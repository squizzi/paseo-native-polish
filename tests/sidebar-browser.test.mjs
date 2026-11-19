import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';

// Exercise the real adapter in a rendering browser. Only the host-provided
// runtime imports are replaced; geometry, observers and animations are real.
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const modules = new Map([
  ['react-native', moduleUrl('export const Platform = { OS: "web" };')],
  ['react', moduleUrl('export function useSyncExternalStore() {}')],
]);
async function compile(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  let source = ts.transpileModule(await readFile(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const match of [...source.matchAll(/from ["']([^"']+)["']/g)]) {
    const specifier = match[1];
    const dependency = modules.get(specifier) ?? await compile(new URL(`${specifier}.ts`, url));
    source = source.replace(match[0], `from "${dependency}"`);
  }
  const compiled = moduleUrl(source);
  modules.set(url.href, compiled);
  return compiled;
}
const adapter = await compile(new URL('../client/web.ts', import.meta.url));
const preferences = await compile(new URL('../client/preferences.ts', import.meta.url));
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {}),
});
try {
  {
    const page = await browser.newPage();
    await page.setContent(`
      <style>body { margin: 0 } #shell { display: flex; height: 700px }
        #settings { width: 240px; flex-shrink: 0 } main { flex: 1 }</style>
      <button id="open">Settings</button><div id="shell"><main>Workspace</main></div>
    `);
    await page.addScriptTag({ type: 'module', content: `
      import { defaults, setPreferences } from '${preferences}';
      import { installMotion } from '${adapter}';
      setPreferences({ ...defaults, edgePeek: false, elasticScroll: false });
      window.disposeMotion = installMotion();
    ` });
    await page.waitForFunction(() => typeof window.disposeMotion === 'function');
    const result = await page.evaluate(async () => {
      const open = document.getElementById('open');
      const shell = document.getElementById('shell');
      const starts = [];
      const originalAnimate = Element.prototype.animate;
      Element.prototype.animate = function(frames, options) {
        if (this.matches('[data-testid="settings-sidebar"]')) starts.push(frames.map(frame => frame.width));
        return originalAnimate.call(this, frames, options);
      };
      open.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      open.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      open.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const sidebar = document.createElement('nav');
      sidebar.id = 'settings';
      sidebar.dataset.testid = 'settings-sidebar';
      sidebar.innerHTML = '<div><button>General</button></div>';
      shell.prepend(sidebar);
      const widths = [];
      for (let i = 0; i < 22; i++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        widths.push(sidebar.getBoundingClientRect().width);
      }
      const entranceGhosts = document.querySelectorAll('[data-native-polish-ghost]').length;
      open.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      open.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      sidebar.remove();
      await new Promise(resolve => setTimeout(resolve, 0));
      const exit = document.querySelector('[data-native-polish-ghost]');
      const exitWidth = exit?.getBoundingClientRect().width ?? 0;
      await new Promise(resolve => setTimeout(resolve, 300));
      const remainingGhosts = document.querySelectorAll('[data-native-polish-ghost]').length;
      window.disposeMotion();
      Element.prototype.animate = originalAnimate;
      return { starts, widths, entranceGhosts, exitWidth, remainingGhosts };
    });
    assert.equal(result.starts.length, 1, `settings sidebar must enter once: ${JSON.stringify(result)}`);
    assert.ok(result.widths.every((width, index) => !index || width >= result.widths[index - 1] - 1), `settings sidebar must not flash: ${JSON.stringify(result)}`);
    assert.equal(result.widths.at(-1), 240, 'settings sidebar settles at its host width');
    assert.equal(result.entranceGhosts, 0, 'settings entrance creates no exit copies');
    assert.ok(result.exitWidth > 1, 'removing settings still produces a visible exit');
    assert.equal(result.remainingGhosts, 0, 'settings exit releases its copy');
    console.log('settings: one continuous entrance');
    await page.close();
  }
  for (const timing of ['retained-close', 'no-resize', 'legacy', 'rapid-press', 'finish-close', 'native-menu', 'pointerup-commit', 'click-commit', 'frame', 'same-task', 'after-poll']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    await page.setContent(`
      <style>
        body { margin: 0 }
        .shell { display: flex; height: 700px }
        #panel { width: 280px; flex-shrink: 0 }
        #agent-list-gesture-host-fixture { display: none; flex-shrink: 0 }
        main { flex: 1 }
      </style>
      <button id="toggle" data-testid="menu-button">Menu</button>
      <div class="shell">
        <div id="agent-list-gesture-host-fixture"><aside id="panel">
          <div data-testid="sidebar-project-workspace-list-scroll"><div dir="auto">Workspace</div></div>
          <div><div data-testid="left-sidebar-resize-handle"></div></div>
        </aside></div>
        <main>Content</main>
      </div>
    `);
    await page.evaluate(timing => {
      if (timing === 'no-resize') document.querySelector('[data-testid="left-sidebar-resize-handle"]').remove();
      if (timing === 'legacy') {
        const panel = document.getElementById('panel');
        document.getElementById('agent-list-gesture-host-fixture').replaceWith(panel);
        panel.style.display = 'none';
      }
    }, timing);
    await page.addScriptTag({ type: 'module', content: `
      import { defaults, setPreferences } from '${preferences}';
      import { installMotion } from '${adapter}';
      setPreferences({ ...defaults, edgePeek: false, elasticScroll: false });
      window.disposeMotion = installMotion();
    ` });
    await page.waitForFunction(() => typeof window.disposeMotion === 'function');
    const widths = await page.evaluate(async timing => {
      const panel = document.getElementById('panel');
      const host = document.getElementById('agent-list-gesture-host-fixture') ?? panel;
      const toggle = document.getElementById('toggle');
      const visibleWidth = () => Math.min(panel.getBoundingClientRect().width, host.getBoundingClientRect().width);
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      if (timing === 'pointerup-commit' || timing === 'click-commit') {
        toggle.addEventListener(timing === 'pointerup-commit' ? 'pointerup' : 'click', () => {
          host.style.display = 'block';
        }, { once: true });
      }
      if (timing === 'native-menu') {
        // Native menu accelerators can commit without any DOM input event.
        await frame(); await frame();
        toggle.setAttribute('aria-expanded', 'true');
        host.style.display = 'block';
      } else {
        toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        toggle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        if (timing === 'pointerup-commit') await new Promise(resolve => setTimeout(resolve, 0));
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        if (timing === 'same-task') host.style.display = 'block';
        // The bounded layout poll can finish before a delayed host commit.
        if (timing === 'after-poll') for (let i = 0; i < 15; i++) await frame();
        await frame();
        if (timing !== 'same-task') host.style.display = 'block';
      }
      // Yield after this rendering opportunity. Sampling immediately at the
      // mutation would see full width even when no frame actually paints it.
      await new Promise(resolve => setTimeout(resolve, 0));
      const first = visibleWidth();
      await frame();
      await new Promise(resolve => setTimeout(resolve, 0));
      const second = visibleWidth();
      let rapidAfter = second;
      let rapidExit = null, rapidExitBefore = null, rapidExitAfter = null, rapidReopen = null;
      if (timing === 'rapid-press') {
        toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        rapidAfter = visibleWidth();
        toggle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        host.style.display = 'none';
        await new Promise(resolve => setTimeout(resolve, 0));
        const copy = () => document.querySelector('[data-native-polish-ghost]');
        rapidExit = copy()?.getBoundingClientRect().width ?? 0;
        await frame();
        rapidExitBefore = copy()?.getBoundingClientRect().width ?? 0;
        toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        rapidExitAfter = copy()?.getBoundingClientRect().width ?? 0;
        toggle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        host.style.display = 'block';
        await new Promise(resolve => setTimeout(resolve, 0));
        rapidReopen = visibleWidth();
      }
      await new Promise(resolve => setTimeout(resolve, 600));
      const final = visibleWidth();
      toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      toggle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      await frame();
      host.style.display = 'none';
      await new Promise(resolve => setTimeout(resolve, 0));
      const exitCopies = document.querySelectorAll('[data-native-polish-ghost]').length;
      const exitWidth = document.querySelector('[data-native-polish-ghost]')?.getBoundingClientRect().width ?? 0;
      await frame();
      const shrinkingWidth = document.querySelector('[data-native-polish-ghost]')?.getBoundingClientRect().width ?? 0;
      let closed = null, closedCopies = null;
      if (timing === 'finish-close') {
        await new Promise(resolve => setTimeout(resolve, 300));
        closed = visibleWidth();
        closedCopies = document.querySelectorAll('[data-native-polish-ghost]').length;
      }
      // Reopen while the exit still owns a shrinking copy of the retained dock.
      toggle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      toggle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      await frame();
      const reopenedFrom = document.querySelector('[data-native-polish-ghost]')?.getBoundingClientRect().width ?? 0;
      host.style.display = 'block';
      await new Promise(resolve => setTimeout(resolve, 0));
      const reopened = visibleWidth();
      const staleCopies = document.querySelectorAll('[data-native-polish-ghost]').length;
      await new Promise(resolve => setTimeout(resolve, 600));
      window.disposeMotion();
      return { first, second, final, rapidAfter, rapidExit, rapidExitBefore, rapidExitAfter, rapidReopen, exitCopies, exitWidth, shrinkingWidth, closed, closedCopies, reopenedFrom, reopened, staleCopies, animations: document.getAnimations().length,
        ghosts: document.querySelectorAll('[data-native-polish-ghost]').length,
        inline: host.getAttribute('style'), innerStyle: panel.getAttribute('style') ?? '' };
    }, timing);
    assert.equal(errors.length, 0, `${timing}: browser errors: ${errors}`);
    assert.ok(widths.first < 140, `${timing}: full-width flash before animation: ${JSON.stringify(widths)}`);
    assert.ok(widths.second >= widths.first, `${timing}: opening must not shrink: ${JSON.stringify(widths)}`);
    assert.ok(Math.abs(widths.rapidAfter - widths.second) < 2, `${timing}: pointerdown cancels the opening: ${JSON.stringify(widths)}`);
    if (timing === 'rapid-press') {
      assert.ok(widths.rapidExit > 0 && Math.abs(widths.rapidExit - widths.rapidAfter) < 2, `closing reverses from the visible width: ${JSON.stringify(widths)}`);
      assert.ok(Math.abs(widths.rapidExitAfter - widths.rapidExitBefore) < 2, `pointerdown preserves the exit copy: ${JSON.stringify(widths)}`);
      assert.ok(Math.abs(widths.rapidReopen - widths.rapidExitAfter) < 2, `reopening reverses from the exit width: ${JSON.stringify(widths)}`);
    }
    assert.equal(widths.final, 280, `${timing}: settles at host width`);
    assert.ok(widths.exitWidth > 1, `${timing}: closing animation is hidden: ${JSON.stringify(widths)}`);
    assert.ok(widths.shrinkingWidth > 0 && widths.shrinkingWidth < widths.exitWidth, `${timing}: the visible exit copy shrinks`);
    if (timing === 'finish-close') {
      assert.equal(widths.closed, 0, 'closing finishes hidden');
      assert.equal(widths.closedCopies, 0, 'closing releases the exit copy');
    }
    assert.equal(widths.exitCopies, 1, `${timing}: starts the exit before paint`);
    assert.ok(Math.abs(widths.reopened - widths.reopenedFrom) < 2, `${timing}: reopening continues from the exit width: ${JSON.stringify(widths)}`);
    assert.equal(widths.staleCopies, 0, `${timing}: reopening removes the exit copy`);
    assert.equal(widths.animations, 0, `${timing}: cleans up animations`);
    assert.equal(widths.ghosts, 0, `${timing}: cleans up copies`);
    assert.equal(widths.innerStyle, timing === 'legacy' ? 'display: block;' : '', `${timing}: restores content styles`);
    assert.equal(widths.inline, 'display: block;', `${timing}: restores host styles`);
    console.log(`${timing}: ${widths.first} → ${widths.second} → ${widths.final}px, no flash`);
    await page.close();
  }
} finally {
  await browser.close();
}
