import { Platform } from "react-native";
import { defaults, getPreferences, setPreferences, subscribePreferences } from "./preferences";
import { installElasticScroll } from "./elastic-scroll";
import { installEdgePeek } from "./edge-peek";
import { leaseMotion } from "./motion-runtime";

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
interface Animation { cancel(): void; finished: Promise<unknown> }
interface Element {
  nodeType: number; parentElement: Element | null; nextElementSibling: Element | null; children: ArrayLike<Element>;
  style: Style; isConnected: boolean; textContent: string | null;
  scrollTop: number; scrollLeft: number; scrollHeight: number; clientHeight: number;
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
interface Event { target: Element | null; key?: string; keyCode?: number; isComposing?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; repeat?: boolean; button?: number; buttons?: number; clientX?: number; clientY?: number }
type Listener = (event: Event) => void;
interface Media { matches: boolean; addEventListener(type: string, callback: () => void): void; removeEventListener(type: string, callback: () => void): void }
declare const document: {
  body: Element; head: Element;
  hidden: boolean;
  hasFocus(): boolean;
  querySelectorAll(selector: string): ArrayLike<Element>;
  createElement(tag: string): Element;
  addEventListener(type: string, callback: Listener, capture?: boolean): void;
  removeEventListener(type: string, callback: Listener, capture?: boolean): void;
};
declare const window: {
  innerWidth: number; innerHeight: number;
  getComputedStyle(element: Element): Style;
  matchMedia(query: string): Media;
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
  localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  addEventListener(type: string, callback: Listener, capture?: boolean): void;
  removeEventListener(type: string, callback: Listener, capture?: boolean): void;
};
interface Mutation { type: string; target: Element; attributeName: string | null; addedNodes: ArrayLike<Element>; removedNodes: ArrayLike<Element> }
declare const MutationObserver: new (callback: (records: Mutation[]) => void) => { observe(target: Element, options: { subtree: boolean; childList: boolean; characterData: boolean; attributes: boolean; attributeFilter: string[] }): void; disconnect(): void };

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
const LABEL_CHIP = '[data-testid^="workspace-label-chip-"]';
// Every other meta-row item (branch, project, checks, service, host, PR) is a
// single instance per row, so unlike labels it gets a fixed logical key: the
// row shouldn't replay an exit/entrance just because a check's state changed
// its testid, or a PR's host changed its badge id.
const META_ITEM = LABEL_CHIP + ', [data-testid="sidebar-workspace-branch"], [data-testid="sidebar-workspace-project"], '
  + '[data-testid^="sidebar-workspace-checks-"], [data-testid="workspace-service"], [data-testid="workspace-service-unhealthy"], '
  + '[data-testid^="host-badge-"], [role="link"]';
function metaItemKey(el: Element): string {
  const testid = el.getAttribute('data-testid') ?? '';
  if (testid.startsWith('workspace-label-chip-')) return testid;
  if (testid.startsWith('host-badge-')) return 'host';
  if (testid.startsWith('sidebar-workspace-checks-')) return 'checks';
  if (testid === 'workspace-service' || testid === 'workspace-service-unhealthy') return 'service';
  if (testid === 'sidebar-workspace-branch') return 'branch';
  if (testid === 'sidebar-workspace-project') return 'project';
  return 'pr';
}
const TITLE_EXCLUDED = '[role="button"],[role="menuitem"],svg';
const TITLE_REVEAL_HORIZON_MS = 150;
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
const FLOATING = '[data-menu-surface="true"], [role="dialog"], [role="tooltip"]';
const CHAT = '[data-testid="agent-chat-scroll"]';
const HISTORY_ROW = '[data-history-row-id]';
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
// The rendered title has no testid of its own. It is the first leaf text node
// in the row that is not inside a tagged badge/menu/icon, which always comes
// before the meta row (branch, labels, checks) in document order.
function workspaceTitleNode(row: Element): Element | null {
  const tagged = (el: Element) => {
    for (let at: Element | null = el; at && at !== row; at = at.parentElement) if (at.getAttribute('data-testid') || at.matches(TITLE_EXCLUDED)) return true;
    return false;
  };
  for (const el of all(row, '*')) if (!el.children.length && el.textContent?.trim() && !tagged(el)) return el;
  return null;
}
function computeRevealStep(backlog: number, elapsedMs: number): number {
  if (backlog <= 0) return 0;
  const elapsed = Math.min(Math.max(elapsedMs, 0), 250);
  if (elapsed <= 0) return 0;
  if (elapsed >= TITLE_REVEAL_HORIZON_MS) return backlog;
  return Math.min(backlog, Math.max(1, Math.ceil((backlog * elapsed) / TITLE_REVEAL_HORIZON_MS)));
}
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
  return leaseMotion('0.4.13', installWebMotion);
}

function installWebMotion(): () => void {
  document.body.setAttribute("data-native-polish", "0.4.13");

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
  console.info('[Native Polish] loaded', JSON.stringify({ version: '0.4.13', preferences: getPreferences(), reduceMotion: reduceMotion.matches }));
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
  function ghost(before: Snapshot, horizontal = 0, milliseconds = duration()) {
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
    animate(copy, [{ opacity: 1, transform: 'translate(0,0)', clipPath: 'inset(0 0 0 0)' }, { opacity: 0, transform: `translate(${horizontal}px,-3px)`, clipPath: horizontal ? 'inset(0 0 0 0)' : 'inset(0 0 100% 0)' }], () => { copy.remove(); ghosts.delete(copy); }, 0, milliseconds);
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
  // status changes) without relying on a click being in progress. No content
  // text is compared, and message DOM is never cloned.
  interface TabState { chip: Element; shot: Snapshot; left: number }
  let tabRows = new Map<Element, Map<string, TabState>>();
  interface WorkspaceAnchor { shot: Snapshot; top: number; left: number; project: string | null }
  interface WorkspaceList {
    keys: Set<string>; anchorKeys: Set<string>; sections: Map<string, string | null>; projectKeys: Set<string>;
    projects: Map<string, Snapshot>; anchors: Map<string, WorkspaceAnchor>; expanded: Map<string, string | null>;
  }
  let workspaceLists = new Map<Element, WorkspaceList>();
  // Keep the workspace row as well as the label's DOM snapshot. React can
  // remove the final meta-container along with the label, leaving the label's
  // parent disconnected by the time this observer gets to animate it. The row
  // is still mounted and is the thing whose shrinking height must be owned.
  interface WorkspaceMetaState { shot: Snapshot; row: Element; rowHeight: number; top: number; left: number }
  let workspaceMeta = new Map<string, Map<string, WorkspaceMetaState>>();
  let workspaceTitleBaseline = new Map<string, string>();
  interface TitleCover { overlay: Element; restoreNode: () => void }
  interface TitleReveal { key: string; target: string; revealed: number; cover: TitleCover; stop: () => void }
  const titleReveals = new Map<Element, TitleReveal>();
  // A row whose reveal owns it is looked up here instead of re-deriving its
  // title node from the DOM, whose text is transiently empty/partial mid-reveal
  // and would otherwise be misidentified as a different row element entirely.
  const titleRevealKeys = new Map<string, Element>();
  let titleFrame = 0;
  let titleLastTime = 0;
  interface FloatingSnapshot extends Snapshot { opacity: number; hostExit: boolean }
  let floating = new Map<Element, FloatingSnapshot>();
  let paneBaseline = paneBoxes();
  let paneTransition: Map<string, PaneBox> | null = null;
  let paneTransitionUntil = 0;
  let fileIcons = new Map<Element, string>();
  let toolIcons = new Map<Element, string>();
  let toolStates = new Map<Element, boolean>();
  let agentStates = new Map<Element, string>();
  const tabSettling = new WeakMap<Element, number>();
  const chats = new WeakMap<Element, { seen: Set<string>; pending: Set<string>; running: boolean }>();
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
  // The host eases its own row to the content's new, smaller measured height
  // with overflow clipped to that target. Our own in-flow exit/entrance still
  // needs the old, larger extent for its own duration, or the host's already-
  // shrinking clip silently hides it. Relax any clipping ancestor up to the
  // row for that window, then let it settle back once our clone is gone.
  function releaseRowClip(from: Element, row: Element): () => void {
    const restores: (() => void)[] = [];
    for (let at: Element | null = from; at && at !== row; at = at.parentElement) {
      const style = window.getComputedStyle(at);
      const clipped = /^(hidden|clip)$/.test(style.getPropertyValue('overflow-y') || style.getPropertyValue('overflow'));
      if (clipped || at.style.getPropertyValue('height')) restores.push(temporaryStyles(at, { overflow: 'visible', height: 'auto', 'max-height': 'none' }));
    }
    return () => { for (const restore of restores) restore(); };
  }
  // The host has already committed the smaller workspace row by the time the
  // observer runs. Never re-expand that row: its flex/grid alignment would
  // reflow the title, unread dot, and timestamp while its height animates.
  // Instead, retain the removed chips as fixed ghosts and collapse equivalent
  // trailing space after the committed row. Following workspaces ease upward,
  // while every surviving part of this row stays in its final layout.
  function collapseMetaItems(items: WorkspaceMetaState[]) {
    if (!items.length) return;
    // A final label commonly takes its now-empty parent with it. Its saved
    // workspace row gives us a height owner even though every label parent is
    // gone, so the next workspace does not jump upward before the ghost fades.
    const row = items.find(item => item.row.isConnected)?.row
      ?? items.find(item => item.shot.parent?.isConnected)?.shot.parent?.closest(WORKSPACE_ROW)
      ?? null;
    if (!row) { for (const item of items) ghost(item.shot); return; }
    const afterHeight = rect(row).height;
    const beforeHeight = Math.max(...items.map(item => item.rowHeight));
    const milliseconds = Math.round(duration() * .75);
    for (const item of items) ghost(item.shot, 0, milliseconds);
    const shrink = beforeHeight - afterHeight;
    if (shrink <= 1) return;
    const baseMargin = parseFloat(window.getComputedStyle(row).getPropertyValue('margin-bottom')) || 0;
    const expandedMargin = baseMargin + shrink;
    // The added margin restores the following row to its pre-removal position
    // without changing this row's own child layout. Animate it back to the
    // host baseline to produce the same smooth vertical collapse.
    const restoreRow = temporaryStyles(row, { 'margin-bottom': `${expandedMargin}px` });
    animate(row, [{ marginBottom: `${expandedMargin}px` }, { marginBottom: `${baseMargin}px` }], restoreRow, 0, milliseconds);
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
  // Covers labels plus every other meta-row item (branch, project, checks,
  // service, host badge, PR) with the same add/remove treatment. Rows are
  // scanned per scroll container, not per-row visibility (unlike live()): a
  // row scrolled just out of view must still be tracked, or the next time it
  // scrolls back in looks like a fresh mount and its baseline is lost.
  function updateWorkspaceMeta(allow: boolean) {
    const nextLists = new Map<string, Map<string, WorkspaceMetaState>>();
    for (const scroll of live(WORKSPACE_SCROLL)) {
      for (const row of all(scroll, WORKSPACE_ROW).filter(el => !el.closest('[data-native-polish-ghost]'))) {
        const key = row.getAttribute('data-testid');
        if (!key) continue;
        const old = workspaceMeta.get(key);
        const rowHeight = rect(row).height;
        const items = all(row, META_ITEM).filter(el => !el.closest('[data-native-polish-ghost]')).slice(0, 40);
        const entries = items.map(item => ({ item, id: metaItemKey(item) }));
        const present = new Set(entries.map(entry => entry.id));
        const motionAllowed = allow && getPreferences().sidebars && !!old && Date.now() >= quietUntil;
        const removed = old ? Array.from(old.keys()).filter(id => !present.has(id)) : [];
        const current = new Map<string, WorkspaceMetaState>();
        for (const { item, id } of entries) {
          const previous = old?.get(id);
          // If a second new label is still entering when its sibling is
          // removed, first settle it at Paseo's new layout. Its fresh box is
          // then a reliable FLIP destination instead of an in-flight width 0.
          if (motionAllowed && removed.length && active.has(item)) active.get(item)?.();
          const box = rect(item);
          current.set(id, active.has(item) && previous ? previous : { shot: snapshot(item), row, rowHeight, top: box.top, left: box.left });
        }
        nextLists.set(key, current);
        // A row discovered for the first time has no baseline: its items are
        // already mounted, not just added, so they must not fade in.
        if (!motionAllowed || !old) continue;
        const added = Array.from(current.keys()).filter(id => !old.has(id));
        let entered = 0;
        for (const id of added) {
          const state = current.get(id)!;
          const el = state.shot.element;
          if (active.has(el)) continue;
          const width = state.shot.box.width, height = state.shot.box.height;
          if (width < 2 || height < 2) continue;
          // Growing the item's own box (not just its opacity) slides it into
          // flow, naturally reflowing same-line siblings into place the same
          // way removal does — a separate reposition transform on those
          // siblings would fight this real layout change instead of helping it.
          // It stays invisible until the box is nearly full size (showing text
          // while the box is still small and widening reads as letters typing
          // in), but that fade-in only needs a short tail — the grow gets
          // nearly the whole duration so the sibling's reflow reads as a slide.
          const restore = temporaryStyles(el, { overflow: 'hidden', 'max-width': `${width}px`, 'max-height': `${height}px`, 'flex-shrink': '0' });
          const releaseClip = releaseRowClip(el, el.closest(WORKSPACE_SCROLL) ?? row);
          animate(el, [
            { width: '0px', height: '0px', opacity: 0, transform: 'translateY(-4px)' },
            { width: `${width}px`, height: `${height}px`, opacity: 0, transform: 'translateY(0)', offset: 0.85 },
            { width: `${width}px`, height: `${height}px`, opacity: 1, transform: 'translateY(0)' },
          ], () => { restore(); releaseClip(); }, Math.min(entered++ * 40, 160));
        }
        collapseMetaItems(removed.map(id => old.get(id)!));
        // The fixed removal ghost intentionally does not perturb the live
        // meta flow. Animate only surviving items from their old coordinates
        // to the host's final slot, so two labels entering followed by one
        // removal remains fluid without reflowing the workspace title.
        if (removed.length) for (const [id, state] of current) {
          if (added.includes(id)) continue;
          const previous = old.get(id);
          if (!previous) continue;
          const dx = previous.left - state.left;
          const dy = previous.top - state.top;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) animate(state.shot.element, [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }]);
        }
        // Labels share a max-width budget: removing or adding one can also
        // change how much a surviving chip's own text gets truncated to. The
        // host already computed that width correctly for the new count by the
        // time we see it here, so its width snaps; only its position eases.
      }
    }
    workspaceMeta = nextLists;
  }
  // Paseo owns the actual workspace-name node. During a rename we hide only
  // that leaf (retaining its layout and the host row's real background), then
  // temporarily draw the old/new title above it.
  function paintTitleCover(overlay: Element, node: Element) {
    const r = rect(node);
    const style = window.getComputedStyle(node);
    const values: Record<string, string> = {
      position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      display: 'block', margin: '0', padding: '0', 'box-sizing': 'border-box', overflow: 'hidden', 'pointer-events': 'none', 'z-index': '1',
      'background-color': 'transparent', color: style.getPropertyValue('color'),
      'font-family': style.getPropertyValue('font-family'), 'font-size': style.getPropertyValue('font-size'),
      'font-style': style.getPropertyValue('font-style'), 'font-weight': style.getPropertyValue('font-weight'),
      'font-variant': style.getPropertyValue('font-variant'), 'font-stretch': style.getPropertyValue('font-stretch'),
      'line-height': style.getPropertyValue('line-height'), 'letter-spacing': style.getPropertyValue('letter-spacing'),
      'word-spacing': style.getPropertyValue('word-spacing'), 'text-transform': style.getPropertyValue('text-transform'),
      'text-indent': style.getPropertyValue('text-indent'), 'text-align': style.getPropertyValue('text-align'),
      'white-space': style.getPropertyValue('white-space'), direction: style.getPropertyValue('direction'),
    };
    for (const [property, value] of Object.entries(values)) overlay.style.setProperty(property, value, 'important');
  }
  function titleRevealCover(node: Element): TitleCover {
    const overlay = document.createElement('div');
    overlay.setAttribute('data-native-polish-reveal', '');
    overlay.setAttribute('aria-hidden', 'true');
    paintTitleCover(overlay, node);
    const restoreNode = temporaryStyles(node, { visibility: 'hidden' });
    document.body.appendChild(overlay);
    return { overlay, restoreNode };
  }
  function removeTitleCovers() {
    for (const state of Array.from(titleReveals.values())) state.stop();
  }
  function tickTitleReveals() {
    titleFrame = 0;
    const now = Date.now();
    const elapsed = titleLastTime ? now - titleLastTime : 16;
    titleLastTime = now;
    for (const [, state] of Array.from(titleReveals)) {
      // React may replace the leaf text span immediately after its mutation.
      // The overlay is intentionally independent of that host node: removing
      // it just because its original anchor was reconciled would expose the
      // final host title before a single reveal frame can be painted.
      if (!state.cover.overlay.isConnected) { state.stop(); continue; }
      const chars = Array.from(state.target);
      const step = computeRevealStep(chars.length - state.revealed, elapsed);
      if (step > 0) {
        state.revealed = Math.min(chars.length, state.revealed + step);
        state.cover.overlay.textContent = chars.slice(0, state.revealed).join('');
      }
      if (state.revealed >= chars.length) state.stop();
    }
    if (titleReveals.size) titleFrame = window.requestAnimationFrame(tickTitleReveals);
    else titleLastTime = 0;
  }
  function startTitleReveal(key: string, node: Element, target: string, cover: TitleCover) {
    active.get(node)?.();
    const stop = () => {
      titleReveals.delete(node);
      if (titleRevealKeys.get(key) === node) titleRevealKeys.delete(key);
      if (active.get(node) === stop) active.delete(node);
      cover.restoreNode();
      cover.overlay.remove();
    };
    active.set(node, stop);
    titleReveals.set(node, { key, target, revealed: 0, cover, stop });
    titleRevealKeys.set(key, node);
    if (!titleFrame) { titleLastTime = 0; titleFrame = window.requestAnimationFrame(tickTitleReveals); }
  }
  // Called straight from the mutation observer, not the deferred/batched
  // ambient pass: that pass runs on the next animation frame, by which point
  // the browser has already painted the host's committed rename for at least
  // one frame. Installing the cover here, in the same microtask as the host
  // mutation, keeps the final name from flashing before our reveal starts.
  function syncTitleReveal(row: Element) {
    if (!canAnimate() || !getPreferences().sidebars || Date.now() < quietUntil) return;
    const key = row.getAttribute('data-testid');
    if (!key || titleRevealKeys.has(key)) return;
    const node = workspaceTitleNode(row);
    if (!node || !visible(node)) return;
    const text = node.textContent ?? '';
    const previous = workspaceTitleBaseline.get(key);
    if (previous === undefined || previous === text) return;
    const cover = titleRevealCover(node);
    startTitleReveal(key, node, text, cover);
  }
  // A React rename can replace the old leaf span outright. In that case the
  // mutation target has already detached, so looking only at target.closest()
  // misses the rename and leaves the next animation-frame scan to replay it
  // after it was visible. The added node is still connected under its row.
  function syncTitleRevealFromMutation(record: Mutation, target: Element | null) {
    const candidates: Element[] = target ? [target] : [];
    if (record.type === 'childList') for (const node of Array.from(record.addedNodes)) {
      const element = elementOf(node);
      if (element) candidates.push(element);
    }
    for (const candidate of candidates) {
      const row = candidate.closest(WORKSPACE_ROW) ?? candidate.querySelector(WORKSPACE_ROW);
      if (row?.closest(WORKSPACE_SCROLL)) { syncTitleReveal(row); return; }
    }
  }
  // Scoped per scroll container, not per-row visibility (unlike live()): a
  // row scrolled just out of view must still be tracked, or the next time it
  // scrolls back in looks like a fresh mount and its baseline is lost.
  function updateWorkspaceTitles(allow: boolean) {
    const nextBaseline = new Map<string, string>();
    for (const scroll of live(WORKSPACE_SCROLL)) {
      for (const row of all(scroll, WORKSPACE_ROW).filter(el => !el.closest('[data-native-polish-ghost]'))) {
        const key = row.getAttribute('data-testid');
        if (!key) continue;
        const node = workspaceTitleNode(row);
        if (!node) continue;
        // A row whose title is already revealing must not be re-scanned: its
        // source leaf can be replaced while the temporary overlay finishes.
        const activeNode = titleRevealKeys.get(key);
        const activeReveal = activeNode ? titleReveals.get(activeNode) : undefined;
        if (activeReveal) {
          nextBaseline.set(key, activeReveal.target);
          continue;
        }
        const text = node.textContent ?? '';
        nextBaseline.set(key, text);
        const previous = workspaceTitleBaseline.get(key);
        // A renamed title is a replacement, not growth of the same string: always
        // retype from the first character rather than diffing against the old one.
        if (previous === undefined || previous === text || !allow || !getPreferences().sidebars || Date.now() < quietUntil) continue;
        startTitleReveal(key, node, text, titleRevealCover(node));
      }
    }
    workspaceTitleBaseline = nextBaseline;
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
  // keyframe animation is an entrance only; a fade transition also runs on
  // close, so neither gets a second entrance and transitions get no copy.
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
    }
    toolIcons = updateIcons(slots, toolIcons, allow);
    toolStates = nextTools;
  }
  function updateMessages(allow: boolean) {
    for (const chat of live(CHAT)) {
      const rows = all(chat, HISTORY_ROW);
      const old = chats.get(chat);
      const running = Boolean(chat.querySelector('[data-testid="turn-working-indicator"]'));
      const seen = old?.seen ?? new Set<string>();
      const candidates = allow ? old?.pending ?? new Set<string>() : new Set<string>();
      let lastKnown = -1;
      rows.forEach((row, index) => { if (seen.has(row.getAttribute('data-history-row-id')!)) lastKnown = index; });
      const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 180;
      let entered = 0;
      rows.forEach((row, index) => {
        const id = row.getAttribute('data-history-row-id')!;
        const isNew = !seen.has(id);
        seen.add(id);
        if (allow && old && isNew && lastKnown >= 0 && index > lastKnown && atBottom && Date.now() >= quietUntil) candidates.add(id);
        if (candidates.has(id) && visible(row) && row.querySelector('[data-testid="user-message"], [data-testid="assistant-message"]')) {
          candidates.delete(id);
          if (allow && getPreferences().messages && atBottom && Date.now() >= quietUntil && entered++ < 4) animate(row, [{ opacity: 0 }, { opacity: 1 }], undefined, 0, 150);
        }
      });
      if (allow && getPreferences().states && old && old.running !== running && atBottom) {
        const indicator = chat.querySelector('[data-testid="turn-working-indicator"]') ?? rows[rows.length - 1];
        if (indicator && visible(indicator) && !active.has(indicator)) animate(indicator, [{ opacity: .4 }, { opacity: 1 }], undefined, 0, 150);
      }
      while (seen.size > 5000) seen.delete(seen.values().next().value!);
      const currentIds = new Set(rows.map(row => row.getAttribute('data-history-row-id')!));
      for (const id of candidates) if (!atBottom || !currentIds.has(id)) candidates.delete(id);
      chats.set(chat, { seen, pending: candidates, running });
    }
  }
  function refreshAmbient(allow = canAnimate(), selected: ReadonlySet<Region> = new Set(regions)) {
    if (disposed || suspended) return;
    if (selected.has('elastic')) elastic.refresh();
    allow = allow && !elastic.isActive();
    if (selected.has('controls')) decorateControls();
    if (selected.has('workspaces')) { updateWorkspaceRows(allow); updateWorkspaceMeta(allow); updateWorkspaceTitles(allow); }
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
      const structural = record.type === 'childList';
      if (structural || record.type === 'characterData') syncTitleRevealFromMutation(record, target);
      if (!target || target.closest('[data-native-polish-ghost],[data-native-polish-peek-trigger],[data-native-polish-reveal]')) continue;
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
      // Reused portal surfaces open by gaining role="dialog"/"tooltip".
      if (record.attributeName === 'role') { scheduleAmbient(['floating', 'controls']); continue; }
      if (structural || record.attributeName === 'aria-expanded' || target.matches(PANE) || target.querySelector(PANE)) schedule();
      const meaningful = structural || record.type === 'characterData' || ['aria-expanded', 'aria-selected', 'aria-busy'].includes(record.attributeName ?? '');
      if (target.closest(CHAT)) {
        if (meaningful) scheduleAmbient(['tools', 'messages']);
      } else if (target.closest(WORKSPACE_SCROLL)) {
        if (meaningful) {
          scheduleAmbient(['workspaces', 'agents', 'controls']);
        }
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
    if (target && (disclosureFor(target)?.closest(WORKSPACE_SCROLL) || target.closest(
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
  const onPointerMove: Listener = event => {
    if (suspended && !document.hidden && document.hasFocus()) resumeMotion();
    if (!pointerOrigin || event.buttons !== 1) return;
    if (Math.abs((event.clientX ?? pointerOrigin.x) - pointerOrigin.x) + Math.abs((event.clientY ?? pointerOrigin.y) - pointerOrigin.y) < 6) return;
    quietUntil = Date.now() + 250;
    pending = null; treeTarget = null; stopAll();
  };
  const onReduce = () => { edgePeek?.refresh(); updateMotionFlags(); if (reduceMotion.matches) { pending = null; stopAll(); removeTitleCovers(); refreshAmbient(false); } };
  const unsubscribe = subscribePreferences(() => {
    try { window.localStorage.setItem(PREF_KEY, JSON.stringify(getPreferences())); } catch { /* optional persistence */ }
    edgePeek?.refresh();
    pending = null; stopAll(); removeTitleCovers(); updateMotionFlags(); refreshAmbient(false);
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
    window.cancelAnimationFrame(titleFrame); titleFrame = 0; titleLastTime = 0;
    // Exit copies are unnecessary while no motion is presented. Release
    // their detached DOM and rebuild clean baselines on return.
    workspaceLists.clear(); tabRows.clear(); floating.clear(); paneBaseline.clear(); paneTransition = null;
    fileIcons.clear(); toolIcons.clear(); toolStates.clear(); agentStates.clear();
    workspaceMeta.clear(); workspaceTitleBaseline.clear(); removeTitleCovers(); titleReveals.clear(); titleRevealKeys.clear();
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
  document.addEventListener('compositionstart', onCompositionStart, true);
  document.addEventListener('compositionend', onCompositionEnd, true);
  document.addEventListener('visibilitychange', onVisibility);
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
    document.removeEventListener('compositionstart', onCompositionStart, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearTimeout(blurTimer);
    window.removeEventListener('blur', onWindowBlur);
    window.removeEventListener('focus', onWindowFocus);
    reduceMotion.removeEventListener('change', onReduce);
    window.clearTimeout(deadline); window.cancelAnimationFrame(frame); window.cancelAnimationFrame(passiveFrame);
    window.cancelAnimationFrame(titleFrame); titleFrame = 0;
    window.clearTimeout(scrollDeadline); dirty.clear();
    workspaceLists.clear(); tabRows.clear(); floating.clear(); paneBaseline.clear(); fileIcons.clear(); toolIcons.clear(); toolStates.clear(); agentStates.clear();
    workspaceMeta.clear(); workspaceTitleBaseline.clear(); removeTitleCovers(); titleReveals.clear(); titleRevealKeys.clear();
    pending = null; treeTarget = null; stopAll();
  };
}
