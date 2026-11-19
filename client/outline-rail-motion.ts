export const OUTLINE_RAIL_TEST_ID = 'chat-outline-rail';
export const OUTLINE_PREVIEW_TEST_ID = 'chat-outline-preview';
export const OUTLINE_RAIL_OFFSET_PX = -24;

function clampUnit(value: number, fallback = 1): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function roundMetric(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Solves the cubic-bezier curve matching `EASING` (0.22, 1, 0.36, 1) for a given
 * time ratio `[0, 1]`.
 */
export function easeOutlineRail(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  if (ratio >= 1) return 1;

  const x1 = 0.22;
  const y1 = 1;
  const x2 = 0.36;
  const y2 = 1;

  let low = 0;
  let high = 1;
  let t = ratio;

  for (let i = 0; i < 8; i++) {
    const oneMinusT = 1 - t;
    const currentX =
      3 * oneMinusT * oneMinusT * t * x1 +
      3 * oneMinusT * t * t * x2 +
      t * t * t;
    const diff = currentX - ratio;
    if (Math.abs(diff) < 1e-6) break;

    if (diff > 0) high = t;
    else low = t;

    const dxdt =
      3 * oneMinusT * oneMinusT * x1 +
      6 * oneMinusT * t * (x2 - x1) +
      3 * t * t * (1 - x2);
    if (Math.abs(dxdt) > 1e-6) {
      const nextT = t - diff / dxdt;
      if (nextT > low && nextT < high) {
        t = nextT;
        continue;
      }
    }
    t = 0.5 * (low + high);
  }

  const oneMinusT = 1 - t;
  return (
    3 * oneMinusT * oneMinusT * t * y1 +
    3 * oneMinusT * t * t * y2 +
    t * t * t
  );
}

/**
 * Computes the remaining normalized travel span `[0, 1]` when an in-flight
 * outline rail entrance or exit animation is interrupted and reversed.
 *
 * When an active `inFlightProgress` is available from Web Animations, it is used
 * directly; otherwise progress is evaluated using `easeOutlineRail(elapsedMs / durationMs)`.
 */
export function outlineRailProgress(
  elapsedMs: number,
  durationMs: number,
  fromSpan = 1,
  inFlightProgress?: number | null,
): number {
  const span = clampUnit(fromSpan, 1);
  if (inFlightProgress != null && Number.isFinite(inFlightProgress)) {
    const p = clampUnit(inFlightProgress, 0);
    return roundMetric(1 - (1 - p) * span);
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1;
  if (!Number.isFinite(elapsedMs)) return span;
  const ratio = clampUnit(elapsedMs / durationMs, 0);
  const eased = easeOutlineRail(ratio);
  return roundMetric(1 - (1 - eased) * span);
}

export function outlineRailDuration(baseDurationMs: number, span = 1): number {
  if (!Number.isFinite(baseDurationMs) || baseDurationMs <= 0) return 0;
  const clamped = Math.min(1, Math.max(0.25, clampUnit(span, 1)));
  return Math.max(60, Math.round(baseDurationMs * clamped));
}

export function outlineRailKeyframes(
  direction: 'enter' | 'exit',
  span = 1,
): Record<string, string | number>[] {
  const clamped = clampUnit(span, 1);
  if (direction === 'enter') {
    const startX = roundMetric(OUTLINE_RAIL_OFFSET_PX * clamped);
    const startOpacity = roundMetric(1 - clamped);
    return [
      { translate: startX === 0 ? '0 0' : `${startX}px 0`, opacity: startOpacity },
      { translate: '0 0', opacity: 1 },
    ];
  }

  const startX = roundMetric(OUTLINE_RAIL_OFFSET_PX * (1 - clamped));
  const startOpacity = roundMetric(clamped);
  return [
    { translate: startX === 0 ? '0 0' : `${startX}px 0`, opacity: startOpacity },
    { translate: `${OUTLINE_RAIL_OFFSET_PX}px 0`, opacity: 0 },
  ];
}
