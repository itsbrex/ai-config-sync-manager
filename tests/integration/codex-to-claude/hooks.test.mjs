import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  cleanupFixture,
  createIntegrationFixture,
  layCodexHome,
  layExpectedClaude,
} from "../helpers/fixture.mjs";
import { assertGolden } from "../helpers/golden.mjs";
import { runPlanJson, runSync } from "../helpers/run-cli.mjs";
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

function applyHooks(fixture, env = {}) {
  return runSync({
    home: fixture.home,
    projectRoot: fixture.project,
    args: [
      "--scope",
      "global",
      "--include",
      "hooks",
      "--from",
      "codex",
      "--to",
      "claude",
      "--apply",
    ],
    env,
  });
}

test("manual-pre-tool-use: codex [[hooks.PreToolUse]] becomes claude hooks.PreToolUse (golden)", () => {
  withFixture("hooks-manual-pre-tool-use", (fixture) => {
    const specs = [{ area: "hooks", variant: "manual-pre-tool-use" }];
    layCodexHome(fixture.home, specs);
    const beforeSnapshot = snapshotTree(fixture.home);

    const result = applyHooks(fixture);
    assert.equal(result.status, 0, `apply failed: ${result.output}`);

    layExpectedClaude(fixture.expectedHome, specs);
    assertGolden(fixture.home, fixture.expectedHome, { ignore: GOLDEN_IGNORE });
    assertSourceUnchanged(fixture.home, beforeSnapshot);
  });
});

test("plan json marks hooks area as manual risk", () => {
  withFixture("hooks-plan-manual-risk", (fixture) => {
    const specs = [{ area: "hooks", variant: "manual-pre-tool-use" }];
    layCodexHome(fixture.home, specs);

    const planJson = runPlanJson({
      home: fixture.home,
      projectRoot: fixture.project,
      include: ["hooks"],
    });

    const planText = JSON.stringify(planJson);
    assert.ok(planText.includes('"hooks"'), `expected plan to reference hooks area: ${planText}`);
    assert.ok(
      planText.includes("manual"),
      `expected plan to mark hooks area as manual risk: ${planText}`
    );
  });
});

test("second apply is idempotent", () => {
  withFixture("hooks-idempotent", (fixture) => {
    const specs = [{ area: "hooks", variant: "manual-pre-tool-use" }];
    layCodexHome(fixture.home, specs);

    const first = applyHooks(fixture);
    assert.equal(first.status, 0, `first apply failed: ${first.output}`);

    const settingsPath = join(fixture.home, ".claude", "settings.json");
    const afterFirst = readFileSync(settingsPath, "utf8");
    const firstParsed = JSON.parse(afterFirst);
    const firstPre = (firstParsed.hooks && firstParsed.hooks.PreToolUse) || [];

    const second = applyHooks(fixture);
    assert.equal(second.status, 0, `second apply failed: ${second.output}`);

    const afterSecond = readFileSync(settingsPath, "utf8");
    const secondParsed = JSON.parse(afterSecond);
    const secondPre = (secondParsed.hooks && secondParsed.hooks.PreToolUse) || [];
    assert.equal(
      secondPre.length,
      firstPre.length,
      `hooks.PreToolUse length must not grow: first=${JSON.stringify(firstPre)} second=${JSON.stringify(secondPre)}`
    );
  });
});
