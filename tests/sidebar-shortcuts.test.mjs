import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const listeners = new Map();
const frames = new Map();
const timers = new Map();
const animations = [];
let sequence = 0;
let observer;
let commit;
let consumeShortcut = true;

class Element {
  nodeType = 1;
  isConnected = true;
  children = [];
  parentElement = null;
  nextElementSibling = null;
  hidden = false;
  attributes = new Map();
  values = new Map();
  style = {
    getPropertyValue: key => this.values.get(key) ?? "",
    getPropertyPriority: () => "",
    setProperty: (key, value) => this.values.set(key, value),
    removeProperty: key => this.values.delete(key),
  };
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  matches(selector) {
    return selector.split(",").some(part => {
      if (part.includes('id^="agent-list-gesture-host-"')) return this.getAttribute("id")?.startsWith("agent-list-gesture-host-");
      if (part.includes('id^="file-explorer-gesture-host-"')) return this.getAttribute("id")?.startsWith("file-explorer-gesture-host-");
      const testid = part.match(/^\s*\[data-testid="([^"]+)"\]$/);
      if (testid) return this.getAttribute("data-testid") === testid[1];
      const attribute = part.match(/^\s*\[([\w-]+)\]$/);
      return attribute ? this.attributes.has(attribute[1]) : false;
    });
  }
  closest(selector) {
    for (let at = this; at; at = at.parentElement) if (at.matches(selector)) return at;
    return null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [ ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector) ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  getBoundingClientRect() {
    for (let at = this; at; at = at.parentElement) {
      if ((at.style.getPropertyValue("display") || (at.hidden ? "none" : "flex")) === "none") return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
    return { left: 0, top: 0, right: 320, bottom: 800, width: 320, height: 800 };
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); }
  insertBefore(child, next) {
    child.parentElement = this;
    const index = this.children.indexOf(next);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  remove() {
    this.isConnected = false;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
  }
  cloneNode(deep) {
    const copy = new Element();
    copy.attributes = new Map(this.attributes);
    copy.values = new Map(this.values);
    if (deep) for (const child of this.children) copy.appendChild(child.cloneNode(true));
    return copy;
  }
  animate(keyframes) {
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    animations.push({ element: this, keyframes, finish });
    return { finished, cancel: finish };
  }
}

const body = new Element();
const head = new Element();
const toggle = new Element();
const left = new Element();
left.setAttribute("id", "agent-list-gesture-host-test");
const handle = new Element();
handle.setAttribute("data-testid", "left-sidebar-resize-handle");
left.appendChild(handle);
body.appendChild(left);
const right = new Element();
right.setAttribute("id", "file-explorer-gesture-host-test");
right.hidden = true;
const explorer = new Element();
explorer.setAttribute("data-testid", "workspace-explorer-sidebar");
right.appendChild(explorer);
body.appendChild(right);
const listen = (type, fn) => { const list = listeners.get(type) ?? []; list.push(fn); listeners.set(type, list); };
const unlisten = (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter(item => item !== fn));

// The host owns the shortcut and consumes it before the plugin listener runs.
listen("keydown", event => {
  if (!(event.metaKey || event.ctrlKey) || !["b", "e"].includes(event.key)) return;
  if (consumeShortcut) event.stopImmediatePropagation();
  const panel = event.key === "b" ? left : right;
  commit = () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("data-testid", event.key === "b" ? "menu-button" : "workspace-explorer-toggle");
    observer([{ type: "attributes", target: toggle, attributeName: "aria-expanded", addedNodes: [], removedNodes: [] }]);
  };
  if (!consumeShortcut) { commit(); commit = null; }
});
const preferences = { enabled: true, sidebars: true, pace: "gentle" };
const modules = {
  "./preferences": { getPreferences: () => preferences, subscribePreferences: () => () => {} },
  "./elastic-scroll": { installElasticScroll: () => ({ refresh() {}, reset() {}, dispose() {}, isActive: () => false }) },
  "./edge-peek": { installEdgePeek: () => ({ refresh() {}, dispose() {}, isTransitioning: () => false }) },
};
const exports = {};
const document = {
  body, head, hidden: false, activeElement: body, hasFocus: () => true,
  querySelector: selector => body.querySelector(selector), createElement: () => new Element(),
  addEventListener() {}, removeEventListener() {},
};
const source = readFileSync(new URL("../client/web.ts", import.meta.url), "utf8");
runInNewContext(ts.transpileModule(source + "\nexport { installWebMotion };", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, {
  exports, require: name => modules[name] ?? {}, console: { info() {} },
  document,
  window: {
    innerWidth: 1200, innerHeight: 800,
    localStorage: { getItem: () => null },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: element => ({ getPropertyValue: key => element.style.getPropertyValue(key) || ({ display: element.hidden ? "none" : "flex", position: "relative" }[key] ?? "") }),
    addEventListener: listen, removeEventListener: unlisten,
    requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => { timers.set(++sequence, callback); return sequence; },
    clearTimeout: id => timers.delete(id),
  },
  MutationObserver: class {
    constructor(callback) { observer = callback; }
    observe() {}
    disconnect() { observer = null; }
  },
});
const dispose = exports.installWebMotion();
function flushFrames() {
  for (const [id, callback] of Array.from(frames)) { frames.delete(id); callback(); }
}
function expireCapture() {
  for (const [id, callback] of Array.from(timers)) { timers.delete(id); callback(); }
  flushFrames();
}
flushFrames();
function key(type, value, target = body) {
  let stopped = false;
  const event = { key: value, target, metaKey: true, stopImmediatePropagation() { stopped = true; } };
  for (const fn of listeners.get(type) ?? []) { fn(event); if (stopped) break; }
}
async function applyCommit() {
  commit?.();
  commit = null;
  flushFrames();
  const width = animations.filter(animation => animation.keyframes.some(frame => "width" in frame));
  for (const animation of animations.splice(0)) animation.finish();
  await Promise.resolve();
  return width;
}

key("keydown", "Meta");
key("keydown", "b");
key("keyup", "Meta");
let width = await applyCommit();
assert.equal(width.length, 1, "left close survives a consumed shortcut and keyup before the commit");
assert.equal(width[0].element.getAttribute("data-native-polish-ghost"), "", "left close keeps the pre-close inert layout");
assert.equal(width[0].keyframes.at(-1).width, "0px");

key("keydown", "Meta");
key("keydown", "b");
width = await applyCommit();
assert.equal(width[0]?.element, left, "left open animates the retained dock");
assert.equal(width[0]?.keyframes[0].width, "0px");

// Reuse the same modifier hold for both right-side transitions.
key("keydown", "e");
width = await applyCommit();
assert.equal(width[0]?.element, right, "right open works without another modifier keydown");
assert.equal(width[0]?.keyframes[0].width, "0px");
key("keydown", "e");
width = await applyCommit();
assert.equal(width[0]?.element, right, "right close animates the real retained dock");
assert.equal(width[0]?.keyframes.at(-1).width, "0px");
key("keyup", "Meta");

expireCapture();
assert.equal(body.querySelectorAll("[data-native-polish-ghost]").length, 0, "completed transitions remove their inert copies");

// Desktop menu accelerators may deliver no DOM modifier/shortcut events.
// Only their real toggle commit reaches the adapter.
key("keydown", "b");
width = await applyCommit();
assert.equal(width.length, 1, "native left close uses the settled baseline without a modifier event");
assert.equal(width[0].keyframes.at(-1).width, "0px");
expireCapture();
key("keydown", "b");
width = await applyCommit();
assert.equal(width[0]?.element, left, "native left open works without DOM keyboard input");
expireCapture();
key("keydown", "e");
width = await applyCommit();
assert.equal(width[0]?.element, right, "native right open uses the settled baseline");
expireCapture();
key("keydown", "e");
width = await applyCommit();
assert.equal(width[0]?.element, right, "native right close uses the settled baseline");
assert.equal(width[0]?.keyframes.at(-1).width, "0px");
expireCapture();

// Older hosts still deliver B/E after committing the shortcut state. The
// modifier baseline must survive that post-commit plugin listener as well.
consumeShortcut = false;
key("keydown", "Meta");
key("keydown", "b");
width = await applyCommit();
assert.equal(width[0]?.keyframes.at(-1).width, "0px", "legacy left close keeps its pre-commit baseline");
key("keydown", "b");
width = await applyCommit();
assert.equal(width[0]?.element, left, "legacy left open still animates after the host commits first");
assert.equal(width[0]?.keyframes[0].width, "0px");
key("keydown", "e");
width = await applyCommit();
assert.equal(width[0]?.element, right, "legacy right open preserves the modifier baseline");
assert.equal(width[0]?.keyframes[0].width, "0px");
key("keydown", "e");
width = await applyCommit();
assert.equal(width[0]?.keyframes.at(-1).width, "0px", "legacy right close still animates");
key("keyup", "Meta");
expireCapture();
consumeShortcut = true;
const editor = new Element();
editor.setAttribute("data-testid", "file-source-editor");
document.activeElement = editor;
key("keydown", "Meta", editor);
key("keydown", "b", editor);
assert.equal((await applyCommit()).length, 0, "editor shortcuts do not arm a global capture");
dispose();
assert.equal((listeners.get("keydown") ?? []).length, 1, "cleanup keeps only the host listener");
assert.equal((listeners.get("keyup") ?? []).length, 0);
console.log("sidebar shortcut tests passed");
