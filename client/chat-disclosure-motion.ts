export interface ChatDisclosureMotionOptions {
  expanding: boolean;
  beforeHeight: number;
  currentHeight: number;
  beforeBubbleHeight?: number;
  currentBubbleHeight?: number;
  beforeToggleMarginTop?: number;
  currentToggleMarginTop?: number;
}

export interface ChatDisclosureMotionResult {
  styles: Record<string, string>;
  priority: string;
  keyframes: Record<string, string>[];
  bubbleStyles: Record<string, string>;
  bubbleKeyframes: Record<string, string>[] | null;
  toggleKeyframes: Record<string, string>[] | null;
}

export interface ResolveChatBubbleExpandedStateOptions {
  ariaExpanded?: string | null;
  previewMaxHeight?: string | null;
  previewChildCount?: number | null;
}

export interface ShouldAnimateChatDisclosureOptions {
  isBubble?: boolean;
  beforeExpanded?: boolean | null;
  currentExpanded?: boolean | null;
  beforeHeight: number;
  currentHeight: number;
}

export function resolveChatBubbleExpandedState(
  options: ResolveChatBubbleExpandedStateOptions,
): boolean | null {
  if (options.ariaExpanded === "true") return true;
  if (options.ariaExpanded === "false") return false;
  if (typeof options.previewChildCount === "number" && options.previewChildCount > 1) {
    return false;
  }
  const maxHeight = options.previewMaxHeight?.trim() ?? "";
  if (maxHeight && maxHeight !== "none" && maxHeight !== "0px") {
    const numeric = Number.parseFloat(maxHeight);
    if (Number.isFinite(numeric) && numeric > 0) return false;
  }
  if (options.previewChildCount === 1 || maxHeight === "none") return true;
  return null;
}

export function shouldAnimateChatDisclosure(options: ShouldAnimateChatDisclosureOptions): boolean {
  if (!options.isBubble) return false;
  if (options.beforeExpanded === null || options.beforeExpanded === undefined) return false;
  if (options.currentExpanded === null || options.currentExpanded === undefined) return false;
  if (options.beforeExpanded === options.currentExpanded) return false;
  return Math.abs(options.currentHeight - options.beforeHeight) >= 2;
}

export function chatDisclosureMotion(options: ChatDisclosureMotionOptions): ChatDisclosureMotionResult {
  const styles: Record<string, string> = {
    overflow: "hidden",
    "box-sizing": "border-box",
    "min-height": "0",
    "flex-shrink": "0",
  };
  if (!options.expanding) {
    styles["max-height"] = "none";
  }
  const bubbleStyles: Record<string, string> = {
    overflow: "hidden",
    "box-sizing": "border-box",
    "min-height": "0",
  };
  const bubbleKeyframes =
    typeof options.beforeBubbleHeight === "number" &&
    typeof options.currentBubbleHeight === "number" &&
    Math.abs(options.currentBubbleHeight - options.beforeBubbleHeight) >= 2
      ? [
          { height: `${options.beforeBubbleHeight}px` },
          { height: `${options.currentBubbleHeight}px` },
        ]
      : null;
  const toggleKeyframes =
    typeof options.beforeToggleMarginTop === "number" &&
    typeof options.currentToggleMarginTop === "number" &&
    Math.abs(options.currentToggleMarginTop - options.beforeToggleMarginTop) >= 0.5
      ? [
          { marginTop: `${options.beforeToggleMarginTop}px` },
          { marginTop: `${options.currentToggleMarginTop}px` },
        ]
      : null;
  return {
    styles,
    priority: options.expanding ? "" : "important",
    keyframes: [
      { height: `${options.beforeHeight}px` },
      { height: `${options.currentHeight}px` },
    ],
    bubbleStyles,
    bubbleKeyframes,
    toggleKeyframes,
  };
}
