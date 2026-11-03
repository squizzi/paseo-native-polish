import { leaseMotion } from "../client/motion-runtime.ts";

function expectEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

delete globalThis.__paseoNativePolishMotion;
const events = [];
const releaseOld = leaseMotion("0.4.16", () => {
  events.push("old install");
  return () => events.push("old dispose");
});
const releaseNew = leaseMotion("0.4.16", () => {
  events.push("new install");
  return () => events.push("new dispose");
});

expectEqual(events.join(","), "old install,old dispose,new install", "a same-version reload replaces the stale motion adapter");

releaseNew();
releaseOld();
delete globalThis.__paseoNativePolishMotion;
