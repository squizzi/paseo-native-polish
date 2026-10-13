import { useSyncExternalStore } from "react";

export const GENTLE_MOTION_DURATION_MS = 220;
export const QUICK_MOTION_DURATION_MS = 150;
export const GENTLE_STREAM_REVEAL_HORIZON_MS = 320;
export const QUICK_STREAM_REVEAL_HORIZON_MS = QUICK_MOTION_DURATION_MS;
export const GENTLE_STREAM_FADE_DURATION_MS = GENTLE_STREAM_REVEAL_HORIZON_MS;
export const QUICK_STREAM_FADE_DURATION_MS = QUICK_MOTION_DURATION_MS;

export interface Preferences {
  enabled: boolean; sidebars: boolean; trees: boolean; timeline: boolean; panes: boolean;
  tabs: boolean; overlays: boolean; controls: boolean; states: boolean; messages: boolean; elasticScroll: boolean; edgePeek: boolean;
  pace: "gentle" | "quick";
}
export const defaults: Preferences = { enabled: true, sidebars: true, trees: true, timeline: true, panes: true, tabs: true, overlays: true, controls: true, states: true, messages: true, elasticScroll: true, edgePeek: true, pace: "gentle" };
// Settings from every connected host control the single window motion owner.
const scope = globalThis as typeof globalThis & { __paseoNativePolishPreferences?: { current: Preferences; listeners: Set<() => void> } };
const store = scope.__paseoNativePolishPreferences ??= { current: defaults, listeners: new Set() };
export function getPreferences() { return store.current; }
export function setPreferences(next: Preferences) {
  store.current = next;
  for (const listener of store.listeners) listener();
}
export function subscribePreferences(listener: () => void) {
  store.listeners.add(listener);
  return () => { store.listeners.delete(listener); };
}
export function usePreferences() { return useSyncExternalStore(subscribePreferences, getPreferences, getPreferences); }
