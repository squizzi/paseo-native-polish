export interface StreamingRowHeightTransition {
  previousHeight: number;
  nextHeight: number;
  sameRow: boolean;
  previouslyVisible: boolean;
  visible: boolean;
  rehydrating: boolean;
}

export const STREAM_REHYDRATION_SETTLE_MS = 180;

export function isStreamingRehydrating(
  justAppeared: boolean,
  rehydratingUntil: number,
  now: number,
): boolean {
  return justAppeared || rehydratingUntil > now;
}

export function isInitialTurnSettling(
  turnJustStarted: boolean,
  turnStartUntil: number,
  now: number,
): boolean {
  return turnJustStarted || turnStartUntil > now;
}

export function shouldSuppressRehydratedStreamEntrance(
  rehydrating: boolean,
  hasLiveStreamingRow: boolean,
): boolean {
  return rehydrating && hasLiveStreamingRow;
}

export function shouldCrossfadeMarkdownHandoff(
  hasStreamingSnapshot: boolean,
  nativeRowVisible: boolean,
): boolean {
  return hasStreamingSnapshot && nativeRowVisible;
}

export function shouldSuppressTransientBottomFollow(
  rehydrating: boolean,
  initialTurnSettling: boolean,
  rendererHandoff: boolean,
): boolean {
  return rehydrating || initialTurnSettling || rendererHandoff;
}

/**
 * A paced renderer already turns a provider-sized delta into small text
 * commits. Fading the entire row on a large measured resize makes long
 * Markdown visibly blink whenever a paragraph or fenced block wraps. Keep the
 * host geometry live and let the bottom-rise own only scroll compensation.
 */
export function shouldFlipStreamingRowHeight({
  previousHeight,
  nextHeight,
  sameRow,
  previouslyVisible,
  visible,
  rehydrating,
}: StreamingRowHeightTransition): boolean {
  void previousHeight;
  void nextHeight;
  void sameRow;
  void previouslyVisible;
  void visible;
  void rehydrating;
  return false;
}
