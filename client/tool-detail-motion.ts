export type ToolDetailTextFrame = Record<string, string | number>;

export const TOOL_DETAIL_TEXT_FADE_DURATION_MS = 400;
export const TOOL_DETAIL_TEXT_BLUR_PX = 2;

export interface ToolDetailTextTransition {
  stableText: string;
  enteringText: string;
  enteringStart: number;
  enteringEnd: number;
  durationMs: number;
  cover: ToolDetailTextFrame[];
  backdrop: ToolDetailTextFrame[];
}

export interface ToolDetailHeightTransition {
  fromHeight: number;
  toHeight: number;
  keyframes: ToolDetailTextFrame[];
  styles: Record<string, string>;
}

export const TOOL_SHIMMER_PEAK_WIDTH_PX = 80;
export const TOOL_SHIMMER_TRACK_START_PX = -TOOL_SHIMMER_PEAK_WIDTH_PX;
export const TOOL_SHIMMER_TRACK_END_PX = 440;
export const TOOL_SHIMMER_DURATION_MS = 1750;

export interface ToolDetailShimmerState {
  delayMs: number;
  offsetX: number;
  startPx: number;
  endPx: number;
  durationMs: number;
  peakWidthPx: number;
}

export function toolDetailShimmerStyle(input: {
  offsetX: number;
  now: number;
  trackEndPx?: number;
  previous?: ToolDetailShimmerState;
}): ToolDetailShimmerState {
  const rawOffset = Number.isFinite(input.offsetX) ? Math.max(0, input.offsetX) : 0;
  const offsetX =
    input.previous && Math.abs(rawOffset - input.previous.offsetX) < 1
      ? input.previous.offsetX
      : Math.round(rawOffset);
  const previousTrackEnd = input.previous
    ? input.previous.endPx + input.previous.offsetX
    : undefined;
  const measuredTrackEnd = input.trackEndPx;
  const rawTrackEnd =
    typeof measuredTrackEnd === "number" && Number.isFinite(measuredTrackEnd)
      ? Math.max(TOOL_SHIMMER_TRACK_END_PX, measuredTrackEnd)
      : TOOL_SHIMMER_TRACK_END_PX;
  const roundedTrackEnd = Math.round(rawTrackEnd);
  const trackEndPx =
    previousTrackEnd === undefined
      ? roundedTrackEnd
      : Math.abs(roundedTrackEnd - previousTrackEnd) < 1
        ? previousTrackEnd
        : Math.max(previousTrackEnd, roundedTrackEnd);
  const phaseMs =
    ((Math.round(input.now) % TOOL_SHIMMER_DURATION_MS) + TOOL_SHIMMER_DURATION_MS) %
    TOOL_SHIMMER_DURATION_MS;
  const delayMs = input.previous ? input.previous.delayMs : phaseMs === 0 ? 0 : -phaseMs;
  return {
    delayMs,
    offsetX,
    startPx: TOOL_SHIMMER_TRACK_START_PX - offsetX,
    endPx: trackEndPx - offsetX,
    durationMs: TOOL_SHIMMER_DURATION_MS,
    peakWidthPx: TOOL_SHIMMER_PEAK_WIDTH_PX,
  };
}

export const TOOL_LABEL_UPDATE_DURATION_MS = 150;
export const TOOL_LABEL_UPDATE_FRAMES: ToolDetailTextFrame[] = [
  { opacity: 0, transform: "translateY(4px)" },
  { opacity: 1, transform: "translateY(0)" },
];
export const TOOL_LABEL_SHIMMER_UPDATE_FRAMES: ToolDetailTextFrame[] = [
  { transform: "translateY(4px)" },
  { transform: "translateY(0)" },
];

export interface ToolLabelState {
  primary: string;
  secondary: string;
}

export interface ToolLabelUpdatePlan {
  animatePrimary: boolean;
  animateSecondary: boolean;
  frames: ToolDetailTextFrame[];
  shimmerFrames: ToolDetailTextFrame[];
  durationMs: number;
}

export function toolLabelUpdateTransition(
  previous: ToolLabelState | undefined,
  current: ToolLabelState,
): ToolLabelUpdatePlan | null {
  if (!previous) return null;
  const animatePrimary = Boolean(current.primary && current.primary !== previous.primary);
  const animateSecondary = Boolean(current.secondary && current.secondary !== previous.secondary);
  if (!animatePrimary && !animateSecondary) return null;
  return {
    animatePrimary,
    animateSecondary,
    frames: TOOL_LABEL_UPDATE_FRAMES,
    shimmerFrames: TOOL_LABEL_SHIMMER_UPDATE_FRAMES,
    durationMs: TOOL_LABEL_UPDATE_DURATION_MS,
  };
}

export function shouldKeepToolShimmerActive(input: {
  hasHostShimmer: boolean;
  hasPlaceholder: boolean;
  isToolGroup: boolean;
  isTopLevelTool: boolean;
  isTurnRunning: boolean;
  isLastTimelineItem: boolean;
}): boolean {
  if (input.hasHostShimmer || input.hasPlaceholder) return true;
  return (
    input.isToolGroup &&
    input.isTopLevelTool &&
    input.isTurnRunning &&
    input.isLastTimelineItem
  );
}

export function findEnteringToolGroupItems<T>(
  previous: ReadonlySet<T> | undefined,
  current: readonly T[],
): T[] {
  if (!previous) return [];
  return current.filter((item) => !previous.has(item));
}

function findClosedLinkLabelEnd(source: string, openBracketIndex: number): number {
  let depth = 0;
  for (let index = openBracketIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "`") {
      let tickEnd = index + 1;
      while (tickEnd < source.length && source[tickEnd] === "`") tickEnd += 1;
      const tickRun = source.slice(index, tickEnd);
      const closeTick = source.indexOf(tickRun, tickEnd);
      if (closeTick === -1) return -1;
      index = closeTick + tickRun.length - 1;
      continue;
    }
    if (char === "[") {
      depth += 1;
    } else if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    } else if (char === "\n" && source[index + 1] === "\n") {
      return -1;
    }
  }
  return -1;
}

function hasClosedLinkDestination(source: string, openParenIndex: number): boolean {
  let depth = 0;
  let quote = "";
  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
    } else if (quote) {
      if (char === quote) quote = "";
    } else if (char === "<") {
      quote = ">";
    } else if ((char === '"' || char === "'") && /\s/.test(source[index - 1] ?? "")) {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) return true;
    } else if (char === "\n") {
      return false;
    }
  }
  return false;
}

function findUnfinalizedInlineCodeStart(source: string, scanStart: number): number {
  let index = scanStart;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "`") {
      let runEnd = index + 1;
      while (runEnd < source.length && source[runEnd] === "`") runEnd += 1;
      const runLength = runEnd - index;
      let search = runEnd;
      let closed = false;
      while (search < source.length) {
        if (source[search] === "\\") {
          search += 2;
          continue;
        }
        if (source[search] === "`") {
          let closeEnd = search + 1;
          while (closeEnd < source.length && source[closeEnd] === "`") closeEnd += 1;
          if (closeEnd - search === runLength) {
            closed = true;
            index = closeEnd;
            break;
          }
          search = closeEnd;
          continue;
        }
        search += 1;
      }
      if (!closed) return index;
      continue;
    }
    index += 1;
  }
  return -1;
}

function findUnfinalizedLinkStart(source: string, scanStart: number): number {
  for (let index = scanStart; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === "`") {
      let runEnd = index + 1;
      while (runEnd < source.length && source[runEnd] === "`") runEnd += 1;
      const run = source.slice(index, runEnd);
      const closeIndex = source.indexOf(run, runEnd);
      if (closeIndex === -1) break;
      index = closeIndex + run.length - 1;
      continue;
    }
    if (source[index] !== "[") continue;

    const hasBangPrefix = index > scanStart && source[index - 1] === "!";
    const prefixEnd = hasBangPrefix ? index - 1 : index;
    const prefixSlice = source.slice(scanStart, prefixEnd);
    const filePrefixMatch = prefixSlice.match(/(?:^|(?<=[\s([{"']))file:$/i);
    const tokenStart = filePrefixMatch ? prefixEnd - filePrefixMatch[0].length : prefixEnd;

    const labelEnd = findClosedLinkLabelEnd(source, index);
    if (labelEnd === -1) {
      const openLabel = source.slice(index + 1);
      if (/^\d+$/.test(openLabel) && !filePrefixMatch && !hasBangPrefix) {
        continue;
      }
      return tokenStart;
    }

    const labelContent = source.slice(index + 1, labelEnd);
    const nextChar = source[labelEnd + 1];
    if (nextChar === "(") {
      if (!hasClosedLinkDestination(source, labelEnd + 1)) {
        return tokenStart;
      }
      continue;
    }
    if (nextChar === "[") {
      const refEnd = findClosedLinkLabelEnd(source, labelEnd + 1);
      if (refEnd === -1) return tokenStart;
      continue;
    }
    if (labelEnd === source.length - 1) {
      // A closed `[label]` at the very end of the stream may be waiting on
      // `(file:///...)` in the next delta. Hold it unless it is a plain numeric
      // index like `items[0]` with no `file:` or `!` prefix.
      const precededByIdentifier =
        !filePrefixMatch &&
        !hasBangPrefix &&
        tokenStart > scanStart &&
        /[A-Za-z0-9_)\]]/.test(source[tokenStart - 1] ?? "");
      if (!precededByIdentifier && (!/^\d+$/.test(labelContent) || Boolean(filePrefixMatch) || hasBangPrefix)) {
        return tokenStart;
      }
    }
  }
  return -1;
}

/**
 * Withholds trailing markdown tokens (such as `[filename](file:///...)`,
 * `file:[filename]`, inline-code file references, or opening emphasis markers)
 * until their closing syntax has arrived, preventing raw link metadata from
 * flashing in the stream before Paseo's `Markdown` component finalizes the node.
 */
export function finalizeStreamingMarkdown(text: string): string {
  if (!text) return text;

  const lines = text.split("\n");
  let openFenceMarker: string | null = null;
  let lastFenceCloseOffset = 0;
  let offset = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const isLastLine = lineIndex === lines.length - 1;
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!openFenceMarker) {
      if (fenceMatch) {
        const marker = fenceMatch[1] ?? "";
        const info = fenceMatch[2] ?? "";
        if (!(marker.startsWith("`") && info.includes("`"))) {
          if (isLastLine) {
            return text.slice(0, offset);
          }
          openFenceMarker = marker;
        }
      }
    } else if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      const rest = fenceMatch[2] ?? "";
      if (marker[0] === openFenceMarker[0] && marker.length >= openFenceMarker.length && /^\s*$/.test(rest)) {
        openFenceMarker = null;
        lastFenceCloseOffset = offset + line.length + (isLastLine ? 0 : 1);
      }
    }
    offset += line.length + (isLastLine ? 0 : 1);
  }

  if (openFenceMarker) {
    return text;
  }

  const lastParagraphBreak = text.lastIndexOf("\n\n");
  const blockStart = Math.max(
    lastFenceCloseOffset,
    lastParagraphBreak === -1 ? 0 : lastParagraphBreak + 2,
  );
  const lastNewline = text.lastIndexOf("\n");
  const lineStart = Math.max(blockStart, lastNewline === -1 ? 0 : lastNewline + 1);

  if (/^ {0,3}#{1,6}$/.test(text.slice(lineStart))) {
    return text.slice(0, lineStart);
  }

  let cutIndex = text.length;

  const unfinalizedLinkStart = findUnfinalizedLinkStart(text, blockStart);
  if (unfinalizedLinkStart !== -1 && unfinalizedLinkStart < cutIndex) {
    cutIndex = unfinalizedLinkStart;
  }

  const unfinalizedCodeStart = findUnfinalizedInlineCodeStart(text, blockStart);
  if (unfinalizedCodeStart !== -1 && unfinalizedCodeStart < cutIndex) {
    cutIndex = unfinalizedCodeStart;
  }

  const tailAfterLineStart = text.slice(lineStart, cutIndex);
  const unclosedAutolinkMatch = tailAfterLineStart.match(/<(?:file:|https?:\/\/)[^>\s]*$/i);
  if (unclosedAutolinkMatch && unclosedAutolinkMatch.index !== undefined) {
    cutIndex = Math.min(cutIndex, lineStart + unclosedAutolinkMatch.index);
  }

  const tailUpToCut = text.slice(lineStart, cutIndex);
  const bareFileMetadataMatch = tailUpToCut.match(/(?:^|(?<=[\s([{"']))file:[^\s)\]}"']*$/i);
  if (bareFileMetadataMatch && bareFileMetadataMatch.index !== undefined) {
    cutIndex = Math.min(cutIndex, lineStart + bareFileMetadataMatch.index);
  }

  let result = text.slice(0, cutIndex);

  const trailingMarkerMatch = result.slice(lineStart).match(/(?<![\\*_~|])(\*{1,3}|_{1,3}|~{1,2}|\|\|)$/);
  if (trailingMarkerMatch) {
    const marker = trailingMarkerMatch[1] ?? "";
    const beforeMarker = result.slice(blockStart, result.length - marker.length);
    const markerCount = beforeMarker.split(marker).length - 1;
    if (markerCount % 2 === 0) {
      result = result.slice(0, result.length - marker.length);
    }
  }

  return result;
}

export function toolDetailTextTransition(previous: string | undefined, current: string): ToolDetailTextTransition | null {
  if (previous === undefined || !current || previous === current) return null;
  let stablePrefix = previous;
  if (!current.startsWith(stablePrefix)) {
    const finalizedPrevious = finalizeStreamingMarkdown(previous);
    if (finalizedPrevious.length < previous.length && current.startsWith(finalizedPrevious)) {
      stablePrefix = finalizedPrevious;
    } else {
      return null;
    }
  }
  const blurStart = `blur(${TOOL_DETAIL_TEXT_BLUR_PX}px)`;
  const blurEnd = "blur(0px)";
  return {
    stableText: stablePrefix,
    enteringText: current.slice(stablePrefix.length),
    enteringStart: stablePrefix.length,
    enteringEnd: current.length,
    durationMs: TOOL_DETAIL_TEXT_FADE_DURATION_MS,
    // A background-coloured cover fades away from only the appended glyph
    // range while a paired backdrop-blur layer softens the newly revealed
    // glyphs underneath. The live text remains a single paint owner, avoiding
    // both the whole-panel flash and the doubled text produced by a cloned snapshot.
    cover: [
      { opacity: 1, filter: blurStart },
      { opacity: 0, filter: blurEnd },
    ],
    backdrop: [
      { backdropFilter: blurStart, WebkitBackdropFilter: blurStart },
      { backdropFilter: blurEnd, WebkitBackdropFilter: blurEnd },
    ],
  };
}

export function toolDetailHeightTransition(input: {
  previousHeight: number | null | undefined;
  currentHeight: number;
  inFlightHeight?: number | null;
}): ToolDetailHeightTransition | null {
  const { previousHeight, currentHeight, inFlightHeight } = input;
  if (
    previousHeight === null ||
    previousHeight === undefined ||
    !Number.isFinite(previousHeight) ||
    !Number.isFinite(currentHeight) ||
    previousHeight <= 0 ||
    currentHeight <= 0 ||
    Math.abs(currentHeight - previousHeight) < 2
  ) {
    return null;
  }
  const fromHeight =
    inFlightHeight !== null &&
    inFlightHeight !== undefined &&
    Number.isFinite(inFlightHeight) &&
    inFlightHeight > 0
      ? inFlightHeight
      : previousHeight;
  if (Math.abs(currentHeight - fromHeight) < 1) return null;
  return {
    fromHeight,
    toHeight: currentHeight,
    keyframes: [
      { height: `${Math.round(fromHeight)}px` },
      { height: `${Math.round(currentHeight)}px` },
    ],
    styles: {
      overflow: "hidden",
      "box-sizing": "border-box",
      "min-height": "0",
    },
  };
}
