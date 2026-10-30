import assert from "node:assert/strict";
import test from "node:test";
import {
  USER_MESSAGE_AFTER_FOOTER_SLIDE_DELAY_MS,
  WORKED_FOOTER_ENTRANCE_DURATION_MS,
  isFollowingScrollBottom,
  resolveFollowOutputScroll,
  resolveStreamingAssistantGaps,
  resolveUserMessageEntranceDelayMs,
  shouldAllowFollowOutputRise,
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

test("Worked footer entrance eases text in with the chat rise motion and expands row layout to ease elements below down", () => {
  const motion = workedFooterEntranceMotion({
    height: 56,
    marginTop: 13,
    paddingBottom: 32,
    expandLayout: true,
  });
  assert.deepEqual(motion, {
    durationMs: WORKED_FOOTER_ENTRANCE_DURATION_MS,
    textKeyframes: [
      { opacity: 0, transform: "translateY(6px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    chromeKeyframes: [
      { opacity: 0, transform: "translateY(6px)" },
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

  const partialHostScrollStep = resolveFollowOutputScroll({
    wasFollowing: true,
    currentScrollTop: 1120,
    maxScrollTop: 1260,
    previousScrollTop: 1048,
    previousCompensatedScrollTop: 1260,
    previousMaxScrollTop: 1260,
    currentScrollHeight: 1860,
    previousScrollHeight: 1860,
    currentClientHeight: 600,
    previousClientHeight: 600,
  });
  assert.deepEqual(partialHostScrollStep, {
    anticipatesBottom: true,
    compensatedScrollTop: 1260,
    scrollDistance: 0,
    viewportHeightChangedOnly: false,
  });

  const scrolledUpSend = resolveFollowOutputScroll({
    wasFollowing: false,
    currentScrollTop: 300,
    maxScrollTop: 1260,
    previousScrollTop: 300,
    previousCompensatedScrollTop: 300,
    previousMaxScrollTop: 1200,
    currentScrollHeight: 1860,
    previousScrollHeight: 1800,
    currentClientHeight: 600,
    previousClientHeight: 600,
  });
  assert.deepEqual(scrolledUpSend, {
    anticipatesBottom: false,
    compensatedScrollTop: 300,
    scrollDistance: 0,
    viewportHeightChangedOnly: false,
  });
});

test("scrolling up while text is streaming disengages scroll easing until returning to the bottom", () => {
  // User scrolls up slightly (e.g. 40px above bottom, well within the old 180px window)
  const scrolledUpStep = isFollowingScrollBottom({
    currentScrollTop: 960,
    maxScrollTop: 1000,
    previousScrollTop: 1000,
    previousCompensatedScrollTop: 1000,
    previousMaxScrollTop: 1000,
    userScrolledUp: false,
    holdingPendingBottom: false,
  });
  assert.deepEqual(scrolledUpStep, {
    atBottom: false,
    wasFollowing: false,
    userScrolledUp: true,
  });

  // Next streaming line arrives while user remains at 960
  const streamingWhileScrolledUp = isFollowingScrollBottom({
    currentScrollTop: 960,
    maxScrollTop: 1028,
    previousScrollTop: 960,
    previousCompensatedScrollTop: 960,
    previousMaxScrollTop: 1000,
    userScrolledUp: scrolledUpStep.userScrolledUp,
    holdingPendingBottom: false,
  });
  assert.deepEqual(streamingWhileScrolledUp, {
    atBottom: false,
    wasFollowing: false,
    userScrolledUp: true,
  });

  // Even if resolveFollowOutputScroll is called when scrolled up or mid-scroll-up, it must not jump
  assert.deepEqual(
    resolveFollowOutputScroll({
      wasFollowing: true,
      currentScrollTop: 960,
      maxScrollTop: 1028,
      previousScrollTop: 960,
      previousCompensatedScrollTop: 960,
      previousMaxScrollTop: 1000,
    }),
    {
      anticipatesBottom: false,
      compensatedScrollTop: 960,
      scrollDistance: 0,
      viewportHeightChangedOnly: false,
    },
  );
  assert.deepEqual(
    resolveFollowOutputScroll({
      wasFollowing: true,
      currentScrollTop: 960,
      maxScrollTop: 1028,
      previousScrollTop: 1000,
      previousCompensatedScrollTop: 1000,
      previousMaxScrollTop: 1000,
    }),
    {
      anticipatesBottom: false,
      compensatedScrollTop: 960,
      scrollDistance: 0,
      viewportHeightChangedOnly: false,
    },
  );

  // Even a tiny 4px upward scroll disengages follow-output until the user returns to the exact bottom
  const tinyScrollUp = isFollowingScrollBottom({
    currentScrollTop: 996,
    maxScrollTop: 1000,
    previousScrollTop: 1000,
    previousCompensatedScrollTop: 1000,
    previousMaxScrollTop: 1000,
    userScrolledUp: false,
    holdingPendingBottom: false,
  });
  assert.deepEqual(tinyScrollUp, {
    atBottom: false,
    wasFollowing: false,
    userScrolledUp: true,
  });

  // Returning to the bottom re-engages follow-output scroll easing
  const returnedToBottom = isFollowingScrollBottom({
    currentScrollTop: 1028,
    maxScrollTop: 1028,
    previousScrollTop: 960,
    previousCompensatedScrollTop: 960,
    previousMaxScrollTop: 1028,
    userScrolledUp: streamingWhileScrolledUp.userScrolledUp,
    holdingPendingBottom: false,
  });
  assert.deepEqual(returnedToBottom, {
    atBottom: true,
    wasFollowing: true,
    userScrolledUp: false,
  });
});

test("streaming assistant gap offsets match Paseo's compactBottom assistant spacing across handoff", () => {
  // Trailing streaming assistant after a live tool/thought row:
  // above has 16px plugin gap (offset by -12px -> 4px), below is end-of-timeline (0px compactBottom).
  assert.deepEqual(
    resolveStreamingAssistantGaps({
      aboveIsUserMessage: false,
      aboveIsToolSequence: true,
      aboveHasCompletedFooter: false,
      belowExists: false,
      belowIsToolSequence: false,
      currentHasCompletedFooter: false,
    }),
    {
      gapAbove: "tool",
      gapBelow: null,
    },
  );

  // When the row above has an inline CompletedTurnFooterRow ("Worked for ..."),
  // Paseo sets above's gapBelow to 0px for both plugin and assistant_message, so no negative margin is applied.
  assert.deepEqual(
    resolveStreamingAssistantGaps({
      aboveIsUserMessage: false,
      aboveIsToolSequence: true,
      aboveHasCompletedFooter: true,
      belowExists: false,
      belowIsToolSequence: false,
      currentHasCompletedFooter: false,
    }),
    {
      gapAbove: null,
      gapBelow: null,
    },
  );

  // Mid-stream assistant followed by a tool/thought/todo row:
  // 0px paddingBottom + 16px plugin gapBelow matches 12px default paddingBottom + 4px assistant gapBelow.
  assert.deepEqual(
    resolveStreamingAssistantGaps({
      aboveIsUserMessage: true,
      aboveIsToolSequence: false,
      aboveHasCompletedFooter: false,
      belowExists: true,
      belowIsToolSequence: true,
      currentHasCompletedFooter: false,
    }),
    {
      gapAbove: "user",
      gapBelow: null,
    },
  );

  // Assistant row followed by a non-tool row without an inline completed footer restores 12px bottom padding.
  assert.deepEqual(
    resolveStreamingAssistantGaps({
      aboveIsUserMessage: true,
      aboveIsToolSequence: false,
      aboveHasCompletedFooter: false,
      belowExists: true,
      belowIsToolSequence: false,
      currentHasCompletedFooter: false,
    }),
    {
      gapAbove: "user",
      gapBelow: "default",
    },
  );
});

test("sending a user message while a Thinking panel height animation is active still allows follow-output rise", () => {
  const base = {
    hasPreviousChatState: true,
    allow: true,
    atBottom: true,
    messagesEnabled: true,
    quiet: false,
    suppressHandoffMotion: false,
    suppressHydrationMotion: false,
    suppressWidthReflowMotion: false,
    suppressDisclosureMotion: true,
    hasEnteringUserMessage: false,
    holdingPendingBottom: false,
    hasActiveTimelineRise: false,
    hasManualDisclosureCapture: false,
  };

  // Ordinary Thinking panel growth remains suppressed from triggering a whole-timeline rise
  assert.equal(shouldAllowFollowOutputRise(base), false);

  // Sending a user message while Thinking panel height animation is active prepares timeline rise
  assert.equal(
    shouldAllowFollowOutputRise({
      ...base,
      hasEnteringUserMessage: true,
    }),
    true,
  );

  // Subsequent frames while holding pending bottom and active timeline rise stay active until host scroll lands
  assert.equal(
    shouldAllowFollowOutputRise({
      ...base,
      holdingPendingBottom: true,
      hasActiveTimelineRise: true,
    }),
    true,
  );

  // Manual user click on a disclosure never triggers timeline rise
  assert.equal(
    shouldAllowFollowOutputRise({
      ...base,
      hasEnteringUserMessage: true,
      hasManualDisclosureCapture: true,
    }),
    false,
  );
});
