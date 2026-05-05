import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupFixture,
  createIntegrationFixture,
  layCodexHome,
  layExpectedClaude,
  layPreExistingClaude,
} from "../helpers/fixture.mjs";
import { assertGolden } from "../helpers/golden.mjs";
import { extractBackupRoot, runSync } from "../helpers/run-cli.mjs";
import { scanClaudeAgents } from "../helpers/readers.mjs";
import { assertSourceUnchanged, snapshotTree } from "../helpers/snapshot.mjs";

const GOLDEN_IGNORE = [".ai-config-sync-manager/", "backups/", ".DS_Store", ".codex/", ".agents/"];

function withFixture(scenario, body) {
  const fixture = createIntegrationFixture({ scenario });
  let kept = false;
  try {
    body(fixture);
  } catch (error) {
    if (process.env.KEEP_FIXTURE === "1") {
      kept = true;
      error.message = `${error.message}\n[fixture kept at ${fixture.root}]`;
    }
    throw error;
  } finally {
    if (!kept && process.env.KEEP_FIXTURE !== "1") {
      cleanupFixture(fixture);
    }
  }
}

function applyAgents(fixture) {
  return runSync({
    home: fixture.home,
    projectRoot: fixture.project,
    args: [
      "--scope",
      "global",
      "--include",
      "agents",
      "--from",
      "codex",
      "--to",
      "claude",
      "--apply",
    ],
  });
}

function walkFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let info;
    try {
      info = statSync(current);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      for (const name of readdirSync(current)) stack.push(join(current, name));
    } else if (info.isFile()) {
      out.push(current);
    }
  }
  return out;
}

test("TOML->frontmatter mapping for happy agent (golden)", () => {
  withFixture("agents-apply-happy", (fixture) => {
    const specs = [{ area: "agents", variant: "happy" }];
    layCodexHome(fixture.home, specs);
    const beforeSnapshot = snapshotTree(fixture.home);

    const result = applyAgents(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    layExpectedClaude(fixture.expectedHome, specs);
    assertGolden(fixture.home, fixture.expectedHome, { ignore: GOLDEN_IGNORE });
    assertSourceUnchanged(fixture.home, beforeSnapshot);
  });
});

test("manual-overwrite uses backup before replacing", () => {
  withFixture("agents-manual-overwrite", (fixture) => {
    const specs = [{ area: "agents", variant: "manual-overwrite" }];
    layCodexHome(fixture.home, specs);
    layPreExistingClaude(fixture.home, specs);

    const claudeAgentPath = join(fixture.home, ".claude", "agents", "translate.md");
    const oldContent = readFileSync(claudeAgentPath, "utf8");

    const beforeSnapshot = snapshotTree(fixture.home);
    const result = applyAgents(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    layExpectedClaude(fixture.expectedHome, specs);
    assertGolden(fixture.home, fixture.expectedHome, { ignore: GOLDEN_IGNORE });

    const backupRootDir = extractBackupRoot(result.stdout);
    assert.ok(backupRootDir, "expected Backup root in stdout");
    assert.equal(existsSync(backupRootDir), true, `backup root missing: ${backupRootDir}`);

    const backupFiles = walkFiles(backupRootDir);
    const backedUp = backupFiles.find((p) => p.endsWith(`${"/.claude/agents/"}translate.md`));
    assert.ok(backedUp, `expected backup of translate.md, got: ${backupFiles.join(", ")}`);
    assert.equal(
      readFileSync(backedUp, "utf8"),
      oldContent,
      "backup must contain pre-existing claude content"
    );

    assertSourceUnchanged(fixture.home, beforeSnapshot);
  });
});

test("scan after apply matches codex agent set", () => {
  withFixture("agents-scan-after-apply", (fixture) => {
    const specs = [{ area: "agents", variant: "happy" }];
    layCodexHome(fixture.home, specs);

    const result = applyAgents(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    const scanned = scanClaudeAgents(fixture.home);
    assert.deepEqual(
      [...scanned.keys()].sort(),
      ["translate"],
      `unexpected agent set after apply: ${[...scanned.keys()].join(", ")}`
    );
  });
});

test("tool-paraphrase rewrites codex_only tokens during agents apply", () => {
  withFixture("agents-vocab-paraphrase", (fixture) => {
    const specs = [{ area: "agents", variant: "manual-overwrite" }];
    layCodexHome(fixture.home, specs);
    layPreExistingClaude(fixture.home, specs);

    const result = applyAgents(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    const claudeAgent = readFileSync(
      join(fixture.home, ".claude", "agents", "translate.md"),
      "utf8"
    );
    assert.match(claudeAgent, /wait for the spawned agent/);
    assert.doesNotMatch(claudeAgent, /\bwait_agent\b/);
  });
});

test("idempotent re-apply", () => {
  withFixture("agents-idempotent", (fixture) => {
    const specs = [{ area: "agents", variant: "happy" }];
    layCodexHome(fixture.home, specs);

    const first = applyAgents(fixture);
    assert.equal(first.status, 0, `first apply failed: ${first.output}`);

    const afterFirst = snapshotTree(join(fixture.home, ".claude"));

    const second = applyAgents(fixture);
    assert.equal(second.status, 0, `second apply failed: ${second.output}`);

    const afterSecond = snapshotTree(join(fixture.home, ".claude"));
    assert.equal(
      afterSecond.size,
      afterFirst.size,
      "claude tree size changed between first and second apply"
    );
    for (const [path, entry] of afterFirst) {
      const next = afterSecond.get(path);
      assert.ok(next, `path ${path} disappeared on second apply`);
      assert.equal(next.sha256, entry.sha256, `path ${path} content changed on second apply`);
    }
  });
});
