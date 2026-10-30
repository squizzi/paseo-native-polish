import { Platform } from "react-native";
import { defaults, getPreferences, setPreferences, subscribePreferences } from "./preferences";
import { installElasticScroll } from "./elastic-scroll";
import { installEdgePeek } from "./edge-peek";
import {
  BOTTOM_SCROLL_EPSILON_PX,
  isFollowingScrollBottom,
  resolveFollowOutputScroll,
  resolveStreamingAssistantGaps,
  resolveUserMessageEntranceDelayMs,
  shouldAllowFollowOutputRise,
  shouldAnimateFooterRise,
  shouldExpandWorkedFooterLayout,
  shouldQueueWorkedFooterEntrance,
  workedFooterEntranceMotion,
} from "./footer-motion";
import { leaseMotion } from "./motion-runtime";
import { isChangeTreeRowTestId, treeMotionOwners, treeRowTranslation, treeRowsAfterAnchor } from "./tree-motion";
import {
  TOOL_LABEL_UPDATE_DURATION_MS,
  TOOL_LABEL_UPDATE_FRAMES,
  TOOL_SHIMMER_DURATION_MS,
  TOOL_SHIMMER_PEAK_WIDTH_PX,
  TOOL_SHIMMER_TRACK_END_PX,
  TOOL_SHIMMER_TRACK_START_PX,
  findEnteringToolGroupItems,
  shouldKeepToolShimmerActive,
  toolDetailHeightTransition,
  toolDetailShimmerStyle,
  toolDetailTextTransition,
  toolLabelUpdateTransition,
  type ToolDetailShimmerState,
  type ToolLabelState,
} from "./tool-detail-motion";
import { messageEntranceMotion, shouldQueueMessageEntrance } from "./message-entry-motion";
import {
  chatDisclosureMotion,
  resolveChatBubbleExpandedState,
  shouldAnimateChatDisclosure,
} from "./chat-disclosure-motion";

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
interface TextNode { nodeType: number; textContent: string | null; parentElement?: Element | null }
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
  contains?(other: Element | null): boolean;
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
  Event?: new (type: string) => Event;
  dispatchEvent?(event: Event): boolean;
};
interface Mutation { type: string; target: Element; attributeName: string | null; addedNodes: ArrayLike<Element>; removedNodes: ArrayLike<Element> }
declare const MutationObserver: new (callback: (records: Mutation[]) => void) => { observe(target: Element, options: { subtree: boolean; childList: boolean; characterData: boolean; attributes: boolean; attributeFilter: string[] }): void; disconnect(): void };

const TOOL = '[data-testid="tool-call-badge"], [data-testid="tool-call-group"]';
const TOOL_GROUP_ITEM = '[data-testid="tool-call-badge"], [data-testid="timeline-plan-card"], [data-testid="speak-message"]';
const USER_MESSAGE = '[data-testid="user-message"]';
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

function nearestPaintedBackground(element: Element): string {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const background = window.getComputedStyle(current).getPropertyValue('background-color');
    const transparent = background === 'transparent' || /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(background);
    if (background && !transparent) return background;
  }
  return 'transparent';
}

function textSliceRange(owner: Element, start: number, end?: number): { range: TextRange; anchor: Element } | null {
  const walker = document.createTreeWalker(owner, 4);
  const nodes: TextNode[] = [];
  let total = 0;
  let startNode: TextNode | null = null;
  let startOffset = 0;
  let endNode: TextNode | null = null;
  let endOffset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    nodes.push(node);
    if (!startNode && start <= total + length) {
      startNode = node;
      startOffset = Math.max(0, start - total);
    }
    if (end !== undefined && !endNode && end <= total + length) {
      endNode = node;
      endOffset = Math.max(0, end - total);
    }
    total += length;
  }
  const finalNode = nodes[nodes.length - 1];
  if (!startNode || !finalNode || start >= total) return null;
  if (!endNode) {
    endNode = finalNode;
    endOffset = finalNode.textContent?.length ?? 0;
  }
  if (startNode === endNode && endOffset <= startOffset) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return { range, anchor: startNode.parentElement ?? owner };
}

interface Snapshot { element: Element; box: Rect; copy: Element; parent: Element | null; grandparent: Element | null; next: Element | null }
interface Disclosure {
  element: Element;
  height: number;
  children: Element[];
  details: Snapshot[];
  toggle?: Element | null;
  expanded?: boolean | null;
  isBubble?: boolean;
  preview?: Element | null;
  previewHeight?: number;
  toggleMarginTop?: number;
  chat?: Element | null;
  scrollTop?: number;
}
interface RowSnapshot extends Snapshot { key: string }
interface Tree { element: Element; rows: RowSnapshot[]; anchorKey: string | null }
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
function panelContent(el: Element): Element | null {
  return Array.from(el.children).find(child => {
    const style = window.getComputedStyle(child);
    return style.getPropertyValue('display') !== 'contents' && style.getPropertyValue('position') !== 'absolute';
  }) ?? Array.from(el.children)[0] ?? null;
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
function panelOwner(element: Element): Element | null {
  if (element.getAttribute('data-testid') !== 'workspace-explorer-sidebar') return element;
  // Paseo 0.13+ wraps the explorer dock inside MobilePanelOverlay's gesture host;
  // on desktop (presentation="dock") that outer flex item owns the dock width and
  // display:none state. On mobile (presentation="overlay") it is position:absolute
  // and already animated by Reanimated.
  const host = element.closest('[id^="file-explorer-gesture-host-"]');
  if (host) return window.getComputedStyle(host).getPropertyValue('position') === 'absolute' ? null : host;
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
    const owner = el ? panelOwner(el) : null;
    if (owner) result.set(name, owner);
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

function snapshot(el: Element): Snapshot {
  let slot = el;
  while (slot.parentElement && window.getComputedStyle(slot.parentElement).getPropertyValue('display') === 'contents') slot = slot.parentElement;
  return { element: el, box: rect(el), copy: el.cloneNode(true), parent: slot.parentElement, grandparent: slot.parentElement?.parentElement ?? null, next: slot.nextElementSibling };
}
function bubbleToggleFor(el: Element): Element | null {
  const ariaToggle = el.querySelector('[role="button"][aria-expanded]');
  if (ariaToggle) return ariaToggle;
  const children = Array.from(el.children);
  if (children.length < 2) return null;
  const last = children[children.length - 1];
  return last?.matches('button, [role="button"]') ? last : null;
}
function bubbleExpandedState(toggle: Element | null, preview: Element | null): boolean | null {
  return resolveChatBubbleExpandedState({
    ariaExpanded: toggle?.getAttribute('aria-expanded'),
    previewMaxHeight: preview ? window.getComputedStyle(preview).getPropertyValue('max-height') : null,
    previewChildCount: preview ? preview.children.length : null,
  });
}
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
  if (expanded?.closest(USER_MESSAGE)) return expanded.parentElement;
  const button = target.closest('button, [role="button"]');
  const bubble = button?.parentElement;
  if (button && bubble && button.closest(USER_MESSAGE) && bubbleToggleFor(bubble) === button) {
    return bubble;
  }
  return null;
}
function captureDisclosure(el: Element | null): Disclosure | null {
  if (!el || !visible(el)) return null;
  const children = Array.from(el.children);
  const isBubble = Boolean(el.closest(USER_MESSAGE));
  const toggle = isBubble ? bubbleToggleFor(el) : el.querySelector('[role="button"][aria-expanded]');
  const preview = isBubble ? (children.find(child => child !== toggle) ?? null) : null;
  const ariaExpanded = toggle?.getAttribute('aria-expanded');
  const expanded = isBubble
    ? bubbleExpandedState(toggle, preview)
    : (ariaExpanded === 'true' ? true : ariaExpanded === 'false' ? false : null);
  const previewHeight = preview ? rect(preview).height : undefined;
  const toggleMarginTop = isBubble && toggle
    ? Number.parseFloat(window.getComputedStyle(toggle).getPropertyValue('margin-top')) || 0
    : undefined;
  const chat = isBubble ? el.closest(CHAT) : null;
  return {
    element: el,
    height: rect(el).height,
    children,
    details: isBubble ? [] : children.slice(1).filter(visible).map(snapshot),
    toggle,
    expanded,
    isBubble,
    preview,
    previewHeight,
    toggleMarginTop,
    chat,
    scrollTop: chat ? chat.scrollTop : undefined,
  };
}
function closestChangeRow(target: Element): Element | null {
  for (let cursor: Element | null = target; cursor; cursor = cursor.parentElement) {
    if (cursor.matches(CHANGE_ROW) && isChangeTreeRowTestId(cursor.getAttribute('data-testid'))) return cursor;
  }
  return null;
}
function captureTree(target: Element): Tree | null {
  const tree = target.closest(FILE_TREE + ', ' + CHANGE_TREE);
  if (!tree) return null;
  const diffTree = tree.matches(CHANGE_TREE);
  const anchor = diffTree ? closestChangeRow(target) : target.closest(FILE_ROW);
  let anchorKey: string | null = null;
  const rows = diffTree ? all(tree, CHANGE_ROW).filter(row => isChangeTreeRowTestId(row.getAttribute('data-testid'))) : all(tree, FILE_ROW);
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
    if (anchor && (row === anchor || hasAncestor(anchor, [row]))) anchorKey = key;
    // Match the bounded tree animation budget; do not deep-copy an arbitrary
    // number of visible rows on the input path.
    if (snapshots.length < 120) snapshots.push({ ...snapshot(row), key });
  }
  return { element: tree, rows: snapshots, anchorKey };
}

// Keep in step with package.json. leaseMotion uses it to pick which bundle owns the window.
const VERSION = '0.4.16';

export function installMotion(): () => void {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  return leaseMotion(VERSION, installWebMotion);
}

function installWebMotion(): () => void {
  document.body.setAttribute("data-native-polish", VERSION);

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
  console.info('[Native Polish] loaded', JSON.stringify({ version: VERSION, preferences: getPreferences(), reduceMotion: reduceMotion.matches }));
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
  function animate(el: Element, frames: Record<string, string | number>[], cleanup?: (cancelled?: boolean) => void, delay = 0, milliseconds = duration()) {
    active.get(el)?.();
    if (!canAnimate() || typeof el.animate !== 'function') { cleanup?.(false); return; }
    let animation: Animation;
    try { animation = el.animate(frames, { duration: milliseconds, easing: EASING, fill: 'both', delay }); }
    catch { cleanup?.(false); return; }
    let finished = false;
    const finish = (cancelled: boolean) => {
      if (finished) return;
      finished = true;
      animation.cancel();
      if (active.get(el) === stop) active.delete(el);
      cleanup?.(cancelled);
    };
    const stop = () => finish(true);
    active.set(el, stop);
    void animation.finished.then(() => finish(false), () => finish(true));
  }
  function temporaryStyles(el: Element, values: Record<string, string>, priority = ''): () => void {
    const previous = Object.keys(values).map(key => [key, el.style.getPropertyValue(key), el.style.getPropertyPriority(key)]);
    // Compare against what the browser stored, not what was written: it
    // normalizes values (`0` reads back as `0px`, `0 0` as `0px 0px`).
    const written = new Map<string, string>();
    for (const [key, value] of Object.entries(values)) {
      el.style.setProperty(key, value, priority); written.set(key, el.style.getPropertyValue(key));
    }
    return () => {
      for (const [key, value, prevPriority] of previous) {
        // Restore only values still owned by us; React may have updated a style.
        if (el.style.getPropertyValue(key) !== written.get(key)) continue;
        if (value) el.style.setProperty(key, value, prevPriority);
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
  let diffFrame = 0;
  let diffTail = false;
  // DiffSurface debounces ResizeObserver updates by 120ms unless a window
  // pointer cycle flushes its latest measured width on the next animation
  // frame. Sync each sidebar animation frame so the diff canvas widens/narrows
  // with the drawer instead of snapping after it finishes closing.
  const syncDiffViewport = () => {
    if (!window.dispatchEvent || !window.Event || !document.body.querySelector('[data-testid="git-diff-canvas-root"]')) return;
    try {
      window.dispatchEvent(new window.Event('pointerdown'));
      window.dispatchEvent(new window.Event('pointercancel'));
    } catch { /* synthetic window events are optional in non-browser test harnesses */ }
  };
  const tickDiff = () => {
    diffFrame = 0;
    syncDiffViewport();
    if (panelEntries.size || panelExits.size) {
      diffTail = true;
      diffFrame = window.requestAnimationFrame(tickDiff);
    } else if (diffTail) {
      diffTail = false;
      diffFrame = window.requestAnimationFrame(tickDiff);
    }
  };
  const startDiffSync = () => {
    diffTail = true;
    if (diffFrame) return;
    syncDiffViewport();
    diffFrame = window.requestAnimationFrame(tickDiff);
  };
  function revealPanel(el: Element) {
    const width = rect(el).width;
    if (width < 2) return;
    const content = Array.from(el.children).find(child => rect(child).width > width / 2) ?? panelContent(el);
    const restoreContent = content ? temporaryStyles(content, { 'min-width': `${width}px` }) : () => {};
    const restore = temporaryStyles(el, { overflow: 'hidden', 'min-width': '0', 'box-sizing': 'border-box', 'flex-shrink': '0' });
    panelEntries.add(el);
    startDiffSync();
    animate(el, [{ width: '0px', opacity: 0.4 }, { width: `${width}px`, opacity: 1 }], () => { restoreContent(); restore(); panelEntries.delete(el); });
  }
  function hidePanel(before: Snapshot, key: string) {
    const el = before.element;
    if (!el.isConnected) {
      // Explorer is unmounted on close. An inert copy in the original flex
      // slot lets the adjacent panes expand progressively instead of jumping.
      const copy = exitCopy(before);
      const values: Record<string, string> = { display: 'flex', position: 'relative', width: `${before.box.width}px`, height: `${before.box.height}px`, 'min-width': '0', 'flex-shrink': '0', 'box-sizing': 'border-box', overflow: 'hidden', 'pointer-events': 'none' };
      // An !important width would override the Web Animations width frames.
      for (const [property, value] of Object.entries(values)) copy.style.setProperty(property, value, property === 'width' ? '' : 'important');
      panelContent(copy)?.style.setProperty('min-width', `${before.box.width}px`);
      if (before.parent?.isConnected) {
        before.parent.insertBefore(copy, before.next?.parentElement === before.parent ? before.next : null);
        ghosts.add(copy);
        panelExits.add(copy);
        startDiffSync();
        animate(copy, [{ width: `${before.box.width}px`, opacity: 1 }, { width: '0px', opacity: 0.3 }], () => { copy.remove(); ghosts.delete(copy); panelExits.delete(copy); });
        return;
      }
      if (before.grandparent?.isConnected) {
        // ChangesSurface unmounts the TreeRail row wrapper when its tree rail
        // closes, leaving the diff container as the live parent. Hold the rail
        // slot inside that container so the diff widens smoothly as it closes.
        const host = before.grandparent;
        const sibling = firstBoxChild(host);
        const restoreHost = temporaryStyles(host, { 'flex-direction': 'row' });
        const restoreSibling = sibling ? temporaryStyles(sibling, { 'min-width': '0' }) : () => {};
        host.insertBefore(copy, key === 'left' ? host.children[0] ?? null : null);
        ghosts.add(copy);
        panelExits.add(copy);
        startDiffSync();
        animate(copy, [{ width: `${before.box.width}px`, opacity: 1 }, { width: '0px', opacity: 0.3 }], () => {
          copy.remove();
          ghosts.delete(copy);
          panelExits.delete(copy);
          restoreSibling();
          restoreHost();
        });
        return;
      }
      ghost(before, key === 'left' ? -before.box.width : before.box.width);
      return;
    }
    // Left sidebar is retained with display:none. Keep its real layout slot
    // for the duration of the exit, while preserving host aria-hidden/input state.
    panelExits.add(el);
    const restore = temporaryStyles(el, { display: 'flex', overflow: 'hidden', 'min-width': '0', 'box-sizing': 'border-box', 'pointer-events': 'none', 'flex-shrink': '0' });
    el.style.setProperty('display', 'flex', 'important');
    const content = panelContent(el);
    const restoreContent = content ? temporaryStyles(content, { 'min-width': `${before.box.width}px` }) : () => {};
    startDiffSync();
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
    const toggle = before.toggle?.isConnected && hasAncestor(before.toggle, [el])
      ? before.toggle
      : (before.isBubble ? bubbleToggleFor(el) : el.querySelector('[role="button"][aria-expanded]'));
    const preview = before.isBubble
      ? (before.preview?.isConnected && hasAncestor(before.preview, [el])
        ? before.preview
        : (toggle ? children.find(child => child !== toggle) ?? null : null))
      : null;
    const ariaExpanded = toggle?.getAttribute('aria-expanded');
    const currentExpanded = before.isBubble
      ? bubbleExpandedState(toggle, preview)
      : (ariaExpanded === 'true' ? true : ariaExpanded === 'false' ? false : null);
    const toggleFlipped = before.expanded !== null && before.expanded !== undefined && currentExpanded !== null && currentExpanded !== undefined && before.expanded !== currentExpanded;
    const childrenChanged = children.length !== before.children.length || children.some((child, index) => child !== before.children[index]);
    // Streamed text, syntax highlighting and hover updates must not trigger a
    // new expand animation. Only a change in direct detail children or toggle state does.
    if (!childrenChanged && !toggleFlipped) return;
    const height = rect(el).height;
    if (Math.abs(height - before.height) < 2) return;
    active.get(el)?.();

    if (before.isBubble) {
      if (preview && before.previewHeight !== undefined) {
        const previewHeight = rect(preview).height;
        if (shouldAnimateChatDisclosure({
          isBubble: true,
          beforeExpanded: before.expanded,
          currentExpanded,
          beforeHeight: before.previewHeight,
          currentHeight: previewHeight,
        })) {
          active.get(preview)?.();
          if (toggle) active.get(toggle)?.();
          const expanding = previewHeight > before.previewHeight;
          const currentToggleMarginTop = toggle
            ? Number.parseFloat(window.getComputedStyle(toggle).getPropertyValue('margin-top')) || 0
            : undefined;
          const motion = chatDisclosureMotion({
            expanding,
            beforeHeight: before.previewHeight,
            currentHeight: previewHeight,
            beforeBubbleHeight: before.height,
            currentBubbleHeight: height,
            beforeToggleMarginTop: before.toggleMarginTop,
            currentToggleMarginTop,
          });
          const finishChatHeight = beginChatHeightAnimation(before.chat ?? el.closest(CHAT), el);
          const restoreBubble = motion.bubbleKeyframes ? temporaryStyles(el, motion.bubbleStyles) : null;
          const restorePreview = temporaryStyles(preview, motion.styles, motion.priority);
          if (motion.bubbleKeyframes) {
            animate(el, motion.bubbleKeyframes, (cancelled) => {
              restoreBubble?.();
              active.get(preview)?.();
              if (toggle) active.get(toggle)?.();
              finishChatHeight(cancelled);
            });
          } else {
            const stopBubble = () => {
              active.get(preview)?.();
              if (toggle) active.get(toggle)?.();
              finishChatHeight(true);
            };
            active.set(el, stopBubble);
          }
          animate(preview, motion.keyframes, (cancelled) => {
            if (!motion.bubbleKeyframes) active.delete(el);
            restorePreview();
            finishChatHeight(cancelled);
          });
          if (toggle && motion.toggleKeyframes) {
            animate(toggle, motion.toggleKeyframes);
          }
          // If the host MutationObserver jumped scrollTop in the same microtask
          // before the bubble height animation constrained the layout, restore
          // the pre-commit scrollTop so the host ResizeObserver / follow loop
          // eases scrollTop smoothly with the bubble's height curve.
          if (expanding && before.chat && before.scrollTop !== undefined && before.chat.scrollTop > before.scrollTop) {
            before.chat.scrollTop = before.scrollTop;
          }
        }
      }
      return;
    }

    const finishChatHeight = beginChatHeightAnimation(before.chat ?? el.closest(CHAT), el);
    const restore = temporaryStyles(el, { overflow: 'hidden', 'box-sizing': 'border-box', 'min-height': '0' });
    animate(el, [{ height: `${before.height}px` }, { height: `${height}px` }], (cancelled) => {
      restore();
      finishChatHeight(cancelled);
    });
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
    // A folder disclosure can affect the virtualizer's measurements for every
    // row, including those above the clicked folder. Only rows after that
    // folder have a real disclosure-driven position change.
    const anchorKey = before.anchorKey ?? after.anchorKey;
    const beforeAnchor = before.rows.find(row => row.key === anchorKey) ?? null;
    const afterAnchor = after.rows.find(row => row.key === anchorKey) ?? null;
    const previousRows = treeRowsAfterAnchor(before.rows, beforeAnchor);
    const nextRows = treeRowsAfterAnchor(after.rows, afterAnchor);
    // A moved folder carries all of its descendants. Giving those descendants
    // the same FLIP translation applies the delta twice, then makes them snap
    // back when their independent animation ends.
    const translations = new Map(treeMotionOwners(nextRows.map(row => {
      const old = oldRows.get(row.key);
      return { row, translation: old ? treeRowTranslation(old.box.top - row.box.top) : null };
    }), (ancestor, descendant) => hasAncestor(descendant.element, [ancestor.element]))
      .map(({ row, translation }) => [row.element, translation!]));
    // Bound work for very large trees; the viewport's rows still move together.
    for (const row of previousRows.slice(0, 80)) if (!nextKeys.has(row.key)) ghost(row);
    let entered = 0;
    for (const row of nextRows.slice(0, 100)) {
      const old = oldRows.get(row.key);
      if (!old) {
        // Diff rows can already have a host transform for virtualized layout.
        // Animating `transform` would replace that position and scatter rows
        // during a folder collapse/expand. The independent translate property
        // composes with the host transform instead.
        animate(row.element, [{ opacity: 0, translate: '0 -5px' }, { opacity: 1, translate: '0 0' }], undefined, Math.min(entered++ * 8, 48));
      } else {
        const translation = translations.get(row.element);
        if (translation) animate(row.element, [{ translate: translation }, { translate: '0 0' }]);
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
  let toolShimmers = new Map<Element, ToolDetailShimmerState>();
  let toolLabels = new Map<Element, ToolLabelState>();
  let toolGroupItems = new Map<Element, Set<Element>>();
  let agentStates = new Map<Element, string>();
  const tabSettling = new WeakMap<Element, number>();
  interface ChatState {
    contextKey: string;
    rowIds: Set<string>;
    seen: Set<string>;
    seenCompactions: Set<string>;
    seenWorkedFooters: Set<string>;
    pending: Set<string>;
    running: boolean;
    completedFooterPendingUntil: number;
    scrollTop: number;
    compensatedScrollTop: number;
    pendingBottomUntil: number;
    userScrolledUp: boolean;
    maxScrollTop: number;
    scrollHeight: number;
    clientHeight: number;
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
  interface ChatHeightAnimationToken { element: Element }
  const chats = new WeakMap<Element, ChatState>();
  const seenWorkedFooterNodes = new WeakSet<Element>();
  const chatDisclosureQuietUntil = new WeakMap<Element, number>();
  const chatHeightAnimations = new WeakMap<Element, Set<ChatHeightAnimationToken>>();
  const timelineRises = new WeakMap<Element, ContentRise>();
  const footerRises = new WeakMap<Element, ContentRise>();
  const toolDetailRises = new WeakMap<Element, ContentRise>();
  const contentRises = new Set<ContentRise>();
  interface ToolDetailTextState {
    text: string;
    owner: Element;
    box: Element;
    committedHeight: number;
    contentHeight: number;
  }
  interface ToolDetailReveal {
    owner: Element;
    clipBox: Element | null;
    startOffset: number;
    endOffset: number;
    backdropFrames: Record<string, string | number>[];
    durationMs: number;
    root: Element;
    blurLayer: Element;
    tintLayer: Element;
    blurCovers: Element[];
    tintCovers: Element[];
  }
  let toolDetailText = new Map<Element, ToolDetailTextState>();
  const toolDetailReveals = new Set<ToolDetailReveal>();
  let revealFrame = 0;
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
    @keyframes paseo-toolcall-shimmer {
      0% { background-position: var(--paseo-shimmer-start, -200px) 0; }
      100% { background-position: var(--paseo-shimmer-end, 200px) 0; }
    }
    body[data-native-polish-timeline="true"] [data-native-polish-tool-label] {
      width: auto !important;
      overflow: visible !important;
    }
    body[data-native-polish-timeline="true"] :is(${TOOL}) [style*="--paseo-shimmer"] {
      opacity: 0 !important;
    }
    [data-native-polish-shimmer-overlay] {
      display: none;
    }
    body[data-native-polish-timeline="true"] [data-native-polish-shimmer-overlay] {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: row;
      align-items: center;
      overflow: hidden;
      pointer-events: none;
    }
    body[data-native-polish-timeline="true"] [data-native-polish-shimmer-text] {
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      background-image: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.45) 24%, #ffffff 40%, #ffffff 60%, rgba(255, 255, 255, 0.45) 76%, rgba(255, 255, 255, 0) 100%) !important;
      background-size: ${TOOL_SHIMMER_PEAK_WIDTH_PX}px 100% !important;
      background-repeat: no-repeat !important;
      background-clip: text !important;
      -webkit-background-clip: text !important;
      white-space: nowrap !important;
      animation-name: paseo-toolcall-shimmer !important;
      animation-duration: ${TOOL_SHIMMER_DURATION_MS}ms !important;
      animation-timing-function: linear !important;
      animation-iteration-count: infinite !important;
      animation-delay: var(--native-polish-shimmer-delay, 0ms) !important;
      --paseo-shimmer-start: var(--native-polish-shimmer-start, ${TOOL_SHIMMER_TRACK_START_PX}px) !important;
      --paseo-shimmer-end: var(--native-polish-shimmer-end, ${TOOL_SHIMMER_TRACK_END_PX}px) !important;
    }
    body[data-native-polish-timeline="true"] [data-native-polish-shimmer-text="primary"] {
      flex-shrink: 0;
    }
    body[data-native-polish-timeline="true"] [data-native-polish-shimmer-text="secondary"] {
      flex-shrink: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* A transformed assistant is temporarily a plugin stream item, so core
       assigns the default 16px inter-item gap. Offset only that difference;
       when core resumes rendering, both the plugin node and correction leave
       together and the text keeps the same screen position. */
    [data-testid="native-polish-streaming-assistant"][data-native-polish-gap-above="user"] { margin-top: -16px; }
    [data-testid="native-polish-streaming-assistant"][data-native-polish-gap-above="tool"] { margin-top: -12px; }
    [data-testid="native-polish-streaming-assistant"][data-native-polish-gap-below="default"] { padding-bottom: 12px; }
  `;
  document.head.appendChild(stylesheet);
  function updateMotionFlags() {
    const preferences = getPreferences();
    for (const key of ['controls', 'tabs', 'trees', 'states', 'timeline'] as const) document.body.setAttribute(`data-native-polish-${key}`, String(canAnimate() && preferences[key]));
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
      const oldBySection = new Map<string, string[]>();
      for (const key of old.keys) {
        const section = old.sections.get(key);
        if (!section) continue;
        const list = oldBySection.get(section) ?? [];
        list.push(key);
        oldBySection.set(section, list);
      }
      const nextBySection = new Map<string, string[]>();
      for (const key of keys) {
        const section = sections.get(key);
        if (!section) continue;
        const list = nextBySection.get(section) ?? [];
        list.push(key);
        nextBySection.set(section, list);
      }
      const liftedRows = new Map<string, { top: number; left: number; section: string }>();
      const liftedSections = new Set<string>();
      const overflowDisplaced = new Set<string>();
      for (const [section, nextList] of nextBySection) {
        const topKey = nextList[0];
        const topItem = topKey ? anchors.get(topKey) : undefined;
        if (!topKey || !topItem) continue;
        const oldList = oldBySection.get(section) ?? [];
        if (old.keys.has(topKey)) {
          const oldSection = old.sections.get(topKey);
          const oldIndex = oldList.indexOf(topKey);
          const sameSectionResort = oldSection === section && oldIndex > 0
            && oldList.slice(0, oldIndex).some(k => nextList.includes(k));
          const crossStatusResort = Boolean(
            oldSection?.startsWith('sidebar-status-group-rows-')
            && section.startsWith('sidebar-status-group-rows-')
            && oldSection !== section,
          );
          if (!sameSectionResort && !crossStatusResort) continue;
          const fallbackKey = [...oldList].reverse().find(k => old.anchors.has(k));
          const origin = old.anchors.get(topKey) ?? (fallbackKey ? old.anchors.get(fallbackKey) : undefined);
          if (!origin || origin.top - topItem.top <= 1) continue;
          liftedRows.set(topKey, { top: origin.top, left: origin.left, section });
          liftedSections.add(section);
        } else if (oldList.length > 0 && nextList.length === oldList.length && nextList.includes(oldList[0])) {
          const displacedKey = [...oldList].reverse().find(k => !keys.has(k));
          const origin = displacedKey ? old.anchors.get(displacedKey) : undefined;
          if (!displacedKey || !origin || origin.top - topItem.top <= 1) continue;
          liftedRows.set(topKey, { top: origin.top, left: origin.left, section });
          liftedSections.add(section);
          overflowDisplaced.add(displacedKey);
        }
      }
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
        if (anchorKeys.has(key) || overflowDisplaced.has(key) || (item.project && exitingProjects.has(item.project))) continue;
        // Only actual removals, including headers, exit. Offscreen movement
        // does not count as removal from the mounted sidebar list.
        if (!removed.includes(key) && !item.shot.element.matches(PROJECT + ', ' + STATUS + ', [data-testid="sidebar-pinned-section-header"]')) continue;
        if (item.shot.element.isConnected && scroll === item.shot.element.closest(WORKSPACE_SCROLL)) continue;
        const before = item.shot;
        // A partially clipped row should never escape the sidebar viewport.
        if (before && before.box.top >= bounds.top && before.box.bottom <= bounds.bottom) ghost(before, -6);
      }
      let sr = 0, sg = 0, sb = 0, rem = 1;
      for (let at: Element | null = scroll; at && rem > 1e-4; at = at.parentElement) {
        const bg = window.getComputedStyle(at).getPropertyValue('background-color');
        const parts = /^rgba?\(([^)]+)\)$/i.exec(bg.trim())?.[1].match(/\d*\.?\d+%?/g);
        if (!parts || parts.length < 3) continue;
        const chan = (raw: string, scale: number) => raw.endsWith('%') ? (parseFloat(raw) / 100) * scale : parseFloat(raw);
        const r = chan(parts[0], 255), g = chan(parts[1], 255), b = chan(parts[2], 255);
        const a = parts[3] !== undefined ? Math.max(0, Math.min(1, chan(parts[3], 1))) : 1;
        if (!Number.isFinite(a) || a <= 0) continue;
        sr += r * a * rem; sg += g * a * rem; sb += b * a * rem;
        rem *= 1 - a;
      }
      sr = Math.round(sr + 20 * rem); sg = Math.round(sg + 23 * rem); sb = Math.round(sb + 22 * rem);
      const dark = (sr * 299 + sg * 587 + sb * 114) / 1000 < 128;
      const [dr, dg, db] = dark ? [Math.min(255, sr + 19), Math.min(255, sg + 19), Math.min(255, sb + 19)] : [sr, sg, sb];
      const [br, bg, bb] = dark ? [Math.min(255, sr + 17), Math.min(255, sg + 20), Math.min(255, sb + 20)] : [Math.max(0, sr - 16), Math.max(0, sg - 16), Math.max(0, sb - 14)];
      const liftDuration = Math.round(duration() * 1.6);
      for (const [key, item] of anchors) {
        const el = item.shot.element;
        if (active.has(el) || hasAncestor(el, active.keys()) || el.style.getPropertyValue('transform')) continue;
        const lifted = liftedRows.get(key);
        if (lifted) {
          const dy = lifted.top - item.top;
          const dx = lifted.left - item.left;
          const rowBg = window.getComputedStyle(el).getPropertyValue('background-color');
          const hasRowBg = Boolean(rowBg && !/^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))$/i.test(rowBg));
          const startBg = hasRowBg ? rowBg : `rgba(${dr}, ${dg}, ${db}, 0)`;
          const dragBg = `rgb(${dr}, ${dg}, ${db})`;
          const blur = dark ? 8 : 16;
          const alpha = dark ? 0.2 : 0.04;
          const restShadow = `0 0 0 1px rgba(${br}, ${bg}, ${bb}, 0), 0 4px ${blur}px rgba(0, 0, 0, 0)`;
          const liftShadow = `0 0 0 1px rgba(${br}, ${bg}, ${bb}, 1), 0 4px ${blur}px rgba(0, 0, 0, ${alpha})`;
          const cleanups: (() => void)[] = [temporaryStyles(el, { position: 'relative', 'z-index': '3' })];
          for (let at = el.parentElement; at && at !== scroll; at = at.parentElement) {
            if (window.getComputedStyle(at).getPropertyValue('display') === 'contents') continue;
            cleanups.push(temporaryStyles(at, { position: 'relative', 'z-index': '1000' }));
          }
          animate(
            el,
            [
              { transform: `translate(${dx}px,${dy}px) scale(1)`, opacity: 1, backgroundColor: startBg, boxShadow: restShadow, offset: 0 },
              { transform: `translate(${dx}px,${dy}px) scale(1.02)`, opacity: 0.9, backgroundColor: dragBg, boxShadow: liftShadow, offset: 0.18 },
              { transform: 'translate(0px,0px) scale(1.02)', opacity: 0.9, backgroundColor: dragBg, boxShadow: liftShadow, offset: 0.82 },
              { transform: 'translate(0px,0px) scale(1)', opacity: 1, backgroundColor: startBg, boxShadow: restShadow, offset: 1 },
            ],
            () => { for (const fn of cleanups) fn(); },
            0,
            liftDuration,
          );
        } else if (added.includes(key) || !old.anchorKeys.has(key)) {
          animate(el, [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }]);
        } else {
          const previous = old.anchors.get(key);
          if (!previous) continue;
          const dy = previous.top - item.top;
          const dx = previous.left - item.left;
          if (Math.abs(dy) > 1 || Math.abs(dx) > 1) {
            const section = sections.get(key);
            const displacedByLift = Boolean(section && liftedSections.has(section) && dy < -1);
            animate(
              el,
              [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }],
              undefined,
              displacedByLift ? Math.round(liftDuration * 0.14) : 0,
              displacedByLift ? Math.round(liftDuration * 0.72) : duration(),
            );
          }
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
  function deepestTextElement(el: Element): Element {
    let current = el;
    while (current.children.length > 0) {
      const next = Array.from(current.children).find((child) => (child.textContent ?? '').length > 0);
      if (!next) break;
      current = next;
    }
    return current;
  }
  function syncShimmerTypography(target: Element, source: Element | null, marginSource?: Element | null) {
    if (!source) return;
    const computed = window.getComputedStyle(deepestTextElement(source));
    for (const prop of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing'] as const) {
      const val = computed.getPropertyValue(prop);
      if (val && target.style.getPropertyValue(prop) !== val) target.style.setProperty(prop, val);
    }
    if (marginSource) {
      const marginLeft = window.getComputedStyle(marginSource).getPropertyValue('margin-left');
      if (marginLeft && target.style.getPropertyValue('margin-left') !== marginLeft) {
        target.style.setProperty('margin-left', marginLeft);
      }
    }
  }
  function applyShimmerVars(
    shimmer: Element,
    offsetX: number,
    now: number,
    nextShimmers: Map<Element, ToolDetailShimmerState>,
    trackEndPx: number,
  ) {
    const previous = toolShimmers.get(shimmer);
    const next = toolDetailShimmerStyle({ offsetX, now, previous, trackEndPx });
    nextShimmers.set(shimmer, next);
    if (!previous || previous.delayMs !== next.delayMs) {
      shimmer.style.setProperty('--native-polish-shimmer-delay', `${next.delayMs}ms`);
    }
    if (!previous || previous.startPx !== next.startPx) {
      shimmer.style.setProperty('--native-polish-shimmer-start', `${next.startPx}px`);
    }
    if (!previous || previous.endPx !== next.endPx) {
      shimmer.style.setProperty('--native-polish-shimmer-end', `${next.endPx}px`);
    }
  }
  function updateToolStates(allow: boolean) {
    const nextShimmers = new Map<Element, ToolDetailShimmerState>();
    const nextLabels = new Map<Element, ToolLabelState>();
    const nextGroupItems = new Map<Element, Set<Element>>();
    const chatTailState = new Map<Element, { isTurnRunning: boolean; lastRow: Element | null; lastStreamItem: Element | null }>();
    const getChatTailState = (chat: Element) => {
      let state = chatTailState.get(chat);
      if (!state) {
        const rows = all(chat, HISTORY_ROW);
        const streamItems = all(chat, '[data-testid="stream-item"]');
        state = {
          isTurnRunning: Boolean(chat.querySelector('[data-testid="turn-working-indicator"]')),
          lastRow: rows.length > 0 ? rows[rows.length - 1] : null,
          lastStreamItem: streamItems.length > 0 ? streamItems[streamItems.length - 1] : null,
        };
        chatTailState.set(chat, state);
      }
      return state;
    };
    const slots: Element[] = [];
    const now = Date.now();
    for (const tool of live(TOOL).slice(-80)) {
      const header = firstBoxChild(tool);
      if (!header) continue;
      const row = firstBoxChild(header);
      const labelRow = row ? Array.from(row.children)[1] : null;
      const labelChildren = labelRow ? Array.from(labelRow.children) : [];
      const primary = labelChildren.find((child) => !child.matches('[data-native-polish-shimmer-overlay]')) ?? null;
      if (primary) decorate(primary, 'data-native-polish-tool-label');
      if (labelRow) {
        const secondary = labelChildren.find((child) =>
          child !== primary
          && !child.matches('[role="button"],button,[data-testid="tool-call-summary-placeholder"],[data-native-polish-shimmer-overlay]')
          && window.getComputedStyle(child).getPropertyValue('position') !== 'absolute'
        ) ?? null;
        const isTopLevelTool = !tool.parentElement?.closest(TOOL);
        const isToolGroup = tool.matches('[data-testid="tool-call-group"]');
        const toolRow = tool.closest(HISTORY_ROW);
        const labelKey = (isTopLevelTool ? toolRow : null) ?? labelRow;
        const current: ToolLabelState = {
          primary: primary?.textContent ?? '',
          secondary: secondary?.textContent ?? '',
        };
        nextLabels.set(labelKey, current);
        const toolChat = tool.closest(CHAT);
        const toolChatState = toolChat ? chats.get(toolChat) : undefined;
        const toolChatHydrating = Boolean(toolChat && (!toolChatState || Date.now() < toolChatState.hydrationQuietUntil));
        const tail = toolChat ? getChatTailState(toolChat) : null;
        const toolStreamItem = tool.closest('[data-testid="stream-item"]');
        const isLastTimelineItem = Boolean(
          tail
          && toolRow
          && tail.lastRow === toolRow
          && (!toolStreamItem || tail.lastStreamItem === toolStreamItem)
        );
        const hasHostShimmer = all(header, '[style*="--paseo-shimmer"]').length > 0;
        const hasPlaceholder = Boolean(header.querySelector('[data-testid="tool-call-summary-placeholder"]'));
        const shouldShimmer =
          canAnimate()
          && getPreferences().timeline
          && Boolean(current.primary)
          && shouldKeepToolShimmerActive({
            hasHostShimmer,
            hasPlaceholder,
            isToolGroup,
            isTopLevelTool,
            isTurnRunning: Boolean(tail?.isTurnRunning),
            isLastTimelineItem,
          });
        let overlay = labelRow.querySelector('[data-native-polish-shimmer-overlay]');
        let primaryShimmer: Element | null = null;
        let secondaryShimmer: Element | null = null;
        if (shouldShimmer) {
          if (!overlay) {
            overlay = document.createElement('div');
            overlay.setAttribute('data-native-polish-shimmer-overlay', 'true');
            overlay.setAttribute('aria-hidden', 'true');
            const pSpan = document.createElement('span');
            pSpan.setAttribute('data-native-polish-shimmer-text', 'primary');
            const sSpan = document.createElement('span');
            sSpan.setAttribute('data-native-polish-shimmer-text', 'secondary');
            overlay.appendChild(pSpan);
            overlay.appendChild(sSpan);
            labelRow.appendChild(overlay);
            const createdOverlay = overlay;
            decorations.set(createdOverlay, () => createdOverlay.remove());
          }
          primaryShimmer = overlay.children[0] ?? null;
          secondaryShimmer = overlay.children[1] ?? null;
          const openFileBtn = labelRow.querySelector('[data-testid="tool-call-open-file"]');
          const padRightPx = openFileBtn ? Math.round(rect(openFileBtn).width + 4) : 0;
          const padRight = `${padRightPx}px`;
          if (overlay.style.getPropertyValue('padding-right') !== padRight) {
            overlay.style.setProperty('padding-right', padRight);
          }
          const trackEndPx = Math.max(0, Math.round(rect(labelRow).width - padRightPx));
          if (primaryShimmer) {
            syncShimmerTypography(primaryShimmer, primary);
            if (primaryShimmer.textContent !== current.primary) primaryShimmer.textContent = current.primary;
            applyShimmerVars(primaryShimmer, 0, now, nextShimmers, trackEndPx);
          }
          if (secondaryShimmer) {
            syncShimmerTypography(secondaryShimmer, secondary ?? primary, secondary);
            if (secondaryShimmer.textContent !== current.secondary) secondaryShimmer.textContent = current.secondary;
            const offsetX =
              secondary && current.secondary
                ? Math.max(0, rect(secondary).left - rect(labelRow).left)
                : 0;
            applyShimmerVars(secondaryShimmer, offsetX, now, nextShimmers, trackEndPx);
          }
        } else if (overlay) {
          for (const child of Array.from(overlay.children)) active.get(child)?.();
          active.get(overlay)?.();
          overlay.remove();
          decorations.delete(overlay);
        }
        if (allow && !toolChatHydrating && getPreferences().timeline) {
          const transition = toolLabelUpdateTransition(toolLabels.get(labelKey), current);
          if (transition?.animatePrimary && primary) {
            animate(primary, transition.frames, undefined, 0, transition.durationMs);
            if (primaryShimmer) animate(primaryShimmer, transition.shimmerFrames, undefined, 0, transition.durationMs);
          }
          if (transition?.animateSecondary && secondary) {
            animate(secondary, transition.frames, undefined, 0, transition.durationMs);
            if (secondaryShimmer) animate(secondaryShimmer, transition.shimmerFrames, undefined, 0, transition.durationMs);
          }
        }
        if (isToolGroup) {
          const toggle = header.matches('[aria-expanded]') ? header : header.querySelector('[aria-expanded]');
          const isExpanded = toggle ? toggle.getAttribute('aria-expanded') === 'true' : tool.children.length > 1;
          const groupItems = isExpanded
            ? all(tool, TOOL_GROUP_ITEM).filter((item) => item.parentElement?.closest(TOOL) === tool && visible(item))
            : [];
          if (groupItems.length > 0) {
            const groupKey = toolRow ?? tool;
            const previousItems = toolGroupItems.get(groupKey);
            nextGroupItems.set(groupKey, new Set(groupItems));
            if (allow && !toolChatHydrating && getPreferences().timeline) {
              for (const entering of findEnteringToolGroupItems(previousItems, groupItems)) {
                animate(entering, TOOL_LABEL_UPDATE_FRAMES, undefined, 0, TOOL_LABEL_UPDATE_DURATION_MS);
              }
            }
          }
        }
      }
      const slot = row ? firstBoxChild(row) : null;
      if (slot && !Array.from(slot.querySelectorAll('svg')).some(chevron)) slots.push(slot);
    }
    toolIcons = updateIcons(slots, toolIcons, allow);
    toolShimmers = nextShimmers;
    toolLabels = nextLabels;
    toolGroupItems = nextGroupItems;
  }
  function createContentRise(element: Element): ContentRise {
    let offset = 0;
    let animationFrame = 0;
    let lastFrameTime: number | null = null;
    let restoreParentClip: (() => void) | null = null;
    const isTimeline = element.matches(CHAT_TIMELINE);
    const applyOffset = (next: number) => {
      offset = next;
      if (!element.isConnected) {
        restoreParentClip?.();
        restoreParentClip = null;
        return;
      }
      if (next === 0) {
        element.style.removeProperty('transform');
        restoreParentClip?.();
        restoreParentClip = null;
      } else {
        if (isTimeline && !restoreParentClip && element.parentElement) {
          const parent = element.parentElement;
          const parentStyle = window.getComputedStyle(parent);
          const overflowY = (parentStyle.getPropertyValue('overflow-y') || parentStyle.getPropertyValue('overflow')).trim();
          if (!/^(hidden|clip|auto|scroll)$/.test(overflowY)) {
            restoreParentClip = temporaryStyles(parent, { 'overflow-y': 'clip' });
          }
        }
        element.style.setProperty('transform', `translateY(${next}px)`);
      }
      if (toolDetailReveals.size > 0) {
        for (const reveal of Array.from(toolDetailReveals)) {
          if (!syncToolDetailReveal(reveal)) active.get(reveal.tintLayer)?.();
        }
      }
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
        // observed. Hold the inverse intact through that frame when starting
        // from rest, or accumulate onto the already-running decay without
        // resetting lastFrameTime so back-to-back stream chunks never freeze.
        applyOffset(offset + distance);
        if (!animationFrame) {
          lastFrameTime = null;
          animationFrame = window.requestAnimationFrame(step);
        }
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
    const timeline = chat.querySelector(CHAT_TIMELINE);
    const content =
      chat.querySelector(CHAT_CONTENT)
      ?? timeline?.parentElement
      ?? firstBoxChild(chat);
    const indicator = chat.querySelector('[data-testid="turn-working-indicator"]');
    const tagged =
      all(chat, '[data-testid="turn-footer-entry-motion"]').find(
        (el) => !el.closest(HISTORY_ROW),
      ) ?? null;
    let candidate: Element | null = indicator ?? tagged;
    if (!candidate && content) {
      const children = Array.from(content.children);
      const timelineIndex = children.findIndex(
        (child) =>
          child === timeline ||
          Boolean(timeline && hasAncestor(timeline, [child])) ||
          child.matches(HISTORY_ROW) ||
          Boolean(child.querySelector(HISTORY_ROW)),
      );
      if (timelineIndex >= 0) {
        candidate =
          children.slice(timelineIndex + 1).find(
            (child) =>
              !child.matches('[data-testid="older-history-slot"]') &&
              child.getAttribute('data-native-polish-ghost') === null &&
              !child.matches(HISTORY_ROW) &&
              !child.querySelector(HISTORY_ROW),
          ) ?? null;
      }
    }
    if (!candidate) return null;
    // Current core keeps live auxiliary rows in a dedicated sibling after the
    // clipped timeline. Older 0.11 hosts put the indicator directly in the
    // content node, where its parent also owns the timeline.
    const parent = candidate.parentElement;
    return parent &&
      content &&
      parent.parentElement === content &&
      !parent.querySelector(CHAT_TIMELINE) &&
      !parent.querySelector(HISTORY_ROW)
      ? parent
      : candidate;
  }
  function smallestTextElement(root: Element, prefix: string): Element | null {
    const matches = [root, ...all(root, '*')].filter((element) =>
      (element.textContent?.trim() ?? '').startsWith(prefix),
    );
    return matches.find((element) => !Array.from(element.children).some((child) =>
      (child.textContent?.trim() ?? '').startsWith(prefix),
    )) ?? null;
  }
  function beginChatHeightAnimation(chat: Element | null, element: Element, durationMs = duration()): (cancelled?: boolean) => void {
    if (!chat) return () => {};
    let set = chatHeightAnimations.get(chat);
    if (!set) {
      set = new Set();
      chatHeightAnimations.set(chat, set);
    }
    const token: ChatHeightAnimationToken = { element };
    set.add(token);
    chatDisclosureQuietUntil.set(
      chat,
      Math.max(chatDisclosureQuietUntil.get(chat) ?? 0, Date.now() + durationMs + 60),
    );
    let done = false;
    return (cancelled = false) => {
      if (done) return;
      done = true;
      set?.delete(token);
      if (cancelled) return;
      const state = chats.get(chat);
      if ((!set || set.size === 0) && chat.isConnected) {
        chatDisclosureQuietUntil.delete(chat);
        if (state) {
          const footer = footerFor(chat);
          const footerRise = footer ? riseFor(footerRises, footer) : null;
          const nextMaxScrollTop = Math.max(0, chat.scrollHeight - chat.clientHeight);
          const preservePendingBottom =
            Date.now() < state.pendingBottomUntil && state.compensatedScrollTop > chat.scrollTop + 0.5;
          state.scrollTop = chat.scrollTop;
          state.compensatedScrollTop = preservePendingBottom
            ? Math.max(state.compensatedScrollTop, nextMaxScrollTop)
            : chat.scrollTop;
          state.maxScrollTop = nextMaxScrollTop;
          state.scrollHeight = chat.scrollHeight;
          state.clientHeight = chat.clientHeight;
          state.footer = footer;
          state.footerTop = footer ? rect(footer).top - (footerRise?.getOffset() ?? 0) : null;
        }
      }
    };
  }
  function findToolDetailScrollBox(owner: Element): Element | null {
    const ownerTool = owner.closest(TOOL);
    for (const candidate of [owner, ...all(owner, '*')]) {
      if (ownerTool && candidate.closest(TOOL) !== ownerTool) continue;
      const style = window.getComputedStyle(candidate);
      const overflowY = (style.getPropertyValue('overflow-y') || style.getPropertyValue('overflow')).trim();
      const maxHeight = parseFloat(style.getPropertyValue('max-height'));
      if (/^(auto|scroll)$/.test(overflowY)) return candidate;
      if (Number.isFinite(maxHeight) && maxHeight > 0 && /^(hidden|clip)$/.test(overflowY)) return candidate;
    }
    return null;
  }
  function measureToolDetailLayout(owner: Element, activeBoxes: ReadonlyMap<Element, () => void>): {
    scrollBox: Element | null;
    scrollContent: Element | null;
    box: Element;
    naturalHeight: number;
    inFlightHeight: number | null;
    contentHeight: number;
    maxHeight: number;
  } {
    const scrollBox = findToolDetailScrollBox(owner);
    const scrollContent = scrollBox ? firstBoxChild(scrollBox) : null;
    const box = scrollBox ?? owner;
    const currentBoxHeight = rect(box).height;
    const inFlightHeight = activeBoxes.has(box) ? currentBoxHeight : null;
    const style = window.getComputedStyle(box);
    const maxHeight = parseFloat(style.getPropertyValue('max-height'));
    const hasMaxHeight = Number.isFinite(maxHeight) && maxHeight > 0;
    const contentHeight = scrollContent ? rect(scrollContent).height : currentBoxHeight;
    let naturalHeight = currentBoxHeight;
    if (scrollBox && scrollContent && inFlightHeight !== null) {
      const extras =
        (parseFloat(style.getPropertyValue('border-top-width')) || 0) +
        (parseFloat(style.getPropertyValue('border-bottom-width')) || 0) +
        (parseFloat(style.getPropertyValue('padding-top')) || 0) +
        (parseFloat(style.getPropertyValue('padding-bottom')) || 0);
      const unclipped = contentHeight + extras;
      naturalHeight = hasMaxHeight ? Math.min(maxHeight, unclipped) : unclipped;
    }
    return {
      scrollBox,
      scrollContent,
      box,
      naturalHeight,
      inFlightHeight,
      contentHeight,
      maxHeight: hasMaxHeight ? maxHeight : Infinity,
    };
  }
  function syncToolDetailReveal(reveal: ToolDetailReveal): boolean {
    if (!reveal.owner.isConnected || !reveal.root.isConnected) return false;
    const slice = textSliceRange(reveal.owner, reveal.startOffset, reveal.endOffset);
    if (!slice) return false;
    const clipBounds = reveal.clipBox?.isConnected ? rect(reveal.clipBox) : null;
    const rawBoxes = Array.from(slice.range.getClientRects()).filter(box => box.width > 0 && box.height > 0).slice(0, 40);
    const boxes: Array<{ left: number; top: number; width: number; height: number }> = [];
    for (const box of rawBoxes) {
      const paddedLeft = box.left - 1;
      const paddedTop = box.top - 1;
      const paddedRight = box.right + 2;
      const paddedBottom = box.bottom + 1;
      const left = clipBounds ? Math.max(paddedLeft, clipBounds.left + 1) : paddedLeft;
      const top = clipBounds ? Math.max(paddedTop, clipBounds.top + 1) : paddedTop;
      const right = clipBounds ? Math.min(paddedRight, clipBounds.right - 1) : paddedRight;
      const bottom = clipBounds ? Math.min(paddedBottom, clipBounds.bottom - 1) : paddedBottom;
      if (right - left > 0.5 && bottom - top > 0.5) {
        boxes.push({ left, top, width: right - left, height: bottom - top });
      }
    }
    const backgroundColor = nearestPaintedBackground(slice.anchor);
    while (reveal.blurCovers.length < boxes.length) {
      const blurCover = document.createElement('div');
      blurCover.style.setProperty('position', 'fixed', 'important');
      blurCover.style.setProperty('pointer-events', 'none', 'important');
      blurCover.style.setProperty('border-radius', '3px', 'important');
      reveal.blurLayer.appendChild(blurCover);
      reveal.blurCovers.push(blurCover);
      if (typeof blurCover.animate === 'function' && reveal.backdropFrames.length > 0) {
        try {
          blurCover.animate(reveal.backdropFrames, {
            duration: reveal.durationMs,
            easing: EASING,
            fill: 'both',
          });
        } catch { /* ignore unsupported backdrop-filter animation */ }
      }
    }
    while (reveal.blurCovers.length > boxes.length) reveal.blurCovers.pop()?.remove();
    while (reveal.tintCovers.length < boxes.length) {
      const tintCover = document.createElement('div');
      tintCover.style.setProperty('position', 'fixed', 'important');
      tintCover.style.setProperty('pointer-events', 'none', 'important');
      tintCover.style.setProperty('border-radius', '3px', 'important');
      reveal.tintLayer.appendChild(tintCover);
      reveal.tintCovers.push(tintCover);
    }
    while (reveal.tintCovers.length > boxes.length) reveal.tintCovers.pop()?.remove();
    boxes.forEach((box, index) => {
      const blurCover = reveal.blurCovers[index];
      const tintCover = reveal.tintCovers[index];
      for (const cover of [blurCover, tintCover]) {
        cover.style.setProperty('left', `${box.left}px`, 'important');
        cover.style.setProperty('top', `${box.top}px`, 'important');
        cover.style.setProperty('width', `${box.width}px`, 'important');
        cover.style.setProperty('height', `${box.height}px`, 'important');
      }
      tintCover.style.setProperty('background-color', backgroundColor, 'important');
    });
    return boxes.length > 0;
  }
  function tickToolDetailReveals() {
    revealFrame = 0;
    for (const reveal of Array.from(toolDetailReveals)) {
      if (!syncToolDetailReveal(reveal)) active.get(reveal.tintLayer)?.();
    }
    if (toolDetailReveals.size > 0 && canAnimate()) {
      revealFrame = window.requestAnimationFrame(tickToolDetailReveals);
    }
  }
  function animateGrowingToolText(allow: boolean) {
    for (const reveal of Array.from(toolDetailReveals)) {
      if (!syncToolDetailReveal(reveal)) active.get(reveal.tintLayer)?.();
    }

    const next = new Map<Element, ToolDetailTextState>();
    const targets: Array<{ detail: Element; owner: Element; isToolDetail: boolean; isStreaming: boolean; allowTextReveal: boolean }> = [];
    for (const tool of live(TOOL).slice(-80)) {
      if (tool.matches('[data-testid="tool-call-group"]')) continue;
      const header = firstBoxChild(tool);
      const isStreaming = Boolean(header && all(header, '[style*="--paseo-shimmer"],[data-native-polish-shimmer-overlay]').length > 0);
      for (const detail of Array.from(tool.children).slice(1)) {
        if (detail.matches(TOOL) || detail.querySelector(TOOL)) continue;
        targets.push({
          detail,
          owner: firstBoxChild(detail) ?? detail,
          isToolDetail: true,
          isStreaming,
          allowTextReveal: true,
        });
      }
    }
    for (const stream of live('[data-testid="native-polish-streaming-assistant"]')) {
      targets.push({ detail: stream, owner: stream, isToolDetail: false, isStreaming: true, allowTextReveal: true });
    }
    for (const { detail, owner, isToolDetail, isStreaming, allowTextReveal } of targets) {
      if (!visible(owner)) continue;
      const text = owner.textContent ?? '';
      const previous = toolDetailText.get(detail);
      if (previous && previous.owner !== owner) {
        for (const reveal of Array.from(toolDetailReveals)) {
          if (reveal.owner === previous.owner) active.get(reveal.tintLayer)?.();
        }
      }
      const layout = measureToolDetailLayout(owner, active);
      const detailChat = detail.closest(CHAT);
      const detailChatState = detailChat ? chats.get(detailChat) : undefined;
      const detailChatHydrating = Boolean(detailChat && (!detailChatState || Date.now() < detailChatState.hydrationQuietUntil));
      const canAnimateTextReveal = allow && !detailChatHydrating && (getPreferences().messages || getPreferences().timeline);
      const canAnimateDetail = canAnimateTextReveal && Date.now() >= quietUntil;
      const manualDisclosure = pending?.disclosure?.element === detail.closest(TOOL);

      let committedHeight = layout.naturalHeight;
      if (isToolDetail && previous && text !== previous.text && canAnimateDetail && !manualDisclosure) {
        const heightTransition = toolDetailHeightTransition({
          previousHeight: previous.committedHeight,
          currentHeight: layout.naturalHeight,
          inFlightHeight: previous.box === layout.box ? layout.inFlightHeight : null,
        });
        if (heightTransition) {
          const finishChatHeight = beginChatHeightAnimation(detailChat, layout.box);
          const restore = temporaryStyles(layout.box, heightTransition.styles);
          animate(layout.box, heightTransition.keyframes, (cancelled) => {
            restore();
            finishChatHeight(cancelled);
          }, 0, duration());
        } else if (layout.inFlightHeight !== null && Math.abs(layout.naturalHeight - previous.committedHeight) < 2) {
          committedHeight = previous.committedHeight;
        }
        if (
          isStreaming &&
          layout.scrollBox &&
          layout.scrollContent &&
          layout.naturalHeight >= layout.maxHeight - 1 &&
          layout.contentHeight > previous.contentHeight + 1
        ) {
          const delta = layout.contentHeight - previous.contentHeight;
          const previousScrollBoxMax = Math.max(0, layout.scrollBox.scrollHeight - delta - layout.scrollBox.clientHeight);
          if (layout.scrollBox.scrollTop >= previousScrollBoxMax - BOTTOM_SCROLL_EPSILON_PX) {
            layout.scrollBox.scrollTop = Math.max(0, layout.scrollBox.scrollHeight - layout.scrollBox.clientHeight);
            riseFor(toolDetailRises, layout.scrollContent)?.start(delta);
          }
        }
      }

      next.set(detail, {
        text,
        owner,
        box: layout.box,
        committedHeight,
        contentHeight: layout.contentHeight,
      });

      const baselineText =
        previous !== undefined
          ? previous.text
          : isToolDetail && isStreaming && !manualDisclosure && text.length > 0 && text.length <= 48
            ? ''
            : undefined;
      const transition = allowTextReveal ? toolDetailTextTransition(baselineText, text) : null;
      if (!(isToolDetail ? canAnimateDetail : canAnimateTextReveal) || !transition) continue;

      // Cover only the appended glyph rectangles with a paired backdrop-blur
      // layer and background-coloured tint layer, then fade them away over
      // 400ms. Keeping `root` and `blurLayer` at opacity 1 avoids creating a
      // CSS Backdrop Root while the host remains the sole text painter.
      if (!textSliceRange(owner, transition.enteringStart, transition.enteringEnd)) continue;
      const root = document.createElement('div');
      root.setAttribute('data-native-polish-ghost', '');
      root.setAttribute('aria-hidden', 'true');
      root.setAttribute('inert', '');
      root.style.setProperty('position', 'fixed', 'important');
      root.style.setProperty('inset', '0', 'important');
      root.style.setProperty('pointer-events', 'none', 'important');
      root.style.setProperty('z-index', '90', 'important');
      const blurLayer = document.createElement('div');
      blurLayer.style.setProperty('position', 'fixed', 'important');
      blurLayer.style.setProperty('inset', '0', 'important');
      blurLayer.style.setProperty('pointer-events', 'none', 'important');
      const tintLayer = document.createElement('div');
      tintLayer.style.setProperty('position', 'fixed', 'important');
      tintLayer.style.setProperty('inset', '0', 'important');
      tintLayer.style.setProperty('pointer-events', 'none', 'important');
      root.appendChild(blurLayer);
      root.appendChild(tintLayer);
      document.body.appendChild(root);
      const reveal: ToolDetailReveal = {
        owner,
        clipBox: layout.scrollBox ?? detailChat,
        startOffset: transition.enteringStart,
        endOffset: transition.enteringEnd,
        backdropFrames: transition.backdrop,
        durationMs: transition.durationMs,
        root,
        blurLayer,
        tintLayer,
        blurCovers: [],
        tintCovers: [],
      };
      toolDetailReveals.add(reveal);
      ghosts.add(root);
      if (!syncToolDetailReveal(reveal)) {
        root.remove(); ghosts.delete(root); toolDetailReveals.delete(reveal);
        continue;
      }
      if (!revealFrame) revealFrame = window.requestAnimationFrame(tickToolDetailReveals);
      animate(tintLayer, transition.cover, () => {
        root.remove(); ghosts.delete(root); toolDetailReveals.delete(reveal);
      }, 0, transition.durationMs);
    }
    for (const [detail, state] of toolDetailText) {
      if (!next.has(detail) && detail.isConnected) {
        next.set(detail, state);
      }
    }
    toolDetailText = next;
  }
  function chatContextKey(chat: Element): string {
    const pane = chat.closest(PANE);
    const paneId = pane?.getAttribute('data-testid') ?? '';
    const scope = pane ?? document.body;
    const selectedTab = scope.querySelector(`${TAB}[aria-selected="true"]`)?.getAttribute('data-testid')
      ?? document.body.querySelector(`${TAB}[aria-selected="true"]`)?.getAttribute('data-testid')
      ?? '';
    const selectedWorkspace = document.body.querySelector(
      `${WORKSPACE_ROW}[aria-selected="true"], ${WORKSPACE_ROW}[data-selected="true"], ${WORKSPACE_ROW}[aria-current="true"]`,
    )?.getAttribute('data-testid') ?? '';
    return `${paneId}|${selectedWorkspace}|${selectedTab}`;
  }
  interface WorkedFooterTarget {
    keys: string[];
    row: Element;
    label: Element;
    chrome: Element[];
    hasFollowingContent: boolean;
    isTurnCompletionFooter: boolean;
  }
  function hasContentAfterWorkedFooter(chat: Element, footerRow: Element, historyRow: Element | null, rows: Element[]): boolean {
    for (let cursor: Element | null = footerRow; cursor && cursor !== chat && cursor !== historyRow; cursor = cursor.parentElement) {
      for (let sibling = cursor.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        if (sibling.getAttribute('data-native-polish-ghost') !== null) continue;
        if (rect(sibling).height > 1) return true;
      }
    }
    if (historyRow) {
      const rowIndex = rows.indexOf(historyRow);
      if (rowIndex >= 0 && rowIndex < rows.length - 1) return true;
    }
    const indicator = chat.querySelector('[data-testid="turn-working-indicator"]');
    return Boolean(indicator && visible(indicator));
  }
  function findWorkedFooters(chat: Element, rows: Element[]): WorkedFooterTarget[] {
    const results: WorkedFooterTarget[] = [];
    const seenRows = new Set<Element>();
    const textCounts = new Map<string, number>();
    const leaves = all(chat, '*').filter((el) => {
      if (el.closest('[data-native-polish-ghost]') || el.getAttribute('aria-hidden') === 'true') return false;
      if (el.children.length > 0) return false;
      return /^Worked\b/.test(el.textContent?.trim() ?? '');
    });
    for (const leaf of leaves) {
      const historyRow = leaf.closest(HISTORY_ROW);
      const taggedFooter = leaf.closest('[data-testid="turn-footer-entry-motion"]');
      let footerRow: Element = taggedFooter ?? leaf;
      if (!taggedFooter) {
        const stopAt = historyRow ?? chat.querySelector(CHAT_CONTENT) ?? chat;
        while (
          footerRow.parentElement &&
          footerRow.parentElement !== stopAt &&
          !footerRow.parentElement.querySelector(
            '[data-testid="stream-item"], [data-testid="assistant-message"], [data-testid="tool-call-badge"], [data-testid="tool-call-group"], [data-testid="user-message"], [data-testid="turn-working-indicator"], ' +
              CHAT_TIMELINE,
          )
        ) {
          footerRow = footerRow.parentElement;
        }
      }
      if (seenRows.has(footerRow)) continue;
      seenRows.add(footerRow);
      let label: Element = leaf;
      while (
        label.parentElement &&
        label.parentElement !== footerRow &&
        Array.from(label.parentElement.children).every((child) => /^Worked\b/.test(child.textContent?.trim() ?? ''))
      ) {
        label = label.parentElement;
      }
      const group = label.parentElement;
      const chrome =
        group && group !== footerRow
          ? Array.from(group.children).filter((child) => child !== label)
          : [];
      const rowId = historyRow?.getAttribute('data-history-row-id') ?? '';
      const normalizedText = (label.textContent ?? leaf.textContent ?? '').replace(/\s+/g, ' ').trim();
      const textOccurrence = textCounts.get(normalizedText) ?? 0;
      textCounts.set(normalizedText, textOccurrence + 1);
      const keys = [`text:${normalizedText}#${textOccurrence}`, `aux:${normalizedText}`];
      if (rowId) keys.unshift(`row:${rowId}`);
      results.push({
        keys,
        row: footerRow,
        label,
        chrome,
        hasFollowingContent: hasContentAfterWorkedFooter(chat, footerRow, historyRow, rows),
        isTurnCompletionFooter: Boolean(
          taggedFooter || !historyRow || footerRow.querySelector('button, [role="button"]'),
        ),
      });
    }
    return results;
  }
  function updateMessages(allow: boolean) {
    const activeChats = live(CHAT);
    for (const chat of activeChats) {
      const old = chats.get(chat);
      const rows = all(chat, HISTORY_ROW);
      const contextKey = chatContextKey(chat);
      const currentRowIds = new Set(rows.map((row) => row.getAttribute('data-history-row-id') ?? '').filter(Boolean));
      const conversationSwitched = Boolean(
        old && (
          old.contextKey !== contextKey
          || (old.rowIds.size > 0 && currentRowIds.size === 0)
          || (
            old.rowIds.size > 0
            && currentRowIds.size > 0
            && !Array.from(currentRowIds).some((id) => old.rowIds.has(id))
            && !old.stream
            && !old.handoff
          )
        ),
      );
      if (conversationSwitched && old) {
        const timeline = timelineFor(chat, rows);
        const footer = footerFor(chat);
        if (timeline) riseFor(timelineRises, timeline)?.cancel();
        if (footer) riseFor(footerRises, footer)?.cancel();
        chatDisclosureQuietUntil.delete(chat);
        for (const [el, stop] of Array.from(active.entries())) {
          if (el === chat || hasAncestor(el, [chat])) stop();
        }
        old.contextKey = contextKey;
        old.rowIds = currentRowIds;
        old.seen = new Set(currentRowIds);
        old.seenCompactions = new Set();
        for (const item of all(chat, '[data-testid="stream-item"]')) {
          if (!(item.textContent?.trim() ?? '').startsWith('Compacting')) continue;
          const itemRow = item.closest(HISTORY_ROW);
          const key = item.getAttribute('data-stream-item-id') ?? itemRow?.getAttribute('data-history-row-id') ?? '';
          if (key) old.seenCompactions.add(key);
        }
        old.seenWorkedFooters = new Set();
        for (const workedFooter of findWorkedFooters(chat, rows)) {
          seenWorkedFooterNodes.add(workedFooter.row);
          seenWorkedFooterNodes.add(workedFooter.label);
          for (const key of workedFooter.keys) old.seenWorkedFooters.add(key);
        }
        old.pending.clear();
        old.running = Boolean(chat.querySelector('[data-testid="turn-working-indicator"]'));
        old.completedFooterPendingUntil = 0;
        old.scrollTop = chat.scrollTop;
        old.compensatedScrollTop = chat.scrollTop;
        old.maxScrollTop = Math.max(0, chat.scrollHeight - chat.clientHeight);
        old.scrollHeight = chat.scrollHeight;
        old.clientHeight = chat.clientHeight;
        old.clientWidth = chat.clientWidth;
        old.footer = footer;
        old.footerTop = footer ? rect(footer).top : null;
        old.stream = null;
        old.handoff = null;
        old.handoffQuietUntil = 0;
        old.hydrationQuietUntil = Date.now() + 500;
        old.reflowQuietUntil = 0;
      } else if (old && old.seen.size === 0 && rows.length > 0) {
        const isFirstLiveUserTurn =
          allow &&
          rows.length <= 2 &&
          Boolean(rows[0]?.querySelector(USER_MESSAGE)) &&
          !rows.some((row) => Boolean(row.querySelector('[data-testid="assistant-message"]')));
        if (!isFirstLiveUserTurn) {
          old.hydrationQuietUntil = Date.now() + 500;
        }
      }
    }
    animateGrowingToolText(allow);
    for (const chat of activeChats) {
      const rows = all(chat, HISTORY_ROW);
      const isToolSequenceRow = (candidate: Element | null) =>
        Boolean(
          candidate?.querySelector(
            `${TOOL}, [data-testid="tool-call-summary-placeholder"], [data-testid="todo-list-card"]`,
          ),
        );
      const hasCompletedFooterRow = (candidate: Element | null) =>
        Boolean(candidate?.querySelector('[data-testid="turn-footer-entry-motion"]'));
      for (const stream of all(chat, '[data-testid="native-polish-streaming-assistant"]')) {
        const row = stream.closest(HISTORY_ROW);
        const rowIndex = row ? rows.indexOf(row) : -1;
        const above = rowIndex > 0 ? rows[rowIndex - 1] : null;
        const below = rowIndex >= 0 && rowIndex < rows.length - 1 ? rows[rowIndex + 1] : null;
        const { gapAbove, gapBelow } = resolveStreamingAssistantGaps({
          aboveIsUserMessage: Boolean(above?.querySelector(USER_MESSAGE)),
          aboveIsToolSequence: isToolSequenceRow(above),
          aboveHasCompletedFooter: hasCompletedFooterRow(above),
          belowExists: Boolean(below),
          belowIsToolSequence: isToolSequenceRow(below),
          currentHasCompletedFooter: hasCompletedFooterRow(row),
        });
        if (gapAbove) stream.setAttribute('data-native-polish-gap-above', gapAbove);
        else stream.removeAttribute('data-native-polish-gap-above');
        if (gapBelow) stream.setAttribute('data-native-polish-gap-below', gapBelow);
        else stream.removeAttribute('data-native-polish-gap-below');
      }
      const old = chats.get(chat);
      const contextKey = chatContextKey(chat);
      const running = Boolean(chat.querySelector('[data-testid="turn-working-indicator"]'));
      const seen = old?.seen ?? new Set<string>();
      const seenCompactions = old?.seenCompactions ?? new Set<string>();
      const seenWorkedFooters = old?.seenWorkedFooters ?? new Set<string>();
      const candidates = allow ? old?.pending ?? new Set<string>() : new Set<string>();
      const firstHistoryPopulation = Boolean(!old || (old.seen.size === 0 && rows.length > 0));
      const isFirstLiveUserTurn = Boolean(
        allow &&
          firstHistoryPopulation &&
          rows.length >= 1 &&
          rows.length <= 2 &&
          rows[0]?.querySelector(USER_MESSAGE) &&
          !rows.some((row) => Boolean(row.querySelector('[data-testid="assistant-message"]'))),
      );
      const hydrationQuietUntil =
        firstHistoryPopulation && !isFirstLiveUserTurn
          ? Math.max(old?.hydrationQuietUntil ?? 0, Date.now() + 500)
          : isFirstLiveUserTurn
            ? 0
            : old?.hydrationQuietUntil ?? 0;
      const suppressHydrationMotion = Date.now() < hydrationQuietUntil;
      const liveTurn = running || Boolean(old?.running);
      const hasEnteringUserMessage = Boolean(
        (old || isFirstLiveUserTurn) &&
          !suppressHydrationMotion &&
          rows.some((row) => {
            const id = row.getAttribute('data-history-row-id') ?? '';
            return Boolean(id && !seen.has(id) && row.querySelector(USER_MESSAGE));
          }),
      );
      if (hasEnteringUserMessage) {
        const heightAnimated = chatHeightAnimations.get(chat);
        if (heightAnimated?.size) {
          for (const token of Array.from(heightAnimated)) {
            if (!token.element.closest(TOOL)) {
              active.get(token.element)?.();
              heightAnimated.delete(token);
            }
          }
        }
      }
      const currentScrollTop = chat.scrollTop;
      const currentScrollHeight = chat.scrollHeight;
      const currentClientHeight = chat.clientHeight;
      const maxScrollTop = Math.max(0, currentScrollHeight - currentClientHeight);
      const holdingPendingBottom = Boolean(
        old && Date.now() < old.pendingBottomUntil && Date.now() >= quietUntil,
      );
      const previousCompensatedScrollTop =
        old && holdingPendingBottom ? old.compensatedScrollTop : old?.scrollTop;
      const followState = isFollowingScrollBottom({
        currentScrollTop,
        maxScrollTop,
        previousScrollTop: old?.scrollTop,
        previousCompensatedScrollTop,
        previousMaxScrollTop: old?.maxScrollTop,
        userScrolledUp: hasEnteringUserMessage ? false : old?.userScrolledUp,
        holdingPendingBottom,
      });
      const userScrolledUp = followState.userScrolledUp;
      const wasFollowing = Boolean(old && Date.now() >= quietUntil && followState.wasFollowing);
      const atBottom = followState.atBottom || hasEnteringUserMessage;
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
      const handoffSwapCommit = Boolean(!stream && (old?.stream || handoffRow));
      const handoffTransition = Boolean(!stream && (old?.stream || old?.handoff || handoffRow));
      let handoffQuietUntil = handoffSwapCommit ? Date.now() + 180 : old?.handoffQuietUntil ?? 0;
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
      const enteringWorkedFooters: WorkedFooterTarget[] = [];
      for (const workedFooter of findWorkedFooters(chat, rows)) {
        const alreadySeen =
          seenWorkedFooterNodes.has(workedFooter.row)
          || seenWorkedFooterNodes.has(workedFooter.label)
          || workedFooter.keys.some((key) => seenWorkedFooters.has(key));
        if (shouldQueueWorkedFooterEntrance({
          hasPreviousChatState: Boolean(old),
          liveTurn,
          completedFooterPending: Boolean(old && !running && Date.now() < old.completedFooterPendingUntil),
          suppressHydrationMotion,
          hasEnteringUserMessage,
          isNew: !alreadySeen,
        })) {
          enteringWorkedFooters.push(workedFooter);
        }
        seenWorkedFooterNodes.add(workedFooter.row);
        seenWorkedFooterNodes.add(workedFooter.label);
        for (const key of workedFooter.keys) seenWorkedFooters.add(key);
      }
      let entered = 0;
      const pendingRowEntrances: Array<{ row: Element; isUserMessage: boolean }> = [];
      rows.forEach((row) => {
        const id = row.getAttribute('data-history-row-id')!;
        const isNew = !seen.has(id);
        const isUserMessage = Boolean(row.querySelector(USER_MESSAGE));
        seen.add(id);
        if (row === handoffRow) candidates.delete(id);
        else if (shouldQueueMessageEntrance({
          hasPreviousChatState: Boolean(old) || isFirstLiveUserTurn,
          wasRunning: Boolean(old?.running),
          running,
          isUserMessage,
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
            pendingRowEntrances.push({ row, isUserMessage });
          }
        }
      });
      if (hasEnteringUserMessage && !handoffTransition) {
        handoffQuietUntil = 0;
        chatDisclosureQuietUntil.delete(chat);
      }
      const suppressHandoffMotion = Date.now() < handoffQuietUntil;
      if (allow && getPreferences().messages && atBottom && Date.now() >= quietUntil) {
        for (const item of enteringCompactions) {
          if (!visible(item) || active.has(item)) continue;
          const motion = messageEntranceMotion(false);
          animate(item, motion.keyframes, undefined, 0, 260);
        }
      }
      if (allow && (getPreferences().messages || getPreferences().states) && Date.now() >= quietUntil) {
        for (const workedFooter of enteringWorkedFooters) {
          if (!visible(workedFooter.row)) continue;
          const rowBox = rect(workedFooter.row);
          const rowStyle = window.getComputedStyle(workedFooter.row);
          const marginTop = parseFloat(rowStyle.getPropertyValue('margin-top')) || 0;
          const paddingBottom = parseFloat(rowStyle.getPropertyValue('padding-bottom')) || 0;
          const expandLayout = shouldExpandWorkedFooterLayout({
            hasFollowingContent: workedFooter.hasFollowingContent,
            isTurnCompletionFooter: workedFooter.isTurnCompletionFooter,
            suppressHandoffMotion,
          });
          const motion = workedFooterEntranceMotion({
            height: rowBox.height,
            marginTop,
            paddingBottom,
            expandLayout,
          });
          if (motion.rowStyles && motion.rowKeyframes && !active.has(workedFooter.row)) {
            const finishWorkedFooterHeight = beginChatHeightAnimation(chat, workedFooter.row, motion.durationMs);
            const restoreRow = temporaryStyles(workedFooter.row, motion.rowStyles);
            animate(workedFooter.row, motion.rowKeyframes, (cancelled) => {
              restoreRow();
              finishWorkedFooterHeight(cancelled);
            }, 0, motion.durationMs);
          }
          if (visible(workedFooter.label) && !active.has(workedFooter.label)) {
            animate(workedFooter.label, motion.textKeyframes, undefined, 0, motion.durationMs);
          }
          for (const chrome of workedFooter.chrome) {
            if (visible(chrome) && !active.has(chrome)) {
              animate(chrome, motion.chromeKeyframes, undefined, 0, motion.durationMs);
            }
          }
        }
      }
      const timeline = timelineFor(chat, rows);
      const footer = footerFor(chat);
      const timelineRise = timeline ? riseFor(timelineRises, timeline) : null;
      const footerRise = footer ? riseFor(footerRises, footer) : null;
      const currentClientWidth = chat.clientWidth;
      const widthChanged = Boolean(old && Math.abs(currentClientWidth - old.clientWidth) > .5);
      // Sidebar/pane motion continuously changes the chat's available width.
      // The resulting line-wrap height is viewport reflow, not new output: core
      // bottom-anchors it without starting a content rise. Keep that boundary
      // alive through the trailing host scroll event.
      const reflowQuietUntil = widthChanged ? Date.now() + 120 : old?.reflowQuietUntil ?? 0;
      const suppressWidthReflowMotion = Date.now() < reflowQuietUntil;
      const suppressDisclosureMotion =
        Date.now() < (chatDisclosureQuietUntil.get(chat) ?? 0) ||
        Boolean(chatHeightAnimations.get(chat)?.size);
      const measuredFooterTop = footer && footerRise ? rect(footer).top - footerRise.getOffset() : null;
      const hasManualDisclosureCapture = Boolean(
        pending?.disclosure && (pending.disclosure.chat === chat || pending.disclosure.element.closest(CHAT) === chat),
      );
      const canRiseWithFollowOutput = shouldAllowFollowOutputRise({
        hasPreviousChatState: Boolean(old),
        allow,
        atBottom,
        messagesEnabled: getPreferences().messages,
        quiet: Date.now() < quietUntil,
        suppressHandoffMotion,
        suppressHydrationMotion,
        suppressWidthReflowMotion,
        suppressDisclosureMotion,
        hasEnteringUserMessage,
        holdingPendingBottom,
        hasActiveTimelineRise: (timelineRise?.getOffset() ?? 0) > 0.5,
        hasManualDisclosureCapture,
      });
      let compensatedScrollTop = currentScrollTop;
      let pendingBottomUntil = 0;
      let footerTop = measuredFooterTop;
      if (canRiseWithFollowOutput && old) {
        // A chat mutation is observable before Paseo's follow-output frame.
        // Pre-arm the inverse from the new scroll extent so the subsequent
        // scrollTop snap and transform land in one paint. Waiting for `scroll`
        // produces an upward flash followed by a downward correction.
        // Scroll events are intentionally not required to have committed the
        // previous snap yet; the compensated target is the authoritative
        // follow position across back-to-back stream chunks.
        const followScroll = resolveFollowOutputScroll({
          wasFollowing,
          currentScrollTop,
          maxScrollTop,
          previousScrollTop: old.scrollTop,
          previousCompensatedScrollTop: previousCompensatedScrollTop ?? old.scrollTop,
          previousMaxScrollTop: old.maxScrollTop,
          currentScrollHeight,
          previousScrollHeight: old.scrollHeight,
          currentClientHeight,
          previousClientHeight: old.clientHeight,
        });
        compensatedScrollTop = followScroll.compensatedScrollTop;
        if (followScroll.anticipatesBottom) {
          pendingBottomUntil = Date.now() + 120;
        }
        if (followScroll.viewportHeightChangedOnly) {
          if (currentClientHeight < old.clientHeight - 0.5 || (timelineRise?.getOffset() ?? 0) <= 0.5) {
            timelineRise?.cancel();
            footerRise?.cancel();
          }
          footerTop = footer ? rect(footer).top : null;
        } else {
          if (followScroll.anticipatesBottom) timelineRise?.prepare(followScroll.scrollDistance);
          else timelineRise?.start(followScroll.scrollDistance);
          // Once overflow grows, the anticipated scroll absorbs the footer's
          // layout movement. Before overflow, retain the ordinary footer rise.
          if (measuredFooterTop !== null) footerTop = measuredFooterTop - (compensatedScrollTop - currentScrollTop);
          if (
            old.maxScrollTop <= 0.5 &&
            old.footerTop !== null &&
            footerTop !== null &&
            old.footerTop - footerTop < -0.5 &&
            shouldAnimateFooterRise(old.footer, footer, hasEnteringUserMessage)
          ) {
            footerRise?.start(old.footerTop - footerTop);
          }
        }
      } else if (!allow || !atBottom || Date.now() < quietUntil || suppressHydrationMotion || suppressWidthReflowMotion) {
        const hadUncommittedAnticipation = Boolean(
          old &&
            old.compensatedScrollTop > old.scrollTop + 0.5 &&
            currentScrollTop < old.compensatedScrollTop - 0.5,
        );
        if (
          !allow ||
          !old ||
          old.contextKey !== contextKey ||
          suppressHydrationMotion ||
          suppressWidthReflowMotion ||
          hadUncommittedAnticipation
        ) {
          timelineRise?.cancel();
          footerRise?.cancel();
        }
        if (suppressHydrationMotion || suppressWidthReflowMotion || !atBottom) {
          footerTop = footer ? rect(footer).top : null;
        }
      } else if (old && wasFollowing) {
        compensatedScrollTop = maxScrollTop;
        if (maxScrollTop > currentScrollTop + 0.5) {
          pendingBottomUntil = Math.max(
            Date.now() + 120,
            chatDisclosureQuietUntil.get(chat) ?? 0,
            handoffQuietUntil,
          );
        }
      }
      const footerMovedDownPx =
        old?.footerTop !== null && old?.footerTop !== undefined && footerTop !== null
          ? footerTop - old.footerTop
          : 0;
      const footerSlideDownPx =
        old && old.maxScrollTop <= 0.5 ? Math.max(0, footerMovedDownPx) : 0;
      for (const { row, isUserMessage } of pendingRowEntrances) {
        const delayMs = resolveUserMessageEntranceDelayMs({
          isUserMessage,
          footerSlideDownPx,
        });
        const motion = messageEntranceMotion(isUserMessage);
        const restore = motion.styles ? temporaryStyles(row, motion.styles) : undefined;
        animate(row, motion.keyframes, restore, delayMs, 320);
      }
      if (allow && getPreferences().states && old && old.running !== running && atBottom && !suppressHandoffMotion && !suppressHydrationMotion) {
        // A disappearing indicator has no incoming element to animate. Do not
        // fall through to the completed assistant row during renderer handoff.
        const indicator = chat.querySelector('[data-testid="turn-working-indicator"]');
        if (indicator && visible(indicator) && !active.has(indicator)) animate(indicator, [{ opacity: .4 }, { opacity: 1 }], undefined, 0, 150);
      }
      let completedFooterPendingUntil = running ? 0 : old?.completedFooterPendingUntil ?? 0;
      if (suppressHydrationMotion || enteringWorkedFooters.length > 0) completedFooterPendingUntil = 0;
      else if (old?.running && !running) completedFooterPendingUntil = Date.now() + 600;
      if (allow && (getPreferences().messages || getPreferences().states) && !running && atBottom && Date.now() < completedFooterPendingUntil) {
        const footerRow = chat.querySelector('[data-testid="turn-footer-entry-motion"]');
        const worked = footerRow ? smallestTextElement(footerRow, 'Worked') : null;
        if (worked && visible(worked) && !active.has(worked)) {
          const motion = workedFooterEntranceMotion({ height: 0, expandLayout: false });
          animate(worked, motion.textKeyframes, undefined, 0, motion.durationMs);
          completedFooterPendingUntil = 0;
        }
      }
      while (seen.size > 5000) seen.delete(seen.values().next().value!);
      while (seenCompactions.size > 500) seenCompactions.delete(seenCompactions.values().next().value!);
      while (seenWorkedFooters.size > 1000) seenWorkedFooters.delete(seenWorkedFooters.values().next().value!);
      const currentIds = new Set(rows.map(row => row.getAttribute('data-history-row-id')!));
      for (const id of candidates) if (!atBottom || !currentIds.has(id)) candidates.delete(id);
      chats.set(chat, { contextKey, rowIds: currentIds, seen, seenCompactions, seenWorkedFooters, pending: candidates, running, completedFooterPendingUntil, scrollTop: currentScrollTop, compensatedScrollTop, pendingBottomUntil, userScrolledUp, maxScrollTop, scrollHeight: currentScrollHeight, clientHeight: currentClientHeight, clientWidth: currentClientWidth, footer, footerTop, stream, handoff, handoffQuietUntil, hydrationQuietUntil, reflowQuietUntil });
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
    panels: new Map(Array.from(panels()).filter(([, el]) => visible(el) && !panelExits.has(el)).map(([key, el]) => [key, snapshot(el)])),
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
    const disclosure = pending.disclosure;
    const nextChildren = disclosure ? Array.from(disclosure.element.children) : [];
    const nextToggle = disclosure
      ? (disclosure.isBubble ? bubbleToggleFor(disclosure.element) : disclosure.element.querySelector('[role="button"][aria-expanded]'))
      : null;
    const nextPreview = disclosure?.isBubble
      ? (disclosure.preview?.isConnected && hasAncestor(disclosure.preview, [disclosure.element])
        ? disclosure.preview
        : (nextToggle ? nextChildren.find(child => child !== nextToggle) ?? null : null))
      : null;
    const nextAria = nextToggle?.getAttribute('aria-expanded');
    const nextExpanded = disclosure?.isBubble
      ? bubbleExpandedState(nextToggle, nextPreview)
      : (nextAria === 'true' ? true : nextAria === 'false' ? false : null);
    const toggleFlipped = disclosure?.expanded !== undefined && disclosure.expanded !== null && nextExpanded !== null && nextExpanded !== disclosure.expanded;
    const disclosureChanged = Boolean(disclosure && (toggleFlipped || nextChildren.length !== disclosure.children.length || nextChildren.some((child, index) => child !== disclosure.children[index])));
    const inTimeline = Boolean(disclosure && (disclosure.element.matches(TOOL) || disclosure.element.closest(CHAT)));
    if (disclosure && ((inTimeline && preferences.timeline) || (!inTimeline && preferences.sidebars))) animateDisclosure(disclosure);
    // Capture the committed tree once, before applying its FLIP transforms.
    // Reuse it as the next baseline instead of cloning/measuring it again.
    const nextTree = pending.tree && treeTarget?.isConnected ? captureTree(treeTarget) : null;
    if (preferences.trees && pending.tree && nextTree) animateTree(pending.tree, nextTree);
    // Refresh after a commit so asynchronous directory loads can animate once
    // without replaying previous rows. Ignore animation-generated ghost nodes.
    pending = {
      panels: nextPanels,
      panes: pending.paneMotion ? currentPanes : pending.panes,
      paneAction: pending.paneAction,
      paneMotion: pending.paneMotion && !paneChanged,
      disclosure: disclosureChanged
        ? (disclosure?.isBubble ? null : captureDisclosure(disclosure!.element))
        : disclosure,
      tree: nextTree ?? pending.tree,
    };
    if (layoutPolling > 0 && active.size === 0) { layoutPolling--; schedule(); }
    else layoutPolling = 0;
  };
  const schedule = () => { if (pending && canAnimate() && !frame) frame = window.requestAnimationFrame(flush); };
  const scheduleDisclosureMicrotask = () => {
    if (!pending?.disclosure) return;
    void Promise.resolve().then(() => {
      if (pending?.disclosure && canAnimate()) {
        if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
        flush();
      }
    });
  };
  const observer = new MutationObserver(records => {
    if (disposed || suspended) return;
    let refreshChatNow = false;
    for (const record of records) {
      const target = elementOf(record.target);
      const structural = record.type === 'childList';
      const textual = record.type === 'characterData';
      if (structural || textual) syncTitleRevealFromMutation(record, target);
      if (!target || target.closest('[data-native-polish-ghost],[data-native-polish-peek-trigger],[data-native-polish-reveal],[data-native-polish-shimmer-overlay]')) continue;
      // Discover an editor's scroll surface when CodeMirror mounts into its
      // host. Token, selection and caret updates remain excluded from scans.
      if (target.closest(EDITING)) {
        if (structural && target.matches('[data-testid="file-source-editor"]')) scheduleAmbient(['elastic']);
        continue;
      }
      if (structural) {
        const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
        if (nodes.length && nodes.every(node => node.nodeType === 1 && (node.getAttribute('data-native-polish-ghost') !== null || node.getAttribute('data-native-polish-peek-trigger') !== null || node.getAttribute('data-native-polish-shimmer-overlay') !== null))) continue;
      }
      // Offset/clip/translate writes belong solely to the elastic adapter.
      // Host spinner leaf styles likewise do not invalidate whole layouts.
      if (record.attributeName === 'style' && target.closest('[data-native-polish-elastic]')) continue;
      if (record.attributeName === 'data-status-bucket') { scheduleAmbient(['agents']); continue; }
      // Reused dialog portal surfaces open by gaining role="dialog".
      if (record.attributeName === 'role') { scheduleAmbient(['floating', 'controls']); continue; }
      if (structural || record.attributeName === 'aria-expanded' || target.matches(PANE) || target.querySelector(PANE)) schedule();
      const meaningful = structural || record.type === 'characterData' || ['aria-expanded', 'aria-selected', 'aria-busy'].includes(record.attributeName ?? '');
      if (target.closest(CHAT)) {
        if (meaningful || textual) {
          refreshChatNow = true;
        }
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
    if (refreshChatNow) {
      if (pending?.disclosure && canAnimate()) {
        if (frame) { window.cancelAnimationFrame(frame); frame = 0; }
        flush();
      }
      // Follow-output is scheduled from the same chat commit. Measure its
      // new extent once in this microtask so the inverse is ready before the
      // host's animation frame writes scrollTop.
      refreshAmbient(canAnimate(), new Set<Region>(['tools', 'messages']));
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
    if (!shortcut && target.closest('[data-testid="message-input-root"]')) return false;
    if (target.closest(CHAT) && !shortcut) return Boolean(disclosureFor(target));
    return shortcut || Boolean(target.closest(ACTION));
  }
  // The host's shortcut listener precedes ours on window capture, and React
  // commits its sidebar state in a microtask before our listener runs. Take
  // the sidebar baseline when the modifier goes down, before B/E arrives.
  let primed: Map<string, Snapshot> | null = null;
  const prime = (event: Event) => {
    if (event.key !== 'Meta' && event.key !== 'Control') return;
    primed = event.repeat || !canAnimate() ? primed : new Map(Array.from(panels()).filter(([, el]) => visible(el) && !panelExits.has(el)).map(([key, el]) => [key, snapshot(el)]));
  };
  const unprime: Listener = event => { if (event.key === 'Meta' || event.key === 'Control') primed = null; };
  const begin = (event: Event) => {
    if (event.key === 'Meta' || event.key === 'Control') { prime(event); return; }
    if (!capturesInput(event)) {
      // Selecting text or placing a caret may interrupt motion, but does not
      // require full snapshots. Ordinary keystrokes leave host input alone.
      const target = elementOf(event.target);
      if (!event.key && !target?.closest(`${EDITING}, [data-testid="message-input-root"]`)) { clearCapture(); if (active.size || ghosts.size) stopAll(); }
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
    if (event.key) scheduleDisclosureMicrotask();
    schedule();
  };
  const onScroll: Listener = event => {
    if (disposed || suspended) return;
    const inChat = Boolean(elementOf(event.target)?.closest(CHAT));
    quietUntil = Date.now() + 350; pending = null; treeTarget = null;
    if (!inChat) {
      if (active.size || ghosts.size) stopAll();
    } else if (ghosts.size > toolDetailReveals.size) {
      const revealRoots = new Set(Array.from(toolDetailReveals, reveal => reveal.root));
      for (const ghostEl of Array.from(ghosts)) {
        if (!revealRoots.has(ghostEl)) {
          active.get(ghostEl)?.();
          ghostEl.remove();
          ghosts.delete(ghostEl);
        }
      }
    }
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
    if (toolDetailReveals.size > 0) {
      for (const reveal of Array.from(toolDetailReveals)) {
        if (!syncToolDetailReveal(reveal)) active.get(reveal.tintLayer)?.();
      }
    }
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
    scheduleDisclosureMicrotask();
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
    window.cancelAnimationFrame(diffFrame); diffFrame = 0; diffTail = false;
    window.cancelAnimationFrame(titleFrame); titleFrame = 0; titleLastTime = 0;
    window.cancelAnimationFrame(revealFrame); revealFrame = 0;
    // Exit copies are unnecessary while no motion is presented. Release
    // their detached DOM and rebuild clean baselines on return.
    workspaceLists.clear(); tabRows.clear(); floating.clear(); paneBaseline.clear(); paneTransition = null;
    for (const rise of contentRises) rise.cancel();
    fileIcons.clear(); toolIcons.clear(); toolShimmers.clear(); toolLabels.clear(); toolGroupItems.clear(); toolDetailText.clear(); toolDetailReveals.clear(); agentStates.clear();
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
    for (const key of ['controls', 'tabs', 'trees', 'states', 'timeline', 'motion']) document.body.removeAttribute(`data-native-polish-${key}`);
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
    window.cancelAnimationFrame(diffFrame); diffFrame = 0; diffTail = false;
    window.cancelAnimationFrame(titleFrame); titleFrame = 0;
    window.cancelAnimationFrame(revealFrame); revealFrame = 0;
    window.clearTimeout(scrollDeadline); dirty.clear();
    for (const rise of contentRises) rise.cancel();
    contentRises.clear();
    workspaceLists.clear(); tabRows.clear(); floating.clear(); paneBaseline.clear(); fileIcons.clear(); toolIcons.clear(); toolShimmers.clear(); toolLabels.clear(); toolGroupItems.clear(); toolDetailText.clear(); toolDetailReveals.clear(); agentStates.clear();
    workspaceMeta.clear(); workspaceTitleBaseline.clear(); removeTitleCovers(); titleReveals.clear(); titleRevealKeys.clear();
    pending = null; treeTarget = null; stopAll();
  };
}
