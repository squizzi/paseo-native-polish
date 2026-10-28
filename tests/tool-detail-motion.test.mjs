import assert from "node:assert/strict";
import test from "node:test";
import {
  TOOL_DETAIL_TEXT_BLUR_PX,
  TOOL_DETAIL_TEXT_FADE_DURATION_MS,
  TOOL_LABEL_SHIMMER_UPDATE_FRAMES,
  TOOL_LABEL_UPDATE_DURATION_MS,
  TOOL_LABEL_UPDATE_FRAMES,
  TOOL_SHIMMER_DURATION_MS,
  TOOL_SHIMMER_PEAK_WIDTH_PX,
  TOOL_SHIMMER_TRACK_END_PX,
  TOOL_SHIMMER_TRACK_START_PX,
  finalizeStreamingMarkdown,
  findEnteringToolGroupItems,
  shouldKeepToolShimmerActive,
  toolDetailHeightTransition,
  toolDetailShimmerStyle,
  toolDetailTextTransition,
  toolLabelUpdateTransition,
} from "../client/tool-detail-motion.ts";

test("Thinking keeps its existing text stable while the appended suffix fades and unblurs in", () => {
  const transition = toolDetailTextTransition("Considering", "Considering the request");
  assert.deepEqual(transition, {
    stableText: "Considering",
    enteringText: " the request",
    enteringStart: "Considering".length,
    enteringEnd: "Considering the request".length,
    durationMs: TOOL_DETAIL_TEXT_FADE_DURATION_MS,
    cover: [
      { opacity: 1, filter: `blur(${TOOL_DETAIL_TEXT_BLUR_PX}px)` },
      { opacity: 0, filter: "blur(0px)" },
    ],
    backdrop: [
      { backdropFilter: `blur(${TOOL_DETAIL_TEXT_BLUR_PX}px)`, WebkitBackdropFilter: `blur(${TOOL_DETAIL_TEXT_BLUR_PX}px)` },
      { backdropFilter: "blur(0px)", WebkitBackdropFilter: "blur(0px)" },
    ],
  });
});

test("Thinking animates the first chunk when transitioning from an empty loading state", () => {
  const transition = toolDetailTextTransition("", "Considering");
  assert.deepEqual(transition, {
    stableText: "",
    enteringText: "Considering",
    enteringStart: 0,
    enteringEnd: "Considering".length,
    durationMs: TOOL_DETAIL_TEXT_FADE_DURATION_MS,
    cover: [
      { opacity: 1, filter: `blur(${TOOL_DETAIL_TEXT_BLUR_PX}px)` },
      { opacity: 0, filter: "blur(0px)" },
    ],
    backdrop: [
      { backdropFilter: `blur(${TOOL_DETAIL_TEXT_BLUR_PX}px)`, WebkitBackdropFilter: `blur(${TOOL_DETAIL_TEXT_BLUR_PX}px)` },
      { backdropFilter: "blur(0px)", WebkitBackdropFilter: "blur(0px)" },
    ],
  });
});

test("Thinking does not replay streaming motion for uninitialized, unchanged, or replaced text", () => {
  assert.equal(toolDetailTextTransition(undefined, "Considering"), null);
  assert.equal(toolDetailTextTransition("", ""), null);
  assert.equal(toolDetailTextTransition("Considering", "Considering"), null);
  assert.equal(toolDetailTextTransition("Considering", "Done"), null);
});

test("Thinking block height growth animates smoothly and retargets from in-flight height", () => {
  assert.equal(toolDetailHeightTransition({ previousHeight: null, currentHeight: 48 }), null);
  assert.equal(toolDetailHeightTransition({ previousHeight: 48, currentHeight: 48.8 }), null);

  const lineGrowth = toolDetailHeightTransition({ previousHeight: 48, currentHeight: 70 });
  assert.deepEqual(lineGrowth, {
    fromHeight: 48,
    toHeight: 70,
    keyframes: [{ height: "48px" }, { height: "70px" }],
    styles: {
      overflow: "hidden",
      "box-sizing": "border-box",
      "min-height": "0",
    },
  });

  const retargetedGrowth = toolDetailHeightTransition({
    previousHeight: 70,
    currentHeight: 92,
    inFlightHeight: 59.4,
  });
  assert.deepEqual(retargetedGrowth, {
    fromHeight: 59.4,
    toHeight: 92,
    keyframes: [{ height: "59px" }, { height: "92px" }],
    styles: {
      overflow: "hidden",
      "box-sizing": "border-box",
      "min-height": "0",
    },
  });
});

test("Tool detail shimmer keeps a constant sweep track and locks its initial delay across summary updates", () => {
  const initial = toolDetailShimmerStyle({ offsetX: 0, now: 420 });
  assert.deepEqual(initial, {
    delayMs: -420,
    offsetX: 0,
    startPx: TOOL_SHIMMER_TRACK_START_PX,
    endPx: TOOL_SHIMMER_TRACK_END_PX,
    durationMs: TOOL_SHIMMER_DURATION_MS,
    peakWidthPx: TOOL_SHIMMER_PEAK_WIDTH_PX,
  });

  const updated = toolDetailShimmerStyle({ offsetX: 0, now: 1180, previous: initial });
  assert.deepEqual(updated, initial);
});

test("Tool detail shimmer extends its sweep track to cover long label lines", () => {
  const wide = toolDetailShimmerStyle({ offsetX: 0, now: 0, trackEndPx: 812 });
  assert.deepEqual(wide, {
    delayMs: 0,
    offsetX: 0,
    startPx: TOOL_SHIMMER_TRACK_START_PX,
    endPx: 812,
    durationMs: TOOL_SHIMMER_DURATION_MS,
    peakWidthPx: TOOL_SHIMMER_PEAK_WIDTH_PX,
  });

  const secondary = toolDetailShimmerStyle({ offsetX: 140, now: 0, trackEndPx: 812 });
  assert.equal(secondary.startPx, TOOL_SHIMMER_TRACK_START_PX - 140);
  assert.equal(secondary.endPx, 812 - 140);

  // Shorter labels keep the existing default track so the sweep cadence does not speed up.
  const short = toolDetailShimmerStyle({ offsetX: 0, now: 0, trackEndPx: 200 });
  assert.equal(short.endPx, TOOL_SHIMMER_TRACK_END_PX);

  // Growing a long line extends the track without restarting the locked delay, and the
  // track never shrinks mid-sweep so later layout jitter cannot pull it back short.
  const initial = toolDetailShimmerStyle({ offsetX: 0, now: 420, trackEndPx: TOOL_SHIMMER_TRACK_END_PX });
  const grown = toolDetailShimmerStyle({
    offsetX: 0,
    now: 800,
    trackEndPx: 812,
    previous: initial,
  });
  assert.equal(grown.delayMs, initial.delayMs);
  assert.equal(grown.endPx, 812);

  const shrunk = toolDetailShimmerStyle({
    offsetX: 0,
    now: 900,
    trackEndPx: 500,
    previous: grown,
  });
  assert.equal(shrunk.delayMs, initial.delayMs);
  assert.equal(shrunk.endPx, 812);
});

test("Secondary and remounted tool detail shimmers join the active sweep phase and align their horizontal track", () => {
  const secondaryMount = toolDetailShimmerStyle({ offsetX: 112.2, now: TOOL_SHIMMER_DURATION_MS + 650 });
  assert.deepEqual(secondaryMount, {
    delayMs: -650,
    offsetX: 112,
    startPx: TOOL_SHIMMER_TRACK_START_PX - 112,
    endPx: TOOL_SHIMMER_TRACK_END_PX - 112,
    durationMs: TOOL_SHIMMER_DURATION_MS,
    peakWidthPx: TOOL_SHIMMER_PEAK_WIDTH_PX,
  });

  // Subpixel layout jitter does not rewrite the track, while a real primary-label
  // width change shifts only the track offset without resetting delayMs.
  const subpixelUpdate = toolDetailShimmerStyle({
    offsetX: 112.6,
    now: TOOL_SHIMMER_DURATION_MS + 900,
    previous: secondaryMount,
  });
  assert.deepEqual(subpixelUpdate, secondaryMount);

  const widenedPrimaryUpdate = toolDetailShimmerStyle({
    offsetX: 128,
    now: TOOL_SHIMMER_DURATION_MS + 900,
    previous: secondaryMount,
  });
  assert.deepEqual(widenedPrimaryUpdate, {
    ...secondaryMount,
    offsetX: 128,
    startPx: TOOL_SHIMMER_TRACK_START_PX - 128,
    endPx: TOOL_SHIMMER_TRACK_END_PX - 128,
  });
});

test("Tool labels and summaries fade up from the bottom when their text changes", () => {
  assert.equal(toolLabelUpdateTransition(undefined, { primary: "Ran 1 command", secondary: "" }), null);
  assert.equal(
    toolLabelUpdateTransition(
      { primary: "Ran 1 command", secondary: "npm test" },
      { primary: "Ran 1 command", secondary: "npm test" },
    ),
    null,
  );

  assert.deepEqual(
    toolLabelUpdateTransition(
      { primary: "Ran 1 command", secondary: "" },
      { primary: "Ran 2 commands", secondary: "" },
    ),
    {
      animatePrimary: true,
      animateSecondary: false,
      frames: TOOL_LABEL_UPDATE_FRAMES,
      shimmerFrames: TOOL_LABEL_SHIMMER_UPDATE_FRAMES,
      durationMs: TOOL_LABEL_UPDATE_DURATION_MS,
    },
  );

  assert.deepEqual(
    toolLabelUpdateTransition(
      { primary: "Running command", secondary: "npm test" },
      { primary: "Running command", secondary: "git status" },
    ),
    {
      animatePrimary: false,
      animateSecondary: true,
      frames: [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      shimmerFrames: [
        { transform: "translateY(4px)" },
        { transform: "translateY(0)" },
      ],
      durationMs: 150,
    },
  );
});

test("Tool details summary keeps glimmering until the active tail tool group finishes", () => {
  // Active host shimmer or summary placeholder always keeps the glimmer playing.
  assert.equal(
    shouldKeepToolShimmerActive({
      hasHostShimmer: true,
      hasPlaceholder: false,
      isToolGroup: false,
      isTopLevelTool: true,
      isTurnRunning: true,
      isLastTimelineItem: false,
    }),
    true,
  );
  assert.equal(
    shouldKeepToolShimmerActive({
      hasHostShimmer: false,
      hasPlaceholder: true,
      isToolGroup: false,
      isTopLevelTool: true,
      isTurnRunning: true,
      isLastTimelineItem: false,
    }),
    true,
  );

  // Between consecutive commands in an unsealed tail tool-call-group while the
  // turn is still running, the glimmer stays active even when host isLoading drops.
  assert.equal(
    shouldKeepToolShimmerActive({
      hasHostShimmer: false,
      hasPlaceholder: false,
      isToolGroup: true,
      isTopLevelTool: true,
      isTurnRunning: true,
      isLastTimelineItem: true,
    }),
    true,
  );

  // Once a non-tool item (thought/message) follows the group or the turn ends,
  // or for non-group badges (like a completed Thought badge), the glimmer stops.
  assert.equal(
    shouldKeepToolShimmerActive({
      hasHostShimmer: false,
      hasPlaceholder: false,
      isToolGroup: true,
      isTopLevelTool: true,
      isTurnRunning: true,
      isLastTimelineItem: false,
    }),
    false,
  );
  assert.equal(
    shouldKeepToolShimmerActive({
      hasHostShimmer: false,
      hasPlaceholder: false,
      isToolGroup: true,
      isTopLevelTool: true,
      isTurnRunning: false,
      isLastTimelineItem: true,
    }),
    false,
  );
  assert.equal(
    shouldKeepToolShimmerActive({
      hasHostShimmer: false,
      hasPlaceholder: false,
      isToolGroup: false,
      isTopLevelTool: true,
      isTurnRunning: true,
      isLastTimelineItem: true,
    }),
    false,
  );
});

test("Expanded tool details summary only eases in newly arrived lines after initial expansion", () => {
  const line1 = { id: "call-1" };
  const line2 = { id: "call-2" };
  const line3 = { id: "call-3" };

  // Initial expansion records existing lines without replaying individual line entrances.
  assert.deepEqual(findEnteringToolGroupItems(undefined, [line1, line2]), []);

  // Subsequent updates while expanded return only newly appended lines.
  const baseline = new Set([line1, line2]);
  assert.deepEqual(findEnteringToolGroupItems(baseline, [line1, line2]), []);
  assert.deepEqual(findEnteringToolGroupItems(baseline, [line1, line2, line3]), [line3]);
});

test("finalizeStreamingMarkdown withholds unfinalized file link metadata and inline tokens until closed", () => {
  // Incomplete markdown links and `file:` metadata are held back until finalized.
  assert.equal(finalizeStreamingMarkdown("Check [web.ts"), "Check ");
  assert.equal(finalizeStreamingMarkdown("Check [web.ts]"), "Check ");
  assert.equal(
    finalizeStreamingMarkdown("Check [web.ts](file:///Users/kysquizz/client/web.ts"),
    "Check ",
  );
  assert.equal(
    finalizeStreamingMarkdown("Check [web.ts](file:///Users/kysquizz/client/web.ts)"),
    "Check [web.ts](file:///Users/kysquizz/client/web.ts)",
  );

  // Links with inline code labels and line fragments wait for the closing `)`.
  assert.equal(
    finalizeStreamingMarkdown("See [`toolDetailTextTransition`](file:///repo/client/tool-detail-motion.ts#L126"),
    "See ",
  );
  assert.equal(
    finalizeStreamingMarkdown("See [`toolDetailTextTransition`](file:///repo/client/tool-detail-motion.ts#L126)"),
    "See [`toolDetailTextTransition`](file:///repo/client/tool-detail-motion.ts#L126)",
  );

  // Destinations containing balanced parentheses (e.g. Next.js/Expo route groups) wait for the outer `)`.
  assert.equal(
    finalizeStreamingMarkdown("Open [index.tsx](file:///repo/src/app/(tabs)/index.tsx"),
    "Open ",
  );
  assert.equal(
    finalizeStreamingMarkdown("Open [index.tsx](file:///repo/src/app/(tabs)/index.tsx)"),
    "Open [index.tsx](file:///repo/src/app/(tabs)/index.tsx)",
  );

  // `file:[filename]` and bare trailing `file:` metadata are held back until completed.
  assert.equal(finalizeStreamingMarkdown("Inspect file:[client/web.ts"), "Inspect ");
  assert.equal(finalizeStreamingMarkdown("Inspect file:[client/web.ts]"), "Inspect ");
  assert.equal(
    finalizeStreamingMarkdown("Inspect file:[client/web.ts](file:///repo/client/web.ts"),
    "Inspect ",
  );
  assert.equal(
    finalizeStreamingMarkdown("Inspect file:[client/web.ts] now"),
    "Inspect file:[client/web.ts] now",
  );
  assert.equal(finalizeStreamingMarkdown("Inspect file:client/web.ts"), "Inspect ");
  assert.equal(
    finalizeStreamingMarkdown("Inspect file:client/web.ts now"),
    "Inspect file:client/web.ts now",
  );

  // Incomplete inline code spans and autolinks are held back until closed.
  assert.equal(finalizeStreamingMarkdown("Read `client/web.ts"), "Read ");
  assert.equal(finalizeStreamingMarkdown("Read `client/web.ts`"), "Read `client/web.ts`");
  assert.equal(finalizeStreamingMarkdown("Open <file:///repo/client/web.ts"), "Open ");
  assert.equal(
    finalizeStreamingMarkdown("Open <file:///repo/client/web.ts>"),
    "Open <file:///repo/client/web.ts>",
  );

  // Ordinary array indexing and fenced code blocks are preserved.
  assert.equal(finalizeStreamingMarkdown("items[0]"), "items[0]");
  assert.equal(
    finalizeStreamingMarkdown("```ts\nconst item = list[0"),
    "```ts\nconst item = list[0",
  );
});

test("toolDetailTextTransition recovers the entering link text when previous snapshot had unfinalized link syntax", () => {
  const transition = toolDetailTextTransition(
    "Updated [web.ts](file:///repo/client/web.ts",
    "Updated web.ts",
  );
  assert.equal(transition?.stableText, "Updated ");
  assert.equal(transition?.enteringText, "web.ts");
  assert.equal(transition?.enteringStart, "Updated ".length);
  assert.equal(transition?.enteringEnd, "Updated web.ts".length);
});
