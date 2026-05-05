import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

function toPosix(p) {
  return sep === "/" ? p : p.split(sep).join("/");
}

function shouldIgnore(relPath, ignore) {
  for (const entry of ignore) {
    if (entry.endsWith("/")) {
      const dir = entry.slice(0, -1);
      if (relPath === dir || relPath.startsWith(entry)) return true;
    } else {
      if (relPath === entry) return true;
      const idx = relPath.lastIndexOf("/");
      const base = idx === -1 ? relPath : relPath.slice(idx + 1);
      if (base === entry) return true;
    }
  }
  return false;
}

function hashFile(absPath) {
  const buf = readFileSync(absPath);
  return createHash("sha256").update(buf).digest("hex");
}

function walk(rootDir, currentDir, out, ignore) {
  const entries = readdirSync(currentDir);
  for (const name of entries) {
    const abs = join(currentDir, name);
    const rel = toPosix(relative(rootDir, abs));
    if (shouldIgnore(rel, ignore)) continue;
    let info;
    try {
      info = lstatSync(abs);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) {
      let linkTarget = "";
      try {
        linkTarget = readlinkSync(abs);
      } catch {}
      out.set(rel, {
        sha256: null,
        size: info.size,
        mode: info.mode & 0o777,
        isSymlink: true,
        linkTarget,
      });
      continue;
    }
    if (info.isDirectory()) {
      walk(rootDir, abs, out, ignore);
      continue;
    }
    if (info.isFile()) {
      out.set(rel, {
        sha256: hashFile(abs),
        size: info.size,
        mode: info.mode & 0o777,
        isSymlink: false,
      });
    }
  }
}

export function snapshotTree(rootDir, { ignore = [] } = {}) {
  const out = new Map();
  if (!existsSync(rootDir)) return out;
  let info;
  try {
    info = statSync(rootDir);
  } catch {
    return out;
  }
  if (!info.isDirectory()) return out;
  walk(rootDir, rootDir, out, ignore);
  return out;
}

function entriesEqual(a, b) {
  if (!a || !b) return false;
  if (a.isSymlink !== b.isSymlink) return false;
  if (a.isSymlink) return a.linkTarget === b.linkTarget;
  return a.sha256 === b.sha256 && a.size === b.size && a.mode === b.mode;
}

export function diffTrees(actualMap, expectedMap, { ignore = [] } = {}) {
  const missing = [];
  const extra = [];
  const changed = [];
  for (const [path, expected] of expectedMap) {
    if (shouldIgnore(path, ignore)) continue;
    const actual = actualMap.get(path);
    if (!actual) {
      missing.push(path);
      continue;
    }
    if (!entriesEqual(actual, expected)) {
      changed.push({ path, actual, expected });
    }
  }
  for (const [path, actual] of actualMap) {
    if (shouldIgnore(path, ignore)) continue;
    if (!expectedMap.has(path)) extra.push(path);
  }
  missing.sort();
  extra.sort();
  changed.sort((a, b) => a.path.localeCompare(b.path));
  return { missing, extra, changed };
}

export function assertSourceUnchanged(home, beforeSnapshot) {
  const prefixes = [".codex", ".agents/skills"];
  for (const prefix of prefixes) {
    const subRoot = join(home, prefix);
    const after = snapshotTree(subRoot);
    const expected = new Map();
    for (const [path, entry] of beforeSnapshot) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        const sub = path === prefix ? "" : path.slice(prefix.length + 1);
        if (sub.length > 0) expected.set(sub, entry);
      }
    }
    const diff = diffTrees(after, expected);
    if (diff.missing.length > 0 || diff.extra.length > 0 || diff.changed.length > 0) {
      assert.fail(`source tree mutated under ${prefix}:\n${formatTreeDiff(diff)}`);
    }
  }
}

export function formatTreeDiff(diff) {
  const lines = [];
  if (diff.missing.length > 0) {
    lines.push("missing (expected, not in actual):");
    for (const p of diff.missing) lines.push(`  - ${p}`);
  }
  if (diff.extra.length > 0) {
    lines.push("extra (in actual, not expected):");
    for (const p of diff.extra) lines.push(`  + ${p}`);
  }
  if (diff.changed.length > 0) {
    lines.push("changed:");
    for (const c of diff.changed) {
      const a = c.actual;
      const e = c.expected;
      lines.push(`  ~ ${c.path}`);
      lines.push(
        `      expected sha=${e.sha256 ?? "(symlink)"} size=${e.size} symlink=${e.isSymlink}${e.isSymlink ? ` -> ${e.linkTarget}` : ""}`
      );
      lines.push(
        `      actual   sha=${a.sha256 ?? "(symlink)"} size=${a.size} symlink=${a.isSymlink}${a.isSymlink ? ` -> ${a.linkTarget}` : ""}`
      );
    }
  }
  if (lines.length === 0) return "(no diff)";
  return lines.join("\n");
}
