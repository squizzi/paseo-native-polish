import assert from "node:assert/strict";
import test from "node:test";
import { toolDetailTextTransition } from "../client/tool-detail-motion.ts";

test("Thinking keeps its existing text stable while the appended suffix fades in", () => {
  const transition = toolDetailTextTransition("Considering", "Considering the request");
  assert.deepEqual(transition, {
    stableText: "Considering",
    enteringText: " the request",
    enteringStart: "Considering".length,
    cover: [{ opacity: 1 }, { opacity: 0 }],
  });
});

test("Thinking does not replay streaming motion for initial, unchanged, or replaced text", () => {
  assert.equal(toolDetailTextTransition(undefined, "Considering"), null);
  assert.equal(toolDetailTextTransition("Considering", "Considering"), null);
  assert.equal(toolDetailTextTransition("Considering", "Done"), null);
});
