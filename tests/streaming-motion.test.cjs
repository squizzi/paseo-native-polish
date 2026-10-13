const assert = require("node:assert/strict");
const {
  isStreamingRehydrating,
  isInitialTurnSettling,
  shouldCrossfadeMarkdownHandoff,
  shouldFlipStreamingRowHeight,
  shouldSuppressTransientBottomFollow,
  shouldSuppressRehydratedStreamEntrance,
} = require("../.test-build/streaming-motion.js");
const { transformStreamingAssistantMessage } = require("../.test-build/streaming-transform.js");

const stableLargeResize = {
  previousHeight: 24,
  nextHeight: 96,
  sameRow: true,
  previouslyVisible: true,
  visible: true,
  rehydrating: false,
};

assert.equal(
  shouldFlipStreamingRowHeight(stableLargeResize),
  false,
  "a large live Markdown append must not fade the entire existing row",
);
assert.equal(
  shouldFlipStreamingRowHeight({ ...stableLargeResize, previouslyVisible: false, rehydrating: true }),
  false,
  "a tab rehydration must not animate from a hidden row's stale height",
);
assert.equal(shouldFlipStreamingRowHeight({ ...stableLargeResize, sameRow: false }), false);
assert.equal(shouldSuppressRehydratedStreamEntrance(true, true), true);
assert.equal(shouldSuppressRehydratedStreamEntrance(false, true), false);
assert.equal(shouldSuppressRehydratedStreamEntrance(true, false), false);
assert.equal(isStreamingRehydrating(true, 0, 1_000), true);
assert.equal(isStreamingRehydrating(false, 1_180, 1_000), true, "follow-up resize passes must stay settled after rehydration");
assert.equal(isStreamingRehydrating(false, 1_180, 1_180), false);
assert.equal(isInitialTurnSettling(true, 0, 1_000), true);
assert.equal(isInitialTurnSettling(false, 1_580, 1_000), true, "observer passes during the footer entrance must not start bottom-follow");
assert.equal(isInitialTurnSettling(false, 1_580, 1_580), false);
assert.equal(shouldCrossfadeMarkdownHandoff(true, true), true);
assert.equal(shouldCrossfadeMarkdownHandoff(false, true), false);
assert.equal(shouldCrossfadeMarkdownHandoff(true, false), false);
assert.equal(shouldSuppressTransientBottomFollow(false, false, true), true, "native Markdown handoff must rebase without bottom-follow");
assert.equal(shouldSuppressTransientBottomFollow(false, false, false), false);

const firstDelta = transformStreamingAssistantMessage({ messageId: "message-42", text: "first" }, "streaming", true);
const secondDelta = transformStreamingAssistantMessage({ messageId: "message-42", text: "first delta" }, "streaming", true);
assert.equal(firstDelta.items[0].id, undefined, "the host derives identity from the source message");
assert.equal(secondDelta.items[0].id, undefined, "deltas must not pin a separate virtual-row identity");
assert.equal(transformStreamingAssistantMessage({ text: "fallback" }, "streaming", true).items[0].id, undefined);
assert.equal(transformStreamingAssistantMessage({ messageId: "message-42", text: "done" }, "complete", true), undefined);
assert.equal(
  transformStreamingAssistantMessage({ messageId: "message-42", text: "first" }, "streaming", false),
  undefined,
  "disabling messages motion must hand streaming assistant messages back to the host renderer",
);

console.log("streaming motion transitions: ok");
