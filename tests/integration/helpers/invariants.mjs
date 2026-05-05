import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { extractBackupRoot } from "./run-cli.mjs";
import { readSyncState } from "./readers.mjs";
import { assertSourceUnchanged, diffTrees, formatTreeDiff, snapshotTree } from "./snapshot.mjs";

function isUnderHome(target, home) {
  if (!target) return false;
  const abs = isAbsolute(target) ? target : null;
  if (!abs) return false;
  const rel = relative(home, abs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function fail(num, name, message) {
  assert.fail(`invariant #${num} (${name}) failed: ${message}`);
}

export function parsePlanJson(stdout) {
  if (typeof stdout !== "string") return null;
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {}
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stdout.length; i++) {
    const ch = stdout[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(stdout.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function assertInvariants(fixture, options) {
  const {
    beforeSnapshot,
    planJson,
    applyOutput,
    applyOutput2,
    dryRunOutput,
    dryRunBeforeApply = true,
    skip = {},
  } = options;
  const skipDryRun = skip.dryRun === true;
  const skipIdempotency = skip.idempotency === true;

  // 1. source unchanged
  try {
    assertSourceUnchanged(fixture.home, beforeSnapshot);
  } catch (error) {
    fail(1, "source unchanged", error.message);
  }

  // 2. direction
  if (planJson) {
    if (planJson.from !== "codex" || planJson.to !== "claude") {
      fail(
        2,
        "direction",
        `expected from=codex to=claude, got from=${planJson.from} to=${planJson.to}`
      );
    }
  }

  // 3. target paths within home
  if (planJson && Array.isArray(planJson.operations)) {
    for (const op of planJson.operations) {
      const target = op.targetPath ?? op.sourcePath;
      if (!target) continue;
      if (!isUnderHome(String(target), fixture.home)) {
        fail(3, "target paths", `op target outside home: ${target}`);
      }
    }
  }

  // 4. dry-run no writes
  if (dryRunBeforeApply && !skipDryRun) {
    if (!(fixture.dryRunSnapshot instanceof Map)) {
      fail(
        4,
        "dry-run no writes",
        "fixture.dryRunSnapshot not provided; pass skip.dryRun=true to opt out explicitly"
      );
    }
    const diff = diffTrees(fixture.dryRunSnapshot, beforeSnapshot);
    if (diff.missing.length > 0 || diff.extra.length > 0 || diff.changed.length > 0) {
      fail(4, "dry-run no writes", `tree mutated during dry-run:\n${formatTreeDiff(diff)}`);
    }
    void dryRunOutput;
  }

  // 5. state file
  const globalState = readSyncState(fixture.home, "global");
  const projectState = readSyncState(fixture.home, "project");
  const state = globalState ?? projectState;
  if (!state) {
    fail(5, "state file", "no state file under .ai-config-sync-manager/state/");
  }
  if (state.schemaVersion !== 1) {
    fail(5, "state file", `schemaVersion expected 1, got ${state.schemaVersion}`);
  }

  // 6. backup directory exists when reported
  if (typeof applyOutput === "string") {
    const backupRoot = extractBackupRoot(applyOutput);
    if (backupRoot) {
      let info;
      try {
        info = statSync(backupRoot);
      } catch {
        info = null;
      }
      if (!info || !info.isDirectory()) {
        fail(6, "backup on overwrite", `backup root not a directory: ${backupRoot}`);
      }
      if (!existsSync(backupRoot)) {
        fail(6, "backup on overwrite", `backup root missing: ${backupRoot}`);
      }
    }
  }

  // 7. idempotency
  if (!skipIdempotency) {
    if (!applyOutput2 || typeof applyOutput2 !== "object") {
      fail(
        7,
        "idempotency",
        "applyOutput2 not provided; pass skip.idempotency=true to opt out explicitly"
      );
    }
    const results = Array.isArray(applyOutput2.results) ? applyOutput2.results : null;
    if (!results) {
      fail(7, "idempotency", "applyOutput2.results missing or not an array");
    }
    for (const r of results) {
      if (r.status !== "noop" && r.status !== "applied") {
        fail(7, "idempotency", `unexpected second-apply status: ${r.status}`);
      }
    }
    if (typeof applyOutput2.changed === "number" && applyOutput2.changed !== 0) {
      fail(7, "idempotency", `second apply reported changed=${applyOutput2.changed}, expected 0`);
    }
  }
}
