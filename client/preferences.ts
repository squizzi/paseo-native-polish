import { useSyncExternalStore } from "react";
export interface Preferences {
  enabled: boolean; sidebars: boolean; trees: boolean; timeline: boolean; panes: boolean;
  tabs: boolean; overlays: boolean; controls: boolean; states: boolean; messages: boolean; elasticScroll: boolean; edgePeek: boolean;
  pace: "gentle" | "quick"; edgePeekSensitivity: EdgePeekSensitivity;
}
export type EdgePeekSensitivity = "low" | "normal" | "high";
// Width in px of the window-edge strip that opens a hidden sidebar preview.
export const edgePeekWidths: Record<EdgePeekSensitivity, number> = { low: 4, normal: 7, high: 14 };
export const defaults: Preferences = { enabled: true, sidebars: true, trees: true, timeline: true, panes: true, tabs: true, overlays: true, controls: true, states: true, messages: true, elasticScroll: true, edgePeek: true, pace: "gentle", edgePeekSensitivity: "normal" };
// Settings from every connected host control the single window motion owner.
const scope = globalThis as typeof globalThis & { __paseoNativePolishPreferences?: { current: Preferences; listeners: Set<() => void> } };
const store = scope.__paseoNativePolishPreferences ??= { current: defaults, listeners: new Set() };
// The store outlives plugin reloads; fill keys added since it was created.
store.current = { ...defaults, ...store.current };
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
