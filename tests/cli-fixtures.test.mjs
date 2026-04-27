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

function runCli(fixture, args, input) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: fixture.project,
    env: {
      ...process.env,
      AI_CONFIG_SYNC_HOME: fixture.home
    },
    encoding: "utf8",
    input
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
  assert.deepEqual(report.entries[0].itemQualities, { notion: "exact" });
});

test("global MCP status reads Claude servers from configurable global paths", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.home, ".claude"), { recursive: true });
  mkdirSync(join(fixture.home, ".codex"), { recursive: true });
  writeJson(join(fixture.home, ".claude.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.home, ".codex/config.toml"), "");

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "global", "--include", "mcp:notion", "--json"]));

  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].area, "mcp");
  assert.equal(report.entries[0].claudePath, join(fixture.home, ".claude/mcp.json"));
  assert.deepEqual(report.entries[0].claudeMcpPaths, [join(fixture.home, ".claude.json")]);
  assert.deepEqual(report.entries[0].missingInCodex, ["notion"]);
});

test("global MCP status reads Claude settings and Codex JSON MCP paths", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.home, ".claude"), { recursive: true });
  mkdirSync(join(fixture.home, ".codex"), { recursive: true });
  writeJson(join(fixture.home, ".claude/settings.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeJson(join(fixture.home, ".codex/mcp.json"), {
    mcpServers: {
      github: { command: "github-mcp-server" }
    }
  });
  writeFileSync(join(fixture.home, ".codex/config.toml"), "");

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "global", "--include", "mcp", "--json"]));

  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].area, "mcp");
  assert.deepEqual(report.entries[0].claudeMcpPaths, [join(fixture.home, ".claude/settings.json")]);
  assert.deepEqual(report.entries[0].codexMcpPaths, [join(fixture.home, ".codex/config.toml"), join(fixture.home, ".codex/mcp.json")]);
  assert.deepEqual(report.entries[0].missingInCodex, ["notion"]);
  assert.deepEqual(report.entries[0].missingInClaude, ["github"]);
});

test("project MCP status reads Codex JSON MCP path", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), { mcpServers: {} });
  writeJson(join(fixture.project, ".codex/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "mcp:notion", "--json"]));

  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].area, "mcp");
  const projectRoot = realpathSync(fixture.project);
  assert.deepEqual(report.entries[0].codexMcpPaths, [join(projectRoot, ".codex/config.toml"), join(projectRoot, ".codex/mcp.json")]);
  assert.deepEqual(report.entries[0].missingInClaude, ["notion"]);
});

test("global MCP sync can copy from secondary Claude MCP path", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.home, ".claude"), { recursive: true });
  mkdirSync(join(fixture.home, ".codex"), { recursive: true });
  writeJson(join(fixture.home, ".claude.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.home, ".codex/config.toml"), "");

  const output = runCli(fixture, ["sync", "--scope", "global", "--include", "mcp:notion", "--apply"]);
  const config = readFileSync(join(fixture.home, ".codex/config.toml"), "utf8");

  assert.match(output, /merged MCP servers claude -> codex: notion/);
  assert.match(config, /\[mcp_servers\.notion\]/);
  assert.match(config, /args = \["notion-mcp"\]/);
});

test("global instructions status reads Claude settings instructions", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.home, ".claude"), { recursive: true });
  mkdirSync(join(fixture.home, ".codex"), { recursive: true });
  writeJson(join(fixture.home, ".claude/settings.json"), { instructions: "claude settings instructions" });
  writeFileSync(join(fixture.home, ".codex/AGENTS.md"), "codex instructions\n");

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "global", "--include", "instructions", "--json"]));

  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].area, "instructions");
  assert.equal(report.entries[0].claudePath, join(fixture.home, ".claude/CLAUDE.md"));
  assert.deepEqual(report.entries[0].claudeInstructionPaths, [join(fixture.home, ".claude/settings.json#instructions")]);
  assert.match(report.entries[0].claude, /1 source\(s\) sha256:/);
});

test("global instructions status reads Codex config instructions", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.home, ".claude"), { recursive: true });
  mkdirSync(join(fixture.home, ".codex"), { recursive: true });
  writeFileSync(join(fixture.home, ".claude/CLAUDE.md"), "claude instructions\n");
  writeFileSync(join(fixture.home, ".codex/config.toml"), 'instructions = "codex config instructions"\n');

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "global", "--include", "instructions", "--json"]));

  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].area, "instructions");
  assert.deepEqual(report.entries[0].codexInstructionPaths, [join(fixture.home, ".codex/config.toml#instructions")]);
  assert.match(report.entries[0].codex, /1 source\(s\) sha256:/);
});

test("status supports compact and tree output formats", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const compact = runCli(fixture, ["status", "--scope", "project", "--include", "mcp:notion", "--compact"]);
  const tree = runCli(fixture, ["status", "--scope", "project", "--include", "mcp:notion", "--tree"]);

  assert.match(compact, /^status: 1 diff\(s\) detected for project scope\./);
  assert.match(compact, /project\/mcp \[safe\] missing-in-codex: notion \[exact\]/);
  assert.match(tree, /project\/\n  mcp\/\n    \[safe\] MCP servers differ/);
  assert.match(tree, /missing-in-codex: notion \[exact\]/);
});

test("status labels permission mapping quality per item", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/settings.json"), {
    permissions: {
      allow: ["Bash", "WebFetch"]
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "permissions:Bash,permissions:WebFetch", "--json"]));

  assert.equal(report.entries[0].itemQualities.Bash, "exact");
  assert.equal(report.entries[0].itemQualities.WebFetch, "approximate");
});

test("commands support command-specific help", () => {
  const fixture = createFixture();
  const connectHelp = runCli(fixture, ["connect", "--help"]);
  const statusHelp = runCli(fixture, ["status", "--help"]);
  const syncHelp = runCli(fixture, ["sync", "--help"]);

  assert.match(connectHelp, /Usage:\n  ai-config-sync connect/);
  assert.match(statusHelp, /--compact/);
  assert.match(statusHelp, /--tree/);
  assert.match(syncHelp, /--plan-json/);
  assert.match(syncHelp, /--confirm/);
  assert.match(syncHelp, /--from claude\|codex/);
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
  assert.match(config, /\[mcp_servers\.notion\.tools\.search\]/);
  assert.match(config, /approval_mode = "approve"/);
  assert.doesNotMatch(config, /# BEGIN ai-config-sync permissions/);
  assert.doesNotMatch(config, /# permissions\.allow/);
  assert.match(rules, /prefix_rule\(pattern=\["npm","run","check"\], decision="allow"/);
  assert.ok(existsSync(join(backupRoot(output), realpathSync(fixture.project), ".codex/config.toml")));
});

test("sync supports JSON plan output", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const plan = JSON.parse(runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "mcp:notion",
    "--plan-json"
  ]));

  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.route, "auto");
  assert.equal(plan.confirm, false);
  assert.equal(plan.requiresConfirmation, false);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].action, "merge-mcp-servers");
  assert.deepEqual(plan.operations[0].serverNames, ["notion"]);
  assert.deepEqual(plan.operations[0].itemQualities, { notion: "exact" });
  assert.deepEqual(plan.results, []);
});

test("default sync plans Codex-only config toward Claude", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), { mcpServers: {} });
  writeFileSync(join(fixture.project, ".codex/config.toml"), [
    "[mcp_servers.notion]",
    'command = "npx"',
    'args = ["notion-mcp"]',
    ""
  ].join("\n"));

  const plan = JSON.parse(runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "mcp:notion",
    "--plan-json"
  ]));

  assert.equal(plan.route, "auto");
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].from, "codex");
  assert.equal(plan.operations[0].to, "claude");
  assert.deepEqual(plan.operations[0].serverNames, ["notion"]);
});

test("default sync applies Codex-only config to Claude", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), { mcpServers: {} });
  writeFileSync(join(fixture.project, ".codex/config.toml"), [
    "[mcp_servers.notion]",
    'command = "npx"',
    'args = ["notion-mcp"]',
    ""
  ].join("\n"));

  const output = runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "mcp:notion",
    "--apply"
  ]);
  const mcp = JSON.parse(readFileSync(join(fixture.project, ".claude/mcp.json"), "utf8"));

  assert.match(output, /merged MCP servers codex -> claude: notion/);
  assert.deepEqual(mcp.mcpServers.notion, { command: "npx", args: ["notion-mcp"] });
});

test("default sync propagates Codex deletion to Claude after baseline", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), [
    "[mcp_servers.notion]",
    'command = "npx"',
    'args = ["notion-mcp"]',
    ""
  ].join("\n"));

  runCli(fixture, ["sync", "--scope", "project", "--apply"]);
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const output = runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "mcp:notion",
    "--apply"
  ]);
  const mcp = JSON.parse(readFileSync(join(fixture.project, ".claude/mcp.json"), "utf8"));

  assert.match(output, /deleted mcp item\(s\) from claude: notion/);
  assert.deepEqual(mcp.mcpServers, {});
});

test("default sync propagates Claude addition to Codex after baseline", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), { mcpServers: {} });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  runCli(fixture, ["sync", "--scope", "project", "--apply"]);
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });

  const output = runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "mcp:notion",
    "--apply"
  ]);
  const config = readFileSync(join(fixture.project, ".codex/config.toml"), "utf8");

  assert.match(output, /merged MCP servers claude -> codex: notion/);
  assert.match(config, /\[mcp_servers\.notion\]/);
});


test("sync confirm flag marks apply plans as requiring confirmation", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const plan = JSON.parse(runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "mcp:notion",
    "--confirm",
    "--plan-json"
  ]));

  assert.equal(plan.mode, "apply");
  assert.equal(plan.confirm, true);
  assert.equal(plan.requiresConfirmation, true);
});

test("sync confirm applies only after explicit yes", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const output = runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "mcp:notion",
    "--confirm"
  ], "yes\n");
  const config = readFileSync(join(fixture.project, ".codex/config.toml"), "utf8");

  assert.match(output, /Apply this sync plan\? Type yes to continue:/);
  assert.match(output, /applied: merged MCP servers claude -> codex: notion/);
  assert.match(config, /\[mcp_servers\.notion\]/);
});

test("sync plan includes permission review notes for risky and approximate mappings", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/settings.json"), {
    permissions: {
      allow: ["Bash", "WebFetch"]
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const text = runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "permissions:Bash,permissions:WebFetch",
    "--dry-run"
  ]);
  const plan = JSON.parse(runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "permissions:Bash,permissions:WebFetch",
    "--plan-json"
  ]));

  assert.match(text, /Review notes:/);
  assert.match(text, /Patch preview:/);
  assert.match(text, /rules\/default\.rules prefix_rule\(pattern=\[\], decision="allow"/);
  assert.match(text, /config\.toml approval_policy = "on-request"/);
  assert.match(text, /Bash: broad, interpreter, shell-wrapper, network, or destructive command/);
  assert.match(text, /WebFetch: maps to a broad Codex approval policy/);
  assert.equal(plan.operations[0].patchPreview[0].item, "allow:Bash");
  assert.deepEqual(plan.operations[0].patchPreview[0].changes, ['rules/default.rules prefix_rule(pattern=[], decision="allow", justification="Migrated from Claude allow permission Bash.")']);
  assert.deepEqual(plan.operations[0].patchPreview[1].changes, ['config.toml approval_policy = "on-request"']);
  assert.deepEqual(plan.operations[0].reviewNotes, [
    "Bash: broad, interpreter, shell-wrapper, network, or destructive command will be written as a prefix_rule; review before apply",
    "WebFetch: maps to a broad Codex approval policy; review before relying on equivalent behavior"
  ]);
});

test("sync apply keeps unsupported permission mappings as managed metadata", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/settings.json"), {
    permissions: {
      allow: ["Bash", "WebFetch"]
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "permissions:Bash,permissions:WebFetch",
    "--apply"
  ]);
  const config = readFileSync(join(fixture.project, ".codex/config.toml"), "utf8");
  const rules = readFileSync(join(fixture.project, ".codex/rules/default.rules"), "utf8");

  assert.match(config, /approval_policy = "on-request"/);
  assert.match(config, /# permissions\.allow = "WebFetch"/);
  assert.doesNotMatch(config, /# permissions\.allow = "Bash"/);
  assert.match(rules, /prefix_rule\(pattern=\[\], decision="allow"/);
});

test("sync apply converts Codex native permissions back to Claude permissions", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex/rules"), { recursive: true });
  writeJson(join(fixture.project, ".claude/settings.json"), { permissions: {} });
  writeFileSync(join(fixture.project, ".codex/config.toml"), [
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    'web_search = "live"',
    "",
    "[mcp_servers.github]",
    'command = "github-mcp-server"',
    'enabled_tools = ["search_repositories", "get_issue"]',
    'disabled_tools = ["delete_repository"]',
    "",
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
    "permissions:Bash(npm run check:*),permissions:mcp__notion__search,permissions:WebSearch,permissions:mcp__github__search_repositories,permissions:mcp__github__delete_repository,permissions:Write,permissions:Edit,permissions:MultiEdit",
    "--apply"
  ]);
  const settings = JSON.parse(readFileSync(join(fixture.project, ".claude/settings.json"), "utf8"));

  assert.deepEqual(settings.permissions.ask, ["Bash(npm run check:*)"]);
  assert.deepEqual(settings.permissions.allow, ["Edit", "MultiEdit", "WebSearch", "Write", "mcp__github__search_repositories", "mcp__notion__search"]);
  assert.deepEqual(settings.permissions.deny, ["mcp__github__delete_repository"]);
  assert.ok(!settings.permissions.allow.includes("approval_policy"));
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

  assert.match(output, /Patch preview:/);
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
  assert.doesNotMatch(config, /# BEGIN ai-config-sync hooks/);
});

test("sync apply keeps unsupported hooks as managed metadata", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/settings.json"), {
    hooks: {
      Notification: [
        {
          hooks: [
            {
              type: "webhook",
              url: "https://example.invalid/hook"
            }
          ]
        }
      ]
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  runCli(fixture, ["sync", "--scope", "project", "--include", "hooks:Notification", "--apply"]);
  const config = readFileSync(join(fixture.project, ".codex/config.toml"), "utf8");

  assert.match(config, /# BEGIN ai-config-sync hooks/);
  assert.match(config, /# hooks\.Notification = /);
  assert.doesNotMatch(config, /\[\[hooks\.Notification\]\]/);
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
