import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { cleanupFixture, createIntegrationFixture, layClaudeHome } from "../helpers/fixture.mjs";
import { runSync } from "../helpers/run-cli.mjs";
import { snapshotTree } from "../helpers/snapshot.mjs";

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

function applyMcp(fixture) {
  return runSync({
    home: fixture.home,
    projectRoot: fixture.project,
    args: ["--scope", "global", "--include", "mcp", "--from", "claude", "--to", "codex", "--apply"],
  });
}

// the writer fences servers in ai-config-sync markers, so bytes cannot match the hand-written config.toml fixture
test("mcpServers.notion becomes a managed [mcp_servers.notion] block", () => {
  withFixture("mcp-reverse-apply-happy", (fixture) => {
    const specs = [{ area: "mcp", variant: "happy" }];
    layClaudeHome(fixture.home, specs);
    const sourceBefore = readFileSync(join(fixture.home, ".claude.json"), "utf8");

    const result = applyMcp(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    const toml = readFileSync(join(fixture.home, ".codex", "config.toml"), "utf8");
    assert.match(toml, /^# BEGIN ai-config-sync mcp-servers$/m);
    assert.match(toml, /^# END ai-config-sync mcp-servers$/m);
    assert.match(toml, /^\[mcp_servers\.notion\]$/m);
    assert.match(toml, /^command = "npx"$/m);
    assert.match(toml, /^args = \["-y","@notionhq\/notion-mcp-server"\]$/m);

    assert.equal(
      readFileSync(join(fixture.home, ".claude.json"), "utf8"),
      sourceBefore,
      "apply must not mutate the claude source ~/.claude.json"
    );
  });
});

test("second apply is idempotent", () => {
  withFixture("mcp-reverse-idempotent", (fixture) => {
    const specs = [{ area: "mcp", variant: "happy" }];
    layClaudeHome(fixture.home, specs);

    const first = applyMcp(fixture);
    assert.equal(first.status, 0, `first apply failed: ${first.output}`);

    const afterFirst = snapshotTree(join(fixture.home, ".codex"));

    const second = applyMcp(fixture);
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
