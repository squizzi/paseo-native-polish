import assert from "node:assert/strict";
import test from "node:test";
import { shouldAnimateFooterRise } from "../client/footer-motion.ts";

test("footer rise stays with one stable DOM owner", () => {
  const footer = {};
  assert.equal(shouldAnimateFooterRise(footer, footer), true);
});

test("sending does not carry the completed footer offset into the new Working footer", () => {
  const completedFooter = {};
  const workingFooter = {};
  assert.equal(shouldAnimateFooterRise(completedFooter, workingFooter), false);
});
