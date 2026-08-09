import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupFixture,
  createIntegrationFixture,
  layClaudeHome,
  layExpectedCodex,
} from "../helpers/fixture.mjs";
import { assertGolden } from "../helpers/golden.mjs";
import { runSync } from "../helpers/run-cli.mjs";
import { assertPrefixesUnchanged, snapshotTree } from "../helpers/snapshot.mjs";

const GOLDEN_IGNORE = [
  ".ai-config-sync-manager/",
  "backups/",
  ".DS_Store",
  ".claude/",
  ".claude.json",
];
const CLAUDE_SOURCE_PREFIXES = [".claude", ".claude.json"];

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

test("~/.claude/agents/translate.md becomes ~/.codex/agents/translate.toml (golden)", () => {
  withFixture("agents-reverse-happy", (fixture) => {
    const specs = [{ area: "agents", variant: "happy" }];
    layClaudeHome(fixture.home, specs);
    const beforeSnapshot = snapshotTree(fixture.home);

    const result = runSync({
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
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    layExpectedCodex(fixture.expectedHome, specs);
    assertGolden(fixture.home, fixture.expectedHome, { ignore: GOLDEN_IGNORE });
    assertPrefixesUnchanged(fixture.home, beforeSnapshot, CLAUDE_SOURCE_PREFIXES);
  });
});
