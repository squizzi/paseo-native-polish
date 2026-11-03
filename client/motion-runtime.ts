// Each connected daemon evaluates its own client bundle. DOM motion belongs
// to the window: keep one adapter, and hand it over when its host disconnects.
interface Lease { version: number[]; install(): () => void }
interface Runtime { leases: Lease[]; owner: Lease | null; dispose: (() => void) | null }
const scope = globalThis as typeof globalThis & { __paseoNativePolishMotion?: Runtime };

export function leaseMotion(version: string, install: () => () => void): () => void {
  const runtime = scope.__paseoNativePolishMotion ??= { leases: [], owner: null, dispose: null };
  const lease: Lease = { version: version.split(/[.-]/).slice(0, 3).map(Number), install };
  function reconcile() {
    const next = runtime.leases.reduce<Lease | null>((best, candidate) => {
      if (!best) return candidate;
      for (let index = 0; index < 3; index++) {
        const difference = candidate.version[index] - best.version[index];
        if (difference) return difference > 0 ? candidate : best;
      }
      // A plugin reload evaluates a new client bundle without necessarily
      // disconnecting the old one first.  Equal versions therefore mean the
      // later lease is the freshly reloaded code and must take ownership.
      return candidate;
    }, null);
    if (runtime.owner === next) return;
    runtime.dispose?.();
    runtime.dispose = null; runtime.owner = next;
    if (next) runtime.dispose = next.install();
  }
  runtime.leases.push(lease);
  try { reconcile(); } catch (error) {
    runtime.leases.splice(runtime.leases.indexOf(lease), 1);
    runtime.owner = null; reconcile();
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    runtime.leases.splice(runtime.leases.indexOf(lease), 1);
    reconcile();
  };
}
