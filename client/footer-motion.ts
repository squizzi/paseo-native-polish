export type FooterMotionFrame = Record<string, string | number>;

export const WORKED_FOOTER_ENTRANCE_DURATION_MS = 320;
export const WORKED_FOOTER_TEXT_BLUR_PX = 4;
export const USER_MESSAGE_AFTER_FOOTER_SLIDE_DELAY_MS = 140;

export interface WorkedFooterEntranceMotion {
  durationMs: number;
  textKeyframes: FooterMotionFrame[];
  chromeKeyframes: FooterMotionFrame[];
  rowStyles: Record<string, string> | null;
  rowKeyframes: FooterMotionFrame[] | null;
}

export function shouldAnimateFooterRise(
  previousFooter: object | null,
  currentFooter: object | null,
  allowReplacedOnUserMessage = false,
): boolean {
  if (previousFooter === null || currentFooter === null) return false;
  return previousFooter === currentFooter || allowReplacedOnUserMessage;
}

export function resolveUserMessageEntranceDelayMs(input: {
  isUserMessage: boolean;
  footerSlideDownPx: number;
}): number {
  if (!input.isUserMessage) return 0;
  if (!Number.isFinite(input.footerSlideDownPx) || input.footerSlideDownPx <= 1) return 0;
  return USER_MESSAGE_AFTER_FOOTER_SLIDE_DELAY_MS;
}

export function shouldQueueWorkedFooterEntrance(input: {
  hasPreviousChatState: boolean;
  liveTurn: boolean;
  suppressHydrationMotion: boolean;
  isNew: boolean;
  hasEnteringUserMessage?: boolean;
}): boolean {
  if (
    !input.hasPreviousChatState ||
    !input.liveTurn ||
    input.suppressHydrationMotion ||
    input.hasEnteringUserMessage ||
    !input.isNew
  ) {
    return false;
  }
  return true;
}

export function shouldExpandWorkedFooterLayout(input: {
  hasFollowingContent: boolean;
  isTurnCompletionFooter: boolean;
  suppressHandoffMotion: boolean;
}): boolean {
  return (
    input.hasFollowingContent &&
    !input.isTurnCompletionFooter &&
    !input.suppressHandoffMotion
  );
}

export function resolveFollowOutputScroll(input: {
  wasFollowing: boolean;
  currentScrollTop: number;
  maxScrollTop: number;
  previousScrollTop: number;
  previousCompensatedScrollTop: number;
  previousMaxScrollTop: number;
  currentScrollHeight?: number;
  previousScrollHeight?: number;
  currentClientHeight?: number;
  previousClientHeight?: number;
}): {
  anticipatesBottom: boolean;
  compensatedScrollTop: number;
  scrollDistance: number;
  viewportHeightChangedOnly: boolean;
} {
  const hasHeightMetrics =
    Number.isFinite(input.currentScrollHeight) &&
    Number.isFinite(input.previousScrollHeight) &&
    Number.isFinite(input.currentClientHeight) &&
    Number.isFinite(input.previousClientHeight);
  const scrollHeightDelta = hasHeightMetrics
    ? input.currentScrollHeight! - input.previousScrollHeight!
    : null;
  const clientHeightDelta = hasHeightMetrics
    ? input.currentClientHeight! - input.previousClientHeight!
    : null;
  const viewportHeightChangedOnly =
    scrollHeightDelta !== null &&
    clientHeightDelta !== null &&
    Math.abs(clientHeightDelta) > 0.5 &&
    Math.abs(scrollHeightDelta) <= 0.5;
  if (viewportHeightChangedOnly) {
    return {
      anticipatesBottom: false,
      compensatedScrollTop: input.currentScrollTop,
      scrollDistance: 0,
      viewportHeightChangedOnly: true,
    };
  }
  const viewportAdjust =
    scrollHeightDelta !== null &&
    clientHeightDelta !== null &&
    Math.abs(clientHeightDelta) > 0.5 &&
    scrollHeightDelta > 0.5
      ? clientHeightDelta
      : 0;
  const effectivePreviousMaxScrollTop = Math.max(0, input.previousMaxScrollTop - viewportAdjust);
  const effectivePreviousCompensatedScrollTop = Math.max(
    0,
    Math.min(effectivePreviousMaxScrollTop, input.previousCompensatedScrollTop - viewportAdjust),
  );
  const heightGrewBeforeScroll =
    input.maxScrollTop > effectivePreviousMaxScrollTop + 0.5 &&
    input.currentScrollTop <=
      Math.max(input.previousCompensatedScrollTop, effectivePreviousCompensatedScrollTop) + 0.5 &&
    input.currentScrollTop < input.maxScrollTop - 0.5;
  const holdingPendingBottom =
    effectivePreviousCompensatedScrollTop > input.currentScrollTop + 0.5 &&
    input.currentScrollTop >= input.previousScrollTop - 0.5 &&
    input.maxScrollTop >= effectivePreviousCompensatedScrollTop - 0.5;
  const anticipatesBottom = input.wasFollowing && (heightGrewBeforeScroll || holdingPendingBottom);
  const compensatedScrollTop = anticipatesBottom ? input.maxScrollTop : input.currentScrollTop;
  const scrollBaseline = anticipatesBottom
    ? Math.max(effectivePreviousMaxScrollTop, effectivePreviousCompensatedScrollTop)
    : effectivePreviousCompensatedScrollTop;
  return {
    anticipatesBottom,
    compensatedScrollTop,
    scrollDistance: input.wasFollowing ? Math.max(0, compensatedScrollTop - scrollBaseline) : 0,
    viewportHeightChangedOnly: false,
  };
}

export function workedFooterEntranceMotion(input: {
  height: number;
  marginTop?: number;
  paddingBottom?: number;
  expandLayout?: boolean;
}): WorkedFooterEntranceMotion {
  const height = Number.isFinite(input.height) ? Math.max(0, Math.round(input.height)) : 0;
  const marginTop = Number.isFinite(input.marginTop) ? Math.max(0, Math.round(input.marginTop!)) : 0;
  const paddingBottom = Number.isFinite(input.paddingBottom)
    ? Math.max(0, Math.round(input.paddingBottom!))
    : 0;
  const shouldExpand = (input.expandLayout ?? true) && height > 1;
  return {
    durationMs: WORKED_FOOTER_ENTRANCE_DURATION_MS,
    textKeyframes: [
      { opacity: 0, filter: `blur(${WORKED_FOOTER_TEXT_BLUR_PX}px)`, transform: "translateY(4px)" },
      { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
    ],
    chromeKeyframes: [
      { opacity: 0, transform: "translateY(4px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    rowStyles: shouldExpand
      ? {
          overflow: "hidden",
          "box-sizing": "border-box",
          "min-height": "0",
        }
      : null,
    rowKeyframes: shouldExpand
      ? [
          { height: "0px", marginTop: "0px", paddingBottom: "0px" },
          {
            height: `${height}px`,
            marginTop: `${marginTop}px`,
            paddingBottom: `${paddingBottom}px`,
          },
        ]
      : null,
  };
}
