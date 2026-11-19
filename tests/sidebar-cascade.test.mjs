import { cascadeDelays } from "../client/sidebar-cascade.ts";

function expectEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

const timing = { lead: 40, step: 20, spread: 220 };
const row = (top, left, height = 28, width = 40) => ({ top, bottom: top + height, left, right: left + width });

// Input order is preserved; rows run top to bottom regardless of DOM order.
expectEqual(cascadeDelays([row(60, 8), row(0, 8), row(30, 8)], timing).join(","), "80,40,60", "orders rows from top to bottom");

// A centred 20px icon beside 28px text belongs to the same visual row, and
// items within a row trail left to right at half a row step.
const footer = cascadeDelays([row(100, 120, 20), row(96, 8), row(100, 64, 20), row(140, 8)], timing);
expectEqual(footer.join(","), "60,40,50,60", "sweeps a row from left to right");

// A long list compresses its row gaps so the last row starts within the spread.
const long = cascadeDelays(Array.from({ length: 23 }, (_, index) => row(index * 30, 8)), timing);
expectEqual(long[0], 40, "starts the first row after the lead");
expectEqual(long[22], 260, "bounds the last row's delay by lead plus spread");

// A right sidebar opens from its right edge, so a row sweeps right to left.
const rail = cascadeDelays([row(0, 8), row(0, 120), row(0, 64)], timing, "right");
expectEqual(rail.join(","), "60,40,50", "sweeps a right sidebar row from right to left");

expectEqual(cascadeDelays([], timing).length, 0, "accepts an empty sidebar");
expectEqual(cascadeDelays([row(0, 0)], timing)[0], 40, "delays a single item by the lead only");

console.log("sidebar cascade tests passed");
