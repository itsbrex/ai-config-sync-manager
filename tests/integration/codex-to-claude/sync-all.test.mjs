import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupFixture,
  createIntegrationFixture,
  layCodexHome,
  mergeCodexConfigToml,
} from "../helpers/fixture.mjs";
import { runSync } from "../helpers/run-cli.mjs";
import {
  readClaudeMcpFromHome,
  readClaudeSettings,
  readSyncState,
  scanClaudeAgents,
  scanClaudeSkills,
} from "../helpers/readers.mjs";
import { assertSourceUnchanged, snapshotTree } from "../helpers/snapshot.mjs";

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

function layAllHappy(home) {
  layCodexHome(home, [
    { area: "instructions", variant: "happy" },
    { area: "skills", variant: "happy" },
    { area: "agents", variant: "happy" },
  ]);
  mergeCodexConfigToml(home, [
    { area: "mcp", variant: "happy" },
    { area: "permissions", variant: "manual-allow" },
    { area: "hooks", variant: "manual-pre-tool-use" },
  ]);
}

function applyAll(fixture, env = {}) {
  return runSync({
    home: fixture.home,
    projectRoot: fixture.project,
    args: ["--scope", "global", "--from", "codex", "--to", "claude", "--apply"],
    env,
  });
}

test("single apply syncs all 6 areas at once", () => {
  withFixture("sync-all-happy", (fixture) => {
    layAllHappy(fixture.home);

    const result = applyAll(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    assert.equal(
      existsSync(join(fixture.home, ".claude", "CLAUDE.md")),
      true,
      "instructions: expected ~/.claude/CLAUDE.md"
    );

    const skills = scanClaudeSkills(fixture.home);
    assert.ok(
      skills.has("hello"),
      `skills: expected 'hello' skill, got: ${[...skills.keys()].join(", ")}`
    );

    const agents = scanClaudeAgents(fixture.home);
    assert.ok(
      agents.has("translate"),
      `agents: expected 'translate' agent, got: ${[...agents.keys()].join(", ")}`
    );

    const servers = readClaudeMcpFromHome(fixture.home);
    assert.ok(
      servers.notion,
      `mcp: expected notion server in ~/.claude.json, got: ${JSON.stringify(servers)}`
    );

    const settings = readClaudeSettings(fixture.home);
    const allow = settings.permissions?.allow ?? [];
    assert.ok(
      Array.isArray(allow) && allow.includes("WebSearch"),
      `permissions: expected WebSearch in allow, got: ${JSON.stringify(allow)}`
    );

    assert.ok(
      settings.hooks?.PreToolUse,
      `hooks: expected PreToolUse in settings.hooks, got: ${JSON.stringify(settings.hooks)}`
    );
  });
});

test("state file records tracked areas with schemaVersion 1", () => {
  withFixture("sync-all-state", (fixture) => {
    layAllHappy(fixture.home);

    const result = applyAll(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    const state = readSyncState(fixture.home, "global");
    assert.ok(state, "expected global state file");
    assert.equal(state.schemaVersion, 1, `schemaVersion expected 1, got ${state?.schemaVersion}`);

    const areas = state.areas ?? {};
    // instructions is body-only and not tracked in state.areas; the other 5 are.
    for (const area of ["skills", "agents", "mcp", "permissions", "hooks"]) {
      assert.ok(areas[area], `state.areas should include '${area}': ${JSON.stringify(state)}`);
    }
  });
});

test("second apply leaves the resulting claude tree unchanged", () => {
  withFixture("sync-all-idempotent", (fixture) => {
    layAllHappy(fixture.home);

    const first = applyAll(fixture);
    assert.equal(first.status, 0, `first apply failed: ${first.output}`);

    const afterFirst = snapshotTree(join(fixture.home, ".claude"));

    const second = applyAll(fixture);
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

test("source under .codex and .agents stays unchanged", () => {
  withFixture("sync-all-source-unchanged", (fixture) => {
    layAllHappy(fixture.home);
    const beforeSnapshot = snapshotTree(fixture.home);

    const result = applyAll(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    assertSourceUnchanged(fixture.home, beforeSnapshot);
  });
});
