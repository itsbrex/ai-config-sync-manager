import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupFixture,
  createIntegrationFixture,
  layClaudeHome,
  layExpectedCodex,
} from "../helpers/fixture.mjs";
import { assertGolden } from "../helpers/golden.mjs";
import { runStatus, runSync } from "../helpers/run-cli.mjs";
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

function applyMcp(fixture, env = {}) {
  return runSync({
    home: fixture.home,
    projectRoot: fixture.project,
    args: ["--scope", "global", "--include", "mcp", "--from", "claude", "--to", "codex", "--apply"],
    env,
  });
}

test("~/.claude.json mcpServers.notion becomes a managed [mcp_servers.notion] block (golden)", () => {
  withFixture("mcp-reverse-happy", (fixture) => {
    const specs = [{ area: "mcp", variant: "happy" }];
    layClaudeHome(fixture.home, specs);
    const beforeSnapshot = snapshotTree(fixture.home);

    const result = applyMcp(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    layExpectedCodex(fixture.expectedHome, specs);
    assertGolden(fixture.home, fixture.expectedHome, { ignore: GOLDEN_IGNORE });
    assertPrefixesUnchanged(fixture.home, beforeSnapshot, CLAUDE_SOURCE_PREFIXES);
  });
});

test("streamable-http server keeps every HTTP header as codex http_headers (golden)", () => {
  withFixture("mcp-reverse-http-headers", (fixture) => {
    const specs = [{ area: "mcp", variant: "http-headers" }];
    layClaudeHome(fixture.home, specs);
    const beforeSnapshot = snapshotTree(fixture.home);

    const result = applyMcp(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    layExpectedCodex(fixture.expectedHome, specs);
    assertGolden(fixture.home, fixture.expectedHome, { ignore: GOLDEN_IGNORE });
    assertPrefixesUnchanged(fixture.home, beforeSnapshot, CLAUDE_SOURCE_PREFIXES);
  });
});

test("mcp apply reaches parity: status reports no entries and a second apply is a no-op", () => {
  withFixture("mcp-reverse-parity", (fixture) => {
    const specs = [{ area: "mcp", variant: "http-headers" }];
    layClaudeHome(fixture.home, specs);

    const first = applyMcp(fixture);
    assert.equal(first.status, 0, `first apply failed: ${first.output}`);

    const status = runStatus({
      home: fixture.home,
      projectRoot: fixture.project,
      args: ["--scope", "global", "--include", "mcp", "--json"],
    });
    assert.equal(status.status, 0, `status failed: ${status.output}`);
    const report = JSON.parse(status.stdout);
    assert.deepEqual(report.entries, [], "status must reach parity after one apply");

    const afterFirst = snapshotTree(fixture.home, { ignore: [".ai-config-sync-manager/"] });
    const second = applyMcp(fixture);
    assert.equal(second.status, 0, `second apply failed: ${second.output}`);
    assertPrefixesUnchanged(fixture.home, afterFirst, [".codex"]);
  });
});
