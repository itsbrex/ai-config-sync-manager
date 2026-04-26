import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../bin/ai-config-sync.mjs", import.meta.url));

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "ai-config-sync-test-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { root, home, project };
}

function runCli(fixture, args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: fixture.project,
    env: {
      ...process.env,
      AI_CONFIG_SYNC_HOME: fixture.home
    },
    encoding: "utf8"
  });
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function backupRoot(output) {
  const match = output.match(/^Backup root: (.+)$/m);
  assert.ok(match, "sync output should include a backup root");
  return match[1];
}

test("status supports item selectors for MCP servers", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] },
      playwright: { command: "npx", args: ["playwright-mcp"] }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), [
    "[mcp_servers.playwright]",
    'command = "npx"',
    'args = ["playwright-mcp"]',
    ""
  ].join("\n"));

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "mcp:notion", "--json"]));

  assert.deepEqual(report.include, ["mcp:notion"]);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].area, "mcp");
  assert.deepEqual(report.entries[0].missingInCodex, ["notion"]);
});

test("connect registers missing host integrations in an isolated home", () => {
  const fixture = createFixture();

  const output = runCli(fixture, ["connect"]);
  const installed = JSON.parse(readFileSync(join(fixture.home, ".claude/plugins/installed_plugins.json"), "utf8"));
  const marketplace = JSON.parse(readFileSync(join(fixture.home, ".agents/plugins/marketplace.json"), "utf8"));

  assert.match(output, /ok: registered default root/);
  assert.match(output, /ok: registered Claude plugin/);
  assert.match(output, /ok: registered Codex plugin/);
  assert.ok(existsSync(join(fixture.home, ".ai-config-sync-manager")));
  assert.ok(existsSync(join(fixture.home, ".claude/plugins/config-manager@ai-config-sync-manager/bin/ai-config-sync")));
  assert.ok(existsSync(join(fixture.home, "plugins/ai-config-sync-manager/bin/ai-config-sync")));
  assert.equal(
    installed.plugins["config-manager@ai-config-sync-manager"][0].installPath,
    join(fixture.home, ".claude/plugins/config-manager@ai-config-sync-manager")
  );
  assert.equal(marketplace.plugins[0].name, "ai-config-sync-manager");
});

test("status reports same-name skill content drift as a manual conflict", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/skills/review"), { recursive: true });
  mkdirSync(join(fixture.project, ".agents/skills/review"), { recursive: true });
  writeFileSync(join(fixture.project, ".claude/skills/review/SKILL.md"), "# Review\nClaude version\n");
  writeFileSync(join(fixture.project, ".agents/skills/review/SKILL.md"), "# Review\nCodex version\n");

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "skills:review", "--json"]));

  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].area, "skills");
  assert.equal(report.entries[0].risk, "manual");
  assert.deepEqual(report.entries[0].conflicts, ["review"]);
});

test("status keeps missing skills as safe copy candidates", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/skills/review"), { recursive: true });
  writeFileSync(join(fixture.project, ".claude/skills/review/SKILL.md"), "# Review\n");

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "skills:review", "--json"]));

  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].area, "skills");
  assert.equal(report.entries[0].risk, "safe");
  assert.deepEqual(report.entries[0].missingInCodex, ["review"]);
});

test("sync apply maps Bash permissions, MCP tool approvals, and creates backups", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/settings.json"), {
    permissions: {
      allow: ["Bash(npm run check:*)", "mcp__notion__search"]
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "approval_policy = \"never\"\n");

  const output = runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "permissions:Bash(npm run check:*),permissions:mcp__notion__search",
    "--apply"
  ]);
  const config = readFileSync(join(fixture.project, ".codex/config.toml"), "utf8");
  const rules = readFileSync(join(fixture.project, ".codex/rules/default.rules"), "utf8");

  assert.match(output, /approval required: no/i);
  assert.match(config, /# permissions\.allow = "Bash\(npm run check:\*\)"/);
  assert.match(config, /\[mcp_servers\.notion\.tools\.search\]/);
  assert.match(config, /approval_mode = "approve"/);
  assert.match(rules, /prefix_rule\(pattern=\["npm","run","check"\], decision="allow"/);
  assert.ok(existsSync(join(backupRoot(output), realpathSync(fixture.project), ".codex/config.toml")));
});

test("sync apply converts Codex prefix rules and MCP approvals back to Claude permissions", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex/rules"), { recursive: true });
  writeJson(join(fixture.project, ".claude/settings.json"), { permissions: {} });
  writeFileSync(join(fixture.project, ".codex/config.toml"), [
    "[mcp_servers.notion.tools.search]",
    'approval_mode = "approve"',
    ""
  ].join("\n"));
  writeFileSync(
    join(fixture.project, ".codex/rules/default.rules"),
    'prefix_rule(pattern=["npm","run","check"], decision="prompt", justification="test")\n'
  );

  runCli(fixture, [
    "sync",
    "--from",
    "codex",
    "--to",
    "claude",
    "--scope",
    "project",
    "--include",
    "permissions:Bash(npm run check:*),permissions:mcp__notion__search",
    "--apply"
  ]);
  const settings = JSON.parse(readFileSync(join(fixture.project, ".claude/settings.json"), "utf8"));

  assert.deepEqual(settings.permissions.ask, ["Bash(npm run check:*)"]);
  assert.deepEqual(settings.permissions.allow, ["mcp__notion__search"]);
});

test("sync apply merges MCP servers without secret-like env values", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: {
        command: "node",
        args: ["server.js"],
        env: {
          NOTION_TOKEN: "secret",
          SAFE_ENV: "visible"
        }
      }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const output = runCli(fixture, ["sync", "--scope", "project", "--include", "mcp:notion", "--apply"]);
  const config = readFileSync(join(fixture.project, ".codex/config.toml"), "utf8");

  assert.match(output, /MCP patch preview:/);
  assert.match(output, /notion: add/);
  assert.match(output, /env\.SAFE_ENV: "visible"/);
  assert.match(output, /metadata-only env\.NOTION_TOKEN: skipped secret-like value/);
  assert.match(config, /\[mcp_servers\.notion\]/);
  assert.match(config, /SAFE_ENV = "visible"/);
  assert.doesNotMatch(config, /NOTION_TOKEN/);
  assert.doesNotMatch(config, /secret/);
});

test("sync apply converts Claude command hooks to Codex native hook TOML", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/settings.json"), {
    hooks: {
      PostToolUse: [
        {
          matcher: "Write",
          hooks: [
            {
              type: "command",
              command: "npm run check",
              timeout: 30,
              statusMessage: "checking"
            }
          ]
        }
      ]
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  runCli(fixture, ["sync", "--scope", "project", "--include", "hooks:PostToolUse", "--apply"]);
  const config = readFileSync(join(fixture.project, ".codex/config.toml"), "utf8");

  assert.match(config, /\[features\]/);
  assert.match(config, /codex_hooks = true/);
  assert.match(config, /\[\[hooks\.PostToolUse\]\]/);
  assert.match(config, /matcher = "Write"/);
  assert.match(config, /command = "npm run check"/);
  assert.match(config, /timeout = 30/);
});

test("sync apply converts Codex native hooks back to Claude settings", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/settings.json"), {});
  writeFileSync(join(fixture.project, ".codex/config.toml"), [
    "[features]",
    "codex_hooks = true",
    "",
    "[[hooks.PostToolUse]]",
    'matcher = "Write"',
    "[[hooks.PostToolUse.hooks]]",
    'type = "command"',
    'command = "npm run check"',
    "timeout = 30",
    'statusMessage = "checking"',
    ""
  ].join("\n"));

  runCli(fixture, [
    "sync",
    "--from",
    "codex",
    "--to",
    "claude",
    "--scope",
    "project",
    "--include",
    "hooks:PostToolUse",
    "--apply"
  ]);
  const settings = JSON.parse(readFileSync(join(fixture.project, ".claude/settings.json"), "utf8"));

  assert.deepEqual(settings.hooks.PostToolUse, [
    {
      matcher: "Write",
      hooks: [
        {
          type: "command",
          command: "npm run check",
          timeout: 30,
          statusMessage: "checking"
        }
      ]
    }
  ]);
});
