// Browser layout measurements can vary by a couple of pixels while a diff
// section is being mounted or removed.  Treat that as settled layout rather
// than replaying it as a row transition.
export function treeRowTranslation(delta: number): string | null {
  return Math.abs(delta) > 3 ? `0 ${delta}px` : null;
}

export function treeRowsAfterAnchor<T>(rows: readonly T[], anchor: T | null): readonly T[] {
  const index = anchor === null ? -1 : rows.indexOf(anchor);
  return index < 0 ? rows : rows.slice(index + 1);
}

export function isChangeTreeRowTestId(testId: string | null): boolean {
  return Boolean(testId && /^(diff-folder|diff-tree-file)-/.test(testId) && !/-(?:toggle|name|stat)(?:-|$)/.test(testId));
}

export interface TreeRowMovement<T> {
  row: T;
  translation: string | null;
}

export function treeMotionOwners<T>(movements: readonly TreeRowMovement<T>[], contains: (ancestor: T, descendant: T) => boolean): TreeRowMovement<T>[] {
  const moving = movements.filter(movement => movement.translation !== null);
  return moving.filter(movement => !moving.some(candidate => candidate !== movement && contains(candidate.row, movement.row)));
}
