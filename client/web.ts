import { Platform } from "react-native";
import { defaults, getPreferences, setPreferences, subscribePreferences } from "./preferences";
import { installElasticScroll } from "./elastic-scroll";
import { installEdgePeek } from "./edge-peek";
import { shouldAnimateFooterRise } from "./footer-motion";
import { leaseMotion } from "./motion-runtime";
import { toolDetailTextTransition } from "./tool-detail-motion";
import { shouldQueueMessageEntrance } from "./message-entry-motion";

/* Desktop/Web adapter for Paseo 0.11.2. Host DOM is not a public plugin API.
 * Keep selectors here; native clients never touch these globals. No host events
 * are cancelled, no React internals are accessed, and no agent content is sent.
 */
interface Rect { left: number; top: number; width: number; height: number; right: number; bottom: number }
interface Style {
  getPropertyValue(key: string): string;
  getPropertyPriority(key: string): string;
  setProperty(key: string, value: string, priority?: string): void;
  removeProperty(key: string): void;
}
interface Animation {
  cancel(): void; finished: Promise<unknown>;
  /** CSS animations only. */
  animationName?: string;
  effect?: { getKeyframes?(): Record<string, unknown>[] } | null;
}
interface TextNode { nodeType: number; textContent: string | null }
interface TreeWalker { nextNode(): TextNode | null }
interface TextRange {
  setStart(node: TextNode, offset: number): void;
  setEnd(node: TextNode, offset: number): void;
  getClientRects(): ArrayLike<Rect>;
}
interface Element {
  nodeType: number; parentElement: Element | null; nextElementSibling: Element | null; children: ArrayLike<Element>;
  style: Style; isConnected: boolean; textContent: string | null;
  scrollTop: number; scrollLeft: number; scrollHeight: number; clientWidth: number; clientHeight: number;
  closest(selector: string): Element | null;
  matches(selector: string): boolean;
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): ArrayLike<Element>;
  addEventListener(type: string, callback: Listener): void;
  removeEventListener(type: string, callback: Listener): void;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getBoundingClientRect(): Rect;
  cloneNode(deep: boolean): Element;
  appendChild(child: Element): void;
  insertBefore(child: Element, next: Element | null): void;
  remove(): void;
  animate(frames: Record<string, string | number>[], options: { duration: number; easing: string; fill?: string; delay?: number }): Animation;
  getAnimations?(): Animation[];
}
interface Event { target: Element | null; animationName?: string; key?: string; keyCode?: number; isComposing?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; repeat?: boolean; button?: number; buttons?: number; clientX?: number; clientY?: number }
type Listener = (event: Event) => void;
interface Media { matches: boolean; addEventListener(type: string, callback: () => void): void; removeEventListener(type: string, callback: () => void): void }
declare const document: {
  body: Element; head: Element;
  hidden: boolean;
  hasFocus(): boolean;
  querySelectorAll(selector: string): ArrayLike<Element>;
  createElement(tag: string): Element;
  createRange(): TextRange;
  createTreeWalker(root: Element, whatToShow: number): TreeWalker;
  addEventListener(type: string, callback: Listener, capture?: boolean): void;
  removeEventListener(type: string, callback: Listener, capture?: boolean): void;
};
declare const window: {
  innerWidth: number; innerHeight: number;
  getComputedStyle(element: Element): Style;
  matchMedia(query: string): Media;
  requestAnimationFrame(callback: (timestamp: number) => void): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
  localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  addEventListener(type: string, callback: Listener, capture?: boolean): void;
  removeEventListener(type: string, callback: Listener, capture?: boolean): void;
};
interface Mutation { type: string; target: Element; attributeName: string | null; addedNodes: ArrayLike<Element>; removedNodes: ArrayLike<Element> }
declare const MutationObserver: new (callback: (records: Mutation[]) => void) => { observe(target: Element, options: { subtree: boolean; childList: boolean; attributes: boolean; attributeFilter: string[]; characterData?: boolean }): void; disconnect(): void };

const TOOL = '[data-testid="tool-call-badge"], [data-testid="tool-call-group"]';
const FILE_TREE = '[data-testid="file-explorer-tree-scroll"]';
const FILE_ROW = '[data-testid^="file-explorer-row-"]:not([data-testid$="-name"])';
const CHANGE_TREE = '[data-testid="changes-file-tree"]';
const CHANGE_ROW = '[data-testid^="diff-folder-"]:not([data-testid$="-toggle"]):not([data-testid$="-name"]):not([data-testid$="-stat"]), [data-testid^="diff-tree-file-"]:not([data-testid$="-name"])';
const PROJECT = '[data-testid^="sidebar-project-row-"]';
const STATUS = '[data-testid^="sidebar-status-group-"]:not([data-testid^="sidebar-status-group-rows-"]):not([data-testid^="sidebar-status-group-show-more-"])';
const WORKSPACE_ROW = '[data-testid^="sidebar-workspace-row-"]';
const WORKSPACE_SCROLL = '[data-testid="sidebar-project-workspace-list-scroll"], [data-testid="sidebar-status-list-scroll"]';
const WORKSPACE_SECTION = '[data-testid^="sidebar-workspace-list-"], [data-testid="sidebar-pinned-list"], [data-testid^="sidebar-status-group-rows-"]';
const WORKSPACE_ANCHOR = WORKSPACE_ROW + ', ' + PROJECT + ', ' + STATUS + ', [data-testid="sidebar-pinned-section-header"], [data-testid*="sidebar-"][data-testid*="show-more"]';
const PREF_KEY = 'paseo-native-polish:preferences:v1';
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const all = (root: Element, selector: string) => Array.from(root.querySelectorAll(selector));
const rect = (el: Element) => el.getBoundingClientRect();
const visible = (el: Element) => {
  const r = rect(el);
  return el.isConnected && r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < window.innerHeight;
};
const elementOf = (el: Element | null) => el?.nodeType === 1 ? el : el?.parentElement ?? null;
function hasAncestor(el: Element, ancestors: Iterable<Element>): boolean {
  const owners = new Set(ancestors);
  for (let parent = el.parentElement; parent; parent = parent.parentElement) if (owners.has(parent)) return true;
  return false;
}

function nearestPaintedBackground(element: Element): string {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const background = window.getComputedStyle(current).getPropertyValue('background-color');
    const transparent = background === 'transparent' || /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(background);
    if (background && !transparent) return background;
  }
  return 'transparent';
}

function appendedTextRange(owner: Element, start: number): TextRange | null {
  const walker = document.createTreeWalker(owner, 4);
  const nodes: TextNode[] = [];
  let total = 0;
  let startNode: TextNode | null = null;
  let startOffset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    nodes.push(node);
    if (!startNode && start <= total + length) {
      startNode = node;
      startOffset = Math.max(0, start - total);
    }
    total += length;
  }
  const endNode = nodes[nodes.length - 1];
  if (!startNode || !endNode || start >= total) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endNode.textContent?.length ?? 0);
  return range;
}

interface Snapshot { element: Element; box: Rect; copy: Element; parent: Element | null; next: Element | null }
interface Disclosure { element: Element; height: number; children: Element[]; details: Snapshot[] }
interface RowSnapshot extends Snapshot { key: string }
interface Tree { element: Element; rows: RowSnapshot[] }
interface PaneBox { element: Element; box: Rect }
interface Capture { panels: Map<string, Snapshot>; panes: Map<string, PaneBox>; paneAction: boolean; paneMotion: boolean; disclosure: Disclosure | null; tree: Tree | null }
const PANE = '[data-testid^="workspace-pane-"]';
const PANE_ACTION = '[data-testid="workspace-maximize-pane"], [data-testid="workspace-restore-pane"]';
const TAB = '[data-testid^="workspace-tab-"][role="button"][aria-selected]';
const TAB_ROW = '[data-testid="workspace-tabs-scroll"]';
// Tooltips are transient hover affordances. Giving their text an entrance and
// a cloned exit makes it flash both when the pointer arrives and when it goes.
const FLOATING = '[data-menu-surface="true"], [role="dialog"]';
const CHAT = '[data-testid="agent-chat-scroll"]';
const HISTORY_ROW = '[data-history-row-id]';
const CHAT_TIMELINE = '[data-testid="agent-chat-timeline"]';
const CHAT_CONTENT = '[data-testid="agent-chat-content"]';
const EDITING = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[data-testid="file-source-editor"],.cm-editor,.monaco-editor,[data-testid="terminal-surface"],.xterm';
// Some RN web Pressables omit a role. Keep the known interactive tree/sidebar
// rows and pane actions eligible without capturing arbitrary content clicks.
const ACTION = 'button,a,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="treeitem"],[role="separator"],[data-testid="left-sidebar-resize-handle"],[tabindex="0"][aria-label],'
  + PANE_ACTION + ',' + WORKSPACE_ANCHOR + ',' + FILE_ROW + ',' + CHANGE_ROW;
const live = (selector: string) => all(document.body, selector).filter(el => !el.closest('[data-native-polish-ghost]') && visible(el));
function firstBoxChild(el: Element): Element | null {
  const child = Array.from(el.children)[0];
  if (!child) return null;
  return window.getComputedStyle(child).getPropertyValue('display') === 'contents' ? firstBoxChild(child) : child;
}
function tabSlot(tab: Element, scroll: Element): Element {
  let slot = tab;
  while (slot.parentElement && slot.parentElement !== scroll) {
    const parent = slot.parentElement;
    if (window.getComputedStyle(parent).getPropertyValue('flex-direction') === 'row' && parent.querySelectorAll(TAB).length > 1) break;
    // The scroll content is also a row when it only has one tab.
    if (parent.parentElement === scroll) break;
    slot = parent;
  }
  return slot;
}
const chevron = (svg: Element) => Array.from(svg.querySelectorAll('path')).some(path => /^m9\s*18\s*6-6-6-6$/i.test(path.getAttribute('d') ?? ''));
function paneBoxes(): Map<string, PaneBox> {
  return new Map(all(document.body, PANE).filter(visible).map(element => [element.getAttribute('data-testid')!, { element, box: rect(element) }]));
}
function layoutParent(element: Element): Element | null {
  let parent = element.parentElement;
  while (parent && window.getComputedStyle(parent).getPropertyValue('display') === 'contents') parent = parent.parentElement;
  return parent;
}
function panelOwner(element: Element): Element {
  if (element.getAttribute('data-testid') !== 'workspace-explorer-sidebar') return element;
  // Explorer content -> RetainedPanel (flex:1) -> fixed-width dock. Unistyles
  // puts the dock's width in a class, so an inline-style search cannot find it.
  const retained = layoutParent(element);
  return retained ? layoutParent(retained) ?? retained : element;
}

function panels(): Map<string, Element> {
  const result = new Map<string, Element>();
  const resize = document.body.querySelector('[data-testid="left-sidebar-resize-handle"]');
  if (resize?.parentElement) {
    // GestureDetector adds a display:contents wrapper. On touch there is also
    // an absolutely positioned handle layer. The border's parent owns width.
    // This structure remains stable when display:none makes every rect zero.
    let border = layoutParent(resize);
    if (border && window.getComputedStyle(border).getPropertyValue('position') === 'absolute') border = layoutParent(border);
    const owner = border ? layoutParent(border) : null;
    if (owner) result.set('left', owner);
  }
  // Compact headers do not mount the desktop resize handle; only discover the
  // fallback within the sidebar's own list ancestry, never arbitrary app divs.
  if (!result.has('left')) {
    const list = document.body.querySelector('[data-testid="sidebar-project-workspace-list-scroll"], [data-testid="sidebar-status-list-scroll"]');
    let cursor = list;
    while (cursor?.parentElement) {
      const r = rect(cursor);
      if (r.height > 240 && r.width > 120 && r.width < 450 && cursor.querySelector('[data-testid="sidebar-pinned-section"]')) result.set('left', cursor);
      if (rect(cursor.parentElement).width > 500) break;
      cursor = cursor.parentElement;
    }
  }
  for (const [name, selector] of [
    ['explorer', '[data-testid="workspace-explorer-sidebar"]'],
    ['explorer-dock', '[data-testid="native-explorer-sidebar-dock"]'],
    ['settings', '[data-testid="settings-sidebar"]'],
    ['changes-rail', '[data-testid="changes-tree-rail-tree"]'],
  ]) {
    const el = all(document.body, selector).find(visible);
    if (el) result.set(name, panelOwner(el));
  }
  // Only the outer width owner animates. A nested Changes rail must travel
  // with its Explorer/sidebar instead of running a second width animation.
  const owners = Array.from(result.values());
  const seen = new Set<Element>();
  for (const [key, el] of result) {
    if (seen.has(el) || hasAncestor(el, owners)) result.delete(key);
    else seen.add(el);
  }
  return result;
}

function snapshot(el: Element): Snapshot { return { element: el, box: rect(el), copy: el.cloneNode(true), parent: el.parentElement, next: el.nextElementSibling }; }
function disclosureFor(target: Element): Element | null {
  const tool = target.closest(TOOL);
  if (tool) {
    // Only the header toggles disclosure. Detail links, selection, file-open
    // buttons and nested tools keep their own existing behavior.
    const header = Array.from(tool.children)[0];
    if (header && target.closest('[role="button"]') === header) return tool;
  }
  const project = target.closest(PROJECT);
  if (project && target.closest('[role="button"]') === project) return project.closest('[role="group"]');
  const status = target.closest(STATUS);
  if (status) return status.parentElement?.parentElement ?? null;
  const expanded = target.closest('[role="button"][aria-expanded]');
  if (expanded?.closest('[data-testid^="sidebar-"]')) return expanded.parentElement;
  return null;
}
function captureDisclosure(el: Element | null): Disclosure | null {
  if (!el || !visible(el)) return null;
  const children = Array.from(el.children);
  return { element: el, height: rect(el).height, children, details: children.slice(1).filter(visible).map(snapshot) };
}
function captureTree(target: Element): Tree | null {
  const tree = target.closest(FILE_TREE + ', ' + CHANGE_TREE);
  if (!tree) return null;
  const rows = all(tree, tree.matches(CHANGE_TREE) ? CHANGE_ROW : FILE_ROW);
  // Rows are keyed by hierarchy and name, because the host's numeric test IDs
  // shift on every expand/collapse. Indentation distinguishes nested duplicates.
  const stack: { depth: number; name: string }[] = [];
  const snapshots: RowSnapshot[] = [];
  for (const row of rows) {
    if (!visible(row)) continue;
    const depth = parseFloat(window.getComputedStyle(row).getPropertyValue('padding-left')) || 0;
    const name = row.querySelector('[data-testid$="-name"]')?.textContent ?? row.textContent ?? '';
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const key = JSON.stringify([...stack.map(item => item.name), name]);
    stack.push({ depth, name });
    // Match the bounded tree animation budget; do not deep-copy an arbitrary
    // number of visible rows on the input path.
    if (snapshots.length < 120) snapshots.push({ ...snapshot(row), key });
  }
  return { element: tree, rows: snapshots };
}

export function installMotion(): () => void {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  return leaseMotion('0.4.16', installWebMotion);
}

function installWebMotion(): () => void {
  document.body.setAttribute("data-native-polish", "0.4.16");

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREF_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const next = { ...defaults };
      for (const key of ['enabled', 'sidebars', 'trees', 'timeline', 'panes', 'tabs', 'overlays', 'controls', 'states', 'messages', 'elasticScroll', 'edgePeek'] as const) if (typeof saved[key] === 'boolean') next[key] = saved[key];
      if (saved.pace === 'quick') next.pace = 'quick';
      setPreferences(next);
    }
  } catch { /* A blocked storage area should not disable motion. */ }
  console.info('[Native Polish] loaded', JSON.stringify({ version: '0.4.16', preferences: getPreferences(), reduceMotion: reduceMotion.matches }));
  let disposed = false;
  let pending: Capture | null = null;
  let frame = 0;
  let deadline = 0;
  let layoutPolling = 0;
  let passiveFrame = 0;
  let quietUntil = 0;
  let workspaceQuietUntil = 0;
  let pointerOrigin: { x: number; y: number } | null = null;
  let suspended = document.hidden || !document.hasFocus();
  let composing = false;
  const panelExits = new Set<Element>();
  const panelEntries = new Set<Element>();
  const active = new Map<Element, () => void>();
  const ghosts = new Set<Element>();
  let edgePeek: ReturnType<typeof installEdgePeek> | null = null;
  const motionReady = () => !disposed && !suspended && !edgePeek?.isTransitioning() && getPreferences().enabled && !reduceMotion.matches;
  // Layout captures stay off while an edge preview is open; its scrolling is
  // still ordinary list input, so elastic rebound uses motionReady alone.
  const canAnimate = () => motionReady() && document.body.getAttribute('data-native-polish-peek') === null;
  const duration = () => getPreferences().pace === 'quick' ? 150 : 220;

  const stopAll = () => {
    for (const stop of Array.from(active.values())) stop();
    for (const ghost of ghosts) ghost.remove();
    ghosts.clear();
  };
  function animate(el: Element, frames: Record<string, string | number>[], cleanup?: () => void, delay = 0, milliseconds = duration()) {
    active.get(el)?.();
    if (!canAnimate() || typeof el.animate !== 'function') { cleanup?.(); return; }
    let animation: Animation;
    try { animation = el.animate(frames, { duration: milliseconds, easing: EASING, fill: 'both', delay }); }
    catch { cleanup?.(); return; }
    let finished = false;
    const stop = () => {
      if (finished) return;
      finished = true;
      animation.cancel();
      if (active.get(el) === stop) active.delete(el);
      cleanup?.();
    };
    active.set(el, stop);
    void animation.finished.then(stop, stop);
  }
  function temporaryStyles(el: Element, values: Record<string, string>): () => void {
    const previous = Object.keys(values).map(key => [key, el.style.getPropertyValue(key), el.style.getPropertyPriority(key)]);
    for (const [key, value] of Object.entries(values)) el.style.setProperty(key, value);
    return () => {
      for (const [key, value, priority] of previous) {
        // Restore only values still owned by us; React may have updated a style.
        if (el.style.getPropertyValue(key) !== values[key]) continue;
        if (value) el.style.setProperty(key, value, priority);
        else el.style.removeProperty(key);
      }
    };
  }
  function exitCopy(before: Snapshot): Element {
    const copy = before.copy;
    copy.setAttribute('data-native-polish-ghost', '');
    copy.setAttribute('aria-hidden', 'true');
    copy.setAttribute('inert', '');
    for (const el of [copy, ...all(copy, '[data-testid], [id], [autofocus], [data-menu-surface], [data-history-row-id], [data-message-id]')]) {
      el.removeAttribute('data-testid'); el.removeAttribute('id'); el.removeAttribute('autofocus');
      el.removeAttribute('data-menu-surface'); el.removeAttribute('data-history-row-id'); el.removeAttribute('data-message-id');
    }
    for (const el of all(copy, 'iframe, video, audio, input, textarea')) el.remove();
    return copy;
  }
  function ghost(before: Snapshot, horizontal = 0) {
    const copy = exitCopy(before);
    const style = window.getComputedStyle(before.element);
    const r = before.box;
    const values: Record<string, string> = {
      position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      margin: '0', 'box-sizing': 'border-box', overflow: 'hidden', 'pointer-events': 'none', 'z-index': '90',
      color: style.getPropertyValue('color'), 'font-family': style.getPropertyValue('font-family'),
    };
    for (const [key, value] of Object.entries(values)) copy.style.setProperty(key, value, 'important');
    document.body.appendChild(copy);
    ghosts.add(copy);
    animate(copy, [{ opacity: 1, transform: 'translate(0,0)', clipPath: 'inset(0 0 0 0)' }, { opacity: 0, transform: `translate(${horizontal}px,-3px)`, clipPath: horizontal ? 'inset(0 0 0 0)' : 'inset(0 0 100% 0)' }], () => { copy.remove(); ghosts.delete(copy); });
  }
  function revealPanel(el: Element) {
    const width = rect(el).width;
    if (width < 2) return;
    const content = Array.from(el.children).find(child => rect(child).width > width / 2);
    const restoreContent = content ? temporaryStyles(content, { 'min-width': `${width}px` }) : () => {};
    const restore = temporaryStyles(el, { overflow: 'hidden', 'min-width': '0', 'box-sizing': 'border-box', 'flex-shrink': '0' });
    panelEntries.add(el);
    animate(el, [{ width: '0px', opacity: 0.4 }, { width: `${width}px`, opacity: 1 }], () => { restoreContent(); restore(); panelEntries.delete(el); });
  }
  function hidePanel(before: Snapshot, key: string) {
    const el = before.element;
    if (!el.isConnected) {
      if (!before.parent?.isConnected) { ghost(before, key === 'left' ? -before.box.width : before.box.width); return; }
      // Explorer is unmounted on close. An inert copy in the original flex
      // slot lets the adjacent panes expand progressively instead of jumping.
      const copy = exitCopy(before);
      const values: Record<string, string> = { display: 'flex', position: 'relative', width: `${before.box.width}px`, height: `${before.box.height}px`, 'min-width': '0', 'flex-shrink': '0', 'box-sizing': 'border-box', overflow: 'hidden', 'pointer-events': 'none' };
      // An !important width would override the Web Animations width frames.
      for (const [property, value] of Object.entries(values)) copy.style.setProperty(property, value, property === 'width' ? '' : 'important');
      const content = Array.from(copy.children)[0];
      content?.style.setProperty('min-width', `${before.box.width}px`);
      before.parent.insertBefore(copy, before.next?.parentElement === before.parent ? before.next : null);
      ghosts.add(copy);
      animate(copy, [{ width: `${before.box.width}px`, opacity: 1 }, { width: '0px', opacity: 0.3 }], () => { copy.remove(); ghosts.delete(copy); });
      return;
    }
    // Left sidebar is retained with display:none. Keep its real layout slot
    // for the duration of the exit, while preserving host aria-hidden/input state.
    panelExits.add(el);
    const restore = temporaryStyles(el, { display: 'flex', overflow: 'hidden', 'min-width': '0', 'box-sizing': 'border-box', 'pointer-events': 'none', 'flex-shrink': '0' });
    el.style.setProperty('display', 'flex', 'important');
    const content = Array.from(el.children)[0];
    const restoreContent = content ? temporaryStyles(content, { 'min-width': `${before.box.width}px` }) : () => {};
    animate(el, [{ width: `${before.box.width}px`, opacity: 1 }, { width: '0px', opacity: 0.3 }], () => { restoreContent(); restore(); panelExits.delete(el); });
  }
  function animatePanes(before: Map<string, PaneBox>, after: Map<string, PaneBox>) {
    let changed = false;
    for (const [key, next] of after) {
      if (active.has(next.element)) continue;
      const old = before.get(key);
      if (!old) {
        // Retained split children can become visible before Reanimated commits
        // their flex sizes. Keep waiting for the existing pane's geometry too.
        animate(next.element, [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }]);
        continue;
      }
      const dx = old.box.left - next.box.left;
      const dy = old.box.top - next.box.top;
      const sx = old.box.width / next.box.width;
      const sy = old.box.height / next.box.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.002 && Math.abs(sy - 1) < 0.002) continue;
      changed = true;
      const restore = temporaryStyles(next.element, { 'transform-origin': '0 0', overflow: 'hidden' });
      animate(next.element, [{ transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transform: 'translate(0,0) scale(1,1)' }], restore);
    }
    return changed;
  }
  function animateDisclosure(before: Disclosure) {
    const el = before.element;
    if (!visible(el)) return;
    const children = Array.from(el.children);
    // Streamed text, syntax highlighting and hover updates must not trigger a
    // new expand animation. Only a change in the direct detail children does.
    if (children.length === before.children.length && children.every((child, index) => child === before.children[index])) return;
    const height = rect(el).height;
    if (Math.abs(height - before.height) < 2) return;
    active.get(el)?.();
    const restore = temporaryStyles(el, { overflow: 'hidden', 'box-sizing': 'border-box', 'min-height': '0' });
    animate(el, [{ height: `${before.height}px` }, { height: `${height}px` }], restore);
    if (height > before.height) {
      for (const detail of children.slice(1)) {
        if (before.children.includes(detail)) continue;
        animate(detail, [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }]);
      }
    } else for (const detail of before.details) if (!detail.element.isConnected) ghost(detail);
  }
  function animateTree(before: Tree, after: Tree | null) {
    if (!after || after.element !== before.element) return;
    const oldRows = new Map(before.rows.map(row => [row.key, row]));
    const nextKeys = new Set(after.rows.map(row => row.key));
    if (before.rows.length === after.rows.length && before.rows.every((row, index) => row.key === after.rows[index].key)) return;
    // Bound work for very large trees; the viewport's rows still move together.
    for (const row of before.rows.slice(0, 80)) if (!nextKeys.has(row.key)) ghost(row);
    let entered = 0;
    for (const row of after.rows.slice(0, 100)) {
      const old = oldRows.get(row.key);
      if (!old) {
        animate(row.element, [{ opacity: 0, transform: 'translateY(-5px)' }, { opacity: 1, transform: 'translateY(0)' }], undefined, Math.min(entered++ * 8, 48));
      } else {
        const delta = old.box.top - row.box.top;
        if (Math.abs(delta) > 1) animate(row.element, [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }]);
      }
    }
  }

  // Persistent observation adds motion to async updates (new tabs/messages and
  // status changes) without relying on a click being in progress. Tool text is
  // compared only in memory to detect appended content; it never leaves the client.
  interface TabState { chip: Element; shot: Snapshot; left: number }
  let tabRows = new Map<Element, Map<string, TabState>>();
  interface WorkspaceAnchor { shot: Snapshot; top: number; left: number; project: string | null }
  interface WorkspaceList {
    keys: Set<string>; anchorKeys: Set<string>; sections: Map<string, string | null>; projectKeys: Set<string>;
    projects: Map<string, Snapshot>; anchors: Map<string, WorkspaceAnchor>; expanded: Map<string, string | null>;
  }
  let workspaceLists = new Map<Element, WorkspaceList>();
  interface FloatingSnapshot extends Snapshot { opacity: number; hostExit: boolean }
  let floating = new Map<Element, FloatingSnapshot>();
  let paneBaseline = paneBoxes();
  let paneTransition: Map<string, PaneBox> | null = null;
  let paneTransitionUntil = 0;
  let fileIcons = new Map<Element, string>();
  let toolIcons = new Map<Element, string>();
  let toolStates = new Map<Element, boolean>();
  interface ToolLabelState { primary: string; primaryWidth: number; secondary: string; secondaryWidth: number }
  let toolLabels = new Map<Element, ToolLabelState>();
  let agentStates = new Map<Element, string>();
  const tabSettling = new WeakMap<Element, number>();
  interface ChatState {
    seen: Set<string>;
    seenCompactions: Set<string>;
    pending: Set<string>;
    running: boolean;
    completedFooterPendingUntil: number;
    scrollTop: number;
    compensatedScrollTop: number;
    maxScrollTop: number;
    clientWidth: number;
    footer: Element | null;
    footerTop: number | null;
    stream: StreamRowState | null;
    handoff: (StreamRowState & { expires: number }) | null;
    handoffQuietUntil: number;
    hydrationQuietUntil: number;
    reflowQuietUntil: number;
  }
  interface StreamRowState { id: string; index: number; text: string }
  interface ContentRise { start(distance: number): void; prepare(distance: number): void; cancel(): void; getOffset(): number }
  const chats = new WeakMap<Element, ChatState>();
  const chatDisclosureQuietUntil = new WeakMap<Element, number>();
  const timelineRises = new WeakMap<Element, ContentRise>();
  const footerRises = new WeakMap<Element, ContentRise>();
  const contentRises = new Set<ContentRise>();
  interface ToolDetailTextState { text: string; owner: Element }
  interface ToolDetailReveal { owner: Element; range: TextRange; root: Element; covers: Element[] }
  let toolDetailText = new Map<Element, ToolDetailTextState>();
  const toolDetailReveals = new Set<ToolDetailReveal>();
  const decorations = new Map<Element, () => void>();
  type Region = 'controls' | 'workspaces' | 'tabs' | 'floating' | 'panes' | 'agents' | 'files' | 'tools' | 'messages' | 'elastic';
  const regions: Region[] = ['controls', 'workspaces', 'tabs', 'floating', 'panes', 'agents', 'files', 'tools', 'messages', 'elastic'];
  const dirty = new Set<Region>();
  let scrollDeadline = 0;
  const elastic = installElasticScroll({
    enabled: () => motionReady() && getPreferences().elasticScroll,
    quick: () => getPreferences().pace === 'quick',
    onRest: () => { quietUntil = Math.max(quietUntil, Date.now() + 350); scheduleAmbient(['workspaces', 'tabs', 'messages']); },
  });
  const stylesheet = document.createElement('style');
  stylesheet.setAttribute('data-native-polish-style', '');
  stylesheet.textContent = `
    body[data-native-polish-controls="true"] :is([role="button"],button,[role="menuitem"],[aria-selected]) {
      transition-property: background-color,color,border-color,outline-color,box-shadow;
      transition-duration: 110ms;
      transition-timing-function: cubic-bezier(0.22,1,0.36,1);
    }
    body[data-native-polish-controls="true"] [data-native-polish-pressable] {
      transition-property: background-color,color,border-color,outline-color,box-shadow,scale;
      transition-duration: 110ms;
    }
    body[data-native-polish-controls="true"] [data-native-polish-pressable]:active:not([aria-disabled="true"]):not(:disabled) { scale: .97; }
    body[data-native-polish-tabs="true"] ${TAB} {
      transition-property: background-color,color,border-color;
      transition-duration: 150ms;
      transition-timing-function: cubic-bezier(0.22,1,0.36,1);
    }
    body[data-native-polish-trees="true"] [data-native-polish-chevron] {
      transition: transform 160ms cubic-bezier(0.22,1,0.36,1);
    }
    body[data-native-polish-states="true"] :is(${TAB},[data-testid^="sidebar-workspace-"]) :is(svg,path,circle) {
      transition: color 150ms,stroke 150ms,fill 150ms;
    }
    body[data-native-polish-motion="true"] ${CHAT_TIMELINE} {
      will-change: transform;
    }
    @keyframes native-polish-stream-token {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    [data-native-polish-stream-token="true"] {
      display: inline;
      white-space: pre-wrap;
      overflow: visible;
      line-height: inherit !important;
      animation: native-polish-stream-token 400ms ease-out backwards;
    }
    [data-native-polish-stream-token-host="true"] { white-space: pre-wrap; }
    /* Plugin theme props intentionally expose colors, not Paseo's adjustable
       typography tokens. These variables are sampled from the nearest native
       chat message so the streaming row and its core replacement have the
       same glyph metrics at every content/code/font setting. */
    [data-testid="native-polish-streaming-assistant"] {
      --native-polish-content-size: 15px;
      --native-polish-content-line: 21px;
      --native-polish-code-size: 12px;
      --native-polish-code-line: 17px;
      --native-polish-ui-font: inherit;
      --native-polish-mono-font: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --native-polish-h1-size: 28px; --native-polish-h1-line: 36px;
      --native-polish-h2-size: 24px; --native-polish-h2-line: 31px;
      --native-polish-h3-size: 21px; --native-polish-h3-line: 27px;
      --native-polish-h4-size: 19px; --native-polish-h4-line: 25px;
      --native-polish-h5-size: 17px; --native-polish-h5-line: 22px;
    }
    [data-testid="native-polish-streaming-assistant"] span {
      font-family: var(--native-polish-ui-font) !important;
      font-size: var(--native-polish-content-size) !important;
      line-height: var(--native-polish-content-line) !important;
    }
    [data-testid="native-polish-streaming-assistant"] [data-native-polish-markdown-role="heading1"] span {
      font-size: var(--native-polish-h1-size) !important; line-height: var(--native-polish-h1-line) !important;
    }
    [data-testid="native-polish-streaming-assistant"] [data-native-polish-markdown-role="heading2"] span {
      font-size: var(--native-polish-h2-size) !important; line-height: var(--native-polish-h2-line) !important;
    }
    [data-testid="native-polish-streaming-assistant"] [data-native-polish-markdown-role="heading3"] span {
      font-size: var(--native-polish-h3-size) !important; line-height: var(--native-polish-h3-line) !important;
    }
    [data-testid="native-polish-streaming-assistant"] [data-native-polish-markdown-role="heading4"] span {
      font-size: var(--native-polish-h4-size) !important; line-height: var(--native-polish-h4-line) !important;
    }
    [data-testid="native-polish-streaming-assistant"] :is([data-native-polish-markdown-role="heading5"],[data-native-polish-markdown-role="heading6"]) span {
      font-size: var(--native-polish-h5-size) !important; line-height: var(--native-polish-h5-line) !important;
    }
    [data-testid="native-polish-streaming-assistant"] :is([data-native-polish-markdown-role="code_inline"],[data-native-polish-markdown-role="code_block"],[data-native-polish-markdown-role="fence"]),
    [data-testid="native-polish-streaming-assistant"] :is([data-native-polish-markdown-role="code_inline"],[data-native-polish-markdown-role="code_block"],[data-native-polish-markdown-role="fence"]) span {
      font-family: var(--native-polish-mono-font) !important;
      font-size: var(--native-polish-code-size) !important;
    }
    [data-testid="native-polish-streaming-assistant"] :is([data-native-polish-markdown-role="code_block"],[data-native-polish-markdown-role="fence"]) span {
      line-height: var(--native-polish-code-line) !important;
    }
    /* A transformed assistant is temporarily a plugin stream item, so core
       assigns the default 16px inter-item gap. Offset only that difference;
       when core resumes rendering, both the plugin node and correction leave
       together and the text keeps the same screen position. */
    [data-testid="native-polish-streaming-assistant"][data-native-polish-gap-above="user"] { margin-top: -16px; }
    [data-testid="native-polish-streaming-assistant"][data-native-polish-gap-above="tool"] { margin-top: -12px; }
    [data-testid="native-polish-streaming-assistant"][data-native-polish-gap-below="tool"] { margin-bottom: -12px; }
    @media (prefers-reduced-motion: reduce) {
      [data-native-polish-stream-token="true"] {
        animation: none !important;
        opacity: 1 !important;
      }
    }
  `;
  document.head.appendChild(stylesheet);
  function updateMotionFlags() {
    const preferences = getPreferences();
    for (const key of ['controls', 'tabs', 'trees', 'states'] as const) document.body.setAttribute(`data-native-polish-${key}`, String(canAnimate() && preferences[key]));
    document.body.setAttribute('data-native-polish-motion', String(canAnimate()));
  }
  function decorate(el: Element, attribute: string) {
    if (el.getAttribute(attribute) !== null) return;
    el.setAttribute(attribute, '');
    decorations.set(el, () => el.removeAttribute(attribute));
  }
  function decorateControls() {
    for (const button of live('[role="button"],button').slice(0, 250)) {
      const r = rect(button);
      if (r.width <= 100 && r.height <= 56 && !button.matches(TAB) && !button.closest(FILE_TREE + ', ' + CHANGE_TREE + ', ' + TOOL) && !button.matches('[role="separator"]')) decorate(button, 'data-native-polish-pressable');
    }
    for (const row of live(FILE_ROW + ', ' + CHANGE_ROW).slice(0, 180)) {
      const svg = row.querySelector('svg');
      if (!svg || !chevron(svg)) continue;
      const owner = layoutParent(svg);
      if (owner && rect(owner).width <= 24) decorate(owner, 'data-native-polish-chevron');
    }
    for (const [el, cleanup] of decorations) if (!el.isConnected) { cleanup(); decorations.delete(el); }
  }
  function collapseTab(before: Snapshot) {
    if (!before.parent?.isConnected) { ghost(before); return; }
    const copy = exitCopy(before);
    const r = before.box;
    for (const [property, value] of Object.entries({ width: `${r.width}px`, 'max-width': `${r.width}px`, 'min-width': '0', height: `${r.height}px`, overflow: 'hidden', 'flex-shrink': '0', 'pointer-events': 'none' })) copy.style.setProperty(property, value);
    before.parent.insertBefore(copy, before.next?.parentElement === before.parent ? before.next : null);
    ghosts.add(copy);
    animate(copy, [{ width: `${r.width}px`, opacity: 1 }, { width: '0px', opacity: 0 }], () => { copy.remove(); ghosts.delete(copy); }, 0, Math.round(duration() * .75));
  }
  function updateWorkspaceRows(allow: boolean) {
    const nextLists = new Map<Element, WorkspaceList>();
    for (const scroll of live(WORKSPACE_SCROLL)) {
      const old = workspaceLists.get(scroll);
      const bounds = rect(scroll);
      // Membership includes offscreen rows, so scrolling cannot look like a
      // workspace creation/archive. Only visible content is copied/measured.
      const rows = all(scroll, WORKSPACE_ROW).filter(el => !el.closest('[data-native-polish-ghost]'));
      const keys = new Set(rows.map(el => el.getAttribute('data-testid')!));
      const sections = new Map(rows.map(el => [el.getAttribute('data-testid')!, el.closest(WORKSPACE_SECTION)?.getAttribute('data-testid') ?? null]));
      const headers = all(scroll, PROJECT).filter(el => !el.closest('[data-native-polish-ghost]'));
      const projectKeys = new Set(headers.map(el => el.getAttribute('data-testid')!));
      const elements = all(scroll, WORKSPACE_ANCHOR).filter(el => !el.closest('[data-native-polish-ghost]'));
      const anchorKeys = new Set(elements.map(el => el.getAttribute('data-testid')!));
      const expanded = new Map(all(scroll, '[aria-expanded][data-testid]').filter(el => !el.closest('[data-native-polish-ghost]')).map(el => [el.getAttribute('data-testid')!, el.getAttribute('aria-expanded')]));
      const toggled = old && Array.from(expanded).some(([key, value]) => old.expanded.has(key) && old.expanded.get(key) !== value);
      const sameOrder = (a: Set<string>, b: Set<string>) => {
        const previous = Array.from(b);
        return a.size === b.size && Array.from(a).every((key, index) => key === previous[index]);
      };
      const changed = old && (!sameOrder(anchorKeys, old.anchorKeys)
        || Array.from(sections).some(([key, section]) => old.sections.has(key) && old.sections.get(key) !== section));
      const allowed = allow && getPreferences().sidebars && old && !toggled && Date.now() >= Math.max(quietUntil, workspaceQuietUntil)
        && !panelEntries.size && !panelExits.size && !hasAncestor(scroll, active.keys())
        && pending?.disclosure?.element.closest(WORKSPACE_SCROLL) !== scroll;
      // A second real list commit may interrupt a transition. Start from its
      // current visual position, then measure the clean destination layout.
      // Animation-generated mutations alone never restart row movement.
      if (allowed && changed) {
        for (const item of old.anchors.values()) if (active.has(item.shot.element)) {
          if (item.shot.element.isConnected) {
            // The host has already moved the layout slot. Read just our
            // animated translation against the previous committed position.
            const matrix = /^matrix(?:3d)?\(([^)]+)\)$/.exec(window.getComputedStyle(item.shot.element).getPropertyValue('transform'));
            const values = matrix?.[1].split(',').map(Number);
            if (values && (values.length === 6 || values.length === 16)) {
              const dx = values[values.length === 16 ? 12 : 4];
              const dy = values[values.length === 16 ? 13 : 5];
              if (Number.isFinite(dx) && Number.isFinite(dy)) { item.top += dy; item.left += dx; }
            }
          }
          active.get(item.shot.element)?.();
        }
      }
      const projects = new Map<string, Snapshot>();
      for (const header of headers) {
        const key = header.getAttribute('data-testid')!;
        const group = header.closest('[role="group"]');
        if (!group || projects.size >= 30 || !visible(group)) continue;
        const box = rect(group);
        // Large/partially clipped groups use their visible row/header owners.
        // Never copy an entire offscreen workspace list for a project exit.
        if (box.top < bounds.top || box.bottom > bounds.bottom) continue;
        const previous = old?.projects.get(key);
        projects.set(key, active.has(group) && previous ? previous : snapshot(group));
      }
      const anchors = new Map<string, WorkspaceAnchor>();
      for (const el of elements) {
        const box = rect(el);
        if (!visible(el) || box.bottom <= bounds.top || box.top >= bounds.bottom || anchors.size >= 120) continue;
        const key = el.getAttribute('data-testid')!;
        const previous = old?.anchors.get(key);
        const moving = active.has(el) || hasAncestor(el, active.keys());
        const group = el.closest('[role="group"]');
        const project = group?.querySelector(PROJECT)?.getAttribute('data-testid') ?? null;
        anchors.set(key, moving && previous ? previous : {
          shot: snapshot(el), top: box.top - bounds.top + scroll.scrollTop,
          left: box.left - bounds.left + scroll.scrollLeft, project,
        });
      }
      nextLists.set(scroll, { keys, anchorKeys, sections, projectKeys, projects, anchors, expanded });
      // Section expansion and sidebar width already have animation owners.
      // Rebase their rows without adding another entrance/exit underneath.
      if (!allowed || !changed) continue;
      const removed = Array.from(old.keys).filter(key => !keys.has(key));
      const added = Array.from(keys).filter(key => !old.keys.has(key));
      const exitingProjects = new Set<string>();
      for (const [key, before] of old.projects) if (!projectKeys.has(key)) {
        // A project can disappear from the unpinned list while its workspace
        // moves to Pinned. Keep that workspace under the row's motion owner.
        const migrated = all(before.copy, WORKSPACE_ROW).some(el => keys.has(el.getAttribute('data-testid')!));
        if (!migrated && before.box.top >= bounds.top && before.box.bottom <= bounds.bottom) {
          ghost(before, -6); exitingProjects.add(key);
        }
      }
      for (const [key, after] of projects) if (!old.projectKeys.has(key)) {
        const migrated = all(after.element, WORKSPACE_ROW).some(el => old.keys.has(el.getAttribute('data-testid')!));
        if (!migrated && !active.has(after.element) && !hasAncestor(after.element, active.keys())) {
          animate(after.element, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }]);
        }
      }
      for (const [key, item] of old.anchors) {
        if (anchorKeys.has(key) || (item.project && exitingProjects.has(item.project))) continue;
        // Only actual removals, including headers, exit. Offscreen movement
        // does not count as removal from the mounted sidebar list.
        if (!removed.includes(key) && !item.shot.element.matches(PROJECT + ', ' + STATUS + ', [data-testid="sidebar-pinned-section-header"]')) continue;
        if (item.shot.element.isConnected && scroll === item.shot.element.closest(WORKSPACE_SCROLL)) continue;
        const before = item.shot;
        // A partially clipped row should never escape the sidebar viewport.
        if (before && before.box.top >= bounds.top && before.box.bottom <= bounds.bottom) ghost(before, -6);
      }
      for (const [key, item] of anchors) {
        const el = item.shot.element;
        if (active.has(el) || hasAncestor(el, active.keys()) || el.style.getPropertyValue('transform')) continue;
        if (added.includes(key) || !old.anchorKeys.has(key)) {
          animate(el, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }]);
        } else {
          const previous = old.anchors.get(key);
          if (!previous) continue;
          const dy = previous.top - item.top;
          const dx = previous.left - item.left;
          if (Math.abs(dy) > 1 || Math.abs(dx) > 1) animate(el, [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }]);
        }
      }
    }
    workspaceLists = nextLists;
  }
  function updateTabs(allow: boolean) {
    const nextRows = new Map<Element, Map<string, TabState>>();
    for (const scroll of live(TAB_ROW)) {
      const old = tabRows.get(scroll);
      const next = new Map<string, TabState>();
      const scrollLeft = rect(scroll).left;
      for (const chip of all(scroll, TAB).filter(visible).slice(0, 80)) {
        const key = chip.getAttribute('data-testid')!;
        const slot = tabSlot(chip, scroll);
        const previous = old?.get(key);
        // Reuse an in-flight snapshot: animation rects are not layout changes.
        const shot = active.has(slot) && previous ? previous.shot : snapshot(slot);
        const left = active.has(slot) && previous ? previous.left : shot.box.left - scrollLeft + scroll.scrollLeft;
        next.set(key, { chip, shot, left });
      }
      nextRows.set(scroll, next);
      if (!allow || !getPreferences().tabs || !old || Date.now() < quietUntil || hasAncestor(scroll, active.keys())) continue;
      const removed = Array.from(old).filter(([key]) => !next.has(key));
      const added = Array.from(next).filter(([key]) => !old.has(key));
      if (removed.length || added.length) tabSettling.set(scroll, Date.now() + duration() + 50);
      for (const [, item] of removed) collapseTab(item.shot);
      for (const [, item] of added) {
        const el = item.shot.element;
        const width = item.shot.box.width;
        if (width < 2 || active.has(el)) continue;
        const restore = temporaryStyles(el, { overflow: 'hidden', 'min-width': '0', 'max-width': `${width}px`, 'flex-shrink': '0' });
        animate(el, [{ width: '0px', opacity: 0 }, { width: `${width}px`, opacity: 1 }], restore);
      }
      // Only a changed key order is a reorder. Sidebar/pane movement and tab
      // rail scrolling must not animate the same children a second time.
      const oldOrder = Array.from(old.keys());
      const reordered = Array.from(next.keys()).some((key, index) => key !== oldOrder[index]);
      if (reordered && !removed.length && !added.length && Date.now() >= (tabSettling.get(scroll) ?? 0)) for (const [key, item] of next) {
        const previous = old.get(key);
        if (!previous || active.has(item.shot.element) || item.shot.element.style.getPropertyValue('transform')) continue;
        const dx = previous.left - item.left;
        if (Math.abs(dx) > 1 && Math.abs(previous.shot.box.width - item.shot.box.width) < 1 && Date.now() >= quietUntil) animate(item.shot.element, [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }]);
      }
    }
    tabRows = nextRows;
  }
  function floatingExit(before: Snapshot) {
    const copy = exitCopy(before);
    const r = before.box;
    for (const [property, value] of Object.entries({ position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', 'box-sizing': 'border-box', 'pointer-events': 'none', 'z-index': '9999', animation: 'none', transition: 'none', transform: 'none' })) copy.style.setProperty(property, value, 'important');
    document.body.appendChild(copy);
    ghosts.add(copy);
    animate(copy, [{ opacity: 1, scale: 1 }, { opacity: 0, scale: .98 }], () => { copy.remove(); ghosts.delete(copy); }, 0, Math.round(duration() * .65));
  }
  // Paseo animates some overlays on the surface or its portal wrappers. A
  // keyframe animation is an entrance; a fade transition also runs on close,
  // so neither gets a second entrance and transitions get no copy. A host
  // keyframe exit (React Native web Modal fades out with one) is caught when
  // it starts, see onAnimationStart.
  function hostMotion(el: Element): { entrance: boolean; exit: boolean } {
    let entrance = false, exit = false;
    for (let at: Element | null = el, depth = 0; at && at !== document.body && depth < 4; at = at.parentElement, depth++) {
      const style = window.getComputedStyle(at);
      if (style.getPropertyValue('animation-name').split(',').some(name => name.trim() && name.trim() !== 'none')) entrance = true;
      const properties = style.getPropertyValue('transition-property').split(',');
      const durations = style.getPropertyValue('transition-duration').split(',');
      if (properties.some((property, index) => /^(all|opacity|transform|translate)$/.test(property.trim()) && parseFloat(durations[index % durations.length]) > 0)) entrance = exit = true;
    }
    return { entrance, exit };
  }
  // A CSS animation on `el` that ends (nearly) transparent: the host's own exit.
  function fadesOut(el: Element, name: string | undefined): boolean {
    for (const animation of el.getAnimations?.() ?? []) {
      if (!name || animation.animationName !== name) continue;
      const frames = animation.effect?.getKeyframes?.() ?? [];
      const opacity = Number(frames[frames.length - 1]?.opacity);
      if (Number.isFinite(opacity) && opacity <= .1) return true;
    }
    return false;
  }
  // The host fades a tracked overlay (or its portal wrapper) out with a
  // keyframe animation, e.g. React Native web Modal with animationType
  // "fade". It is removed when that ends; an exit copy would fade it again.
  const onAnimationStart: Listener = event => {
    const target = elementOf(event.target);
    if (!target || !floating.size || target.closest('[data-native-polish-ghost]') || !fadesOut(target, event.animationName)) return;
    for (const [el, before] of floating) if (el === target || hasAncestor(el, [target])) before.hostExit = true;
  };
  function updateFloating(allow: boolean) {
    const next = new Map<Element, FloatingSnapshot>();
    for (const el of live(FLOATING).filter(el => { const r = rect(el); return r.right > 0 && r.left < window.innerWidth; }).slice(0, 12)) {
      // Nested menu pages/dialog children must not get two entrances.
      if (el.parentElement?.closest(FLOATING)) continue;
      const previous = floating.get(el);
      const host = previous ? null : hostMotion(el);
      const opacity = parseFloat(window.getComputedStyle(el).getPropertyValue('opacity'));
      next.set(el, active.has(el) && previous ? previous : { ...snapshot(el), opacity: Number.isFinite(opacity) ? opacity : 1, hostExit: previous?.hostExit ?? host?.exit ?? false });
      if (!allow || !getPreferences().overlays || previous || host?.entrance) continue;
      if (!el.getAnimations?.().length) animate(el, [{ opacity: 0, scale: .98 }, { opacity: 1, scale: 1 }], undefined, 0, Math.min(duration(), 180));
    }
    if (allow && getPreferences().overlays) for (const [el, before] of floating) if (!next.has(el) && before.opacity > .1 && !before.hostExit) floatingExit(before);
    floating = next;
  }
  function updatePaneLayout(allow: boolean) {
    // Keep the committed baseline out of our own transformed frames. Once
    // motion ends, the observer rebases from the clean host layout.
    if (panelEntries.size || panelExits.size || Array.from(active.keys()).some(el => el.matches(PANE))) {
      paneTransition = null;
      return;
    }
    const next = paneBoxes();
    const shared = Array.from(next.keys()).some(key => paneBaseline.has(key));
    const membershipChanged = next.size !== paneBaseline.size || Array.from(next.keys()).some(key => !paneBaseline.has(key));
    // Maximize/restore belongs to the explicit capture for the whole gesture,
    // including after its animation has been consumed. Hidden-pane membership
    // changes must not enqueue the same transition in the ambient observer.
    if (!allow || !getPreferences().panes || pending?.paneAction) paneTransition = null;
    else {
      if (shared && membershipChanged) { paneTransition = paneBaseline; paneTransitionUntil = Date.now() + 700; }
      if (paneTransition && (Date.now() > paneTransitionUntil || animatePanes(paneTransition, next))) paneTransition = null;
    }
    paneBaseline = next;
  }
  function iconSignature(slot: Element): string {
    return all(slot, 'svg,path,circle,polyline,line,rect').slice(0, 16).map(el => ['d', 'points', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'stroke', 'fill'].map(key => el.getAttribute(key) ?? '').join(':')).join('|') || 'loading';
  }
  function updateAgentStates(allow: boolean) {
    const nextAgents = new Map<Element, string>();
    for (const agent of live('[data-status-bucket]').slice(0, 100)) {
      const state = agent.getAttribute('data-status-bucket')!;
      nextAgents.set(agent, state);
      const icon = firstBoxChild(agent);
      if (allow && getPreferences().states && agentStates.has(agent) && agentStates.get(agent) !== state && icon && !active.has(icon)) animate(icon, [{ opacity: .25, scale: .9 }, { opacity: 1, scale: 1 }], undefined, 0, 150);
    }
    agentStates = nextAgents;
  }
  function updateIcons(slots: Element[], old: Map<Element, string>, allow: boolean) {
    const next = new Map<Element, string>();
    for (const slot of slots) {
      const signature = iconSignature(slot);
      next.set(slot, signature);
      if (allow && getPreferences().states && old.has(slot) && old.get(slot) !== signature && !active.has(slot)) animate(slot, [{ opacity: .2, scale: .9 }, { opacity: 1, scale: 1 }], undefined, 0, 150);
    }
    return next;
  }
  function updateFileStates(allow: boolean) {
    const slots: Element[] = [];
    for (const row of live(FILE_ROW + ', ' + CHANGE_ROW).slice(0, 150)) {
      const info = firstBoxChild(row);
      const slot = info ? firstBoxChild(info) : null;
      if (slot && rect(slot).width <= 32) slots.push(slot);
    }
    fileIcons = updateIcons(slots, fileIcons, allow);
  }
  function updateToolStates(allow: boolean) {
    const nextTools = new Map<Element, boolean>();
    const nextLabels = new Map<Element, ToolLabelState>();
    const slots: Element[] = [];
    for (const tool of live(TOOL).slice(0, 80)) {
      const header = firstBoxChild(tool);
      if (!header) continue;
      const running = Boolean(header.querySelector('[style*="--paseo-shimmer"]'));
      nextTools.set(header, running);
      if (allow && getPreferences().states && toolStates.has(header) && toolStates.get(header) !== running && !active.has(header)) animate(header, [{ opacity: .65 }, { opacity: 1 }], undefined, 0, 150);
      const row = firstBoxChild(header);
      const slot = row ? firstBoxChild(row) : null;
      if (slot && !Array.from(slot.querySelectorAll('svg')).some(chevron)) slots.push(slot);
      const labelRow = row ? Array.from(row.children)[1] : null;
      if (!labelRow) continue;
      const labelChildren = Array.from(labelRow.children);
      const primary = labelChildren[0] ?? null;
      const secondary = labelChildren.find((child, index) => index > 0 && !child.matches('[role="button"],button') && window.getComputedStyle(child).getPropertyValue('position') !== 'absolute') ?? null;
      const current: ToolLabelState = {
        primary: primary?.textContent ?? '',
        primaryWidth: primary ? rect(primary).width : 0,
        secondary: secondary?.textContent ?? '',
        secondaryWidth: secondary ? rect(secondary).width : 0,
      };
      const previous = toolLabels.get(labelRow);
      nextLabels.set(labelRow, current);
      if (!allow || !getPreferences().timeline || !previous) continue;
      if (primary && current.primary && current.primary !== previous.primary) {
        // Match core's GrowingLabel invariant: the new text keeps its natural
        // width while only its painted edge is revealed. Constraining the text
        // itself to the previous width makes RN Web's numberOfLines render an
        // intermittent ellipsis as aggregate labels such as "Ran X commands"
        // update.
        const hiddenEdge = Math.max(0, current.primaryWidth - previous.primaryWidth);
        animate(primary, [
          { clipPath: `inset(0 ${hiddenEdge}px 0 0)`, opacity: .55, transform: 'translateX(-2px)' },
          { clipPath: 'inset(0 0 0 0)', opacity: 1, transform: 'translateX(0)' },
        ], undefined, 0, 200);
      }
      if (secondary && current.secondary && current.secondary !== previous.secondary) {
        const hiddenEdge = Math.max(0, current.secondaryWidth - previous.secondaryWidth);
        animate(secondary, [
          { clipPath: `inset(0 ${hiddenEdge}px 0 0)`, opacity: 0, transform: 'translateX(-3px)' },
          { clipPath: 'inset(0 0 0 0)', opacity: 1, transform: 'translateX(0)' },
        ], undefined, 0, 200);
      }
    }
    toolIcons = updateIcons(slots, toolIcons, allow);
    toolStates = nextTools;
    toolLabels = nextLabels;
  }
  function createContentRise(element: Element): ContentRise {
    let offset = 0;
    let animationFrame = 0;
    let lastFrameTime: number | null = null;
    const applyOffset = (next: number) => {
      offset = next;
      if (!element.isConnected) return;
      if (next === 0) element.style.removeProperty('transform');
      else element.style.setProperty('transform', `translateY(${next}px)`);
    };
    const step = (timestamp: number) => {
      const delta = lastFrameTime === null ? 0 : timestamp - lastFrameTime;
      lastFrameTime = timestamp;
      const next = offset * Math.exp(-delta / 110);
      if (Math.abs(next) < .5) {
        animationFrame = 0;
        lastFrameTime = null;
        applyOffset(0);
        return;
      }
      applyOffset(next);
      animationFrame = window.requestAnimationFrame(step);
    };
    const rise: ContentRise = {
      start(distance) {
        // Retarget the running decay instead of restarting a fixed-duration
        // easing for every line. This is the reference stream's chunked feel.
        if (Math.abs(distance) <= .5 || !canAnimate() || !getPreferences().messages) return;
        applyOffset(offset + distance);
        if (!animationFrame) animationFrame = window.requestAnimationFrame(step);
      },
      prepare(distance) {
        if (Math.abs(distance) <= .5 || !canAnimate() || !getPreferences().messages) return;
        // The host follow-output frame is already queued when the mutation is
        // observed. Hold the inverse intact through that frame, then begin the
        // same decay core would start immediately after writing scrollTop.
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        lastFrameTime = null;
        applyOffset(offset + distance);
        animationFrame = window.requestAnimationFrame(step);
      },
      cancel() {
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        lastFrameTime = null;
        applyOffset(0);
      },
      getOffset() { return offset; },
    };
    contentRises.add(rise);
    return rise;
  }
  function riseFor(cache: WeakMap<Element, ContentRise>, element: Element | null): ContentRise | null {
    if (!element) return null;
    const existing = cache.get(element);
    if (existing) return existing;
    const created = createContentRise(element);
    cache.set(element, created);
    return created;
  }
  function timelineFor(chat: Element, rows: Element[]): Element | null {
    return chat.querySelector(CHAT_TIMELINE) ?? rows[0]?.parentElement ?? null;
  }
  function footerFor(chat: Element): Element | null {
    const indicator = chat.querySelector('[data-testid="turn-working-indicator"]');
    if (!indicator) return chat.querySelector('[data-testid="turn-footer-entry-motion"]');
    // Current core keeps live auxiliary rows in a dedicated sibling after the
    // clipped timeline. Older 0.11 hosts put the indicator directly in the
    // content node, where its parent also owns the timeline.
    const content = chat.querySelector(CHAT_CONTENT);
    const parent = indicator.parentElement;
    return parent && content && parent.parentElement === content && !parent.querySelector(CHAT_TIMELINE)
      ? parent
      : indicator;
  }
  function smallestTextElement(root: Element, prefix: string): Element | null {
    const matches = [root, ...all(root, '*')].filter((element) =>
      (element.textContent?.trim() ?? '').startsWith(prefix),
    );
    return matches.find((element) => !Array.from(element.children).some((child) =>
      (child.textContent?.trim() ?? '').startsWith(prefix),
    )) ?? null;
  }
  function animateGrowingToolText(allow: boolean) {
    const syncReveal = (reveal: ToolDetailReveal) => {
      const boxes = Array.from(reveal.range.getClientRects()).filter(box => box.width > 0 && box.height > 0).slice(0, 40);
      while (reveal.covers.length < boxes.length) {
        const cover = document.createElement('div');
        cover.style.setProperty('position', 'fixed', 'important');
        cover.style.setProperty('pointer-events', 'none', 'important');
        cover.style.setProperty('background-color', nearestPaintedBackground(reveal.owner), 'important');
        reveal.root.appendChild(cover);
        reveal.covers.push(cover);
      }
      while (reveal.covers.length > boxes.length) reveal.covers.pop()?.remove();
      boxes.forEach((box, index) => {
        const cover = reveal.covers[index];
        cover.style.setProperty('left', `${box.left}px`, 'important');
        cover.style.setProperty('top', `${box.top}px`, 'important');
        cover.style.setProperty('width', `${box.width}px`, 'important');
        cover.style.setProperty('height', `${box.height}px`, 'important');
      });
      return boxes.length > 0;
    };
    for (const reveal of Array.from(toolDetailReveals)) if (!syncReveal(reveal)) active.get(reveal.root)?.();

    const next = new Map<Element, ToolDetailTextState>();
    for (const tool of live(TOOL).slice(0, 80)) {
      for (const detail of Array.from(tool.children).slice(1)) {
        const owner = firstBoxChild(detail) ?? detail;
        if (!visible(owner)) continue;
        const text = owner.textContent ?? '';
        const previous = toolDetailText.get(detail);
        if (previous && previous.owner !== owner) {
          for (const reveal of Array.from(toolDetailReveals)) if (reveal.owner === previous.owner) active.get(reveal.root)?.();
        }
        next.set(detail, previous?.text === text && previous.owner === owner ? previous : { text, owner });
        const transition = toolDetailTextTransition(previous?.text, text);
        if (!allow || !getPreferences().messages || !previous || !transition) continue;

        // Cover only the appended glyph rectangles with the panel background,
        // then fade those covers away. The host remains the sole text painter,
        // so streaming cannot produce doubled or differently wrapped copies.
        const range = appendedTextRange(owner, transition.enteringStart);
        if (!range) continue;
        const root = document.createElement('div');
        root.setAttribute('data-native-polish-ghost', '');
        root.setAttribute('aria-hidden', 'true');
        root.setAttribute('inert', '');
        root.style.setProperty('position', 'fixed', 'important');
        root.style.setProperty('inset', '0', 'important');
        root.style.setProperty('pointer-events', 'none', 'important');
        root.style.setProperty('z-index', '90', 'important');
        document.body.appendChild(root);
        const reveal: ToolDetailReveal = { owner, range, root, covers: [] };
        toolDetailReveals.add(reveal);
        ghosts.add(root);
        if (!syncReveal(reveal)) {
          root.remove(); ghosts.delete(root); toolDetailReveals.delete(reveal);
          continue;
        }
        animate(root, transition.cover, () => {
          root.remove(); ghosts.delete(root); toolDetailReveals.delete(reveal);
        }, 0, 400);
      }
    }
    toolDetailText = next;
  }
  function numericCss(style: Style, property: string): number | null {
    const value = Number.parseFloat(style.getPropertyValue(property));
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  function nativeTypographyReference(stream: Element): Element | null {
    const chat = stream.closest(CHAT);
    if (!chat) return null;
    const streamTop = rect(stream).top;
    // RN Web may put a browser-default font size on inner spans. Core's
    // semantic Markdown paragraph and message-text nodes own the actual Paseo
    // typography, so sample those boundaries rather than an arbitrary leaf.
    const paragraphs = all(chat, '[data-testid="assistant-message"] [data-paseo-markdown-tag="p"]')
      .filter((candidate) => !candidate.closest('[data-testid="native-polish-streaming-assistant"]'));
    const precedingParagraph = paragraphs.filter((candidate) => rect(candidate).top <= streamTop).pop();
    if (precedingParagraph) return precedingParagraph;
    if (paragraphs.length > 0) return paragraphs[paragraphs.length - 1];
    const userText = all(chat, '[data-testid="user-message"] [data-message-text="true"]');
    const precedingUser = userText.filter((candidate) => rect(candidate).top <= streamTop).pop();
    return precedingUser ?? userText[userText.length - 1] ?? null;
  }
  function syncStreamingTypography(stream: Element) {
    const reference = nativeTypographyReference(stream);
    if (!reference) return;
    const proseStyle = window.getComputedStyle(reference);
    const contentSize = numericCss(proseStyle, 'font-size');
    if (contentSize === null) return;
    const contentLine = numericCss(proseStyle, 'line-height') ?? Math.round(contentSize * 1.4);
    const chat = stream.closest(CHAT);
    const code = chat
      ? all(chat, '[data-testid="assistant-message"] [data-paseo-markdown-tag="code"]')[0]
      : null;
    const blockCode = chat
      ? all(chat, '[data-testid="assistant-message"] [data-paseo-markdown-tag="pre"] [data-paseo-markdown-tag="code"]')[0]
      : null;
    const codeStyle = code ? window.getComputedStyle(code) : null;
    const codeSize = codeStyle ? numericCss(codeStyle, 'font-size') ?? 12 : 12;
    const blockCodeStyle = blockCode ? window.getComputedStyle(blockCode) : null;
    const codeLine = blockCodeStyle ? numericCss(blockCodeStyle, 'line-height') ?? Math.round(codeSize * 1.45) : Math.round(codeSize * 1.45);
    const headingSize = (canonical: number) => Math.round(contentSize * (canonical / 14));
    const setPx = (name: string, value: number) => stream.style.setProperty(name, `${value}px`);
    setPx('--native-polish-content-size', contentSize);
    setPx('--native-polish-content-line', contentLine);
    setPx('--native-polish-code-size', codeSize);
    setPx('--native-polish-code-line', codeLine);
    for (const [level, canonical] of [[1, 26], [2, 22], [3, 20], [4, 18], [5, 16]] as const) {
      const size = headingSize(canonical);
      setPx(`--native-polish-h${level}-size`, size);
      setPx(`--native-polish-h${level}-line`, Math.round(size * 1.3));
    }
    const uiFamily = proseStyle.getPropertyValue('font-family');
    if (uiFamily) stream.style.setProperty('--native-polish-ui-font', uiFamily);
    const monoFamily = codeStyle?.getPropertyValue('font-family');
    if (monoFamily) stream.style.setProperty('--native-polish-mono-font', monoFamily);
  }
  function updateMessages(allow: boolean) {
    animateGrowingToolText(allow);
    for (const chat of live(CHAT)) {
      const rows = all(chat, HISTORY_ROW);
      const old = chats.get(chat);
      const running = Boolean(chat.querySelector('[data-testid="turn-working-indicator"]'));
      const seen = old?.seen ?? new Set<string>();
      const seenCompactions = old?.seenCompactions ?? new Set<string>();
      const candidates = allow ? old?.pending ?? new Set<string>() : new Set<string>();
      const firstHistoryPopulation = Boolean(old && old.seen.size === 0 && rows.length > 0);
      const hydrationQuietUntil = firstHistoryPopulation
        ? Date.now() + 500
        : old?.hydrationQuietUntil ?? 0;
      const suppressHydrationMotion = Date.now() < hydrationQuietUntil;
      const liveTurn = running || Boolean(old?.running);
      const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 180;
      const streamIndex = rows.findIndex((row) => Boolean(row.querySelector('[data-testid="native-polish-streaming-assistant"]')));
      const streamRow = streamIndex >= 0 ? rows[streamIndex] : null;
      const stream = streamRow ? {
        id: streamRow.getAttribute('data-history-row-id') ?? '',
        index: streamIndex,
        text: streamRow.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      } : null;
      let handoff = !stream && old?.stream
        ? { ...old.stream, expires: Date.now() + 2000 }
        : !stream && old?.handoff && old.handoff.expires > Date.now() ? old.handoff : null;
      const nativeAssistantRows = rows.filter((row) => Boolean(row.querySelector('[data-testid="assistant-message"]')));
      const pendingHandoff = handoff;
      // Core may retain or replace the history-row ID when the transformer
      // yields on completion. In either case this is the same message, not a
      // new row, so never replay the message entrance at the renderer swap.
      const handoffRow = pendingHandoff ? nativeAssistantRows.find((row) => row.getAttribute('data-history-row-id') === pendingHandoff.id)
        ?? (pendingHandoff.text ? nativeAssistantRows.find((row) => (row.textContent?.replace(/\s+/g, ' ').trim() ?? '') === pendingHandoff.text) : null)
        ?? (rows[pendingHandoff.index]?.querySelector('[data-testid="assistant-message"]') ? rows[pendingHandoff.index] : null)
        ?? nativeAssistantRows.filter((row) => !seen.has(row.getAttribute('data-history-row-id') ?? ''))
          .sort((left, right) => Math.abs(rows.indexOf(left) - pendingHandoff.index) - Math.abs(rows.indexOf(right) - pendingHandoff.index))[0]
        ?? null : null;
      const handoffTransition = Boolean(!stream && (old?.stream || old?.handoff || handoffRow));
      const handoffQuietUntil = handoffTransition ? Date.now() + 500 : old?.handoffQuietUntil ?? 0;
      const suppressHandoffMotion = Date.now() < handoffQuietUntil;
      if (handoffRow) handoff = null;
      const enteringCompactions = new Set<Element>();
      for (const item of all(chat, '[data-testid="stream-item"]')) {
        if (!(item.textContent?.trim() ?? '').startsWith('Compacting')) continue;
        const itemRow = item.closest(HISTORY_ROW);
        const key = item.getAttribute('data-stream-item-id')
          ?? itemRow?.getAttribute('data-history-row-id')
          ?? '';
        if (old && liveTurn && !suppressHydrationMotion && key && !seenCompactions.has(key)) enteringCompactions.add(item);
        if (key) seenCompactions.add(key);
      }
      let entered = 0;
      rows.forEach((row) => {
        const id = row.getAttribute('data-history-row-id')!;
        const isNew = !seen.has(id);
        seen.add(id);
        if (row === handoffRow) candidates.delete(id);
        else if (shouldQueueMessageEntrance({
          hasPreviousChatState: Boolean(old),
          wasRunning: Boolean(old?.running),
          running,
          isUserMessage: Boolean(row.querySelector('[data-testid="user-message"]')),
          suppressHydrationMotion,
          isNew,
          allow,
          atBottom,
          quiet: Date.now() < quietUntil,
        })) candidates.add(id);
        if (candidates.has(id) && visible(row)) {
          candidates.delete(id);
          const ownsTextFade = Boolean(row.querySelector('[data-testid="native-polish-streaming-assistant"]'));
          const ownsCompactionEntry = Array.from(enteringCompactions).some((item) => item.closest(HISTORY_ROW) === row);
          if (!ownsTextFade && !ownsCompactionEntry && allow && getPreferences().messages && atBottom && Date.now() >= quietUntil && entered++ < 12) {
            const user = Boolean(row.querySelector('[data-testid="user-message"]'));
            const restore = temporaryStyles(row, { 'transform-origin': user ? '100% 0%' : '0% 100%' });
            animate(row, [
              { opacity: 0, transform: 'translateY(6px) scale(.98)' },
              { opacity: 1, transform: 'translateY(0) scale(1)' },
            ], restore, 0, 320);
          }
        }
      });
      if (allow && getPreferences().messages && atBottom && Date.now() >= quietUntil) {
        for (const item of enteringCompactions) {
          if (!visible(item) || active.has(item)) continue;
          const restore = temporaryStyles(item, { 'transform-origin': '0% 100%' });
          animate(item, [
            { opacity: 0, transform: 'translateY(6px) scale(.98)' },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ], restore, 0, 260);
        }
      }
      for (const stream of all(chat, '[data-testid="native-polish-streaming-assistant"]')) {
        syncStreamingTypography(stream);
        const row = stream.closest(HISTORY_ROW);
        const rowIndex = row ? rows.indexOf(row) : -1;
        const above = rowIndex > 0 ? rows[rowIndex - 1] : null;
        const below = rowIndex >= 0 && rowIndex < rows.length - 1 ? rows[rowIndex + 1] : null;
        const isToolSequence = (candidate: Element | null) => Boolean(candidate?.querySelector(`${TOOL}, [data-testid="tool-call-summary-placeholder"]`));
        const gapAbove = above?.querySelector('[data-testid="user-message"]')
          ? 'user'
          : isToolSequence(above) ? 'tool' : null;
        const gapBelow = isToolSequence(below) ? 'tool' : null;
        if (gapAbove) stream.setAttribute('data-native-polish-gap-above', gapAbove);
        else stream.removeAttribute('data-native-polish-gap-above');
        if (gapBelow) stream.setAttribute('data-native-polish-gap-below', gapBelow);
        else stream.removeAttribute('data-native-polish-gap-below');
      }
      const timeline = timelineFor(chat, rows);
      const footer = footerFor(chat);
      const timelineRise = timeline ? riseFor(timelineRises, timeline) : null;
      const footerRise = footer ? riseFor(footerRises, footer) : null;
      const currentScrollTop = chat.scrollTop;
      const maxScrollTop = Math.max(0, chat.scrollHeight - chat.clientHeight);
      const currentClientWidth = chat.clientWidth;
      const widthChanged = Boolean(old && Math.abs(currentClientWidth - old.clientWidth) > .5);
      // Sidebar/pane motion continuously changes the chat's available width.
      // The resulting line-wrap height is viewport reflow, not new output: core
      // bottom-anchors it without starting a content rise. Keep that boundary
      // alive through the trailing host scroll event.
      const reflowQuietUntil = widthChanged ? Date.now() + 120 : old?.reflowQuietUntil ?? 0;
      const suppressWidthReflowMotion = Date.now() < reflowQuietUntil;
      const suppressDisclosureMotion = Date.now() < (chatDisclosureQuietUntil.get(chat) ?? 0);
      const measuredFooterTop = footer && footerRise ? rect(footer).top - footerRise.getOffset() : null;
      const canRiseWithFollowOutput = old && allow && atBottom && getPreferences().messages && Date.now() >= quietUntil && !suppressHandoffMotion && !suppressHydrationMotion && !suppressWidthReflowMotion && !suppressDisclosureMotion;
      let compensatedScrollTop = currentScrollTop;
      let footerTop = measuredFooterTop;
      if (canRiseWithFollowOutput) {
        // A chat mutation is observable before Paseo's follow-output frame.
        // Pre-arm the inverse from the new scroll extent so the subsequent
        // scrollTop snap and transform land in one paint. Waiting for `scroll`
        // produces an upward flash followed by a downward correction.
        const wasFollowing = old.maxScrollTop - old.scrollTop < 180;
        // Scroll events are intentionally not required to have committed the
        // previous snap yet; the compensated target is the authoritative
        // follow position across back-to-back stream chunks.
        const anticipatesBottom = wasFollowing && maxScrollTop > old.maxScrollTop && currentScrollTop <= old.compensatedScrollTop + .5;
        compensatedScrollTop = anticipatesBottom ? maxScrollTop : currentScrollTop;
        const scrollDistance = compensatedScrollTop - old.compensatedScrollTop;
        if (anticipatesBottom) timelineRise?.prepare(scrollDistance);
        else timelineRise?.start(scrollDistance);
        // Once overflow grows, the anticipated scroll absorbs the footer's
        // layout movement. Before overflow, retain the ordinary footer rise.
        if (measuredFooterTop !== null) footerTop = measuredFooterTop - (compensatedScrollTop - currentScrollTop);
        if (old.footerTop !== null && footerTop !== null && shouldAnimateFooterRise(old.footer, footer)) {
          footerRise?.start(old.footerTop - footerTop);
        }
      } else if (!allow || !atBottom || Date.now() < quietUntil || suppressHandoffMotion || suppressHydrationMotion || suppressWidthReflowMotion || suppressDisclosureMotion) {
        timelineRise?.cancel();
        footerRise?.cancel();
        if (suppressHandoffMotion || suppressHydrationMotion || suppressWidthReflowMotion || suppressDisclosureMotion) footerTop = footer ? rect(footer).top : null;
      }
      if (allow && getPreferences().states && old && old.running !== running && atBottom && !suppressHandoffMotion && !suppressHydrationMotion) {
        // A disappearing indicator has no incoming element to animate. Do not
        // fall through to the completed assistant row during renderer handoff.
        const indicator = chat.querySelector('[data-testid="turn-working-indicator"]');
        if (indicator && visible(indicator) && !active.has(indicator)) animate(indicator, [{ opacity: .4 }, { opacity: 1 }], undefined, 0, 150);
      }
      let completedFooterPendingUntil = running ? 0 : old?.completedFooterPendingUntil ?? 0;
      if (suppressHydrationMotion) completedFooterPendingUntil = 0;
      else if (old?.running && !running) completedFooterPendingUntil = Date.now() + 600;
      if (allow && getPreferences().states && !running && atBottom && Date.now() < completedFooterPendingUntil) {
        const footerRow = chat.querySelector('[data-testid="turn-footer-entry-motion"]');
        const worked = footerRow ? smallestTextElement(footerRow, 'Worked') : null;
        if (worked && visible(worked) && !active.has(worked)) {
          animate(worked, [
            { opacity: 0, transform: 'translateY(3px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ], undefined, 0, 180);
          completedFooterPendingUntil = 0;
        }
      }
      while (seen.size > 5000) seen.delete(seen.values().next().value!);
      while (seenCompactions.size > 500) seenCompactions.delete(seenCompactions.values().next().value!);
      const currentIds = new Set(rows.map(row => row.getAttribute('data-history-row-id')!));
      for (const id of candidates) if (!atBottom || !currentIds.has(id)) candidates.delete(id);
      chats.set(chat, { seen, seenCompactions, pending: candidates, running, completedFooterPendingUntil, scrollTop: currentScrollTop, compensatedScrollTop, maxScrollTop, clientWidth: currentClientWidth, footer, footerTop, stream, handoff, handoffQuietUntil, hydrationQuietUntil, reflowQuietUntil });
    }
  }
  function refreshAmbient(allow = canAnimate(), selected: ReadonlySet<Region> = new Set(regions)) {
    if (disposed || suspended) return;
    if (selected.has('elastic')) elastic.refresh();
    allow = allow && !elastic.isActive();
    if (selected.has('controls')) decorateControls();
    if (selected.has('workspaces')) updateWorkspaceRows(allow);
    if (selected.has('tabs')) updateTabs(allow);
    if (selected.has('floating')) updateFloating(allow);
    if (selected.has('panes')) updatePaneLayout(allow);
    if (selected.has('agents')) updateAgentStates(allow);
    if (selected.has('files')) updateFileStates(allow);
    if (selected.has('tools')) updateToolStates(allow);
    if (selected.has('messages')) updateMessages(allow);
  }
  function scheduleAmbient(selected: Region[] = regions) {
    if (disposed || suspended) return;
    for (const region of selected) dirty.add(region);
    if (passiveFrame) return;
    passiveFrame = window.requestAnimationFrame(() => {
      passiveFrame = 0;
      const selected = new Set(dirty); dirty.clear();
      // Virtualized membership can change during scrolling. The idle callback
      // rebases it once; those commits are not workspace creation/removal.
      if (scrollDeadline) selected.delete('workspaces');
      if (!disposed) refreshAmbient(canAnimate(), selected);
    });
  }
  updateMotionFlags();
  refreshAmbient(false);
  let treeTarget: Element | null = null;
  const capture = (target: Element | null): Capture => ({
    panels: new Map(Array.from(panels()).filter(([, el]) => visible(el)).map(([key, el]) => [key, snapshot(el)])),
    panes: paneBoxes(),
    paneAction: Boolean(target?.closest(PANE_ACTION)),
    paneMotion: Boolean(target?.closest(PANE_ACTION)),
    disclosure: target ? captureDisclosure(disclosureFor(target)) : null,
    tree: target ? captureTree(target) : null,
  });
  const flush = () => {
    frame = 0;
    if (!pending || !canAnimate()) return;
    const preferences = getPreferences();
    const currentPanels = panels();
    const currentPanes = paneBoxes();
    // Save the committed layout before our width animations change its rects.
    // Retain entry snapshots while their first frame temporarily has width 0.
    const nextPanels = new Map<string, Snapshot>();
    for (const [key, el] of currentPanels) {
      if (panelExits.has(el)) continue;
      const old = pending.panels.get(key);
      if (panelEntries.has(el) && old?.element === el) nextPanels.set(key, old);
      else if (visible(el)) nextPanels.set(key, old?.element === el ? old : snapshot(el));
    }
    if (preferences.sidebars) {
      for (const [key, before] of pending.panels) {
        const after = currentPanels.get(key);
        if ((!after || !visible(after)) && !panelExits.has(before.element) && !panelEntries.has(before.element)) hidePanel(before, key);
      }
      for (const [key, after] of currentPanels) if (visible(after) && !pending.panels.has(key)) {
        if (!panelExits.has(after) && !panelEntries.has(after)) revealPanel(after);
      }
    }
    // FLIP runs once per maximize/restore commit. Reading transformed rects
    // again in our observer would otherwise restart the same animation.
    const paneChanged = pending.paneMotion && preferences.panes && animatePanes(pending.panes, currentPanes);
    if (pending.disclosure && ((pending.disclosure.element.matches(TOOL) && preferences.timeline) || (!pending.disclosure.element.matches(TOOL) && preferences.sidebars))) animateDisclosure(pending.disclosure);
    // Capture the committed tree once, before applying its FLIP transforms.
    // Reuse it as the next baseline instead of cloning/measuring it again.
    const nextTree = pending.tree && treeTarget?.isConnected ? captureTree(treeTarget) : null;
    if (preferences.trees && pending.tree && nextTree) animateTree(pending.tree, nextTree);
    // Refresh after a commit so asynchronous directory loads can animate once
    // without replaying previous rows. Ignore animation-generated ghost nodes.
    const disclosure = pending.disclosure;
    const nextChildren = disclosure ? Array.from(disclosure.element.children) : [];
    const disclosureChanged = disclosure && (nextChildren.length !== disclosure.children.length || nextChildren.some((child, index) => child !== disclosure.children[index]));
    pending = {
      panels: nextPanels,
      panes: pending.paneMotion ? currentPanes : pending.panes,
      paneAction: pending.paneAction,
      paneMotion: pending.paneMotion && !paneChanged,
      disclosure: disclosureChanged ? captureDisclosure(disclosure.element) : disclosure,
      tree: nextTree ?? pending.tree,
    };
    if (layoutPolling > 0 && active.size === 0) { layoutPolling--; schedule(); }
    else layoutPolling = 0;
  };
  const schedule = () => { if (pending && canAnimate() && !frame) frame = window.requestAnimationFrame(flush); };
  const observer = new MutationObserver(records => {
    if (disposed || suspended) return;
    for (const record of records) {
      const target = elementOf(record.target);
      if (!target || target.closest('[data-native-polish-ghost],[data-native-polish-peek-trigger]')) continue;
      const structural = record.type === 'childList';
      const textual = record.type === 'characterData';
      // Discover an editor's scroll surface when CodeMirror mounts into its
      // host. Token, selection and caret updates remain excluded from scans.
      if (target.closest(EDITING)) {
        if (structural && target.matches('[data-testid="file-source-editor"]')) scheduleAmbient(['elastic']);
        continue;
      }
      if (structural) {
        const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
        if (nodes.length && nodes.every(node => node.nodeType === 1 && (node.getAttribute('data-native-polish-ghost') !== null || node.getAttribute('data-native-polish-peek-trigger') !== null))) continue;
      }
      // Offset/clip/translate writes belong solely to the elastic adapter.
      // Host spinner leaf styles likewise do not invalidate whole layouts.
      if (record.attributeName === 'style' && target.closest('[data-native-polish-elastic]')) continue;
      if (record.attributeName === 'data-status-bucket') { scheduleAmbient(['agents']); continue; }
      // Reused dialog portal surfaces open by gaining role="dialog".
      if (record.attributeName === 'role') { scheduleAmbient(['floating', 'controls']); continue; }
      if (structural || record.attributeName === 'aria-expanded' || target.matches(PANE) || target.querySelector(PANE)) schedule();
      const meaningful = structural || ['aria-expanded', 'aria-selected', 'aria-busy'].includes(record.attributeName ?? '');
      if (target.closest(CHAT)) {
        if (meaningful || textual) {
          // Follow-output is scheduled from the same chat commit. Measure its
          // new extent in this microtask so the inverse is ready before the
          // host's animation frame writes scrollTop.
          refreshAmbient(canAnimate(), new Set<Region>(['tools', 'messages']));
        }
      } else if (target.closest(WORKSPACE_SCROLL)) {
        if (meaningful) scheduleAmbient(['workspaces', 'agents', 'controls']);
      } else if (target.closest(FILE_TREE + ', ' + CHANGE_TREE)) {
        if (meaningful) scheduleAmbient(['files', 'controls']);
      } else if (target.closest(TAB_ROW)) {
        if (meaningful || target.matches(TAB)) scheduleAmbient(['tabs', 'agents', 'controls']);
      } else if (target.closest(FLOATING)) {
        if (meaningful || target.matches(FLOATING)) scheduleAmbient(['floating', 'controls']);
      } else if (structural || target.matches(PANE) || target.querySelector(PANE)) {
        // Shell commits may mount/remove any surface, including portal menus.
        scheduleAmbient();
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'role', 'aria-hidden', 'aria-expanded', 'aria-selected', 'aria-busy', 'data-status-bucket'] });
  function clearCapture() {
    pending = null; treeTarget = null; pointerOrigin = null; layoutPolling = 0;
    window.clearTimeout(deadline); deadline = 0;
    window.cancelAnimationFrame(frame); frame = 0;
  }
  function capturesInput(event: Event): boolean {
    if (!canAnimate() || composing || event.isComposing || event.keyCode === 229 || event.key === 'Process' || event.repeat || (event.button ?? 0) !== 0) return false;
    const target = elementOf(event.target);
    if (!target || target.closest('[data-native-polish-ghost]')) return false;
    const shortcut = Boolean(event.key && !event.altKey && (event.metaKey || event.ctrlKey)
      && ['b', 'e', '.', '`'].includes(event.key.toLowerCase()));
    if (event.key && !shortcut && !['Enter', ' '].includes(event.key)) return false;
    // Preserve global sidebar shortcuts in the composer, but never treat
    // editor/terminal shortcuts or ordinary text input as chrome activation.
    if (target.closest(EDITING) && (!shortcut || target.closest('[data-testid="file-source-editor"],.cm-editor,.monaco-editor,[data-testid="terminal-surface"],.xterm'))) return false;
    return shortcut || Boolean(target.closest(ACTION));
  }
  // The host's shortcut listener precedes ours on window capture, and React
  // commits its sidebar state in a microtask before our listener runs. Take
  // the sidebar baseline when the modifier goes down, before B/E arrives.
  let primed: Map<string, Snapshot> | null = null;
  const prime = (event: Event) => {
    if (event.key !== 'Meta' && event.key !== 'Control') return;
    primed = event.repeat || !canAnimate() ? primed : new Map(Array.from(panels()).filter(([, el]) => visible(el)).map(([key, el]) => [key, snapshot(el)]));
  };
  const unprime: Listener = event => { if (event.key === 'Meta' || event.key === 'Control') primed = null; };
  const begin = (event: Event) => {
    if (event.key === 'Meta' || event.key === 'Control') { prime(event); return; }
    if (!capturesInput(event)) {
      // Selecting text or placing a caret may interrupt motion, but does not
      // require full snapshots. Ordinary keystrokes leave host input alone.
      if (!event.key) { clearCapture(); if (active.size || ghosts.size) stopAll(); }
      return;
    }
    const target = elementOf(event.target);
    if (target?.closest('[data-native-polish-ghost]')) return;
    const disclosure = target ? disclosureFor(target) : null;
    const disclosureChat = disclosure?.closest(CHAT);
    if (disclosureChat) {
      // The nested region owns this vertical change. Browser scroll clamping
      // on collapse and host bottom-follow on expansion must rebase directly,
      // rather than being replayed as motion on the entire chat timeline.
      chatDisclosureQuietUntil.set(disclosureChat, Date.now() + duration() + 100);
    }
    if (target && (disclosure?.closest(WORKSPACE_SCROLL) || target.closest(
      '[data-testid*="sidebar-"][data-testid*="show-more"], [data-testid^="sidebar-project-filter-"], [data-testid^="sidebar-host-filter-"], [data-testid^="sidebar-label-filter-"], [data-testid^="sidebar-grouping-"]'
    ))) workspaceQuietUntil = Date.now() + 900;
    // Finish interrupted motion before measuring the next layout. No delayed
    // input handlers: the host receives the original click/key immediately.
    stopAll();
    window.cancelAnimationFrame(passiveFrame); passiveFrame = 0; dirty.clear();
    refreshAmbient(false);
    if (!event.key && event.clientX !== undefined && event.clientY !== undefined) pointerOrigin = { x: event.clientX, y: event.clientY };
    layoutPolling = 0;
    // Shortcuts have no pointerup/click commit; poll for the async commit.
    if (event.key && (event.metaKey || event.ctrlKey)) layoutPolling = 12;
    // Repeated shortcuts while the modifier stays down reuse the previous
    // commit's baseline; the host has already applied this one.
    const baseline = event.key && (event.metaKey || event.ctrlKey) ? primed ?? pending?.panels ?? null : null;
    primed = null;
    treeTarget = target;
    pending = capture(target);
    if (baseline) pending.panels = baseline;
    window.clearTimeout(deadline);
    deadline = window.setTimeout(() => { pending = null; treeTarget = null; }, 900);
    schedule();
  };
  const onScroll: Listener = () => {
    if (disposed || suspended) return;
    quietUntil = Date.now() + 350; pending = null; treeTarget = null;
    if (active.size || ghosts.size) stopAll();
    window.clearTimeout(scrollDeadline);
    // Rebase once after a burst, never clone workspace/project snapshots on
    // every wheel event.
    scrollDeadline = window.setTimeout(() => {
      scrollDeadline = 0;
      if (!disposed) refreshAmbient(false, new Set<Region>(['workspaces', 'tabs', 'messages']));
    }, 160);
  };
  const onChatScroll: Listener = event => {
    const chat = elementOf(event.target);
    if (!chat?.matches(CHAT)) return;
    // Core applies follow-output scrollTop after its content commit. Observe
    // that movement directly and invert it in the same task. Deferring this
    // to another animation frame briefly paints the snapped scroll position,
    // then moves the text back, which reads as ghosting once streaming fades
    // and follow-output overlap.
    updateMessages(canAnimate());
  };
  const onPointerMove: Listener = event => {
    if (suspended && !document.hidden && document.hasFocus()) resumeMotion();
    if (!pointerOrigin || event.buttons !== 1) return;
    if (Math.abs((event.clientX ?? pointerOrigin.x) - pointerOrigin.x) + Math.abs((event.clientY ?? pointerOrigin.y) - pointerOrigin.y) < 6) return;
    quietUntil = Date.now() + 250;
    pending = null; treeTarget = null; stopAll();
  };
  const onReduce = () => { edgePeek?.refresh(); updateMotionFlags(); if (reduceMotion.matches) { pending = null; stopAll(); refreshAmbient(false); } };
  const unsubscribe = subscribePreferences(() => {
    try { window.localStorage.setItem(PREF_KEY, JSON.stringify(getPreferences())); } catch { /* optional persistence */ }
    edgePeek?.refresh();
    pending = null; stopAll(); updateMotionFlags(); refreshAmbient(false);
  });
  // RN Pressable / gesture handlers may commit on pointerup, before the DOM
  // click arrives. Measuring in click capture sees the final layout already.
  // Pointerdown establishes the old layout; click is only an AX fallback.
  const onCommit: Listener = (event) => {
    pointerOrigin = null;
    if (!capturesInput(event)) return;
    if (Date.now() < quietUntil) { refreshAmbient(false); return; }
    if (!pending) begin(event);
    // Layout may change in a React commit after pointerup or click. Poll for a
    // short bounded interval as well as observing class/style/child changes.
    // This also covers CSS stylesheet updates, which are not DOM mutations.
    layoutPolling = 12;
    schedule(); scheduleAmbient();
  };
  const onCompositionStart: Listener = () => { composing = true; clearCapture(); if (active.size || ghosts.size) stopAll(); };
  const onCompositionEnd: Listener = () => { composing = false; };
  function pauseMotion() {
    if (disposed) return;
    suspended = true; composing = false; clearCapture();
    window.clearTimeout(scrollDeadline); scrollDeadline = 0;
    window.cancelAnimationFrame(passiveFrame); passiveFrame = 0; dirty.clear();
    stopAll(); elastic.reset(); elastic.refresh(); updateMotionFlags();
    // Exit copies are unnecessary while no motion is presented. Release
    // their detached DOM and rebuild clean baselines on return.
    workspaceLists.clear(); tabRows.clear(); floating.clear(); paneBaseline.clear(); paneTransition = null;
    for (const rise of contentRises) rise.cancel();
    fileIcons.clear(); toolIcons.clear(); toolStates.clear(); toolLabels.clear(); toolDetailText.clear(); toolDetailReveals.clear(); agentStates.clear();
  }
  function resumeMotion() {
    if (disposed || document.hidden || !document.hasFocus()) return;
    suspended = false; updateMotionFlags();
    // Rebase once after host focus handling. Changes received in background
    // appear immediately; they do not replay stale entrances or exits.
    window.cancelAnimationFrame(passiveFrame); dirty.clear();
    passiveFrame = window.requestAnimationFrame(() => { passiveFrame = 0; dirty.clear(); refreshAmbient(false); });
  }
  const onVisibility: Listener = () => { if (document.hidden) pauseMotion(); else resumeMotion(); };
  let blurTimer = 0;
  const onWindowBlur: Listener = () => {
    window.clearTimeout(blurTimer);
    // Focus entering a sandboxed preview can blur the parent Window while
    // the document's focus chain still belongs to this app window.
    blurTimer = window.setTimeout(() => {
      blurTimer = 0;
      if (document.hidden || !document.hasFocus()) pauseMotion();
    }, 0);
  };
  const onWindowFocus: Listener = () => { window.clearTimeout(blurTimer); blurTimer = 0; resumeMotion(); };
  const onClick: Listener = onCommit;
  edgePeek = installEdgePeek({
    enabled: () => !disposed && getPreferences().enabled && getPreferences().edgePeek,
    motion: () => getPreferences().enabled && getPreferences().sidebars && !reduceMotion.matches,
    quick: () => getPreferences().pace === 'quick',
    panels,
    onTransition: () => {
      clearCapture(); stopAll();
      updateMotionFlags();
      // Rebase pane/list geometry; the preview owns only its horizontal slide.
      refreshAmbient(false);
      scheduleAmbient();
    },
  });
  document.addEventListener('pointerdown', begin, true);
  document.addEventListener('pointerup', onCommit, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('click', onClick, true);
  // The host's shortcut handler is a window capture listener that stops
  // propagation for Cmd/Ctrl+B/E, so a document listener never sees them.
  // Its sidebar state commits asynchronously, after this snapshot.
  window.addEventListener('keydown', begin, true);
  window.addEventListener('keyup', unprime, true);
  document.addEventListener('wheel', onScroll, true);
  document.addEventListener('scroll', onChatScroll, true);
  document.addEventListener('compositionstart', onCompositionStart, true);
  document.addEventListener('compositionend', onCompositionEnd, true);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('animationstart', onAnimationStart, true);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('focus', onWindowFocus);
  reduceMotion.addEventListener('change', onReduce);
  return () => {
    disposed = true;
    edgePeek?.dispose();
    elastic.dispose();
    document.body.removeAttribute("data-native-polish");
    for (const key of ['controls', 'tabs', 'trees', 'states', 'motion']) document.body.removeAttribute(`data-native-polish-${key}`);
    stylesheet.remove();
    for (const cleanup of decorations.values()) cleanup();
    decorations.clear();
    observer.disconnect(); unsubscribe();
    document.removeEventListener('pointerdown', begin, true);
    document.removeEventListener('pointerup', onCommit, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', begin, true);
    window.removeEventListener('keyup', unprime, true);
    document.removeEventListener('wheel', onScroll, true);
    document.removeEventListener('scroll', onChatScroll, true);
    document.removeEventListener('compositionstart', onCompositionStart, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('animationstart', onAnimationStart, true);
    window.clearTimeout(blurTimer);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('focus', onWindowFocus);
    reduceMotion.removeEventListener('change', onReduce);
    window.clearTimeout(deadline); window.cancelAnimationFrame(frame); window.cancelAnimationFrame(passiveFrame);
    window.clearTimeout(scrollDeadline); dirty.clear();
    for (const rise of contentRises) rise.cancel();
    contentRises.clear();
    workspaceLists.clear(); tabRows.clear(); floating.clear(); paneBaseline.clear(); fileIcons.clear(); toolIcons.clear(); toolStates.clear(); toolLabels.clear(); toolDetailText.clear(); toolDetailReveals.clear(); agentStates.clear();
    pending = null; treeTarget = null; stopAll();
  };
}
