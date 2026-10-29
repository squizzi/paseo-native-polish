export type FooterMotionFrame = Record<string, string | number>;

export const WORKED_FOOTER_ENTRANCE_DURATION_MS = 320;
export const USER_MESSAGE_AFTER_FOOTER_SLIDE_DELAY_MS = 140;
export const BOTTOM_SCROLL_EPSILON_PX = 8;

const WORKED_FOOTER_RISE_KEYFRAMES: FooterMotionFrame[] = [
  { opacity: 0, transform: "translateY(6px)" },
  { opacity: 1, transform: "translateY(0)" },
];

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
  completedFooterPending?: boolean;
  suppressHydrationMotion: boolean;
  isNew: boolean;
  hasEnteringUserMessage?: boolean;
}): boolean {
  if (
    !input.hasPreviousChatState ||
    (!input.liveTurn && !input.completedFooterPending) ||
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

export function isFollowingScrollBottom(input: {
  currentScrollTop: number;
  maxScrollTop: number;
  previousScrollTop?: number;
  previousCompensatedScrollTop?: number;
  previousMaxScrollTop?: number;
  userScrolledUp?: boolean;
  holdingPendingBottom?: boolean;
}): {
  atBottom: boolean;
  wasFollowing: boolean;
  userScrolledUp: boolean;
} {
  const hasPrevious =
    Number.isFinite(input.previousScrollTop) &&
    Number.isFinite(input.previousMaxScrollTop);
  const scrolledUpFromBottom =
    hasPrevious &&
    input.currentScrollTop < input.previousScrollTop! - 0.5 &&
    input.maxScrollTop - input.currentScrollTop > 1;
  const atExactBottom = input.maxScrollTop - input.currentScrollTop <= 1;
  const currentlyAtBottom =
    input.maxScrollTop - input.currentScrollTop <= BOTTOM_SCROLL_EPSILON_PX;
  const userScrolledUp = atExactBottom
    ? false
    : scrolledUpFromBottom || Boolean(input.userScrolledUp);
  const previousScrollAtBottom =
    hasPrevious &&
    input.previousMaxScrollTop! - input.previousScrollTop! <= BOTTOM_SCROLL_EPSILON_PX &&
    input.currentScrollTop >= input.previousScrollTop! - 0.5;
  const previousPendingAtBottom =
    hasPrevious &&
    Boolean(input.holdingPendingBottom) &&
    Number.isFinite(input.previousCompensatedScrollTop) &&
    input.previousMaxScrollTop! - input.previousCompensatedScrollTop! <= BOTTOM_SCROLL_EPSILON_PX &&
    input.currentScrollTop >= input.previousScrollTop! - 0.5;
  const wasFollowing =
    hasPrevious &&
    !userScrolledUp &&
    (currentlyAtBottom || previousScrollAtBottom || previousPendingAtBottom);
  const atBottom = !userScrolledUp && (currentlyAtBottom || wasFollowing);
  return {
    atBottom,
    wasFollowing,
    userScrolledUp,
  };
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
  const scrolledUp =
    input.currentScrollTop < input.previousScrollTop - 0.5 &&
    input.maxScrollTop - input.currentScrollTop > 1;
  const previouslyAtBottom =
    input.previousMaxScrollTop - input.previousScrollTop <= BOTTOM_SCROLL_EPSILON_PX ||
    effectivePreviousMaxScrollTop - input.previousScrollTop <= BOTTOM_SCROLL_EPSILON_PX ||
    effectivePreviousMaxScrollTop - effectivePreviousCompensatedScrollTop <= BOTTOM_SCROLL_EPSILON_PX;
  const canFollow = input.wasFollowing && !scrolledUp && previouslyAtBottom;
  const heightGrewBeforeScroll =
    canFollow &&
    input.maxScrollTop > effectivePreviousMaxScrollTop + 0.5 &&
    input.currentScrollTop <=
      Math.max(input.previousCompensatedScrollTop, effectivePreviousCompensatedScrollTop) + 0.5 &&
    input.currentScrollTop < input.maxScrollTop - 0.5;
  const holdingPendingBottom =
    canFollow &&
    effectivePreviousMaxScrollTop - effectivePreviousCompensatedScrollTop <= BOTTOM_SCROLL_EPSILON_PX &&
    effectivePreviousCompensatedScrollTop > input.currentScrollTop + 0.5 &&
    input.currentScrollTop >= input.previousScrollTop - 0.5 &&
    input.maxScrollTop >= effectivePreviousCompensatedScrollTop - 0.5;
  const anticipatesBottom = heightGrewBeforeScroll || holdingPendingBottom;
  const compensatedScrollTop = anticipatesBottom ? input.maxScrollTop : input.currentScrollTop;
  const scrollBaseline = anticipatesBottom
    ? Math.max(effectivePreviousMaxScrollTop, effectivePreviousCompensatedScrollTop)
    : effectivePreviousCompensatedScrollTop;
  return {
    anticipatesBottom,
    compensatedScrollTop,
    scrollDistance: canFollow ? Math.max(0, compensatedScrollTop - scrollBaseline) : 0,
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
    textKeyframes: WORKED_FOOTER_RISE_KEYFRAMES,
    chromeKeyframes: WORKED_FOOTER_RISE_KEYFRAMES,
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
