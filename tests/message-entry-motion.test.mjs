import assert from "node:assert/strict";
import test from "node:test";
import { messageEntranceMotion, shouldQueueMessageEntrance } from "../client/message-entry-motion.ts";

const base = {
  hasPreviousChatState: true,
  wasRunning: false,
  isUserMessage: true,
  suppressHydrationMotion: false,
  allow: true,
  atBottom: true,
  quiet: false,
};

test("non-bubble chat items rise without a scale", () => {
  const motion = messageEntranceMotion(false);
  assert.equal(motion.styles, null);
  assert.deepEqual(motion.keyframes, [
    { opacity: 0, transform: "translateY(6px)" },
    { opacity: 1, transform: "translateY(0)" },
  ]);
});

test("the user message bubble keeps its scaled entrance", () => {
  const motion = messageEntranceMotion(true);
  assert.deepEqual(motion.styles, { "transform-origin": "100% 0%" });
  assert.deepEqual(motion.keyframes, [
    { opacity: 0, transform: "translateY(6px) scale(.98)" },
    { opacity: 1, transform: "translateY(0) scale(1)" },
  ]);
});

test("a new live message queues an entrance when row and Working commit together", () => {
  assert.equal(shouldQueueMessageEntrance({ ...base, running: true, isNew: true }), true);
});

test("a new live message also queues an entrance when its row commits before Working", () => {
  const rowCommit = shouldQueueMessageEntrance({ ...base, running: false, isNew: true });
  const workingCommit = shouldQueueMessageEntrance({ ...base, running: true, isNew: false });
  assert.equal(rowCommit || workingCommit, true);
});

test("a non-user history row still requires a live-turn signal", () => {
  assert.equal(shouldQueueMessageEntrance({ ...base, isUserMessage: false, running: false, isNew: true }), false);
});

test("hydration and deliberate non-motion boundaries still suppress entrances", () => {
  assert.equal(shouldQueueMessageEntrance({ ...base, running: false, isNew: true, suppressHydrationMotion: true }), false);
  assert.equal(shouldQueueMessageEntrance({ ...base, running: false, isNew: true, allow: false }), false);
  assert.equal(shouldQueueMessageEntrance({ ...base, running: false, isNew: true, atBottom: false }), false);
  assert.equal(shouldQueueMessageEntrance({ ...base, running: false, isNew: true, quiet: true }), false);
});
