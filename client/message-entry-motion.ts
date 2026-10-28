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
