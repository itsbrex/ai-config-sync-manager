import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { diffTrees, formatTreeDiff, snapshotTree } from "./snapshot.mjs";

export const defaultGoldenIgnore = [".ai-config-sync-manager/", "backups/", ".DS_Store"];

function mergeIgnore(extra) {
  const set = new Set(defaultGoldenIgnore);
  for (const p of extra) set.add(p);
  return [...set];
}

function isEmptyDir(dir) {
  if (!existsSync(dir)) return true;
  let info;
  try {
    info = statSync(dir);
  } catch {
    return true;
  }
  if (!info.isDirectory()) return true;
  return readdirSync(dir).length === 0;
}

export function assertGolden(actualHome, expectedHome, { ignore = defaultGoldenIgnore } = {}) {
  const ignoreList = mergeIgnore(ignore);
  const actual = snapshotTree(actualHome, { ignore: ignoreList });
  if (isEmptyDir(expectedHome)) {
    if (actual.size > 0) {
      const lines = ["expected no host writes, but found entries:"];
      for (const path of [...actual.keys()].sort()) lines.push(`  + ${path}`);
      assert.fail(lines.join("\n"));
    }
    return;
  }
  const expected = snapshotTree(expectedHome, { ignore: ignoreList });
  const diff = diffTrees(actual, expected, { ignore: ignoreList });
  if (diff.missing.length > 0 || diff.extra.length > 0 || diff.changed.length > 0) {
    assert.fail(`golden tree mismatch:\n${formatTreeDiff(diff)}`);
  }
}
