import { isChangeTreeRowTestId, treeMotionOwners, treeRowTranslation, treeRowsAfterAnchor } from "../client/tree-motion.ts";

function expectEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

// A sibling outside an opened/closed Diff section can receive a small
// sub-layout adjustment. It should remain at its destination, not get a
// visible FLIP translation.
expectEqual(treeRowTranslation(2), null, "ignores a two-pixel downward adjustment");
expectEqual(treeRowTranslation(-2), null, "ignores a two-pixel upward adjustment");
expectEqual(treeRowTranslation(3), null, "keeps the rounding-noise boundary settled");
expectEqual(treeRowTranslation(4), "0 4px", "keeps meaningful downward moves animated");
expectEqual(treeRowTranslation(-4), "0 -4px", "keeps meaningful upward moves animated");
expectEqual(treeRowsAfterAnchor(["above", "folder", "nested child", "below"], "folder").join(","), "nested child,below", "never animates rows above the toggled folder");
expectEqual(isChangeTreeRowTestId("diff-folder-docs"), true, "keeps folder rows");
expectEqual(isChangeTreeRowTestId("diff-folder-docs-stat-additions"), false, "excludes a folder addition stat");
expectEqual(isChangeTreeRowTestId("diff-tree-file-architecture-stat-deletions"), false, "excludes a file deletion stat");

const tests = { id: "tests" };
const testFile = { id: "tests/tree-motion.test.mjs", parent: tests };
const packageFile = { id: "package.json" };
const owners = treeMotionOwners([
  { row: tests, translation: "0 -64px" },
  { row: testFile, translation: "0 -64px" },
  { row: packageFile, translation: "0 -64px" },
], (ancestor, descendant) => descendant.parent === ancestor);
expectEqual(owners.map(({ row }) => row.id).join(","), "tests,package.json", "uses one motion owner for a moved nested section");
