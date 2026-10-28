import assert from "node:assert/strict";
import test from "node:test";
import {
  USER_MESSAGE_AFTER_FOOTER_SLIDE_DELAY_MS,
  WORKED_FOOTER_ENTRANCE_DURATION_MS,
  WORKED_FOOTER_TEXT_BLUR_PX,
  resolveFollowOutputScroll,
  resolveUserMessageEntranceDelayMs,
  shouldAnimateFooterRise,
  shouldExpandWorkedFooterLayout,
  shouldQueueWorkedFooterEntrance,
  workedFooterEntranceMotion,
} from "../client/footer-motion.ts";

test("footer rise stays with one stable DOM owner or a user-message send transition", () => {
  const footer = {};
  assert.equal(shouldAnimateFooterRise(footer, footer), true);
  assert.equal(shouldAnimateFooterRise(footer, {}, true), true);
  assert.equal(shouldAnimateFooterRise(null, footer, true), false);
  assert.equal(shouldAnimateFooterRise(footer, null, true), false);
});

test("sending does not carry the completed footer offset into an unrelated Working footer without user message", () => {
  const completedFooter = {};
  const workingFooter = {};
  assert.equal(shouldAnimateFooterRise(completedFooter, workingFooter), false);
});

test("user message entrance waits for footerDetails slide-down before appearing", () => {
  assert.equal(
    resolveUserMessageEntranceDelayMs({
      isUserMessage: true,
      footerSlideDownPx: 48,
    }),
    USER_MESSAGE_AFTER_FOOTER_SLIDE_DELAY_MS,
  );
  assert.equal(
    resolveUserMessageEntranceDelayMs({
      isUserMessage: true,
      footerSlideDownPx: 0,
    }),
    0,
  );
  assert.equal(
    resolveUserMessageEntranceDelayMs({
      isUserMessage: false,
      footerSlideDownPx: 48,
    }),
    0,
  );
});

test("Worked footer entrance eases text in with opacity/blur and expands row layout to ease elements below down", () => {
  const motion = workedFooterEntranceMotion({
    height: 56,
    marginTop: 13,
    paddingBottom: 32,
    expandLayout: true,
  });
  assert.deepEqual(motion, {
    durationMs: WORKED_FOOTER_ENTRANCE_DURATION_MS,
    textKeyframes: [
      { opacity: 0, filter: `blur(${WORKED_FOOTER_TEXT_BLUR_PX}px)`, transform: "translateY(4px)" },
      { opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
    ],
    chromeKeyframes: [
      { opacity: 0, transform: "translateY(4px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    rowStyles: {
      overflow: "hidden",
      "box-sizing": "border-box",
      "min-height": "0",
    },
    rowKeyframes: [
      { height: "0px", marginTop: "0px", paddingBottom: "0px" },
      { height: "56px", marginTop: "13px", paddingBottom: "32px" },
    ],
  });
});

test("Worked footer entrance omits layout expansion when disabled or zero-height", () => {
  const withoutLayout = workedFooterEntranceMotion({
    height: 56,
    marginTop: 13,
    paddingBottom: 32,
    expandLayout: false,
  });
  assert.equal(withoutLayout.rowStyles, null);
  assert.equal(withoutLayout.rowKeyframes, null);
  assert.equal(withoutLayout.textKeyframes.length, 2);
});

test("Worked footer entrance only queues during live turns outside hydration", () => {
  assert.equal(
    shouldQueueWorkedFooterEntrance({
      hasPreviousChatState: true,
      liveTurn: true,
      suppressHydrationMotion: false,
      isNew: true,
    }),
    true,
  );
  assert.equal(
    shouldQueueWorkedFooterEntrance({
      hasPreviousChatState: true,
      liveTurn: false,
      suppressHydrationMotion: false,
      isNew: true,
    }),
    false,
  );
  assert.equal(
    shouldQueueWorkedFooterEntrance({
      hasPreviousChatState: true,
      liveTurn: true,
      suppressHydrationMotion: true,
      isNew: true,
    }),
    false,
  );
  assert.equal(
    shouldQueueWorkedFooterEntrance({
      hasPreviousChatState: true,
      liveTurn: true,
      suppressHydrationMotion: false,
      isNew: false,
    }),
    false,
  );
  assert.equal(
    shouldQueueWorkedFooterEntrance({
      hasPreviousChatState: true,
      liveTurn: true,
      suppressHydrationMotion: false,
      hasEnteringUserMessage: true,
      isNew: true,
    }),
    false,
  );
});

test("Worked footer layout expansion is suppressed at turn-completion footer slot or handoff", () => {
  assert.equal(
    shouldExpandWorkedFooterLayout({
      hasFollowingContent: true,
      isTurnCompletionFooter: false,
      suppressHandoffMotion: false,
    }),
    true,
  );
  assert.equal(
    shouldExpandWorkedFooterLayout({
      hasFollowingContent: false,
      isTurnCompletionFooter: false,
      suppressHandoffMotion: false,
    }),
    false,
  );
  assert.equal(
    shouldExpandWorkedFooterLayout({
      hasFollowingContent: true,
      isTurnCompletionFooter: true,
      suppressHandoffMotion: false,
    }),
    false,
  );
  assert.equal(
    shouldExpandWorkedFooterLayout({
      hasFollowingContent: true,
      isTurnCompletionFooter: false,
      suppressHandoffMotion: true,
    }),
    false,
  );
});

test("follow-output scroll resolution holds pending bottom across back-to-back commits before host scroll lands", () => {
  const firstCommit = resolveFollowOutputScroll({
    wasFollowing: true,
    currentScrollTop: 1000,
    maxScrollTop: 1060,
    previousScrollTop: 1000,
    previousCompensatedScrollTop: 1000,
    previousMaxScrollTop: 1000,
  });
  assert.deepEqual(firstCommit, {
    anticipatesBottom: true,
    compensatedScrollTop: 1060,
    scrollDistance: 60,
    viewportHeightChangedOnly: false,
  });

  const secondCommitBeforeHostScroll = resolveFollowOutputScroll({
    wasFollowing: true,
    currentScrollTop: 1000,
    maxScrollTop: 1060,
    previousScrollTop: 1000,
    previousCompensatedScrollTop: 1060,
    previousMaxScrollTop: 1060,
  });
  assert.deepEqual(secondCommitBeforeHostScroll, {
    anticipatesBottom: true,
    compensatedScrollTop: 1060,
    scrollDistance: 0,
    viewportHeightChangedOnly: false,
  });

  const hostScrollCommit = resolveFollowOutputScroll({
    wasFollowing: true,
    currentScrollTop: 1060,
    maxScrollTop: 1060,
    previousScrollTop: 1000,
    previousCompensatedScrollTop: 1060,
    previousMaxScrollTop: 1060,
  });
  assert.deepEqual(hostScrollCommit, {
    anticipatesBottom: false,
    compensatedScrollTop: 1060,
    scrollDistance: 0,
    viewportHeightChangedOnly: false,
  });
});

test("composer entry growth changing only clientHeight does not trigger follow-output scroll rise", () => {
  const composerGrew = resolveFollowOutputScroll({
    wasFollowing: true,
    currentScrollTop: 1024,
    maxScrollTop: 1024,
    previousScrollTop: 1000,
    previousCompensatedScrollTop: 1000,
    previousMaxScrollTop: 1000,
    currentScrollHeight: 1600,
    previousScrollHeight: 1600,
    currentClientHeight: 576,
    previousClientHeight: 600,
  });
  assert.deepEqual(composerGrew, {
    anticipatesBottom: false,
    compensatedScrollTop: 1024,
    scrollDistance: 0,
    viewportHeightChangedOnly: true,
  });
});

test("long user message sent while composer resets eases the full new content scroll distance", () => {
  const longMessageSend = resolveFollowOutputScroll({
    wasFollowing: true,
    currentScrollTop: 1048,
    maxScrollTop: 1260,
    previousScrollTop: 1048,
    previousCompensatedScrollTop: 1048,
    previousMaxScrollTop: 1048,
    currentScrollHeight: 1860,
    previousScrollHeight: 1600,
    currentClientHeight: 600,
    previousClientHeight: 552,
  });
  assert.deepEqual(longMessageSend, {
    anticipatesBottom: true,
    compensatedScrollTop: 1260,
    scrollDistance: 260,
    viewportHeightChangedOnly: false,
  });
});
