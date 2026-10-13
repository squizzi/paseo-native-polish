/* Web-only boundary feedback. Native scrolling owns scrollTop, inertia and
 * virtualized history. No event is cancelled and no content is reparented. */
interface Style {
  getPropertyValue(key: string): string;
  getPropertyPriority(key: string): string;
  setProperty(key: string, value: string, priority?: string): void;
  removeProperty(key: string): void;
}
interface Element {
  nodeType: number; parentElement: Element | null; children: ArrayLike<Element>;
  isConnected: boolean; style: Style;
  scrollTop: number; scrollHeight: number; clientHeight: number;
  closest(selector: string): Element | null;
  matches(selector: string): boolean;
  querySelectorAll(selector: string): ArrayLike<Element>;
  getAttribute(key: string): string | null;
  setAttribute(key: string, value: string): void;
  removeAttribute(key: string): void;
}
interface Input {
  target: Element | null; deltaY?: number; deltaX?: number; deltaMode?: number;
  ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; pointerType?: string; buttons?: number;
  touches?: ArrayLike<{ clientX: number; clientY: number }>;
}
type Listener = (event: Input) => void;
declare const document: {
  body: Element;
  addEventListener(type: string, listener: Listener, options: { capture: boolean; passive: boolean }): void;
  removeEventListener(type: string, listener: Listener, capture: boolean): void;
};
declare const window: {
  CSS?: { supports(property: string, value: string): boolean };
  navigator: { userAgent: string };
  getComputedStyle(el: Element): Style;
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(id: number): void;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
};

const FILE_PANE = '[data-testid="workspace-file-pane"]';
const SOURCE_SCROLL = `${FILE_PANE} [data-testid="file-source-editor"] .cm-scroller`;
const SURFACES = '[data-testid="agent-chat-scroll"], [data-testid="sidebar-project-workspace-list-scroll"], [data-testid="sidebar-status-list-scroll"], [data-testid="file-explorer-tree-scroll"], [data-testid="changes-file-tree"], ' + SOURCE_SCROLL;
const MARKDOWN_PREVIEW = '[data-testid="markdown-preview-frame"]';
const MARKER = 'data-native-polish-elastic';
// A chat actively streaming at the bottom keeps its own scrollTop pinned to
// scrollHeight - clientHeight every tick (bottom-follow), which makes the
// "already at the boundary" check below chronically true. Without this,
// every ordinary downward wheel tick while streaming reads as an outward
// overscroll and launches the rubber-band spring instead of just scrolling,
// which is why reaching the bottom during a live stream took several tries.
export const LIVE_BOTTOM_PIN = 'data-native-polish-live-bottom';
const OFFSET = '--native-polish-elastic-offset';
const COEFFICIENT = .55;
// Wheel events have no platform phase information. Keep release latched for
// the momentum tail, but allow deliberate renewed input at the same edge.
interface WheelGesture {
  time: number; magnitude: number; peak: number; decays: number;
  momentum: boolean; released: boolean; collided: boolean; direction: number;
  trough: number; renewed: number; renewedDistance: number; interval: number;
}
interface Spring {
  scroll: Element; content: Element; pull: number; position: number; velocity: number;
  viewport: boolean;
  lastInput: number; touching: boolean; top: number; height: number;
  gesture?: WheelGesture;
  owners: Element[]; children: Element[]; translations: Map<Element, string>; restore(): void; written: string;
}
export function installElasticScroll(options: { enabled(): boolean; quick(): boolean; onRest(): void }) {
  const springs = new Map<Element, Spring>();
  const boundaries = new Map<Element, { value: string; priority: string; written: string }>();
  let wheelGestures = new WeakMap<Element, WheelGesture>();
  let frame = 0;
  let previousTime = 0;
  let disposed = false;
  let touch: { scroll: Element; x: number; y: number } | null = null;
  // macOS browsers already have compositor-driven platform rubber banding.
  // Electron requires a main-process scrollBounce option, outside this plugin.
  const native = /Macintosh|Mac OS X|iPhone|iPad/.test(window.navigator.userAgent) && !/Electron\//.test(window.navigator.userAgent)
    && window.CSS?.supports('overscroll-behavior-y', 'contain') === true;
  const supported = native || (window.CSS?.supports('translate', '0 1px') === true && window.CSS.supports('overflow', 'clip'));
  const scrollable = (el: Element) => /^(auto|scroll)$/.test(window.getComputedStyle(el).getPropertyValue('overflow-y'));
  function markdownScroll(preview: Element): Element | null {
    const pane = preview.closest(FILE_PANE);
    if (!pane || !preview.isConnected || preview.closest('[data-native-polish-ghost]')) return null;
    // Paseo's Markdown RN ScrollView has no test ID. Find its closest scroll
    // owner from the known reading frame, stopping before the file-pane chrome.
    let at = preview.parentElement;
    for (let depth = 0; at && at !== pane && depth < 8; depth++, at = at.parentElement) {
      if (scrollable(at)) return at;
    }
    return null;
  }
  function boundary(scroll: Element) {
    if (boundaries.has(scroll)) return;
    const written = native ? 'contain' : 'none';
    boundaries.set(scroll, { value: scroll.style.getPropertyValue('overscroll-behavior-y'), priority: scroll.style.getPropertyPriority('overscroll-behavior-y'), written });
    // Native mode retains the platform bounce and stops pane scroll chaining.
    // The fallback suppresses a second compositor bounce underneath its offset.
    scroll.style.setProperty('overscroll-behavior-y', written);
  }
  function restoreBoundary(scroll: Element) {
    const old = boundaries.get(scroll);
    if (old && scroll.style.getPropertyValue('overscroll-behavior-y') === old.written) {
      if (old.value) scroll.style.setProperty('overscroll-behavior-y', old.value, old.priority);
      else scroll.style.removeProperty('overscroll-behavior-y');
    }
    boundaries.delete(scroll);
  }
  function finish(state: Spring) {
    if (state.gesture) state.gesture.released = true;
    state.restore();
    state.content.removeAttribute(MARKER);
    springs.delete(state.scroll);
    options.onRest();
  }
  function reset() {
    touch = null;
    for (const state of Array.from(springs.values())) finish(state);
    window.cancelAnimationFrame(frame); frame = 0; previousTime = 0;
    wheelGestures = new WeakMap();
  }
  function refresh() {
    if (!supported || !options.enabled()) {
      reset();
      for (const scroll of Array.from(boundaries.keys())) restoreBoundary(scroll);
      return;
    }
    const live = new Set(Array.from(document.body.querySelectorAll(SURFACES)).filter(el => !el.closest('[data-native-polish-ghost]') && scrollable(el)));
    for (const preview of Array.from(document.body.querySelectorAll(`${FILE_PANE} ${MARKDOWN_PREVIEW}`))) {
      const scroll = markdownScroll(preview);
      if (scroll) live.add(scroll);
    }
    for (const scroll of live) boundary(scroll);
    for (const scroll of Array.from(boundaries.keys())) if (!live.has(scroll)) {
      const state = springs.get(scroll);
      if (state) finish(state);
      restoreBoundary(scroll);
    }
  }
  function owner(target: Element | null): Element | null {
    let el = target?.nodeType === 1 ? target : target?.parentElement ?? null;
    let scope = el?.closest(SURFACES);
    if (!scope) {
      const pane = el?.closest(FILE_PANE);
      const preview = pane?.querySelectorAll(MARKDOWN_PREVIEW)[0];
      if (preview) scope = markdownScroll(preview);
    }
    if (!scope || scope.closest('[data-native-polish-ghost]')) return null;
    while (el) {
      // An inner code/detail scroller keeps its own boundary behavior.
      if (scrollable(el)) return el === scope ? el : null;
      if (el === scope) break;
      el = el.parentElement;
    }
    return null;
  }
  function boxChildren(content: Element): Element[] {
    const result: Element[] = [];
    function visit(el: Element, depth: number) {
      if (depth > 8 || result.length > 512) return;
      if (window.getComputedStyle(el).getPropertyValue('display') === 'contents') {
        for (const child of Array.from(el.children)) visit(child, depth + 1);
      } else result.push(el);
    }
    for (const child of Array.from(content.children)) visit(child, 0);
    return result.length > 512 ? [] : result;
  }
  function styles(el: Element, values: Record<string, string>) {
    const previous = Object.keys(values).map(key => [key, el.style.getPropertyValue(key), el.style.getPropertyPriority(key)]);
    const written = new Map<string, string>();
    for (const [key, value] of Object.entries(values)) {
      el.style.setProperty(key, value); written.set(key, el.style.getPropertyValue(key));
    }
    return () => {
      for (const [key, value, priority] of previous) {
        if (el.style.getPropertyValue(key) !== written.get(key)) continue;
        if (value) el.style.setProperty(key, value, priority);
        else el.style.removeProperty(key);
      }
    };
  }
  function tick() {
    frame = 0;
    const now = Date.now();
    const dt = Math.min(32, Math.max(1, previousTime ? now - previousTime : 16)) / 1000;
    previousTime = now;
    for (const state of Array.from(springs.values())) {
      if (!options.enabled() || !state.scroll.isConnected || !state.content.isConnected
        || (!state.viewport && Array.from(state.scroll.children)[0] !== state.content)
        || state.children.length !== state.content.children.length || state.children.some((el, index) => state.content.children[index] !== el)
        || Math.abs(state.scroll.scrollTop - state.top) > 2 || Math.abs(state.scroll.scrollHeight - state.height) > 2
        || state.content.style.getPropertyValue(OFFSET) !== state.written
        || state.owners.some(el => !el.isConnected || el.style.getPropertyValue('translate') !== state.translations.get(el))) { finish(state); continue; }
      // Pulling is direct manipulation, with no easing/lag. Only release runs
      // the spring; it is critically damped, so it returns without wobbling.
      const hold = state.gesture ? Math.min(120, Math.max(40, state.gesture.interval * 1.5)) : 40;
      const held = state.touching || (!state.gesture?.released && now - state.lastInput < hold);
      if (held) continue;
      if (state.gesture) state.gesture.released = true;
      const frequency = options.quick() ? 32 : 28;
      const stiffness = frequency * frequency;
      const damping = 2 * frequency;
      // Bounded substeps keep the spring stable at low frame rates.
      const steps = Math.ceil(dt / .008);
      for (let i = 0; i < steps; i++) {
        state.velocity += (-stiffness * state.position - damping * state.velocity) * dt / steps;
        state.position += state.velocity * dt / steps;
      }
      if (Math.abs(state.position) < .15 && Math.abs(state.velocity) < 1) { finish(state); continue; }
      state.written = `${state.position.toFixed(3)}px`;
      state.content.style.setProperty(OFFSET, state.written);
    }
    if (springs.size) frame = window.requestAnimationFrame(tick);
    else previousTime = 0;
  }
  function pull(scroll: Element, delta: number, touching: boolean, gesture?: WheelGesture) {
    const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const outward = (delta < 0 && scroll.scrollTop <= 1)
      || (delta > 0 && scroll.scrollTop >= max - 1 && scroll.getAttribute(LIVE_BOTTOM_PIN) === null);
    const current = springs.get(scroll);
    if (!outward) { if (current) finish(current); return; }
    const viewport = scroll.matches(SOURCE_SCROLL);
    // CodeMirror has several coordinated content/gutter/selection layers, not
    // an RN content wrapper. Move the complete viewport inside its existing
    // clipped host, keeping its internal geometry and scroll metrics together.
    const content = viewport ? scroll : Array.from(scroll.children)[0];
    if (!content || scroll.clientHeight < 2 || !content.isConnected) return;
    let state = current;
    if (!state) {
      if (viewport) {
        const host = scroll.closest('[data-testid="file-source-editor"]');
        if (!host || !/^(hidden|clip)$/.test(window.getComputedStyle(host).getPropertyValue('overflow-y'))) return;
      }
      if (window.getComputedStyle(content).getPropertyValue('display') === 'contents') return;
      const owners = viewport ? [scroll] : boxChildren(content);
      if (!owners.length || owners.some(el => {
        const translate = window.getComputedStyle(el).getPropertyValue('translate');
        return translate && translate !== 'none' && !/^0(?:px)?(?: 0(?:px)?){0,2}$/.test(translate);
      })) return;
      boundary(scroll);
      const top = scroll.scrollTop;
      const height = scroll.scrollHeight;
      // Clip inside the unchanged content box, so translated descendants do
      // not extend scrollHeight or disturb virtualizer/follow-output offsets.
      // Never change CodeMirror's overflow or translate its individual lines.
      // Its scroller retains native input, scrollTop and viewport sizing.
      const restoreClip = viewport ? () => {} : styles(content, { 'overflow-x': 'clip', 'overflow-y': 'clip' });
      const restoreOwners = owners.map(el => styles(el, { translate: `0 var(${OFFSET})` }));
      const value = content.style.getPropertyValue(OFFSET);
      const priority = content.style.getPropertyPriority(OFFSET);
      state = {
        scroll, content, viewport, pull: 0, position: 0, velocity: 0, lastInput: 0, touching,
        top, height,
        owners, children: Array.from(content.children), translations: new Map(owners.map(el => [el, el.style.getPropertyValue('translate')])),
        written: '0px', restore: () => {
          for (const restore of restoreOwners) restore();
          restoreClip();
          if (content.style.getPropertyValue(OFFSET) !== state?.written) return;
          if (value) content.style.setProperty(OFFSET, value, priority);
          else content.style.removeProperty(OFFSET);
        },
      };
      content.style.setProperty(OFFSET, state.written);
      if (Math.abs(scroll.scrollHeight - height) > 2 || Math.abs(scroll.scrollTop - top) > 2) { state.restore(); return; }
      content.setAttribute(MARKER, '');
      springs.set(scroll, state);
    }
    // Reconstruct pull from the current visible offset. New input during a
    // return cannot jump back to an earlier gesture's maximum displacement.
    const extent = Math.min(100, Math.max(36, scroll.clientHeight * .18));
    const offset = Math.min(extent - .01, Math.abs(state.position));
    state.pull = Math.sign(state.position) * extent * offset / (COEFFICIENT * (extent - offset));
    state.pull = Math.max(-extent * 8, Math.min(extent * 8, state.pull - Math.max(-120, Math.min(120, delta))));
    const distance = Math.abs(state.pull);
    state.position = Math.sign(state.pull) * COEFFICIENT * distance * extent / (extent + COEFFICIENT * distance);
    state.velocity = 0;
    state.gesture = gesture;
    state.written = `${state.position.toFixed(3)}px`;
    state.content.style.setProperty(OFFSET, state.written);
    state.lastInput = Date.now(); state.touching = touching;
    if (!frame) { previousTime = 0; frame = window.requestAnimationFrame(tick); }
  }
  const wheel: Listener = event => {
    if (!supported || !options.enabled() || event.buttons || event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX ?? 0) >= Math.abs(event.deltaY ?? 0)) return;
    const scroll = owner(event.target);
    if (!scroll) return;
    // Editor mounting can occur after the surrounding pane's layout refresh.
    // Native mode can establish its boundary lazily on the first wheel event.
    if (native) { boundary(scroll); return; }
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.clientHeight : 1;
    const delta = (event.deltaY ?? 0) * unit;
    const magnitude = Math.abs(delta);
    const direction = Math.sign(delta);
    const now = Date.now();
    const previous = wheelGestures.get(scroll);
    if (!direction) return;
    const gap = previous ? now - previous.time : 0;
    let same = Boolean(previous && gap < 240 && direction === previous.direction);
    let renewedDelta = delta;
    if (same && previous?.released) {
      previous.trough = Math.min(previous.trough, magnitude);
      // A single amplitude spike is not enough to reopen an inertial tail.
      // Require sustained pressure above its low point, or a distinct spaced
      // impulse. Line/page wheels have no smooth trackpad momentum to retain.
      const pressure = magnitude >= Math.max(1, previous.trough * 2.5)
        && magnitude >= previous.magnitude * .95;
      previous.renewed = pressure ? previous.renewed + 1 : 0;
      previous.renewedDistance = pressure ? previous.renewedDistance + magnitude : 0;
      const impulse = gap >= 64 && magnitude >= 1 && (
        !previous.momentum && magnitude >= previous.magnitude * .98
        || magnitude >= previous.magnitude * 2.5 && magnitude - previous.magnitude >= 2
      );
      if (event.deltaMode === 1 || event.deltaMode === 2 || impulse
        || previous.renewed >= 2 && previous.renewedDistance >= 3) {
        // Retain the small confirming inputs so a gentle new pull is not lost.
        renewedDelta = direction * Math.max(magnitude, previous.renewedDistance);
        same = false;
      }
    }
    const gesture: WheelGesture = same && previous ? previous : {
      time: now, magnitude, peak: magnitude, decays: 0,
      momentum: false, released: false, collided: false, direction,
      trough: magnitude, renewed: 0, renewedDistance: 0,
      interval: gap > 0 && gap < 160 ? gap : 16,
    };
    if (same) gesture.interval = gesture.interval * .5 + gap * .5;
    // While still pulling, follow the current input as the eventual release
    // floor. Once released, only lower samples move that floor.
    if (!gesture.released) gesture.trough = magnitude;
    gesture.decays = same && magnitude < gesture.magnitude * .98 ? gesture.decays + 1 : 0;
    gesture.peak = Math.max(gesture.peak, magnitude);
    gesture.magnitude = magnitude;
    gesture.time = now;
    // Momentum and release are latched: an uneven tail cannot reopen them.
    gesture.momentum ||= gesture.decays >= 3 && magnitude < gesture.peak * .65;
    wheelGestures.set(scroll, gesture);
    const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const edge = (delta < 0 && scroll.scrollTop <= 1) || (delta > 0 && scroll.scrollTop >= max - 1);
    // A fling may hit the edge during its momentum phase. Give that collision
    // one displacement, then let it return while the remaining tail passes.
    if (gesture.released) return;
    if (gesture.momentum && (!edge || gesture.collided)) {
      if (gesture.collided) gesture.released = true;
      return;
    }
    pull(scroll, renewedDelta, false, gesture);
    if (edge) {
      gesture.collided = true;
      if (gesture.momentum) gesture.released = true;
    }
  };
  const touchStart: Listener = event => {
    reset();
    if (native || !supported || !options.enabled() || event.touches?.length !== 1) return;
    const scroll = owner(event.target);
    if (scroll) touch = { scroll, x: event.touches[0].clientX, y: event.touches[0].clientY };
  };
  const touchMove: Listener = event => {
    if (!touch || !options.enabled() || event.touches?.length !== 1) { reset(); return; }
    const finger = event.touches[0];
    const dy = touch.y - finger.clientY;
    const dx = touch.x - finger.clientX;
    touch.x = finger.clientX; touch.y = finger.clientY;
    if (Math.abs(dy) > Math.abs(dx)) pull(touch.scroll, dy, true);
  };
  const touchEnd: Listener = () => {
    if (touch) {
      const state = springs.get(touch.scroll);
      if (state) { state.touching = false; state.lastInput = 0; }
    }
    touch = null;
  };
  const interrupt: Listener = event => { if (event.pointerType !== 'touch') reset(); };
  const listeners: [string, Listener][] = [
    ['wheel', wheel], ['touchstart', touchStart], ['touchmove', touchMove], ['touchend', touchEnd],
    ['touchcancel', touchEnd], ['pointerdown', interrupt], ['keydown', reset],
    ['beforeinput', reset], ['compositionstart', reset],
  ];
  for (const [type, listener] of listeners) document.addEventListener(type, listener, { capture: true, passive: true });
  window.addEventListener('blur', reset);
  refresh();
  return {
    refresh, reset, isActive: () => springs.size > 0,
    dispose() {
      if (disposed) return;
      disposed = true; reset();
      for (const scroll of Array.from(boundaries.keys())) restoreBoundary(scroll);
      for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
      window.removeEventListener('blur', reset);
    },
  };
}
