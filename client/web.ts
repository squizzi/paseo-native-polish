import { Platform } from "react-native";
import {
  defaults,
  GENTLE_STREAM_FADE_DURATION_MS,
  getPreferences,
  QUICK_MOTION_DURATION_MS,
  QUICK_STREAM_FADE_DURATION_MS,
  GENTLE_MOTION_DURATION_MS,
  setPreferences,
  subscribePreferences,
} from "./preferences";
import { installElasticScroll, LIVE_BOTTOM_PIN } from "./elastic-scroll";
import { installEdgePeek } from "./edge-peek";
import { leaseMotion } from "./motion-runtime";
import {
  isStreamingRehydrating,
  isInitialTurnSettling,
  shouldCrossfadeMarkdownHandoff,
  shouldFlipStreamingRowHeight,
  shouldSuppressTransientBottomFollow,
  shouldSuppressRehydratedStreamEntrance,
  STREAM_REHYDRATION_SETTLE_MS,
} from "./streaming-motion";

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
  contains(other: Element | null): boolean;
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
  requestAnimationFrame(callback: (timestamp: number) => void): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
  localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  addEventListener(type: string, callback: Listener, capture?: boolean): void;
  removeEventListener(type: string, callback: Listener, capture?: boolean): void;
};
interface Mutation { type: string; target: Element; attributeName: string | null; addedNodes: ArrayLike<Element>; removedNodes: ArrayLike<Element> }
declare const MutationObserver: new (callback: (records: Mutation[]) => void) => { observe(target: Element, options: { subtree: boolean; childList: boolean; characterData: boolean; attributes: boolean; attributeFilter: string[] }): void; disconnect(): void };
declare const ResizeObserver: new (callback: () => void) => { observe(target: Element): void; disconnect(): void };

const TOOL = '[data-testid="tool-call-badge"], [data-testid="tool-call-group"]';
const TOOL_DETAIL_CLIP = '[data-testid="tool-call-detail-entry-clip"]';
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

interface Snapshot { element: Element; box: Rect; copy: Element; parent: Element | null; next: Element | null }
interface Disclosure {
  element: Element;
  height: number;
  children: Element[];
  details: Snapshot[];
  expanded: boolean;
  detail: Element | null;
  detailHeight: number;
}
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
const CHAT_TIMELINE = '[data-testid="agent-chat-timeline"]';
const CHAT_TIMELINE_CLIP = '[data-testid="agent-chat-timeline-clip"]';
const WORKING_FOOTER = '[data-testid="turn-working-indicator"]';
// The completed footer replaces the working indicator at the end of a turn.
// Keep both out of a fallback timeline rise: older hosts put them beside the
// rows rather than under the dedicated timeline node that ux-polish has.
const COMPLETED_FOOTER = '[data-testid="turn-footer-entry-motion"]';
const STREAM_MARKDOWN = '[data-testid^="native-polish-stream-pace-"]';
const NATIVE_MARKDOWN_PARAGRAPH = '[data-paseo-markdown-tag="p"]';
const NATIVE_MARKDOWN_ORDERED_LIST = '[data-paseo-markdown-tag="ol"]';
const NATIVE_CODE_BLOCK = '[data-paseo-markdown-tag="pre"]';
const NATIVE_CODE_SURFACE = '[data-pmono]';
const LIVE_STREAM_PROSE = '[data-testid="native-polish-stream-prose"]';
const LIVE_STREAM_HEADING = '[data-testid^="native-polish-stream-heading-"]';
const LIVE_STREAM_CODE = '[data-testid="native-polish-stream-code"]';
const LIVE_STREAM_CODE_SURFACE = '[data-testid="native-polish-stream-code-block"], [data-testid="native-polish-stream-code"], [data-testid="native-polish-stream-inline-code"]';
const LIVE_STREAM_LIST = '[data-testid="native-polish-stream-list"]';
const LIVE_STREAM_LIST_TEXT = '[data-testid="native-polish-stream-list-marker"], [data-testid="native-polish-stream-list-content"]';
const LIVE_SYNTAX_TOKEN = '[data-testid^="native-polish-syntax-"]';
const STREAM_ENTRANCE = '[data-testid="native-polish-stream-token"], [data-testid="native-polish-stream-block"], [data-testid="native-polish-stream-list"], [data-testid="native-polish-stream-prose"], [data-testid^="native-polish-stream-heading-"], [data-testid="native-polish-stream-code-block"]';
const REHYDRATED_STREAM_ENTRANCE = 'data-native-polish-stream-rehydrated';
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
  const detail = toolDetail(el);
  return {
    element: el,
    height: rect(el).height,
    children,
    details: children.slice(1).filter(visible).map(snapshot),
    expanded: toolExpanded(el),
    detail,
    detailHeight: detail ? rect(detail).height : 0,
  };
}
function toolExpanded(tool: Element): boolean {
  return tool.querySelector('[role="button"][aria-expanded="true"], [aria-expanded="true"]') !== null;
}
function toolDetail(tool: Element): Element | null {
  return tool.querySelector(TOOL_DETAIL_CLIP) ?? Array.from(tool.children)[1] ?? null;
}
function toolDetailLines(tool: Element): Element[] {
  const clips = all(tool, TOOL_DETAIL_CLIP).filter(visible);
  if (clips.length) return clips;
  const detail = toolDetail(tool);
  if (!detail) return [];
  const children = Array.from(detail.children).filter(visible);
  return children.length ? children : visible(detail) ? [detail] : [];
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
  const duration = () => getPreferences().pace === 'quick' ? QUICK_MOTION_DURATION_MS : GENTLE_MOTION_DURATION_MS;

  const stopAll = () => {
    for (const stop of Array.from(active.values())) stop();
    for (const ghost of ghosts) ghost.remove();
    ghosts.clear();
  };
  function animate(
    el: Element,
    frames: Record<string, string | number>[],
    cleanup?: () => void,
    delay = 0,
    milliseconds = duration(),
    easing = EASING,
  ) {
    active.get(el)?.();
    if (!canAnimate() || typeof el.animate !== 'function') { cleanup?.(); return; }
    let animation: Animation;
    try { animation = el.animate(frames, { duration: milliseconds, easing, fill: 'both', delay }); }
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
  function temporaryStyles(el: Element, values: Record<string, string | { value: string; priority?: string }>): () => void {
    const requested = Object.entries(values).map(([key, entry]) => ({
      key,
      value: typeof entry === 'string' ? entry : entry.value,
      priority: typeof entry === 'string' ? '' : entry.priority ?? '',
    }));
    const previous = requested.map(({ key }) => [key, el.style.getPropertyValue(key), el.style.getPropertyPriority(key)]);
    for (const { key, value, priority } of requested) el.style.setProperty(key, value, priority);
    return () => {
      for (const [key, value, priority] of previous) {
        // Restore only values still owned by us; React may have updated a style.
        const requestedStyle = requested.find(style => style.key === key)!;
        if (el.style.getPropertyValue(key) !== requestedStyle.value || el.style.getPropertyPriority(key) !== requestedStyle.priority) continue;
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
  // Match ux-polish's GrowingLabel: the summary sentence ("Ran 1 command" ->
  // "Ran 2 commands, used 1 other tool") changes length as a tool group
  // accumulates calls. The host just swaps the text, so the row pops to its
  // new width; clip-animating its intrinsic text width eases the reveal
  // without changing the flex-owned width of the surrounding row.
  function intrinsicWidth(label: Element) {
    // The host's label wrapper is flex:1, so its visible width is the
    // available row width rather than the width of its text. Read its
    // max-content width without letting that temporary layout reach a paint.
    const restore = temporaryStyles(label, { flex: { value: 'none', priority: 'important' } });
    const width = rect(label).width;
    restore();
    return width;
  }
  function animateGrowingLabel(label: Element, before: number, after: number) {
    if (before <= 0 || after <= 0 || Math.abs(after - before) < 1 || active.has(label)) return;
    // The host replaces the inner GrowingLabel frame as its text changes, but
    // preserves the surrounding label row. Keep the row as the animation
    // owner and reveal its already-committed text through an in-flow clip.
    // Unlike a width tween on the replaceable child, this has a stable
    // baseline across tool updates and cannot displace the footer.
    const available = rect(label).width;
    const clip = (width: number) => `inset(0 ${Math.max(0, available - width)}px 0 0)`;
    const restore = temporaryStyles(label, {
      overflow: { value: 'hidden', priority: 'important' },
      'box-sizing': 'border-box',
    });
    animate(label, [{ clipPath: clip(before) }, { clipPath: clip(after) }], restore);
  }
  function animateShrinkingLabel(_before: Snapshot, label: Element, from: number, to: number) {
    // GrowingLabel keeps the replacement text in its ordinary layout slot and
    // changes only the local clip. A fixed-position copy can outlive the row
    // that created it and overlay the footer during a concurrent stream tick.
    // It also hides the live label long enough for numberOfLines={1} to flash
    // an ellipsis. Use the same in-flow clip for either direction.
    animateGrowingLabel(label, from, to);
  }
  function animateToolDetailResize(before: ToolLayout, next: ToolLayout) {
    const detailFrame = next.detail;
    const opening = !before.expanded && next.expanded;
    const closing = before.expanded && !next.expanded;
    if (detailFrame && Math.abs(next.detailHeight - before.detailHeight) >= 1 && !active.has(detailFrame)) {
      // Match ux-polish's ExpandableBadgeCollapseClip: animate only its
      // dedicated detail frame. Animating the whole badge lets the flex row
      // compress the summary label, temporarily rendering it as `…`.
      const restore = temporaryStyles(detailFrame, {
        overflow: 'hidden',
        'box-sizing': 'border-box',
        'min-height': '0',
        'flex-shrink': '0',
      });
      animate(
        detailFrame,
        [{ height: `${before.detailHeight}px` }, { height: `${next.detailHeight}px` }],
        restore,
        0,
        closing ? Math.min(duration(), 120) : duration(),
        closing ? 'cubic-bezier(0.4, 0, 1, 1)' : 'cubic-bezier(0.16, 1, 0.3, 1)',
      );
    }

    const entering = opening ? next.details : next.details.filter(detail => !before.details.includes(detail));
    let index = 0;
    for (const detail of entering) {
      const content = firstBoxChild(detail);
      if (!content || active.has(content)) continue;
      animate(
        content,
        [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
        undefined,
        40 + Math.min(index++ * 18, 90),
        duration(),
      );
    }
  }
  // A streaming row's content can pop to a very different size in one tick
  // instead of growing a few px at a time: a tab-hidden row remounts showing
  // everything it had already streamed (deliberately, so it does not replay
  // the whole reveal from empty), or a provider's first delta is a full
  // paragraph rather than a token. Either way it is not the gradual
  // per-frame growth the rest of this file assumes, so clip-and-fade it the
  // same way the renderer handoff below does instead of popping straight to
  // the new height.
  function flipStreamingRowHeight(row: Element, before: number, after: number) {
    if (active.has(row)) return;
    const restore = temporaryStyles(row, { overflow: 'hidden', 'box-sizing': 'border-box' });
    animate(row, [
      { height: `${before}px`, opacity: 1 },
      { height: `${(before + after) / 2}px`, opacity: 0.3, offset: 0.3 },
      { height: `${after}px`, opacity: 1 },
    ], restore);
  }
  function crossfadeStreamingMarkdownHandoff(before: Snapshot) {
    // A height animation cannot hide a line wrapping differently inside the
    // row. Keep the final plugin pixels as an inert overlay and fade them out
    // over the host's already-final native Markdown layout.
    const copy = before.copy;
    copy.setAttribute('data-native-polish-ghost', '');
    copy.setAttribute('aria-hidden', 'true');
    copy.setAttribute('inert', '');
    copy.removeAttribute('data-history-row-id');
    for (const entry of [copy, ...all(copy, STREAM_ENTRANCE)]) entry.setAttribute(REHYDRATED_STREAM_ENTRANCE, '');
    for (const el of all(copy, '[id], [autofocus], [data-menu-surface], [data-message-id]')) {
      el.removeAttribute('id'); el.removeAttribute('autofocus');
      el.removeAttribute('data-menu-surface'); el.removeAttribute('data-message-id');
    }
    for (const el of all(copy, 'iframe, video, audio, input, textarea')) el.remove();
    const style = window.getComputedStyle(before.element);
    const box = before.box;
    const values: Record<string, string> = {
      position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`,
      margin: '0', overflow: 'hidden', 'box-sizing': 'border-box', 'pointer-events': 'none', 'z-index': '90',
      color: style.getPropertyValue('color'), 'font-family': style.getPropertyValue('font-family'),
    };
    for (const [key, value] of Object.entries(values)) copy.style.setProperty(key, value, 'important');
    document.body.appendChild(copy);
    ghosts.add(copy);
    animate(copy, [{ opacity: 1 }, { opacity: 0 }], () => { copy.remove(); ghosts.delete(copy); }, 0, getPreferences().pace === 'quick' ? 120 : 180);
  }
  function settleRehydratedStreamingRow(row: Element) {
    // A row-height FLIP can outlive the tab that hid it. Cancelling it here
    // releases its temporary height/opacity before the chat is shown again;
    // otherwise the stale in-flight transform competes with the restored
    // layout and reads as jitter on the first visible stream frame.
    active.get(row)?.();
    // CSS animations are created as part of the remount commit. Marking the
    // already-present blocks in the mutation-observer turn prevents them from
    // reaching a paint, while later streamed blocks remain unmarked and retain
    // their normal entrance animation.
    for (const entry of all(row, STREAM_ENTRANCE)) {
      entry.setAttribute(REHYDRATED_STREAM_ENTRANCE, '');
      for (const animation of entry.getAnimations?.() ?? []) animation.cancel();
    }
  }
  function animateDisclosure(before: Disclosure) {
    const el = before.element;
    if (!visible(el)) return;
    const children = Array.from(el.children);
    const height = rect(el).height;
    if (Math.abs(height - before.height) < 2) return;
    if (el.matches(TOOL)) {
      const nextDetail = toolDetail(el);
      const next: ToolLayout = {
        element: el,
        height,
        children,
        expanded: toolExpanded(el),
        detail: nextDetail,
        detailHeight: nextDetail ? rect(nextDetail).height : 0,
        details: toolDetailLines(el),
      };
      const previous: ToolLayout = {
        element: el,
        height: before.height,
        children: before.children,
        expanded: before.expanded,
        detail: toolDetail(el),
        details: toolDetailLines(el),
        detailHeight: before.detailHeight,
      };
      const childChanged = children.length !== before.children.length || children.some((child, index) => child !== before.children[index]);
      if (previous.expanded !== next.expanded || childChanged) animateToolDetailResize(previous, next);
      return;
    }
    // Streamed text, syntax highlighting and hover updates must not trigger a
    // new sidebar disclosure animation. Only direct detail children do.
    if (children.length === before.children.length && children.every((child, index) => child === before.children[index])) return;
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
  interface FloatingSnapshot extends Snapshot { opacity: number; hostExit: boolean }
  let floating = new Map<Element, FloatingSnapshot>();
  let paneBaseline = paneBoxes();
  let paneTransition: Map<string, PaneBox> | null = null;
  let paneTransitionUntil = 0;
  let fileIcons = new Map<Element, string>();
  let toolIcons = new Map<Element, string>();
  let toolStates = new Map<Element, boolean>();
  // Tracks every tool badge ever mounted, independent of its current viewport
  // visibility. `live(TOOL)` drops off-screen badges, so diffing against the
  // ambient layout maps alone would replay the entrance fade every time a
  // scroll (or a hidden workspace tab) brings a long-settled badge back into
  // view. A badge only counts as arriving once, the first time it mounts.
  const seenTools = new WeakSet<Element>();
  let toolsPrimed = false;
  interface ToolLayout {
    element: Element;
    height: number;
    children: Element[];
    expanded: boolean;
    detail: Element | null;
    detailHeight: number;
    details: Element[];
  }
  let toolLayouts = new Map<Element, ToolLayout>();
  interface ToolLabelLayout { width: number; snapshot: Snapshot }
  let toolLabelLayouts = new Map<Element, ToolLabelLayout>();
  interface StreamingRowHeight { rowId: string; height: number; visible: boolean; snapshot: Snapshot }
  let streamingRowHeights = new Map<Element, StreamingRowHeight>();
  let agentStates = new Map<Element, string>();
  const tabSettling = new WeakMap<Element, number>();
  interface Rise {
    start(node: Element, distance: number, counter?: Element | null): void;
    cancel(): void;
    offset(): number;
  }
  // This is the same exponential decay used by ux-polish's content-rise.
  // It is deliberately separate from WAAPI: frequent stream commits retarget
  // one continuous velocity instead of restarting a tween every token.
  function createRise(): Rise {
    let node: Element | null = null;
    let baseTransform = '';
    let basePriority = '';
    let ownedTransform = '';
    // A descendant that must not ride the node's transform -- the footer,
    // when our timeline fallback (the rows' own container, since the real
    // agent-chat-timeline testid is not shipped) happens to contain it as
    // just another row. It gets the exact inverse offset every frame so it
    // reads as a sibling the node's rise never touches, same as the real
    // timeline/footer split this was ported from.
    let counter: Element | null = null;
    let counterBaseTransform = '';
    let counterBasePriority = '';
    let counterOwnedTransform = '';
    let value = 0;
    let frame = 0;
    let previousTime: number | null = null;
    const apply = (next: number) => {
      value = next;
      if (node) {
        const transform = Math.abs(next) < .01 ? baseTransform : `${baseTransform}${baseTransform ? ' ' : ''}translateY(${next}px)`;
        ownedTransform = transform;
        if (transform) node.style.setProperty('transform', transform, basePriority);
        else node.style.removeProperty('transform');
      }
      if (counter) {
        const inverse = -next;
        const transform = Math.abs(inverse) < .01 ? counterBaseTransform : `${counterBaseTransform}${counterBaseTransform ? ' ' : ''}translateY(${inverse}px)`;
        counterOwnedTransform = transform;
        if (transform) counter.style.setProperty('transform', transform, counterBasePriority);
        else counter.style.removeProperty('transform');
      }
    };
    const step = (timestamp: number) => {
      const delta = previousTime === null ? 0 : timestamp - previousTime;
      previousTime = timestamp;
      const next = value * Math.exp(-delta / 110);
      // The host row's final layout is already in place. Snapping from a
      // half-pixel residual back to it is visible on a high-DPI chat pane,
      // particularly when the plugin's Markdown block fade ends nearby.
      // Let the exponential tail reach an effectively subpixel value first.
      if (Math.abs(next) < .1) {
        frame = 0;
        previousTime = null;
        apply(0);
        return;
      }
      apply(next);
      frame = window.requestAnimationFrame(step);
    };
    const releaseCounter = () => {
      if (counter && counter.style.getPropertyValue('transform') === counterOwnedTransform) {
        if (counterBaseTransform) counter.style.setProperty('transform', counterBaseTransform, counterBasePriority);
        else counter.style.removeProperty('transform');
      }
      counter = null;
      counterBaseTransform = '';
      counterBasePriority = '';
      counterOwnedTransform = '';
    };
    return {
      start(nextNode, distance, nextCounter = null) {
        if (!canAnimate() || Math.abs(distance) <= .5) return;
        if (node !== nextNode) {
          this.cancel();
          node = nextNode;
          baseTransform = node.style.getPropertyValue('transform');
          basePriority = node.style.getPropertyPriority('transform');
          ownedTransform = baseTransform;
        }
        if (counter !== nextCounter) {
          releaseCounter();
          counter = nextCounter;
          if (counter) {
            counterBaseTransform = counter.style.getPropertyValue('transform');
            counterBasePriority = counter.style.getPropertyPriority('transform');
            counterOwnedTransform = counterBaseTransform;
          }
        }
        apply(value + distance);
        if (!frame) frame = window.requestAnimationFrame(step);
      },
      cancel() {
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        previousTime = null;
        if (node && node.style.getPropertyValue('transform') === ownedTransform) {
          if (baseTransform) node.style.setProperty('transform', baseTransform, basePriority);
          else node.style.removeProperty('transform');
        }
        releaseCounter();
        node = null;
        baseTransform = '';
        basePriority = '';
        ownedTransform = '';
        value = 0;
      },
      offset: () => value,
    };
  }
  interface ChatLayout {
    seen: Set<string>;
    pending: Set<string>;
    running: boolean;
    streamingRenderer: boolean;
    scrollTop: number;
    bottom: number;
    visible: boolean;
    rehydratingUntil: number;
    turnStartUntil: number;
    contentRise: Rise;
    resizeObserver: { observe(target: Element): void; disconnect(): void };
    observedTimeline: Element | null;
    observedFooter: Element | null;
  }
  const chats = new Map<Element, ChatLayout>();
  const clearChatMotion = () => {
    for (const [chat, state] of chats) {
      state.contentRise.cancel();
      state.resizeObserver.disconnect();
      chat.removeAttribute(LIVE_BOTTOM_PIN);
    }
    chats.clear();
  };
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
    @keyframes native-polish-stream-token {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes native-polish-stream-block {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    [data-testid="native-polish-stream-token"] {
      display: inline;
      white-space: pre-wrap;
      overflow: visible;
      line-height: inherit !important;
      animation: native-polish-stream-token ${GENTLE_STREAM_FADE_DURATION_MS}ms ease-out backwards;
    }
    /* RN-web gives every nested Text its own default size. The streaming
       renderer intentionally nests fade and Markdown spans, so make ordinary
       descendants take their measured paragraph/heading metric exactly. */
    :is([data-testid="native-polish-stream-prose"],[data-testid^="native-polish-stream-heading-"],[data-testid="native-polish-stream-list-marker"],[data-testid="native-polish-stream-list-content"]) :not([data-testid="native-polish-stream-inline-code"]) {
      font-family: inherit !important;
      font-size: inherit !important;
      line-height: inherit !important;
    }
    [data-testid="native-polish-stream-code"] * {
      font-family: inherit !important;
      font-size: inherit !important;
      line-height: inherit !important;
    }
    :is([data-testid^="native-polish-stream-pace-"],[data-testid="native-polish-markdown"]) :is(*,::before,::after) {
      user-select: text;
      -webkit-user-select: text;
    }
    [data-testid="native-polish-assistant-copy"] {
      cursor: pointer;
    }
    [data-testid="native-polish-assistant-copy"]:hover {
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    [data-testid^="native-polish-stream-pace-"] :is([data-testid="native-polish-stream-block"],[data-testid="native-polish-stream-list"],[data-testid="native-polish-stream-prose"],[data-testid^="native-polish-stream-heading-"],[data-testid="native-polish-stream-code-block"]) {
      animation: native-polish-stream-block 200ms cubic-bezier(0.16,1,0.3,1) backwards;
    }
    /* Fading individual monospace tokens makes every short code chunk blink,
       and a partial fence can otherwise replay the block entrance when the
       parser promotes it from prose to a fenced block. Code still arrives via
       the paced reveal queue, just without opacity animation. */
    [data-testid="native-polish-stream-code-block"],
    [data-testid="native-polish-stream-code"] [data-testid="native-polish-stream-token"] {
      animation: none !important;
      opacity: 1 !important;
    }
    [${REHYDRATED_STREAM_ENTRANCE}] {
      animation: none !important;
    }
    [data-testid="agent-chat-timeline-clip"] {
      /* Preserve the host's display mode. In this shipped DOM the clip is a
         flex-growing child; forcing it to display:flex makes it consume the
         remaining chat height and strands the completed footer below it. */
      overflow: hidden;
    }
    [data-testid="agent-chat-timeline"] {
      will-change: transform;
    }
    [data-testid="native-polish-stream-pace-quick"] [data-testid="native-polish-stream-token"] {
      animation-duration: ${QUICK_STREAM_FADE_DURATION_MS}ms;
    }
    [data-testid="native-polish-stream-pace-quick"] :is([data-testid="native-polish-stream-block"],[data-testid="native-polish-stream-list"],[data-testid="native-polish-stream-prose"],[data-testid^="native-polish-stream-heading-"],[data-testid="native-polish-stream-code-block"]) {
      animation-duration: 150ms;
    }
    @media (prefers-reduced-motion: reduce) {
      [data-testid="native-polish-stream-token"], [data-testid="native-polish-stream-block"], [data-testid="native-polish-stream-list"], [data-testid="native-polish-stream-prose"], [data-testid^="native-polish-stream-heading-"], [data-testid="native-polish-stream-code-block"] {
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
    const nextLayouts = new Map<Element, ToolLayout>();
    const nextLabelLayouts = new Map<Element, ToolLabelLayout>();
    const slots: Element[] = [];
    // A badge is only a true arrival the first time it is observed anywhere
    // in the document, scanned without the viewport filter `live` applies so
    // a badge rendered below the fold does not look new once scrolled into
    // view. The very first pass primes this set without animating, so an
    // already-open chat's history does not flood in on load.
    const primed = toolsPrimed;
    toolsPrimed = true;
    const arriving = new Set<Element>();
    for (const tool of all(document.body, TOOL)) {
      if (tool.closest('[data-native-polish-ghost]')) continue;
      if (!seenTools.has(tool)) { seenTools.add(tool); arriving.add(tool); }
    }
    for (const tool of live(TOOL).slice(0, 80)) {
      const header = firstBoxChild(tool);
      if (!header) continue;
      if (allow && getPreferences().timeline && primed && arriving.has(tool) && !active.has(tool)) {
        animate(tool, [
          { opacity: 0, transform: 'translateY(6px) scale(.98)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ]);
      }
      const running = Boolean(header.querySelector('[style*="--paseo-shimmer"]'));
      nextTools.set(header, running);
      const children = Array.from(tool.children).filter(visible);
      const layout: ToolLayout = {
        element: tool,
        height: rect(tool).height,
        children,
        expanded: toolExpanded(tool),
        detail: toolDetail(tool),
        detailHeight: toolDetail(tool) ? rect(toolDetail(tool)!).height : 0,
        details: toolDetailLines(tool),
      };
      const previousLayout = toolLayouts.get(tool);
      // Match the host clip only when the disclosure state changes or a
      // detail pane is added. Reflow from streamed tool output must remain
      // auto-height; chasing every token means an expansion never settles.
      const childChanged = previousLayout && (
        previousLayout.children.length !== layout.children.length ||
        layout.children.some((child, index) => child !== previousLayout.children[index])
      );
      const detailChanged = previousLayout && (
        previousLayout.details.length !== layout.details.length ||
        layout.details.some((detail, index) => detail !== previousLayout.details[index])
      );
      if (
        allow && getPreferences().timeline && previousLayout &&
        !pending?.disclosure?.element.matches(TOOL) &&
        (previousLayout.expanded !== layout.expanded || childChanged || detailChanged)
      ) animateToolDetailResize(previousLayout, layout);
      nextLayouts.set(tool, layout);
      if (allow && getPreferences().states && toolStates.has(header) && toolStates.get(header) !== running && !active.has(header)) animate(header, [{ opacity: .65 }, { opacity: 1 }], undefined, 0, 150);
      const row = firstBoxChild(header);
      const slot = row ? firstBoxChild(row) : null;
      if (slot && !Array.from(slot.querySelectorAll('svg')).some(chevron)) slots.push(slot);
      // The icon badge is the row's first box child; the summary sentence
      // (plus any secondary label and open-file button) is the row directly
      // after it. There is no testid for it in the shipped host markup.
      const labelRow = row ? Array.from(row.children).filter(visible)[1] ?? null : null;
      // The stable label row owns the clipped GrowingLabel child. The child
      // itself is recreated by host updates, so using it as a Map key drops
      // the previous width and makes every transition look like an initial
      // mount.
      const growingLabel = labelRow;
      if (growingLabel) {
        const previous = toolLabelLayouts.get(growingLabel);
        // During an in-flight clip reveal, its current painted width is
        // not a future baseline. Preserve the last intrinsic measurement.
        const width = active.has(growingLabel) && previous ? previous.width : intrinsicWidth(growingLabel);
        if (allow && getPreferences().timeline && previous && !active.has(growingLabel)) {
          if (width < previous.width) animateShrinkingLabel(previous.snapshot, growingLabel, previous.width, width);
          else animateGrowingLabel(growingLabel, previous.width, width);
        }
        nextLabelLayouts.set(growingLabel, { width, snapshot: snapshot(growingLabel) });
      }
    }
    toolIcons = updateIcons(slots, toolIcons, allow);
    toolStates = nextTools;
    toolLayouts = nextLayouts;
    toolLabelLayouts = nextLabelLayouts;
  }
  function liveFooter(chat: Element, timeline: Element | null): Element | null {
    if (timeline) {
      const clip = timeline.parentElement?.matches(CHAT_TIMELINE_CLIP) ? timeline.parentElement : timeline;
      // In the web stream strategy the live auxiliary/footer is the sibling
      // immediately after the clipped timeline. Do not walk arbitrary DOM;
      // the fallback remains scoped to the known working footer.
      const sibling = clip.nextElementSibling;
      if (sibling) return sibling;
    }
    const completed = chat.querySelector(COMPLETED_FOOTER);
    if (completed) return completed;
    const indicator = chat.querySelector(WORKING_FOOTER);
    return indicator?.parentElement ?? indicator;
  }
  function syncLiveMarkdownPresentation(chat: Element) {
    // The host's root font rule deliberately excludes [data-pmono] surfaces.
    // The public plugin React Native types cannot emit that host-only dataset,
    // so mark the streamed DOM before paint to keep code metrics stable until
    // the native Markdown renderer resumes at completion.
    for (const surface of all(chat, LIVE_STREAM_CODE_SURFACE)) surface.setAttribute('data-pmono', '');
    // Host typography and syntax preferences are intentionally not in the
    // plugin theme contract. Read only the already-rendered native Markdown
    // beside this plugin row, then mirror its computed presentation locally.
    // This keeps a plugin workaround visually faithful without reaching into
    // React state or sending any message content anywhere.
    const nativeParagraph = all(chat, NATIVE_MARKDOWN_PARAGRAPH)
      .find((node) => !node.closest(STREAM_MARKDOWN));
    if (nativeParagraph) {
      const nativeText = all(nativeParagraph, '*').find(
        (node) => node.children.length === 0 && Boolean((node.textContent ?? '').trim()),
      ) ?? nativeParagraph;
      const computed = window.getComputedStyle(nativeText);
      const fontFamily = computed.getPropertyValue('font-family');
      const fontSize = computed.getPropertyValue('font-size');
      const lineHeight = computed.getPropertyValue('line-height');
      for (const prose of all(chat, LIVE_STREAM_PROSE)) {
        if (fontFamily) prose.style.setProperty('font-family', fontFamily);
        if (fontSize) prose.style.setProperty('font-size', fontSize);
        if (lineHeight) prose.style.setProperty('line-height', lineHeight);
      }
      // List labels and content are separate RN Text trees, so they cannot
      // inherit the measured prose values through the View list container.
      for (const listText of all(chat, LIVE_STREAM_LIST_TEXT)) {
        if (fontFamily) listText.style.setProperty('font-family', fontFamily);
        if (fontSize) listText.style.setProperty('font-size', fontSize);
        if (lineHeight) listText.style.setProperty('line-height', lineHeight);
      }
      const nativeOrderedList = all(chat, NATIVE_MARKDOWN_ORDERED_LIST)
        .find((node) => !node.closest(STREAM_MARKDOWN));
      if (nativeOrderedList) {
        const nativeMarker = all(nativeOrderedList, '*').find((node) =>
          node.children.length === 0 && /^\d+[.)]$/.test((node.textContent ?? '').trim()),
        ) ?? nativeOrderedList;
        const inset = rect(nativeMarker).left - rect(nativeText).left;
        if (Number.isFinite(inset) && inset > .5) {
          for (const list of all(chat, LIVE_STREAM_LIST)) {
            list.style.setProperty('margin-left', `${inset}px`);
          }
        }
      }
      const contentSize = Number.parseFloat(fontSize);
      if (Number.isFinite(contentSize) && contentSize > 0) {
        const tiers = [26, 22, 20, 18, 16, 16];
        for (const heading of all(chat, LIVE_STREAM_HEADING)) {
          const level = Number.parseInt(heading.getAttribute('data-testid')?.split('-').at(-1) ?? '', 10);
          const tier = tiers[level - 1];
          if (!tier) continue;
          const size = Math.round(contentSize * tier / 14);
          heading.style.setProperty('font-size', `${size}px`);
          heading.style.setProperty('line-height', `${Math.round(size * 1.3)}px`);
          if (fontFamily) heading.style.setProperty('font-family', fontFamily);
        }
      }
    }
    const nativeCode = all(chat, NATIVE_CODE_BLOCK)
      .find((node) => !node.closest(STREAM_MARKDOWN));
    if (nativeCode) {
      const nativeText = all(nativeCode, '*').find(
        (node) => node.children.length === 0 && Boolean((node.textContent ?? '').trim()),
      ) ?? nativeCode;
      const computed = window.getComputedStyle(nativeText);
      const fontFamily = computed.getPropertyValue('font-family');
      const fontSize = computed.getPropertyValue('font-size');
      const lineHeight = computed.getPropertyValue('line-height');
      for (const code of all(chat, LIVE_STREAM_CODE)) {
        if (fontFamily) code.style.setProperty('font-family', fontFamily);
        if (fontSize) code.style.setProperty('font-size', fontSize);
        if (lineHeight) code.style.setProperty('line-height', lineHeight);
      }
    }
    const roleMatchers: Array<[string, RegExp]> = [
      ['keyword', /^(?:as|async|await|break|case|catch|class|const|continue|def|default|do|else|export|extends|finally|for|from|function|if|import|in|interface|let|new|return|switch|throw|try|type|var|while|with|yield)$/],
      ['comment', /^(?:\/\/|#)/],
      ['string', /^(?:["'`]|Lorem ipsum)/],
      ['number', /^\d/],
      ['definition', /^(?:formatLorem|lorem|message|renderMessage)$/],
      ['function', /^(?:formatMessage|log)$/],
      ['class', /^[A-Z][A-Za-z0-9_]*$/],
      ['type', /^(?:any|boolean|float|int|never|null|number|object|string|undefined|unknown|void)$/],
      ['property', /^(?:log|retries|text|length|map|filter|join|split)$/],
      ['variable', /^(?:console|value|messages|state|chunk)$/],
      ['operator', /^(?:=>|=|\.)$/],
      ['punctuation', /^[{}()[\],.;:]$/],
    ];
    const palette = new Map<string, string>();
    for (const surface of all(chat, NATIVE_CODE_SURFACE)) {
      if (surface.closest(STREAM_MARKDOWN)) continue;
      for (const node of all(surface, '*')) {
        const text = (node.textContent ?? '').trim();
        const role = roleMatchers.find(([, matcher]) => matcher.test(text))?.[0];
        if (!role) continue;
        const color = window.getComputedStyle(node).getPropertyValue('color');
        if (color) palette.set(role, color);
      }
    }
    for (const token of all(chat, LIVE_SYNTAX_TOKEN)) {
      const role = token.getAttribute('data-testid')?.replace('native-polish-syntax-', '');
      const color = role ? palette.get(role) : undefined;
      if (color) token.style.setProperty('color', color);
    }
  }
  function updateMessages(allow: boolean) {
    for (const [chat, state] of chats) {
      if (chat.isConnected) continue;
      state.contentRise.cancel();
      chats.delete(chat);
      streamingRowHeights.delete(chat);
    }
    // Keep a baseline for mounted chats even while their workspace tab is
    // hidden. `live(CHAT)` intentionally excludes zero-sized nodes, but that
    // left `visible: true` stale during tab switches and made the first frame
    // on return look like new stream growth, replaying the bottom-follow rise.
    for (const chat of all(document.body, CHAT).filter((node) =>
      node.isConnected && !node.closest('[data-native-polish-ghost]'),
    )) {
      syncLiveMarkdownPresentation(chat);
      const rows = all(chat, HISTORY_ROW);
      const old = chats.get(chat);
      const running = Boolean(chat.querySelector(WORKING_FOOTER));
      const streamingRenderer = Boolean(chat.querySelector(STREAM_MARKDOWN));
      // A hidden/backgrounded tab (another workspace tab switched in front of
      // it) keeps this chat mounted and connected, so observers can go quiet
      // on it without the state below ever reflecting what actually happened
      // while it was offscreen. On the first tick after it reappears, treat
      // every one-shot "state just changed" comparison as a resync instead of
      // a real transition: old.running can still read false there even
      // though the turn had already started while this tab was hidden,
      // which replayed the footer's "just started" pulse on every rehydrate.
      const now = Date.now();
      const chatVisible = visible(chat);
      const justAppeared = chatVisible && old !== undefined && !old.visible;
      const rehydratingUntil = justAppeared ? now + STREAM_REHYDRATION_SETTLE_MS : old?.rehydratingUntil ?? 0;
      const rehydrating = isStreamingRehydrating(justAppeared, rehydratingUntil, now);
      const turnJustStarted = Boolean(old && !old.running && running);
      // The working-footer entrance starts after the new-message animation.
      // Do not let its delayed transform hand off to a timeline rise: use the
      // finished layout as the next baseline instead. Quick is 200ms delay +
      // 150ms duration; gentle is 320ms + 220ms, with one frame of slack.
      const turnStartSettleMs = getPreferences().pace === 'quick' ? 400 : 580;
      const turnStartUntil = turnJustStarted ? now + turnStartSettleMs : old?.turnStartUntil ?? 0;
      const turnStarting = isInitialTurnSettling(turnJustStarted, turnStartUntil, now);
      // A live plugin row is replaced by the native assistant row at turn
      // completion. It is the same message, not an arriving message: leave
      // it at full opacity so the native footer can appear without replaying
      // the entry fade over the completed text.
      const rendererHandoff = Boolean(old && old.streamingRenderer && !streamingRenderer);
      // Native Markdown has its final height before this observer runs. Treat
      // its replacement as a baseline, not fresh streamed growth; otherwise
      // bottom-follow scrolls it, then corrects itself after the crossfade.
      const suppressBottomFollow = shouldSuppressTransientBottomFollow(rehydrating, turnStarting, rendererHandoff);
      // Our markdown and the host's are close, not identical: line-height,
      // block spacing and wrapping differ by a few px. That real difference
      // lands as a pop the instant the host row replaces ours, indistinguishable
      // from any other row resize -- so smooth it the same way: capture the
      // live row's height every tick while it is ours to render, then FLIP
      // the specific row from that captured height to its post-handoff height
      // the moment the swap lands, instead of leaving it to the generic
      // chat-level bottom-follow to absorb as one more undifferentiated jump.
      const streamingRow = streamingRenderer ? rows.find(row => row.querySelector(STREAM_MARKDOWN)) : undefined;
      // Every behavior below is part of the same "smooth streaming" feature,
      // so each piece checks the same preferences.messages toggle the rest
      // of this file already gates message motion on -- disabling it should
      // mean no streaming-row entrance suppression, no FLIP, no crossfade,
      // not just no pacing animation inside the renderer itself.
      const smoothStreamingEnabled = allow && getPreferences().messages;
      if (streamingRow && smoothStreamingEnabled && shouldSuppressRehydratedStreamEntrance(rehydrating, true)) {
        settleRehydratedStreamingRow(streamingRow);
      }
      if (streamingRow) {
        const rowId = streamingRow.getAttribute('data-history-row-id')!;
        const height = rect(streamingRow).height;
        const rowVisible = visible(streamingRow);
        const previous = streamingRowHeights.get(chat);
        // A normal paced-reveal frame moves a few px at most. A jump bigger
        // than a line or two means this tick was not gradual growth -- a
        // rehydrated row showing its whole backlog at once, or an oversized
        // first delta -- so it gets the same FLIP treatment as the handoff
        // below rather than popping straight to the new height.
        if (smoothStreamingEnabled && previous && shouldFlipStreamingRowHeight({
          previousHeight: previous.height,
          nextHeight: height,
          sameRow: previous.rowId === rowId,
          previouslyVisible: previous.visible,
          visible: rowVisible,
          rehydrating,
        })) {
          flipStreamingRowHeight(streamingRow, previous.height, height);
        }
        streamingRowHeights.set(chat, { rowId, height, visible: rowVisible, snapshot: snapshot(streamingRow) });
      } else if (rendererHandoff) {
        const before = streamingRowHeights.get(chat);
        const handoffRow = before ? rows.find(row => row.getAttribute('data-history-row-id') === before.rowId) : undefined;
        if (smoothStreamingEnabled && before && handoffRow && shouldCrossfadeMarkdownHandoff(true, visible(handoffRow))) {
          crossfadeStreamingMarkdownHandoff(before.snapshot);
        }
        streamingRowHeights.delete(chat);
      }
      const seen = old?.seen ?? new Set<string>();
      const candidates = allow ? old?.pending ?? new Set<string>() : new Set<string>();
      if (rendererHandoff) candidates.clear();
      let lastKnown = -1;
      rows.forEach((row, index) => { if (seen.has(row.getAttribute('data-history-row-id')!)) lastKnown = index; });
      // Match the host's follow-output threshold. A reader who has moved away
      // from this band owns their scroll position; inside it, the stream owns
      // a strict bottom anchor.
      const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight <= 64;
      // Elastic scroll treats "already at scrollHeight - clientHeight" as an
      // overscroll boundary. While a turn is running and the reader is at the
      // bottom, that boundary is a moving target our own bottom-follow keeps
      // snapping to, not a real edge: tag it so a normal downward scroll isn't
      // mistaken for an outward pull and bounced instead of just scrolling.
      if (running && atBottom) chat.setAttribute(LIVE_BOTTOM_PIN, '');
      else chat.removeAttribute(LIVE_BOTTOM_PIN);
      let entered = 0;
      rows.forEach((row, index) => {
        const id = row.getAttribute('data-history-row-id')!;
        const isNew = !seen.has(id);
        seen.add(id);
        if (allow && old && !rendererHandoff && isNew && lastKnown >= 0 && index > lastKnown && atBottom && Date.now() >= quietUntil) candidates.add(id);
        if (candidates.has(id) && visible(row) && row.querySelector('[data-testid="user-message"], [data-testid="assistant-message"], ' + STREAM_MARKDOWN)) {
          candidates.delete(id);
          if (!rendererHandoff && allow && getPreferences().messages && atBottom && Date.now() >= quietUntil && entered++ < 4) {
            animate(row, [
              { opacity: 0, transform: 'translateY(6px) scale(.98)' },
              { opacity: 1, transform: 'translateY(0) scale(1)' },
            ], undefined, 0, getPreferences().pace === 'quick' ? 200 : 320);
          }
        }
      });
      while (seen.size > 5000) seen.delete(seen.values().next().value!);
      const currentIds = new Set(rows.map(row => row.getAttribute('data-history-row-id')!));
      for (const id of candidates) if (!atBottom || !currentIds.has(id)) candidates.delete(id);
      // The host has not yet shipped the agent-chat-timeline testid this was
      // ported against (it only exists on an unreleased branch). Fall back to
      // the rows' own container so the rise still has a real node to offset
      // instead of silently no-op'ing into an unsmoothed snap. liveFooter still
      // takes the strict testid match only: a guessed container's sibling is
      // not reliably the working footer, and the function already falls back
      // to scanning for WORKING_FOOTER when it gets null.
      const testidTimeline = chat.querySelector(CHAT_TIMELINE);
      const timeline = testidTimeline ?? rows[0]?.parentElement ?? null;
      const footer = liveFooter(chat, testidTimeline);
      // The footer used to pop in the instant the turn started, which lands
      // in the same frame or two as the new row's own chat-entry fade --
      // reading as one abrupt, uncoordinated motion ("slides down quickly").
      // Hold it until that fade's duration has elapsed, then ease it in
      // gently on its own, afterward, instead of racing it.
      if (allow && getPreferences().states && old && !old.running && running && atBottom && !rehydrating && footer && visible(footer) && !active.has(footer)) {
        const entryDelay = getPreferences().pace === 'quick' ? 200 : 320;
        animate(footer, [
          { opacity: 0, transform: 'translateY(-10px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], undefined, entryDelay);
      }
      const contentRise = old?.contentRise ?? createRise();
      // A rise already in flight when the tab is backgrounded keeps decaying:
      // requestAnimationFrame has no idea this chat went offscreen, since
      // that is a Paseo-internal tab switch, not the browser tab/window
      // itself. Skipping the next start() call was not enough -- whatever
      // offset (and counter-compensated footer) it had decayed to by the
      // time this one reappeared was still sitting there, then got released
      // or re-targeted the moment real growth resumed. Cancel outright on
      // rehydration so it resumes from a clean, fully-settled state instead.
      if (suppressBottomFollow) contentRise.cancel();
      // MutationObserver tells us a stream commit happened, but its callback
      // can precede the browser's final scrollHeight/scrollTop reconciliation.
      // Observe the committed geometry as well: this is the same pre-paint
      // boundary the host uses to detect bottom-follow movement. Without it,
      // the timeline only sees provider-sized scroll jumps instead of every
      // paced text-layout increment.
      const resizeObserver = old?.resizeObserver ?? new ResizeObserver(() => {
        if (!disposed && !suspended) refreshChatBeforePaint();
      });
      if (!old || old.observedTimeline !== timeline || old.observedFooter !== footer) {
        resizeObserver.disconnect();
        resizeObserver.observe(chat);
        if (timeline) resizeObserver.observe(timeline);
        if (footer) resizeObserver.observe(footer);
      }
      const bottom = Math.max(0, chat.scrollHeight - chat.clientHeight);
      // Pin and rise on any change to the content's own bottom, not just
      // growth: a sidebar opening/closing changes the chat's width, which
      // reflows wrapped lines and can shrink scrollHeight too (fewer wrapped
      // lines at the wider measure). The browser clamps scrollTop to the new,
      // smaller max on its own the instant that happens, before any of our
      // code runs; pinning and gliding both directions the same way is the
      // only way to mask that clamp instead of just the growth case.
      //
      // Comparing against old.bottom rather than old.scrollTop matters for
      // growth specifically: old.scrollTop treated "the reader is still
      // mid-scroll toward the bottom" the same as "new content just arrived",
      // so the instant a manual scroll crossed into the atBottom slack it got
      // snapped the rest of the way and replayed the catch-up glide on top of
      // a scroll the reader was already doing themselves.
      if (allow && getPreferences().messages && old && atBottom && chatVisible && !suppressBottomFollow && Math.abs(bottom - old.bottom) > .5) {
        // Bottom-follow is two separate operations in one pre-paint pass:
        // first pin the real scroll position to the new bottom, then offset
        // the timeline by exactly the absorbed delta. The browser is already
        // logically at bottom, but the visible content starts where it was and
        // glides upward only as this offset exponentially settles.
        if (Math.abs(bottom - chat.scrollTop) > .5) chat.scrollTop = bottom;
        // A transform on the rise target cascades to every descendant. The
        // real agent-chat-timeline is a sibling of the footer, never an
        // ancestor, but our fallback target (the rows' own container, since
        // that testid is not shipped yet) can genuinely contain the footer as
        // just another row in the same list. Give the footer the exact
        // inverse offset every frame instead of just opting it out of the
        // rise entirely -- that kept it glued, but also silently dropped the
        // glide for every ordinary streaming tick where it is nested there,
        // which is most of the turn, not just the rare cases this was for.
        // Skip the counter-compensation while the footer's own WAAPI entrance
        // animation is playing: both would write its transform every frame,
        // and WAAPI's effect takes priority over a plain style write for as
        // long as it is active, so our compensation was silently dropped
        // for that whole window and then snapped in the instant the entrance
        // animation ended -- read as the rise's eased offset being yanked
        // away and handed back.
        const counter = timeline && footer && timeline.contains(footer) && !active.has(footer)
          ? footer
          : null;
        if (timeline) contentRise.start(timeline, chat.scrollTop - old.scrollTop, counter);
      }
      // The footer gets no animation of its own: it is glued to the bottom
      // while a turn is running, pushed down only by new content, which is
      // ordinary document flow with nothing for us to compensate. Animating
      // it independently (gliding its measured displacement) chased every
      // qualifying tick during a burst of layout changes -- new row, footer
      // mounting, first chunk landing -- each firing its own rise on top of
      // whatever was left of the last one, which is why it visibly slid up
      // and settled several times in a row right after a message was sent.
      chats.set(chat, {
        seen, pending: candidates, running, streamingRenderer, scrollTop: chat.scrollTop, bottom,
        visible: chatVisible, rehydratingUntil, turnStartUntil, contentRise, resizeObserver,
        observedTimeline: timeline, observedFooter: footer,
      });
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
  // MutationObserver runs after React commits but before the browser presents
  // that commit. Chat text needs this boundary: measuring in the next rAF made
  // the host paint the new line first, then start its compensating rise.
  let refreshingChat = false;
  function refreshChatBeforePaint() {
    if (refreshingChat || disposed || suspended) return;
    refreshingChat = true;
    try {
      const allow = canAnimate() && !elastic.isActive();
      updateToolStates(allow);
      updateMessages(allow);
    } finally {
      refreshingChat = false;
    }
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
        if (meaningful) refreshChatBeforePaint();
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
  const onReduce = () => { edgePeek?.refresh(); updateMotionFlags(); if (reduceMotion.matches) { pending = null; stopAll(); clearChatMotion(); refreshAmbient(false); } };
  const unsubscribe = subscribePreferences(() => {
    try { window.localStorage.setItem(PREF_KEY, JSON.stringify(getPreferences())); } catch { /* optional persistence */ }
    edgePeek?.refresh();
    pending = null; stopAll(); clearChatMotion(); updateMotionFlags(); refreshAmbient(false);
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
    stopAll(); clearChatMotion(); elastic.reset(); elastic.refresh(); updateMotionFlags();
    // Exit copies are unnecessary while no motion is presented. Release
    // their detached DOM and rebuild clean baselines on return.
    workspaceLists.clear(); tabRows.clear(); floating.clear(); paneBaseline.clear(); paneTransition = null;
    fileIcons.clear(); toolIcons.clear(); toolStates.clear(); agentStates.clear();
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
    window.clearTimeout(scrollDeadline); dirty.clear();
    workspaceLists.clear(); tabRows.clear(); floating.clear(); paneBaseline.clear(); fileIcons.clear(); toolIcons.clear(); toolStates.clear(); agentStates.clear();
    pending = null; treeTarget = null; stopAll(); clearChatMotion();
  };
}
