import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupFixture,
  createIntegrationFixture,
  layClaudeHome,
  layCodexHome,
} from "../helpers/fixture.mjs";
import { assertGolden } from "../helpers/golden.mjs";
import { runSync } from "../helpers/run-cli.mjs";
import { diffTrees, formatTreeDiff, snapshotTree } from "../helpers/snapshot.mjs";

const GOLDEN_IGNORE = [
  ".ai-config-sync-manager/",
  "backups/",
  ".DS_Store",
  ".claude/",
  ".claude.json",
];

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

function applySkills(fixture) {
  return runSync({
    home: fixture.home,
    projectRoot: fixture.project,
    args: [
      "--scope",
      "global",
      "--include",
      "skills",
      "--from",
      "claude",
      "--to",
      "codex",
      "--apply",
    ],
  });
}

function assertClaudeSourceUnchanged(home, beforeSnapshot) {
  const diff = diffTrees(snapshotTree(join(home, ".claude")), beforeSnapshot);
  if (diff.missing.length > 0 || diff.extra.length > 0 || diff.changed.length > 0) {
    assert.fail(`source tree mutated under .claude:\n${formatTreeDiff(diff)}`);
  }
}

test("apply copies claude SKILL.md into .agents/skills intact (golden)", () => {
  withFixture("skills-reverse-apply-happy", (fixture) => {
    const specs = [{ area: "skills", variant: "happy" }];
    layClaudeHome(fixture.home, specs);
    const beforeSnapshot = snapshotTree(join(fixture.home, ".claude"));

    const result = applySkills(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    layCodexHome(fixture.expectedHome, specs);
    assertGolden(fixture.home, fixture.expectedHome, { ignore: GOLDEN_IGNORE });
    assertClaudeSourceUnchanged(fixture.home, beforeSnapshot);
  });
});

test("second apply is idempotent", () => {
  withFixture("skills-reverse-idempotent", (fixture) => {
    const specs = [{ area: "skills", variant: "happy" }];
    layClaudeHome(fixture.home, specs);

    const first = applySkills(fixture);
    assert.equal(first.status, 0, `first apply failed: ${first.output}`);

    const afterFirst = snapshotTree(join(fixture.home, ".agents"));

    const second = applySkills(fixture);
    assert.equal(second.status, 0, `second apply failed: ${second.output}`);

    const afterSecond = snapshotTree(join(fixture.home, ".agents"));
    assert.equal(
      afterSecond.size,
      afterFirst.size,
      "agents tree size changed between first and second apply"
    );
    for (const [path, entry] of afterFirst) {
      const next = afterSecond.get(path);
      assert.ok(next, `path ${path} disappeared on second apply`);
      assert.equal(next.sha256, entry.sha256, `path ${path} content changed on second apply`);
    }
  });
});
