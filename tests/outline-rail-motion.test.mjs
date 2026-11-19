import assert from 'node:assert/strict';

import {
  easeOutlineRail,
  OUTLINE_PREVIEW_TEST_ID,
  OUTLINE_RAIL_OFFSET_PX,
  OUTLINE_RAIL_TEST_ID,
  outlineRailDuration,
  outlineRailKeyframes,
  outlineRailProgress,
} from '../client/outline-rail-motion.ts';

assert.equal(OUTLINE_RAIL_TEST_ID, 'chat-outline-rail');
assert.equal(OUTLINE_PREVIEW_TEST_ID, 'chat-outline-preview');
assert.equal(OUTLINE_RAIL_OFFSET_PX, -24);

assert.deepEqual(outlineRailKeyframes('enter'), [
  { translate: '-24px 0', opacity: 0 },
  { translate: '0 0', opacity: 1 },
]);

assert.deepEqual(outlineRailKeyframes('exit'), [
  { translate: '0 0', opacity: 1 },
  { translate: '-24px 0', opacity: 0 },
]);

// Ease curve matches EASING = cubic-bezier(0.22, 1, 0.36, 1)
assert.equal(easeOutlineRail(0), 0);
assert.equal(easeOutlineRail(1), 1);
assert.equal(Math.round(easeOutlineRail(0.4) * 1000) / 1000, 0.917);

// When an active Animation's inFlightProgress is provided (e.g. 0.4),
// the rail reverses from that exact in-flight progress (span = 0.4).
const enterSpanFromComputedProgress = outlineRailProgress(72, 180, 1, 0.4);
assert.equal(enterSpanFromComputedProgress, 0.4);
assert.deepEqual(outlineRailKeyframes('enter', enterSpanFromComputedProgress), [
  { translate: '-9.6px 0', opacity: 0.6 },
  { translate: '0 0', opacity: 1 },
]);

// If an exit animation is interrupted at 72ms of 180ms without an animation
// object, progress is derived from the eased curve (easeOutlineRail(0.4) ≈ 0.917),
// matching the EASING curve rather than a linear elapsed ratio.
const enterSpanEased = outlineRailProgress(72, 180, 1);
assert.equal(enterSpanEased, 0.917);
assert.deepEqual(outlineRailKeyframes('enter', enterSpanEased), [
  { translate: '-22.008px 0', opacity: 0.083 },
  { translate: '0 0', opacity: 1 },
]);

// If that resumed entrance (starting at span 0.4, i.e. -9.6px / opacity 0.6)
// is interrupted halfway through (inFlightProgress = 0.5), the rail is at -4.8px
// with 0.8 opacity. Reversing back to exit starts from that exact position.
const exitSpanAfterInterruptedEnter = outlineRailProgress(
  50,
  100,
  enterSpanFromComputedProgress,
  0.5,
);
assert.equal(exitSpanAfterInterruptedEnter, 0.8);
assert.deepEqual(outlineRailKeyframes('exit', exitSpanAfterInterruptedEnter), [
  { translate: '-4.8px 0', opacity: 0.8 },
  { translate: '-24px 0', opacity: 0 },
]);

assert.equal(outlineRailProgress(-10, 180, 1), 0);
assert.equal(outlineRailProgress(300, 180, 1), 1);
assert.equal(outlineRailProgress(90, 0, 1), 1);

assert.equal(outlineRailDuration(180, 1), 180);
assert.equal(outlineRailDuration(180, 0.5), 90);
assert.equal(outlineRailDuration(180, 0.1), 60);
assert.equal(outlineRailDuration(0, 1), 0);
