import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveChatBubbleExpandedState,
  shouldAnimateChatDisclosure,
  chatDisclosureMotion,
} from "../client/chat-disclosure-motion.ts";

test("expanding chat disclosure generates height keyframes and clips content", () => {
  assert.equal(
    shouldAnimateChatDisclosure({
      isBubble: true,
      beforeExpanded: false,
      currentExpanded: true,
      beforeHeight: 240,
      currentHeight: 650,
    }),
    true,
  );

  const motion = chatDisclosureMotion({
    expanding: true,
    beforeHeight: 240,
    currentHeight: 650,
    beforeBubbleHeight: 288,
    currentBubbleHeight: 706,
    beforeToggleMarginTop: 0,
    currentToggleMarginTop: 8,
  });

  assert.deepEqual(motion.keyframes, [
    { height: "240px" },
    { height: "650px" },
  ]);
  assert.deepEqual(motion.bubbleKeyframes, [
    { height: "288px" },
    { height: "706px" },
  ]);
  assert.deepEqual(motion.toggleKeyframes, [
    { marginTop: "0px" },
    { marginTop: "8px" },
  ]);
  assert.equal(motion.priority, "");
  assert.equal(motion.styles["overflow"], "hidden");
  assert.equal(motion.styles["box-sizing"], "border-box");
  assert.equal(motion.styles["min-height"], "0");
  assert.equal(motion.styles["flex-shrink"], "0");
  assert.equal(motion.styles["max-height"], undefined);
  assert.deepEqual(motion.bubbleStyles, {
    overflow: "hidden",
    "box-sizing": "border-box",
    "min-height": "0",
  });
});

test("collapsing chat disclosure temporarily removes max-height with !important to prevent snap", () => {
  assert.equal(
    shouldAnimateChatDisclosure({
      isBubble: true,
      beforeExpanded: true,
      currentExpanded: false,
      beforeHeight: 650,
      currentHeight: 240,
    }),
    true,
  );

  const motion = chatDisclosureMotion({
    expanding: false,
    beforeHeight: 650,
    currentHeight: 240,
    beforeBubbleHeight: 706,
    currentBubbleHeight: 288,
    beforeToggleMarginTop: 8,
    currentToggleMarginTop: 0,
  });

  assert.deepEqual(motion.keyframes, [
    { height: "650px" },
    { height: "240px" },
  ]);
  assert.deepEqual(motion.bubbleKeyframes, [
    { height: "706px" },
    { height: "288px" },
  ]);
  assert.deepEqual(motion.toggleKeyframes, [
    { marginTop: "8px" },
    { marginTop: "0px" },
  ]);
  assert.equal(motion.priority, "important");
  assert.equal(motion.styles["max-height"], "none");
  assert.equal(motion.styles["overflow"], "hidden");
  assert.equal(motion.styles["flex-shrink"], "0");
});

test("resolveChatBubbleExpandedState detects expansion state even when React Native Web omits aria-expanded", () => {
  // Explicit aria-expanded takes precedence
  assert.equal(
    resolveChatBubbleExpandedState({
      ariaExpanded: "true",
      previewMaxHeight: "240px",
      previewChildCount: 2,
    }),
    true,
  );
  assert.equal(
    resolveChatBubbleExpandedState({
      ariaExpanded: "false",
      previewMaxHeight: "none",
      previewChildCount: 1,
    }),
    false,
  );

  // Collapsed in React Native Web: EdgeFade child mounted (previewChildCount = 2) and max-height: 240px
  assert.equal(
    resolveChatBubbleExpandedState({
      ariaExpanded: null,
      previewMaxHeight: "240px",
      previewChildCount: 2,
    }),
    false,
  );

  // Expanded in React Native Web: EdgeFade unmounted (previewChildCount = 1) and max-height: none
  assert.equal(
    resolveChatBubbleExpandedState({
      ariaExpanded: null,
      previewMaxHeight: "none",
      previewChildCount: 1,
    }),
    true,
  );

  // During collapse animation when inline max-height: none !important is active, child count still identifies collapsed state
  assert.equal(
    resolveChatBubbleExpandedState({
      ariaExpanded: null,
      previewMaxHeight: "none",
      previewChildCount: 2,
    }),
    false,
  );

  // Unknown when no signals exist
  assert.equal(
    resolveChatBubbleExpandedState({
      ariaExpanded: null,
      previewMaxHeight: null,
      previewChildCount: null,
    }),
    null,
  );
});

test("chat disclosure does not animate when expansion state has not changed (e.g. streaming or typing)", () => {
  assert.equal(
    shouldAnimateChatDisclosure({
      isBubble: true,
      beforeExpanded: false,
      currentExpanded: false,
      beforeHeight: 240,
      currentHeight: 280,
    }),
    false,
  );

  assert.equal(
    shouldAnimateChatDisclosure({
      isBubble: true,
      beforeExpanded: true,
      currentExpanded: true,
      beforeHeight: 600,
      currentHeight: 650,
    }),
    false,
  );
});

test("chat disclosure does not animate when height delta is under 2px", () => {
  assert.equal(
    shouldAnimateChatDisclosure({
      isBubble: true,
      beforeExpanded: false,
      currentExpanded: true,
      beforeHeight: 240,
      currentHeight: 241,
    }),
    false,
  );
});

test("chat disclosure ignores non-bubble disclosures or missing state", () => {
  assert.equal(
    shouldAnimateChatDisclosure({
      isBubble: false,
      beforeExpanded: false,
      currentExpanded: true,
      beforeHeight: 240,
      currentHeight: 650,
    }),
    false,
  );

  assert.equal(
    shouldAnimateChatDisclosure({
      isBubble: true,
      beforeExpanded: null,
      currentExpanded: true,
      beforeHeight: 240,
      currentHeight: 650,
    }),
    false,
  );

  assert.equal(
    shouldAnimateChatDisclosure({
      isBubble: true,
      beforeExpanded: false,
      currentExpanded: undefined,
      beforeHeight: 240,
      currentHeight: 650,
    }),
    false,
  );
});

test("chat disclosure boundary behavior around 2px height threshold", () => {
  assert.equal(
    shouldAnimateChatDisclosure({
      isBubble: true,
      beforeExpanded: false,
      currentExpanded: true,
      beforeHeight: 240,
      currentHeight: 242,
    }),
    true,
  );

  assert.equal(
    shouldAnimateChatDisclosure({
      isBubble: true,
      beforeExpanded: false,
      currentExpanded: true,
      beforeHeight: 240,
      currentHeight: 241.9,
    }),
    false,
  );
});

test("chat disclosure motion formats keyframes correctly for long messages", () => {
  const motion = chatDisclosureMotion({
    expanding: true,
    beforeHeight: 240,
    currentHeight: 1850,
  });

  assert.deepEqual(motion.keyframes, [
    { height: "240px" },
    { height: "1850px" },
  ]);
  assert.equal(motion.priority, "");

  const collapseMotion = chatDisclosureMotion({
    expanding: false,
    beforeHeight: 1850,
    currentHeight: 240,
  });

  assert.deepEqual(collapseMotion.keyframes, [
    { height: "1850px" },
    { height: "240px" },
  ]);
  assert.equal(collapseMotion.priority, "important");
  assert.equal(collapseMotion.styles["max-height"], "none");
});
