export interface CascadeBox { top: number; bottom: number; left: number; right: number }
export interface CascadeTiming {
  // Delay before the first row, so it emerges once the drawer has some width.
  lead: number;
  // Preferred gap between visual rows.
  step: number;
  // Upper bound on the last row's delay: a long list compresses its gaps
  // instead of making the bottom rows wait.
  spread: number;
}

// Orders items into visual rows (top to bottom), then items within a row
// starting from the sidebar's opening edge: left to right for a left sidebar,
// right to left for a right one. Returns each delay in input order.
// Items whose vertical centre lies within the current row's extent share it,
// so a centred icon next to taller text is not treated as a separate row.
export function cascadeDelays(boxes: readonly CascadeBox[], timing: CascadeTiming, edge: 'left' | 'right' = 'left'): number[] {
  const order = boxes
    .map((box, index) => ({ box, index, centre: (box.top + box.bottom) / 2 }))
    .sort((a, b) => a.centre - b.centre || a.box.left - b.box.left);
  const rows: (typeof order)[] = [];
  let rowBottom = -Infinity;
  for (const item of order) {
    if (!rows.length || item.centre > rowBottom) { rows.push([item]); rowBottom = item.box.bottom; }
    else { rows[rows.length - 1].push(item); rowBottom = Math.max(rowBottom, item.box.bottom); }
  }
  const step = rows.length > 1 ? Math.min(timing.step, timing.spread / (rows.length - 1)) : timing.step;
  const delays = new Array<number>(boxes.length).fill(timing.lead);
  rows.forEach((row, rowIndex) => {
    row.sort(edge === 'left' ? (a, b) => a.box.left - b.box.left : (a, b) => b.box.right - a.box.right);
    // Columns trail at half a row step, giving a short diagonal sweep.
    row.forEach((item, column) => { delays[item.index] = Math.round(timing.lead + rowIndex * step + Math.min(column, 6) * timing.step / 2); });
  });
  return delays;
}
