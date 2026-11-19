/* Paseo 0.11.2 desktop DOM adapter. Open real host panels via their controls;
 * take them out of flex layout before opening, then restore the closed state.
 * No cloned interactive UI, React internals, reparenting or cancelled input. */
interface Style { getPropertyValue(key: string): string; getPropertyPriority(key: string): string; setProperty(key: string, value: string, priority?: string): void; removeProperty(key: string): void }
interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }
interface Element {
  nodeType: number; parentElement: Element | null; nextElementSibling: Element | null; isConnected: boolean; style: Style; textContent: string | null;
  getAttribute(key: string): string | null; setAttribute(key: string, value: string): void; removeAttribute(key: string): void;
  matches(selector: string): boolean; closest(selector: string): Element | null; querySelector(selector: string): Element | null; querySelectorAll(selector: string): ArrayLike<Element>;
  addEventListener(type: string, listener: Listener, capture?: boolean): void; removeEventListener(type: string, listener: Listener, capture?: boolean): void;
  getBoundingClientRect(): Rect; appendChild(child: Element): void; remove(): void; click?(): void;
}
interface Input { target: Element | null; relatedTarget?: Element | null; clientX?: number; clientY?: number; buttons?: number; pointerType?: string; key?: string; metaKey?: boolean; ctrlKey?: boolean; isComposing?: boolean }
type Listener = (input: Input) => void;
interface Media { matches: boolean; addEventListener(type: string, listener: () => void): void; removeEventListener(type: string, listener: () => void): void }
declare const document: {
  body: Element; head: Element; activeElement: Element | null; hidden: boolean; hasFocus(): boolean;
  createElement(tag: string): Element; querySelectorAll(selector: string): ArrayLike<Element>;
  elementFromPoint(x: number, y: number): Element | null;
  addEventListener(type: string, listener: Listener, capture?: boolean): void; removeEventListener(type: string, listener: Listener, capture?: boolean): void;
};
declare const window: {
  innerWidth: number; innerHeight: number; matchMedia(query: string): Media; getComputedStyle(el: Element): Style;
  requestAnimationFrame(callback: () => void): number; cancelAnimationFrame(id: number): void;
  setTimeout(callback: () => void, ms: number): number; clearTimeout(id: number): void;
  addEventListener(type: string, listener: Listener, capture?: boolean): void; removeEventListener(type: string, listener: Listener, capture?: boolean): void;
};
interface Mutation { target: Element; addedNodes: ArrayLike<Element>; removedNodes: ArrayLike<Element> }
declare const MutationObserver: new (callback: (records: Mutation[]) => void) => {
  observe(element: Element, options: { subtree: boolean; childList: boolean; attributes: boolean; attributeFilter: string[] }): void; disconnect(): void;
};

type Side = 'left' | 'right';
const MARKER = 'data-native-polish-peek';
const OWNER = 'data-native-polish-peek-owner';
const PHASE = 'data-native-polish-peek-phase';
const TRIGGER = 'data-native-polish-peek-trigger';
const LEFT_TOGGLE = '[data-testid="menu-button"][aria-expanded]';
const RIGHT_TOGGLE = '[data-testid="workspace-explorer-toggle"][aria-expanded]';
const RIGHT_HANDLE = '[data-testid="workspace-explorer-sidebar-resize-handle"]';
const RIGHT_HOST = '[id^="file-explorer-gesture-host-"]';
const FLOATING = '[data-menu-surface="true"], [role="dialog"]';
const HEADER = '[data-testid="composer-dock-header"]';
const CONTROL = 'button, [role="button"], [data-testid]';
const INPUT = 'input,textarea,select,[contenteditable="true"],[role="textbox"]';
const DELAY = 180;
const LEAVE_DELAY = 260;
const padding = (el: Element, property: string) => parseFloat(window.getComputedStyle(el).getPropertyValue(property)) || 0;
const visible = (el: Element) => { const r = el.getBoundingClientRect(); return el.isConnected && r.width > 1 && r.height > 1; };
const inside = (el: Element | null, root: Element) => {
  for (let at = el; at; at = at.parentElement) if (at === root) return true;
  return false;
};

export function installEdgePeek(options: {
  enabled(): boolean; motion(): boolean; quick(): boolean; width(): number;
  panels(): Map<string, Element>; onTransition(): void;
  reveal(side: Side): (() => void) | null;
}) {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  let disposed = false;
  let internalClick = false;
  let blocked: Side | null = null;
  let pointer: { x: number; y: number; buttons: number } | null = null;
  let candidate: Side | null = null;
  let enterTimer = 0, leaveTimer = 0, phaseTimer = 0, restoreTimer = 0, blurTimer = 0;
  let restoreFrame = 0, settleFrame = 0;
  let settling = false;
  let conceal: (() => void) | null = null;
  let header: { side: Side; anchor: Element; edge: number; candidates: { el: Element; padding: number }[]; release: (() => void) | null } | null = null;
  let current: { side: Side; toggle: Element; root: Element | null; closing: boolean; restoring: boolean; activated: boolean } | null = null;
  const css = document.createElement('style');
  // The host/sibling selectors apply during React's first mounting commit, before
  // ResizeObserver/onLayout or our MutationObserver can see the new dock.
  const right = `body[${MARKER}="right"] ${RIGHT_HOST}, body[${MARKER}="right"] ${RIGHT_HANDLE} + div`;
  const rightOpening = `body[${MARKER}="right"][${PHASE}="opening"] [${OWNER}], body[${MARKER}="right"][${PHASE}="opening"] ${RIGHT_HOST}, body[${MARKER}="right"][${PHASE}="opening"] ${RIGHT_HANDLE} + div`;
  const rightClosing = `body[${MARKER}="right"][${PHASE}="closing"] [${OWNER}], body[${MARKER}="right"][${PHASE}="closing"] ${RIGHT_HOST}, body[${MARKER}="right"][${PHASE}="closing"] ${RIGHT_HANDLE} + div`;
  const owners = `body[${MARKER}] [${OWNER}], ${right}`;
  css.textContent = `
    [${TRIGGER}] {
      position: fixed; top: 44px; bottom: 8px; width: var(--native-polish-peek-edge, 7px);
      z-index: 79; background: transparent; pointer-events: none;
    }
    [${TRIGGER}="left"] { left: 0; }
    [${TRIGGER}="right"] { right: 0; }
    [${TRIGGER}][data-native-polish-peek-ready] { pointer-events: auto; }
    ${owners} {
      position: fixed !important; top: 0 !important; bottom: 0 !important;
      height: auto !important; max-width: calc(100vw - 72px) !important;
      margin: 0 !important; flex: none !important; z-index: 80 !important;
      box-shadow: 0 0 16px rgb(0 0 0 / 0.14);
    }
    body[${MARKER}="left"] [${OWNER}] { left: 0 !important; right: auto !important; }
    body[${MARKER}="right"] [${OWNER}], ${right} { right: 0 !important; left: auto !important; }
    body[${MARKER}="right"] ${RIGHT_HANDLE} { display: none !important; }
    body[${MARKER}] [${OWNER}] [data-testid="left-sidebar-resize-handle"] { pointer-events: none !important; }
    body[${MARKER}="left"][${PHASE}="opening"] [${OWNER}] { animation: native-polish-peek-left-in var(--native-polish-peek-time) cubic-bezier(.22,1,.36,1) both; }
    ${rightOpening} { animation: native-polish-peek-right-in var(--native-polish-peek-time) cubic-bezier(.22,1,.36,1) both; }
    body[${MARKER}="left"][${PHASE}="closing"] [${OWNER}] { animation: native-polish-peek-left-out var(--native-polish-peek-time) cubic-bezier(.4,0,.8,.2) both; pointer-events: none !important; }
    ${rightClosing} { animation: native-polish-peek-right-out var(--native-polish-peek-time) cubic-bezier(.4,0,.8,.2) both; pointer-events: none !important; }
    @keyframes native-polish-peek-left-in { from { transform: translateX(calc(-100% - 16px)); } to { transform: translateX(0); } }
    @keyframes native-polish-peek-right-in { from { transform: translateX(calc(100% + 16px)); } to { transform: translateX(0); } }
    @keyframes native-polish-peek-left-out { from { transform: translateX(0); } to { transform: translateX(calc(-100% - 16px)); } }
    @keyframes native-polish-peek-right-out { from { transform: translateX(0); } to { transform: translateX(calc(100% + 16px)); } }
    @media (prefers-reduced-motion: reduce) { ${owners} { animation: none !important; } }
  `;
  document.head.appendChild(css);

  // Sandboxed HTML previews have a separate event tree. A narrow host-owned
  // gutter receives hover above them without reading or changing frame content.
  // It reserves only the existing edge zone, has no focus/tab stop and sits
  // below the interactive preview. No synthetic forwarding of frame input.
  const triggers = (['left', 'right'] as const).map(side => {
    const element = document.createElement('div');
    element.setAttribute(TRIGGER, side);
    element.setAttribute('aria-hidden', 'true');
    document.body.appendChild(element);
    return { side, element };
  });

  const available = () => !disposed && options.enabled() && fine.matches && !document.hidden && document.hasFocus();
  const toggleFor = (side: Side) => Array.from(document.querySelectorAll(side === 'left' ? LEFT_TOGGLE : RIGHT_TOGGLE))
    .find(el => visible(el) && typeof el.click === 'function') ?? null;
  const rightDock = () => {
    const panel = options.panels().get('explorer')
      ?? Array.from(document.querySelectorAll(RIGHT_HOST)).find(visible)
      ?? Array.from(document.querySelectorAll(RIGHT_HANDLE)).map(el => el.nextElementSibling).find((el): el is Element => Boolean(el && visible(el)))
      ?? null;
    return panel?.querySelector('[data-testid="workspace-explorer-sidebar"]') ? panel : null;
  };
  const floating = () => Array.from(document.querySelectorAll(FLOATING)).some(visible);
  function refreshTriggers() {
    // Keep hover delivery possible when the focused frame changes. Opening
    // still checks document.hasFocus(), and never focuses a background window.
    const ready = !disposed && options.enabled() && fine.matches && !document.hidden && !current && !settling &&
      document.body.getAttribute(MARKER) === null &&
      Boolean(document.body.querySelector('[data-testid="left-sidebar-resize-handle"]')) && !floating();
    for (const { side, element } of triggers) {
      element.style.setProperty('--native-polish-peek-edge', `${options.width()}px`);
      const active = ready && toggleFor(side)?.getAttribute('aria-expanded') === 'false';
      if (active) element.setAttribute('data-native-polish-peek-ready', '');
      else element.removeAttribute('data-native-polish-peek-ready');
    }
  }
  const edge = () => {
    if (!pointer || pointer.buttons || pointer.y < 44 || pointer.y > window.innerHeight - 8) return null;
    const width = options.width();
    if (pointer.x >= 0 && pointer.x <= width) return 'left';
    if (pointer.x <= window.innerWidth && pointer.x >= window.innerWidth - width) return 'right';
    return null;
  };
  function clearEnter() { window.clearTimeout(enterTimer); enterTimer = 0; candidate = null; }
  function click(toggle: Element) {
    internalClick = true;
    try { toggle.click?.(); } finally { internalClick = false; }
  }
  function stopReveal() { conceal?.(); conceal = null; }
  // Opening a sidebar changes the main header around it: the left sidebar
  // takes the top-left window corner, so the host drops the header's
  // traffic-light inset and menu placeholder; the Explorer moves its toggle
  // out of the header. A preview overlays the canvas instead of taking width,
  // so hold the header items where they were. The anchor is the header item
  // nearest the opening edge that stays; the container is the ancestor that
  // lost the width, found by a shrinking left inset or by having held the toggle.
  function measureHeader(side: Side, toggle: Element) {
    unpinHeader(); header = null;
    const root = Array.from(document.querySelectorAll(HEADER)).find(visible);
    if (!root || (side === 'right' && !inside(toggle, root))) return;
    const property = side === 'left' ? 'padding-left' : 'padding-right';
    const candidates: { el: Element; padding: number }[] = [];
    let anchor: Element | null | undefined;
    if (side === 'left') {
      anchor = Array.from(root.querySelectorAll('*')).find(el => !el.querySelector('*') && el.textContent?.trim() && visible(el));
      for (let at = anchor?.parentElement; at && inside(at, root); at = at.parentElement) candidates.push({ el: at, padding: padding(at, property) });
    } else {
      // The toggle's group (Paseo 0.14: open-in-editor, changes and the
      // toggle) closes up when the toggle leaves. Its rightmost remaining
      // control is the anchor. A full-width titlebar drag region and pane
      // menus outside the group do not move, so they cannot be anchors.
      const controls = (at: Element) => Array.from(at.querySelectorAll(CONTROL)).filter(el => !inside(el, toggle) && !inside(toggle, el) && visible(el));
      let group = toggle.parentElement;
      while (group && inside(group, root) && group !== root && !controls(group).length) group = group.parentElement;
      if (!group || group === root || !inside(group, root)) return;
      anchor = controls(group).reduce<Element | null>((best, el) => !best || el.getBoundingClientRect().right > best.getBoundingClientRect().right ? el : best, null);
      candidates.push({ el: group, padding: padding(group, property) });
    }
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    header = { side, anchor, edge: side === 'left' ? r.left : r.right, candidates, release: null };
  }
  // Runs from the observer, after the host's commit and before paint.
  function pinHeader() {
    // Bounded to the opening commit; streaming updates later must not re-measure.
    if (!header || header.release || !header.anchor.isConnected || document.body.getAttribute(PHASE) !== 'opening') return;
    const r = header.anchor.getBoundingClientRect();
    const shift = header.side === 'left' ? header.edge - r.left : r.right - header.edge;
    if (shift < 1 || shift > 160) return;
    const property = header.side === 'left' ? 'padding-left' : 'padding-right';
    const target = header.side === 'left'
      ? header.candidates.find(({ el, padding: before }) => el.isConnected && padding(el, property) < before - 0.5)
      : header.candidates.find(({ el }) => el.isConnected);
    if (!target) return;
    const { el } = target;
    const previous = el.style.getPropertyValue(property), priority = el.style.getPropertyPriority(property);
    el.style.setProperty(property, `${padding(el, property) + shift}px`, 'important');
    const written = el.style.getPropertyValue(property);
    header.release = () => {
      if (el.style.getPropertyValue(property) !== written) return;
      if (previous) el.style.setProperty(property, previous, priority); else el.style.removeProperty(property);
    };
  }
  function unpinHeader() { header?.release?.(); if (header) header.release = null; }
  // Cascade items once the opened sidebar has its committed layout. Runs at
  // most once per preview, only while it is still sliding in.
  function revealOnce() {
    if (!current?.root || !current.activated || current.closing || conceal || document.body.getAttribute(PHASE) !== 'opening' || !options.motion()) return;
    conceal = options.reveal(current.side);
  }
  function cleanup(handoff = false) {
    stopReveal(); unpinHeader(); header = null;
    window.clearTimeout(phaseTimer); phaseTimer = 0;
    window.clearTimeout(restoreTimer); restoreTimer = 0;
    window.clearTimeout(leaveTimer); leaveTimer = 0;
    window.cancelAnimationFrame(restoreFrame); restoreFrame = 0;
    window.cancelAnimationFrame(settleFrame); settleFrame = 0;
    current?.root?.removeEventListener('pointerleave', onPanelLeave);
    current?.root?.removeAttribute(OWNER);
    current = null;
    settling = !disposed && !handoff;
    const finish = () => {
      settling = false; settleFrame = 0;
      document.body.removeAttribute(MARKER); document.body.removeAttribute(PHASE);
      document.body.style.removeProperty('--native-polish-peek-time');
      // Capture clean host geometry before any ordinary motion can resume.
      options.onTransition(); refreshTriggers();
    };
    if (!settling) { finish(); return; }
    document.body.setAttribute(PHASE, 'settling');
    options.onTransition();
    // aria-expanded and the retained/unmounted dock can commit separately.
    // Keep captures suppressed through the next layout/observer delivery.
    settleFrame = window.requestAnimationFrame(() => {
      options.onTransition();
      settleFrame = window.requestAnimationFrame(finish);
    });
  }
  function awaitClosedLayout() {
    if (!current?.restoring || restoreFrame) return;
    restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = 0;
      if (!current?.restoring) return;
      const root = current.root ?? (current.side === 'right' ? rightDock() : null);
      if (!current.toggle.isConnected) {
        const nextToggle = toggleFor(current.side);
        if (nextToggle) current.toggle = nextToggle;
      }
      const closed = !current.toggle.isConnected || current.toggle.getAttribute('aria-expanded') === 'false';
      if (closed && (!root || !visible(root))) cleanup();
      else awaitClosedLayout();
    });
  }
  function restore(handoff = false) {
    if (!current) return;
    // The observer and phaseTimer can both reach here; a second call would
    // orphan the first restoreTimer, which could later tear down a newer preview.
    if (current.restoring && !handoff) return;
    current.restoring = true;
    // Paseo 0.13+ swaps the header explorer toggle for a sidebar-rail toggle
    // while expanded; rebind to the active control on the current screen.
    if (!current.toggle.isConnected) {
      const nextToggle = toggleFor(current.side);
      if (nextToggle) current.toggle = nextToggle;
    }
    if (current.toggle.isConnected && current.toggle.getAttribute('aria-expanded') === 'true') click(current.toggle);
    if (handoff) { cleanup(true); return; }
    awaitClosedLayout();
    restoreTimer = window.setTimeout(() => {
      // A failed host control must not leave a permanent injected overlay.
      console.warn('[Native Polish] sidebar preview did not restore promptly');
      cleanup();
    }, 700);
  }
  function close(immediate = false, handoff = false) {
    clearEnter(); window.clearTimeout(leaveTimer); leaveTimer = 0;
    if (!current) return;
    if (current.restoring) { if (handoff) cleanup(true); return; }
    if (current.closing && !immediate) return;
    current.closing = true;
    stopReveal();
    window.clearTimeout(phaseTimer);
    options.onTransition();
    document.body.setAttribute(PHASE, 'closing');
    if (immediate || !options.motion()) restore(handoff);
    else phaseTimer = window.setTimeout(() => restore(), options.quick() ? 120 : 170);
  }
  function keepOpen() {
    if (!current || !current.root || current.closing) return false;
    if (pointer?.buttons || floating()) return true;
    if (inside(document.activeElement, current.root) && document.activeElement?.closest(INPUT)) return true;
    if (!pointer) return false;
    const r = current.root.getBoundingClientRect();
    return pointer.x >= r.left - 10 && pointer.x <= r.right + 10 && pointer.y >= r.top && pointer.y <= r.bottom;
  }
  function considerLeave() {
    if (!current || current.closing) return;
    if (keepOpen() || edge() === current.side) { window.clearTimeout(leaveTimer); leaveTimer = 0; return; }
    if (!leaveTimer) leaveTimer = window.setTimeout(() => { leaveTimer = 0; if (!keepOpen()) close(); }, LEAVE_DELAY);
  }
  function enterFrame() {
    // The frame's pointerover follows the parent's pointerout. Neither event
    // may leave a last-known sidebar coordinate latched across documents.
    pointer = null; clearEnter(); considerLeave();
  }
  function onPanelLeave(event: Input) {
    if (!current || current.closing || (event.pointerType && event.pointerType !== 'mouse')) return;
    // pointerleave on the real overlay is authoritative even when Chromium
    // hides the relatedTarget at a sandboxed frame boundary. Later parent
    // moves can still cancel the grace period if the pointer comes back.
    if (event.buttons) {
      pointer = { x: event.clientX ?? 0, y: event.clientY ?? 0, buttons: event.buttons };
    } else pointer = null;
    clearEnter(); considerLeave();
  }
  function open(side: Side) {
    clearEnter();
    if (!available() || current || settling || document.body.getAttribute(MARKER) !== null || floating() || edge() !== side) return;
    const toggle = toggleFor(side);
    if (!toggle || toggle.getAttribute('aria-expanded') !== 'false') return;
    const panels = options.panels();
    const left = panels.get('left');
    // This retained desktop-only handle is absent in compact/mobile layout.
    if (!left?.querySelector('[data-testid="left-sidebar-resize-handle"]')) return;
    current = { side, toggle, root: side === 'left' ? left : null, closing: false, restoring: false, activated: false };
    current.root?.addEventListener('pointerleave', onPanelLeave);
    refreshTriggers();
    current.root?.setAttribute(OWNER, side);
    document.body.style.setProperty('--native-polish-peek-time', `${options.motion() ? (options.quick() ? 120 : 170) : 0}ms`);
    document.body.setAttribute(MARKER, side);
    document.body.setAttribute(PHASE, 'opening');
    options.onTransition();
    measureHeader(side, toggle);
    click(toggle);
    phaseTimer = window.setTimeout(() => {
      phaseTimer = 0;
      if (!current || current.closing) return;
      if (!current.toggle.isConnected) {
        const nextToggle = toggleFor(current.side);
        if (nextToggle) current.toggle = nextToggle;
      }
      if (!current.root && current.side === 'right') {
        const root = rightDock();
        if (root) {
          current.root = root; root.setAttribute(OWNER, 'right');
          root.addEventListener('pointerleave', onPanelLeave);
        }
      }
      if (!current.root || current.toggle.getAttribute('aria-expanded') !== 'true') { close(true); return; }
      document.body.setAttribute(PHASE, 'open');
      options.onTransition(); considerLeave();
    }, options.motion() ? 190 : 32);
  }
  const onMove: Listener = event => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    if (event.target?.closest('iframe')) { enterFrame(); return; }
    if (event.clientX === undefined || event.clientY === undefined) return;
    pointer = { x: event.clientX, y: event.clientY, buttons: event.buttons ?? 0 };
    const side = edge();
    if (blocked && side !== blocked) blocked = null;
    if (current) { considerLeave(); return; }
    if (!side || side === blocked || !available() || floating()) { clearEnter(); return; }
    if (candidate === side) return;
    clearEnter(); candidate = side;
    enterTimer = window.setTimeout(() => open(side), DELAY);
  };
  const onDown: Listener = event => {
    if (internalClick) return;
    clearEnter();
    if (pointer) pointer.buttons = 1;
    if (!current) return;
    // Portal menu actions must reach the host before the panel is deactivated.
    if (event.target?.closest(FLOATING)) return;
    // Close before a real toggle activation so that the user's subsequent
    // host click can open the regular dock, with its normal layout behavior.
    if (!current.root || !inside(event.target, current.root) || inside(event.target, current.toggle)) close(true, inside(event.target, current.toggle));
  };
  const onUp: Listener = () => { if (pointer) pointer.buttons = 0; considerLeave(); };
  const onKey: Listener = event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { blocked = current?.side ?? candidate; close(true); }
    else if (current && (event.metaKey || event.ctrlKey) && ['b', 'e', '.'].includes(event.key?.toLowerCase() ?? '')) close(true, true);
  };
  const onOut: Listener = event => {
    // The next moves will occur inside another document. Do not leave the
    // last sidebar coordinates latched until a parent event happens again.
    if (event.relatedTarget?.matches('iframe')) {
      enterFrame(); return;
    }
    if (event.relatedTarget) return;
    if (event.clientX !== undefined && event.clientY !== undefined && event.clientX > 0 && event.clientX < window.innerWidth && event.clientY > 0 && event.clientY < window.innerHeight) {
      // A null relatedTarget also occurs when a DOM node disappears. Only
      // classify it as crossing into a frame when the host hit-test agrees.
      if (document.elementFromPoint(event.clientX, event.clientY)?.closest('iframe')) enterFrame();
      return;
    }
    pointer = null; clearEnter(); close();
  };
  const reset = () => { pointer = null; blocked = null; close(true); refreshTriggers(); };
  const onBlur: Listener = () => {
    window.clearTimeout(blurTimer);
    // Parent-window blur also fires when focus moves into an iframe. Check
    // the complete document focus chain after the browser finishes the move.
    blurTimer = window.setTimeout(() => {
      blurTimer = 0;
      if (!document.hasFocus() || document.hidden) reset();
      else refreshTriggers();
    }, 0);
  };
  const onFocus: Listener = () => { window.clearTimeout(blurTimer); blurTimer = 0; refreshTriggers(); };
  const observer = new MutationObserver(records => {
    const controls = `${LEFT_TOGGLE},${RIGHT_TOGGLE},[data-testid="left-sidebar-resize-handle"],${FLOATING}`;
    // Refresh gutters only for chrome membership/visibility changes, not for
    // every token streamed into chat or every node rendered inside a pane.
    if (records.some(record => record.target.matches(controls) ||
        [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(node =>
          node.nodeType === 1 && (node.matches(controls) || node.querySelector(controls))))) refreshTriggers();
    if (!current) return;
    if (current.restoring) {
      // The closing commit restores the host inset; release in the same frame.
      if (!current.toggle.isConnected || current.toggle.getAttribute('aria-expanded') !== 'true') unpinHeader();
      awaitClosedLayout();
      return;
    }
    if (!current.toggle.isConnected) {
      const nextToggle = toggleFor(current.side);
      if (!nextToggle) { cleanup(); return; }
      current.toggle = nextToggle;
    }
    if (current.toggle.getAttribute('aria-expanded') !== 'true') {
      if (current.activated) { unpinHeader(); restore(); }
      return;
    }
    current.activated = true;
    pinHeader();
    if (current.side === 'right' && !current.root) {
      const root = rightDock();
      if (root) {
        current.root = root; root.setAttribute(OWNER, 'right');
        root.addEventListener('pointerleave', onPanelLeave);
        considerLeave();
      }
    }
    revealOnce();
    // Streaming chat/list updates do not require layout reads or a menu scan.
    if (records.some(record => record.target === document.body || record.target.closest(FLOATING) ||
        Array.from(record.removedNodes).some(node => node.nodeType === 1 && (node.matches(FLOATING) || node.querySelector(FLOATING))))) considerLeave();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'] });
  refreshTriggers();
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerover', onMove, true);
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointerleave', onOut);
  document.addEventListener('pointerout', onOut, true);
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('visibilitychange', reset);
  document.addEventListener('focusout', onUp, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  window.addEventListener('resize', reset);
  fine.addEventListener('change', reset);
  return {
    isTransitioning: () => internalClick || settling || Boolean(current && (current.closing || document.body.getAttribute(PHASE) === 'opening')),
    refresh() { if (!available()) close(true); refreshTriggers(); },
    dispose() {
      disposed = true; close(true); cleanup(); clearEnter(); observer.disconnect(); css.remove();
      window.clearTimeout(blurTimer); for (const { element } of triggers) element.remove();
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerover', onMove, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointerleave', onOut);
      document.removeEventListener('pointerout', onOut, true);
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', reset);
      document.removeEventListener('focusout', onUp, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('resize', reset);
      fine.removeEventListener('change', reset);
    },
  };
}
