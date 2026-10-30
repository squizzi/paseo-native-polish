export interface MessageEntryContext {
  hasPreviousChatState: boolean;
  wasRunning: boolean;
  running: boolean;
  isUserMessage: boolean;
  suppressHydrationMotion: boolean;
  isNew: boolean;
  allow: boolean;
  atBottom: boolean;
  quiet: boolean;
}

export interface MessageEntranceMotion {
  styles: Record<string, string> | null;
  keyframes: Array<Record<string, string | number>>;
}

const RISE_KEYFRAMES: Array<Record<string, string | number>> = [
  { opacity: 0, transform: "translateY(6px)" },
  { opacity: 1, transform: "translateY(0)" },
];

const BUBBLE_KEYFRAMES: Array<Record<string, string | number>> = [
  { opacity: 0, transform: "translateY(6px) scale(.98)" },
  { opacity: 1, transform: "translateY(0) scale(1)" },
];

export function messageEntranceMotion(isUserMessage: boolean): MessageEntranceMotion {
  if (!isUserMessage) return { styles: null, keyframes: RISE_KEYFRAMES };
  return {
    styles: { "transform-origin": "100% 0%" },
    keyframes: BUBBLE_KEYFRAMES,
  };
}

export function shouldQueueMessageEntrance(context: MessageEntryContext): boolean {
  // Row insertion and the Working indicator can commit in either order.
  // A local user row is itself a live-turn signal; other row kinds retain the
  // Working gate so delayed history population cannot masquerade as output.
  const liveTurn = context.running || context.wasRunning || context.isUserMessage;
  const regularEntry = context.hasPreviousChatState
    && liveTurn
    && !context.suppressHydrationMotion
    && context.isNew;
  return context.allow && regularEntry && context.atBottom && !context.quiet;
}
