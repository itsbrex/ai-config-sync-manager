import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { cleanupFixture, createIntegrationFixture, layClaudeHome } from "../helpers/fixture.mjs";
import { runSync } from "../helpers/run-cli.mjs";
import { diffTrees, formatTreeDiff, snapshotTree } from "../helpers/snapshot.mjs";

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

// the writer re-emits the markdown body verbatim, trailing newline included, so bytes cannot match the hand-written TOML fixture
test("apply writes claude agent frontmatter into a codex agent TOML", () => {
  withFixture("agents-reverse-apply-happy", (fixture) => {
    const specs = [{ area: "agents", variant: "happy" }];
    layClaudeHome(fixture.home, specs);
    const beforeSnapshot = snapshotTree(join(fixture.home, ".claude"));

    const result = applyAgents(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    const toml = readFileSync(join(fixture.home, ".codex", "agents", "translate.toml"), "utf8");
    assert.match(toml, /^name = "translate"$/m);
    assert.match(
      toml,
      /^description = "Translates user text to the requested target language\."$/m
    );
    assert.match(toml, /^developer_instructions = ".*Translate the user input verbatim/m);

    assertClaudeSourceUnchanged(fixture.home, beforeSnapshot);
  });
});

test("second apply is idempotent", () => {
  withFixture("agents-reverse-idempotent", (fixture) => {
    const specs = [{ area: "agents", variant: "happy" }];
    layClaudeHome(fixture.home, specs);

    const first = applyAgents(fixture);
    assert.equal(first.status, 0, `first apply failed: ${first.output}`);

    const afterFirst = snapshotTree(join(fixture.home, ".codex"));

    const second = applyAgents(fixture);
    assert.equal(second.status, 0, `second apply failed: ${second.output}`);

    const afterSecond = snapshotTree(join(fixture.home, ".codex"));
    assert.equal(
      afterSecond.size,
      afterFirst.size,
      "codex tree size changed between first and second apply"
    );
    for (const [path, entry] of afterFirst) {
      const next = afterSecond.get(path);
      assert.ok(next, `path ${path} disappeared on second apply`);
      assert.equal(next.sha256, entry.sha256, `path ${path} content changed on second apply`);
    }
  });
});
