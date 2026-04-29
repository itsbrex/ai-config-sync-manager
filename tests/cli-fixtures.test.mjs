import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

function runCli(fixture, args, input, extraEnv = {}) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: fixture.project,
    env: {
      ...process.env,
      AI_CONFIG_SYNC_HOME: fixture.home,
      ...extraEnv
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

function statusDetailPath(output) {
  const match = output.match(/^Detail file: (.+)$/m);
  assert.ok(match, "status output should include a detail file path");
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
  assert.deepEqual(report.entries[0].claudeInstructionCheckedPaths, [
    join(fixture.home, ".claude/CLAUDE.md"),
    join(fixture.home, ".claude/settings.json")
  ]);
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
  assert.match(compact, /details: Claude has it; Codex missing\./);
  assert.match(tree, /project\/\n  mcp\/\n    \[safe\] MCP servers differ/);
  assert.match(tree, /missing-in-codex: notion \[exact\]/);
  assert.match(tree, /details: Claude has it; Codex missing\./);
});

test("default status prints grouped apply-ready diff status", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const output = runCli(fixture, ["status", "--scope", "project", "--include", "mcp:notion"]);

  assert.match(output, /Result:/);
  assert.match(output, /- 1 safe item\(s\)/);
  assert.match(output, /Diff status:/);
  assert.match(output, /codex:/);
  assert.match(output, /project\/mcp: \+notion \[exact\] \(missing in Codex, safe\)/);
  assert.match(output, /details: Claude has it; Codex missing\./);
  assert.match(output, /action: copy Claude -> Codex/);
  assert.match(output, /apply: ai-config-sync sync --scope project --include mcp:notion --apply/);
  assert.match(output, /Detail file: /);
  assert.match(readFileSync(statusDetailPath(output), "utf8"), /project\/mcp: \+notion \[exact\]/);
});

test("default status details content differs sources", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.project, "CLAUDE.md"), "claude instructions\n");
  writeFileSync(join(fixture.project, "AGENTS.md"), "codex instructions\n");

  const output = runCli(fixture, ["status", "--scope", "project", "--include", "instructions"]);

  assert.match(output, /review:/);
  assert.match(output, /project\/instructions: ~instructions \[equivalent\] \(content differs, safe\)/);
  assert.match(output, /details: Default sync updates Codex from Claude\. Claude: sources: .*CLAUDE\.md; checked: .*CLAUDE\.md, .*\.claude\/settings\.json \(1 source\(s\) sha256:/);
  assert.match(output, /Codex: sources: .*AGENTS\.md; checked: .*AGENTS\.md, .*\.codex\/config\.toml \(1 source\(s\) sha256:/);
  assert.match(output, /diff:/);
  assert.match(output, /- Codex current L1: codex instructions/);
  assert.match(output, /\+ After apply from Claude L1: claude instructions/);
});

test("instructions status treats terminology-mapped model names as equivalent", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.project, "CLAUDE.md"), "Use opus4.7(latest) for hard reasoning.\n");
  writeFileSync(join(fixture.project, "AGENTS.md"), "Use gpt-5.5 for hard reasoning.\n");

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "instructions", "--json"]));

  assert.equal(report.entries.length, 0);
});

test("default status collapses large area diffs and writes full detail file", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/skills"), { recursive: true });
  mkdirSync(join(fixture.project, ".agents/skills"), { recursive: true });

  for (let index = 0; index < 12; index += 1) {
    const skill = `skill-${index}`;
    mkdirSync(join(fixture.project, ".claude/skills", skill), { recursive: true });
    writeFileSync(join(fixture.project, ".claude/skills", skill, "SKILL.md"), `# ${skill}\n`);
  }

  const output = runCli(fixture, ["status", "--scope", "project", "--include", "skills"]);
  const detail = readFileSync(statusDetailPath(output), "utf8");

  assert.match(output, /project\/skills: \+12 \(12 diff\(s\), safe\)/);
  assert.match(output, /hidden because this area has 10\+ item diffs/);
  assert.doesNotMatch(output, /skill-11 \[exact\]/);
  assert.match(detail, /project\/skills: \+skill-11 \[exact\] \(missing in Codex, safe\)/);
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
  assert.match(syncHelp, /--from claude\|codex/);
});

test("connect registers missing host integrations in an isolated home", () => {
  const fixture = createFixture();

  const output = runCli(fixture, ["connect"]);
  const installed = JSON.parse(readFileSync(join(fixture.home, ".claude/plugins/installed_plugins.json"), "utf8"));
  const marketplace = JSON.parse(readFileSync(join(fixture.home, ".agents/plugins/marketplace.json"), "utf8"));
  const statusIgnore = JSON.parse(readFileSync(join(fixture.home, ".ai-config-sync-manager/rules/status-ignore.json"), "utf8"));

  assert.match(output, /ok: initialized config root/);
  assert.match(output, /ok: initialized status ignore/);
  assert.match(output, /ok: registered Claude plugin/);
  assert.match(output, /ok: registered Codex plugin/);
  assert.ok(existsSync(join(fixture.home, ".ai-config-sync-manager")));
  assert.deepEqual(statusIgnore, { version: 1, exclude: [] });
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
  writeFileSync(join(fixture.project, ".claude/skills/review/SKILL.md"), "# Review\nmodel: opus\n");
  writeFileSync(join(fixture.project, ".agents/skills/review/SKILL.md"), "# Review\nCodex version\n");

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "skills:review", "--json"]));

  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].area, "skills");
  assert.equal(report.entries[0].risk, "manual");
  assert.deepEqual(report.entries[0].conflicts, ["review"]);

  const output = runCli(fixture, ["status", "--scope", "project", "--include", "skills:review"]);
  assert.match(output, /project\/skills: !review \[unsupported\] \(conflict, manual\)/);
  assert.match(output, /action: sync area/);
  assert.match(output, /apply: ai-config-sync sync --scope project --include skills:review --apply/);
  assert.match(output, /- Codex current L2: Codex version/);
  assert.match(output, /\+ After apply from Claude L2: model: gpt-5\.5/);
  assert.match(readFileSync(statusDetailPath(output), "utf8"), /\+ After apply from Claude L2: model: gpt-5\.5/);
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

test("status ignore file hides diffs until the rule is removed", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/skills/review"), { recursive: true });
  mkdirSync(join(fixture.project, ".ai-config-sync-manager"), { recursive: true });
  writeFileSync(join(fixture.project, ".claude/skills/review/SKILL.md"), "# Review\n");
  writeJson(join(fixture.project, ".ai-config-sync-manager/status-ignore.json"), {
    version: 1,
    exclude: [
      { scope: "project", area: "skills", item: "review" }
    ]
  });

  const ignored = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "skills:review", "--json"]));
  assert.equal(ignored.statusIgnored, 1);
  assert.equal(ignored.statusIgnorePath, join(realpathSync(fixture.project), ".ai-config-sync-manager/status-ignore.json"));
  assert.equal(ignored.entries.length, 0);

  writeJson(join(fixture.project, ".ai-config-sync-manager/status-ignore.json"), {
    version: 1,
    exclude: []
  });
  const visible = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "skills:review", "--json"]));
  assert.equal(visible.statusIgnored, 0);
  assert.equal(visible.entries.length, 1);
});

test("status ignore file also removes entries from sync plans", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  mkdirSync(join(fixture.project, ".ai-config-sync-manager"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");
  writeJson(join(fixture.project, ".ai-config-sync-manager/status-ignore.json"), {
    version: 1,
    exclude: [
      { scope: "project", area: "mcp", item: "notion" }
    ]
  });

  const plan = JSON.parse(runCli(fixture, ["sync", "--scope", "project", "--include", "mcp:notion", "--plan-json"]));

  assert.equal(plan.ignored, 1);
  assert.equal(plan.ignorePath, join(realpathSync(fixture.project), ".ai-config-sync-manager/status-ignore.json"));
  assert.equal(plan.operations.length, 0);
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

test("sync apply without scope applies global and project scopes", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.home, ".claude"), { recursive: true });
  mkdirSync(join(fixture.home, ".codex"), { recursive: true });
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.home, ".claude/mcp.json"), {
    mcpServers: {
      globalNotion: { command: "npx", args: ["global-notion-mcp"] }
    }
  });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      projectNotion: { command: "npx", args: ["project-notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.home, ".codex/config.toml"), "");
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const output = runCli(fixture, ["sync", "--include", "mcp", "--apply"]);
  const globalConfig = readFileSync(join(fixture.home, ".codex/config.toml"), "utf8");
  const projectConfig = readFileSync(join(fixture.project, ".codex/config.toml"), "utf8");

  assert.match(output, /Scope: global/);
  assert.match(output, /Scope: project/);
  assert.match(globalConfig, /\[mcp_servers\.globalNotion\]/);
  assert.match(projectConfig, /\[mcp_servers\.projectNotion\]/);
});

test("sync dry-run without scope plans global and project scopes", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.home, ".claude"), { recursive: true });
  mkdirSync(join(fixture.home, ".codex"), { recursive: true });
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.home, ".claude/mcp.json"), {
    mcpServers: {
      globalNotion: { command: "npx", args: ["global-notion-mcp"] }
    }
  });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      projectNotion: { command: "npx", args: ["project-notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.home, ".codex/config.toml"), "");
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const plan = JSON.parse(runCli(fixture, ["sync", "--include", "mcp", "--plan-json"]));

  assert.deepEqual(plan.scopes, ["global", "project"]);
  assert.equal(plan.plans.length, 2);
  assert.equal(plan.plans[0].mode, "dry-run");
  assert.equal(plan.plans[0].scope, "global");
  assert.equal(plan.plans[1].scope, "project");
});

test("default sync plans equivalent instruction content diffs", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/settings.json"), { instructions: "claude settings instructions" });
  writeFileSync(join(fixture.project, "AGENTS.md"), "codex instructions\n");

  const plan = JSON.parse(runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "instructions",
    "--plan-json"
  ]));

  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].risk, "safe");
  assert.equal(plan.operations[0].action, "write-instructions");
  assert.equal(plan.operations[0].approvalRequired, false);
  assert.equal(plan.operations[0].targetPath, join(realpathSync(fixture.project), "AGENTS.md"));
  assert.equal(plan.operations[0].content, "claude settings instructions");
  assert.deepEqual(plan.operations[0].changePreview, [
    "- Codex current L1: codex instructions",
    "+ After apply from Claude L1: claude settings instructions"
  ]);
});

test("sync apply writes equivalent instruction content diffs", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  writeJson(join(fixture.project, ".claude/settings.json"), { instructions: "claude settings instructions" });
  writeFileSync(join(fixture.project, "AGENTS.md"), "codex instructions\n");

  const output = runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "instructions",
    "--apply"
  ]);
  const agents = readFileSync(join(fixture.project, "AGENTS.md"), "utf8");

  assert.match(output, /wrote instructions/);
  assert.equal(agents, "claude settings instructions\n");
});

test("sync applies default terminology mappings to instructions", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.project, "CLAUDE.md"), "Use CLAUDE.md with opus4.7(latest), thinking budget, and Task-tool delegation.\n");
  writeFileSync(join(fixture.project, "AGENTS.md"), "old\n");

  const output = runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "instructions",
    "--apply"
  ]);
  const agents = readFileSync(join(fixture.project, "AGENTS.md"), "utf8");

  assert.match(output, /Term mapping: .*rules\/terminology-map\.json/);
  assert.match(output, /Target templates: .*rules\/host-target-templates\.json/);
  assert.equal(agents, "Use AGENTS.md with gpt-5.5, reasoning effort, and Codex spawn_agent delegation.\n");
});

test("sync applies host target templates to generic host surfaces", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.project, "CLAUDE.md"), "Use a Claude slash command with Claude hook handler and Task tool.\n");
  writeFileSync(join(fixture.project, "AGENTS.md"), "old\n");

  runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "instructions",
    "--apply"
  ]);
  const agents = readFileSync(join(fixture.project, "AGENTS.md"), "utf8");

  assert.equal(agents, "Use a Codex skill command with Codex native hook and Codex spawn_agent delegation.\n");
});

test("sync applies project host target template override", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, "rules"), { recursive: true });
  writeJson(join(fixture.project, "rules/host-target-templates.json"), {
    version: 1,
    templates: [
      {
        id: "qa",
        aliases: {
          claude: ["qa skill"],
          codex: ["qa command"]
        },
        target: {
          claude: "custom Claude QA template",
          codex: "custom Codex QA template"
        }
      }
    ]
  });
  writeFileSync(join(fixture.project, "CLAUDE.md"), "Run the qa skill.\n");
  writeFileSync(join(fixture.project, "AGENTS.md"), "old\n");

  runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "instructions",
    "--apply"
  ]);
  const agents = readFileSync(join(fixture.project, "AGENTS.md"), "utf8");

  assert.equal(agents, "Run the custom Codex QA template.\n");
});

test("sync applies project terminology mapping override", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, "rules"), { recursive: true });
  writeJson(join(fixture.project, "rules/terminology-map.json"), {
    version: 1,
    rules: [
      {
        id: "custom-model",
        claude: ["custom-claude-model"],
        codex: ["custom-codex-model"]
      }
    ]
  });
  writeFileSync(join(fixture.project, "CLAUDE.md"), "Use custom-claude-model.\n");
  writeFileSync(join(fixture.project, "AGENTS.md"), "old\n");

  runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "instructions",
    "--apply"
  ]);
  const agents = readFileSync(join(fixture.project, "AGENTS.md"), "utf8");

  assert.equal(agents, "Use custom-codex-model.\n");
});

test("sync applies layered project terminology mapping override", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, "rules"), { recursive: true });
  writeJson(join(fixture.project, "rules/terminology-map.json"), {
    version: 2,
    layers: [
      {
        id: "custom-layer",
        rules: [
          {
            id: "custom-layer-model",
            claude: ["layer-claude-model"],
            codex: ["layer-codex-model"]
          }
        ]
      }
    ]
  });
  writeFileSync(join(fixture.project, "CLAUDE.md"), "Use layer-claude-model.\n");
  writeFileSync(join(fixture.project, "AGENTS.md"), "old\n");

  runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "instructions",
    "--apply"
  ]);
  const agents = readFileSync(join(fixture.project, "AGENTS.md"), "utf8");

  assert.equal(agents, "Use layer-codex-model.\n");
});

test("sync apply replaces manual skill conflicts without per-operation approval", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/skills/review"), { recursive: true });
  mkdirSync(join(fixture.project, ".agents/skills/review"), { recursive: true });
  writeFileSync(join(fixture.project, ".claude/skills/review/SKILL.md"), "# Review\nmodel: opus\n");
  writeFileSync(join(fixture.project, ".agents/skills/review/SKILL.md"), "# Review\nCodex version\n");

  const output = runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "skills:review",
    "--apply"
  ]);
  const skill = readFileSync(join(fixture.project, ".agents/skills/review/SKILL.md"), "utf8");

  assert.match(output, /\[manual\] project\/skills: copy-missing-skills/);
  assert.match(output, /Approval required: no/);
  assert.match(output, /Change preview:/);
  assert.match(output, /review: target will be replaced from Claude/);
  assert.match(output, /- Target current L2: Codex version/);
  assert.match(output, /\+ After apply from Claude L2: model: gpt-5\.5/);
  assert.match(output, /replaced skill review/);
  assert.equal(skill, "# Review\nmodel: gpt-5.5\n");
});

test("sync applies terminology mappings when copying skills", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/skills/review"), { recursive: true });
  writeFileSync(join(fixture.project, ".claude/skills/review/SKILL.md"), "# Review\nUse CLAUDE.md with Opus.\n");

  runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "skills:review",
    "--apply"
  ]);
  const skill = readFileSync(join(fixture.project, ".agents/skills/review/SKILL.md"), "utf8");

  assert.equal(skill, "# Review\nUse AGENTS.md with gpt-5.5.\n");
});

test("sync applies host target templates when copying skills", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/skills/host-surface"), { recursive: true });
  writeFileSync(join(fixture.project, ".claude/skills/host-surface/SKILL.md"), "# Host Surface\nUse Claude plugin command and Claude command hook.\n");

  runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "skills:host-surface",
    "--apply"
  ]);
  const skill = readFileSync(join(fixture.project, ".agents/skills/host-surface/SKILL.md"), "utf8");

  assert.equal(skill, "# Host Surface\nUse Codex skill command and Codex native hook.\n");
});

test("sync regex-translates agent file paths and extensions when copying skills", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/skills/agent-path"), { recursive: true });
  writeFileSync(
    join(fixture.project, ".claude/skills/agent-path/SKILL.md"),
    "# Agent Path\nRead .claude/agents/preview-tester.md for your role.\n"
  );

  runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "skills:agent-path",
    "--apply"
  ]);
  const skill = readFileSync(join(fixture.project, ".agents/skills/agent-path/SKILL.md"), "utf8");

  assert.equal(skill, "# Agent Path\nRead .codex/agents/preview-tester.toml for your role.\n");
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
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].action, "merge-mcp-servers");
  assert.deepEqual(plan.operations[0].serverNames, ["notion"]);
  assert.deepEqual(plan.operations[0].itemQualities, { notion: "exact" });
  assert.deepEqual(plan.results, []);
});

test("default sync plans Codex-only config toward Claude", () => {
  // Direction-aware semantics: with AI_CONFIG_SYNC_HOST=codex, default
  // direction flips to codex->claude, so a Codex-only item is a + copy
  // into Claude (rather than a delete from Codex under the default
  // claude->codex direction).
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

  const plan = JSON.parse(runCli(
    fixture,
    [
      "sync",
      "--scope",
      "project",
      "--include",
      "mcp:notion",
      "--plan-json"
    ],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  ));

  assert.equal(plan.route, "auto");
  assert.equal(plan.from, "codex");
  assert.equal(plan.to, "claude");
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].action, "merge-mcp-servers");
  assert.equal(plan.operations[0].from, "codex");
  assert.equal(plan.operations[0].to, "claude");
  assert.deepEqual(plan.operations[0].serverNames, ["notion"]);
});

test("default sync applies Codex-only config to Claude", () => {
  // Mirror of the planning test above: with codex-host direction, the
  // Codex-only item becomes a + copy applied into Claude.
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

  const output = runCli(
    fixture,
    [
      "sync",
      "--scope",
      "project",
      "--include",
      "mcp:notion",
      "--apply"
    ],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );
  const mcp = JSON.parse(readFileSync(join(fixture.project, ".claude/mcp.json"), "utf8"));

  assert.match(output, /merged MCP servers codex -> claude: notion/);
  assert.deepEqual(mcp.mcpServers.notion, { command: "npx", args: ["notion-mcp"] });
});

test("default sync propagates Codex deletion to Claude after baseline", () => {
  // Direction alone now drives delete detection; baseline tracking is no
  // longer required. With AI_CONFIG_SYNC_HOST=codex, an item present in
  // Claude but absent from Codex (the source) is a delete from Claude.
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  const output = runCli(
    fixture,
    [
      "sync",
      "--scope",
      "project",
      "--include",
      "mcp:notion",
      "--apply"
    ],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );
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

test("default sync deletes Claude skill not present in Codex (codex->claude direction)", () => {
  // Direction-driven delete: with codex as source (host=codex), a skill
  // that exists only on the Claude target is removed via deleteSkillItems.
  // The original directory is replaced by a backup copy.
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/skills/orphan"), { recursive: true });
  writeFileSync(join(fixture.project, ".claude/skills/orphan/SKILL.md"), "# Orphan\n");
  // Codex side exists but does not contain the skill.
  mkdirSync(join(fixture.project, ".agents/skills"), { recursive: true });

  const output = runCli(
    fixture,
    [
      "sync",
      "--scope",
      "project",
      "--include",
      "skills:orphan",
      "--apply"
    ],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );

  const claudeSkillDir = join(fixture.project, ".claude/skills/orphan");
  assert.equal(existsSync(claudeSkillDir), false, "claude-side skill directory should be removed");
  assert.match(output, /deleted skills item\(s\) from claude: orphan/);

  const backup = backupRoot(output);
  assert.ok(existsSync(backup), "backup root directory should exist");
  // process.cwd() resolves symlinks (e.g. /var -> /private/var on macOS),
  // and backupPath() strips the leading "/" then joins under backupRoot.
  // Reconstruct the same path off the resolved project root.
  const projectRoot = realpathSync(fixture.project);
  const backupPath = join(backup, join(projectRoot, ".claude/skills/orphan/SKILL.md").replace(/^\/+/, ""));
  assert.ok(
    existsSync(backupPath),
    `backup should contain SKILL.md for the deleted skill at ${backupPath}`
  );
});

test("default sync deletes Claude agent not present in Codex (codex->claude direction)", () => {
  // Direction-driven delete: an agent file present only on the Claude
  // target is removed via deleteAgentItems with backup intact.
  const fixture = createFixture();
  writeClaudeAgent(
    join(fixture.project, ".claude/agents/orphan.md"),
    { name: "orphan", description: "Orphan agent", model: "opus" },
    "Orphan agent body"
  );
  mkdirSync(join(fixture.project, ".codex/agents"), { recursive: true });

  const output = runCli(
    fixture,
    [
      "sync",
      "--scope",
      "project",
      "--include",
      "agents:orphan",
      "--apply"
    ],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );

  const claudeAgentPath = join(fixture.project, ".claude/agents/orphan.md");
  assert.equal(existsSync(claudeAgentPath), false, "claude-side agent file should be removed");
  assert.match(output, /deleted agents item\(s\) from claude: orphan/);

  const backup = backupRoot(output);
  // backupPath() mirrors the resolved cwd-rooted absolute path under backupRoot.
  const projectRoot = realpathSync(fixture.project);
  const backupAgentPath = join(backup, join(projectRoot, ".claude/agents/orphan.md").replace(/^\/+/, ""));
  assert.ok(
    existsSync(backupAgentPath),
    `backup should contain the deleted agent file at ${backupAgentPath}`
  );
});

test("default sync deletes Codex skill not present in Claude (claude->codex direction)", () => {
  // Mirror of the codex->claude case: with the default direction
  // (claude is source), a Codex-only skill is removed.
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/skills"), { recursive: true });
  mkdirSync(join(fixture.project, ".agents/skills/orphan"), { recursive: true });
  writeFileSync(join(fixture.project, ".agents/skills/orphan/SKILL.md"), "# Orphan\n");

  const output = runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "skills:orphan",
    "--apply"
  ]);

  const codexSkillDir = join(fixture.project, ".agents/skills/orphan");
  assert.equal(existsSync(codexSkillDir), false, "codex-side skill directory should be removed");
  assert.match(output, /deleted skills item\(s\) from codex: orphan/);

  const backup = backupRoot(output);
  const projectRoot = realpathSync(fixture.project);
  const backupSkillFile = join(backup, join(projectRoot, ".agents/skills/orphan/SKILL.md").replace(/^\/+/, ""));
  assert.ok(
    existsSync(backupSkillFile),
    `backup should contain SKILL.md for the deleted skill at ${backupSkillFile}`
  );
});

test("explicit --from codex --to claude deletes Claude-only item", () => {
  // The explicit route shares the same direction-aware algorithm as auto:
  // a skill missing from the source (Codex) is deleted from the target
  // (Claude), regardless of whether the route was inferred or explicit.
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/skills/orphan"), { recursive: true });
  writeFileSync(join(fixture.project, ".claude/skills/orphan/SKILL.md"), "# Orphan\n");
  mkdirSync(join(fixture.project, ".agents/skills"), { recursive: true });

  const plan = JSON.parse(runCli(fixture, [
    "sync",
    "--from",
    "codex",
    "--to",
    "claude",
    "--scope",
    "project",
    "--include",
    "skills:orphan",
    "--plan-json"
  ]));

  assert.equal(plan.route, "explicit");
  assert.equal(plan.from, "codex");
  assert.equal(plan.to, "claude");
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].action, "delete-items");
  assert.equal(plan.operations[0].area, "skills");
  assert.equal(plan.operations[0].from, "codex");
  assert.equal(plan.operations[0].to, "claude");
  assert.deepEqual(plan.operations[0].itemNames, ["orphan"]);
});

test("direction-driven plan reports - symbol for missing-in-source items", () => {
  // The status table representation marks missing-in-source items with a
  // '-' symbol and labels the action "delete from <Target>". The plan
  // JSON correspondingly emits a delete-items operation pointing at the
  // target host. Both surfaces are checked here against the same fixture.
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude"), { recursive: true });
  mkdirSync(join(fixture.project, ".codex"), { recursive: true });
  writeJson(join(fixture.project, ".claude/mcp.json"), {
    mcpServers: {
      notion: { command: "npx", args: ["notion-mcp"] }
    }
  });
  writeFileSync(join(fixture.project, ".codex/config.toml"), "");

  // With AI_CONFIG_SYNC_HOST=codex, source=codex and notion is only on the
  // Claude target -> action should label as "delete from Claude".
  const statusReport = JSON.parse(runCli(
    fixture,
    [
      "status",
      "--scope",
      "project",
      "--include",
      "mcp:notion",
      "--json"
    ],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  ));

  const entry = statusReport.entries.find((item) => item.area === "mcp");
  assert.ok(entry, "expected an mcp status entry");
  // The diff data is symmetric; "missingInCodex" simply means Claude has
  // an item Codex lacks. The direction-aware interpretation lives in the
  // plan and rendered status surfaces below.
  assert.deepEqual(entry.missingInCodex, ["notion"]);
  assert.deepEqual(entry.missingInClaude ?? [], []);
  // Driven from the same data, the direction-aware sync plan exposes the
  // delete operation to the same target host.
  const plan = JSON.parse(runCli(
    fixture,
    [
      "sync",
      "--scope",
      "project",
      "--include",
      "mcp:notion",
      "--plan-json"
    ],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  ));

  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].action, "delete-items");
  assert.equal(plan.operations[0].to, "claude");
  assert.deepEqual(plan.operations[0].itemNames, ["notion"]);

  // The default text status output exposes the symbol/action labels.
  const text = runCli(
    fixture,
    [
      "status",
      "--scope",
      "project",
      "--include",
      "mcp:notion"
    ],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );

  assert.match(text, /-notion/);
  assert.match(text, /delete from Claude/);
});

test("sync rejects unknown --confirm flag with a helpful error", () => {
  const fixture = createFixture();
  let error;
  try {
    runCli(fixture, ["sync", "--confirm"]);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "expected --confirm to throw");
  assert.match(error.stderr ?? error.message ?? "", /Unknown option for sync: --confirm/);
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

test("status treats Claude file-write permissions as equivalent to Codex workspace-write after apply", () => {
  for (const permission of ["Write", "Edit", "MultiEdit"]) {
    const fixture = createFixture();
    mkdirSync(join(fixture.project, ".claude"), { recursive: true });
    mkdirSync(join(fixture.project, ".codex"), { recursive: true });
    writeJson(join(fixture.project, ".claude/settings.json"), {
      permissions: {
        allow: [permission]
      }
    });
    writeFileSync(join(fixture.project, ".codex/config.toml"), "");

    runCli(fixture, ["sync", "--scope", "project", "--include", `permissions:${permission}`, "--apply"]);
    const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "permissions", "--json"]));
    const permissionEntries = report.entries.filter((entry) => entry.area === "permissions");

    assert.equal(
      permissionEntries.length,
      0,
      `expected ${permission} to be equivalent to workspace-write, got: ${JSON.stringify(permissionEntries)}`
    );
  }
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

test("AI_CONFIG_SYNC_HOST=codex flips default sync direction to codex -> claude", () => {
  const fixture = createFixture();
  const plan = JSON.parse(runCli(
    fixture,
    ["sync", "--scope", "project", "--plan-json"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  ));

  assert.equal(plan.from, "codex");
  assert.equal(plan.to, "claude");
  assert.equal(plan.route, "auto");
});

test("AI_CONFIG_SYNC_HOST=claude keeps default sync direction as claude -> codex", () => {
  const fixture = createFixture();
  const plan = JSON.parse(runCli(
    fixture,
    ["sync", "--scope", "project", "--plan-json"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "claude" }
  ));

  assert.equal(plan.from, "claude");
  assert.equal(plan.to, "codex");
  assert.equal(plan.route, "auto");
});

test("status reflects AI_CONFIG_SYNC_HOST=codex in direction header and details wording", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.project, "CLAUDE.md"), "claude side instructions\n");
  writeFileSync(join(fixture.project, "AGENTS.md"), "codex side instructions\n");

  const output = runCli(
    fixture,
    ["status", "--scope", "project", "--include", "instructions"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );

  assert.match(output, /Default sync direction: codex -> claude/);
  assert.match(output, /Default sync updates Claude from Codex/);
});

test("status keeps claude -> codex direction by default", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.project, "CLAUDE.md"), "claude side instructions\n");
  writeFileSync(join(fixture.project, "AGENTS.md"), "codex side instructions\n");

  const output = runCli(
    fixture,
    ["status", "--scope", "project", "--include", "instructions"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "claude" }
  );

  assert.match(output, /Default sync direction: claude -> codex/);
  assert.match(output, /Default sync updates Codex from Claude/);
});

test("status instruction diff preview labels follow AI_CONFIG_SYNC_HOST=codex direction", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.project, "CLAUDE.md"), "claude line one\n");
  writeFileSync(join(fixture.project, "AGENTS.md"), "codex line one\n");

  const output = runCli(
    fixture,
    ["status", "--scope", "project", "--include", "instructions"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );

  const detail = readFileSync(statusDetailPath(output), "utf8");
  assert.match(detail, /Claude current L1: claude line one/);
  assert.match(detail, /After apply from Codex L1:/);
  assert.doesNotMatch(detail, /Codex current L1:/);
  assert.doesNotMatch(detail, /After apply from Claude L1:/);
});

test("status instruction diff preview labels keep claude->codex labels by default", () => {
  const fixture = createFixture();
  writeFileSync(join(fixture.project, "CLAUDE.md"), "claude line one\n");
  writeFileSync(join(fixture.project, "AGENTS.md"), "codex line one\n");

  const output = runCli(
    fixture,
    ["status", "--scope", "project", "--include", "instructions"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "claude" }
  );

  const detail = readFileSync(statusDetailPath(output), "utf8");
  assert.match(detail, /Codex current L1: codex line one/);
  assert.match(detail, /After apply from Claude L1:/);
});

test("compact and tree status formats include direction", () => {
  const fixture = createFixture();
  const compact = runCli(
    fixture,
    ["status", "--scope", "project", "--compact"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );
  const tree = runCli(
    fixture,
    ["status", "--scope", "project", "--tree"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );

  assert.match(compact, /direction=codex->claude/);
  assert.match(tree, /Default sync direction: codex -> claude/);
});

test("sync plan render shows default direction even on auto route", () => {
  const fixture = createFixture();
  const output = runCli(
    fixture,
    ["sync", "--scope", "project"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );

  assert.match(output, /Route: auto \(diff-directed, default codex -> claude\)/);
});

test("status JSON includes direction object", () => {
  const fixture = createFixture();
  const report = JSON.parse(runCli(
    fixture,
    ["status", "--scope", "project", "--json"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  ));

  assert.equal(report.source, "codex");
  assert.equal(report.target, "claude");
  assert.deepEqual(report.direction, { from: "codex", to: "claude" });
});

test("explicit --from --to overrides AI_CONFIG_SYNC_HOST", () => {
  const fixture = createFixture();
  const plan = JSON.parse(runCli(
    fixture,
    ["sync", "--from", "claude", "--to", "codex", "--scope", "project", "--plan-json"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  ));

  assert.equal(plan.from, "claude");
  assert.equal(plan.to, "codex");
  assert.equal(plan.route, "explicit");
});

function writeClaudeAgent(path, frontmatter, body) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push("---", "", body);
  writeFileSync(path, `${lines.join("\n")}\n`);
}

function writeCodexAgent(path, fields) {
  mkdirSync(dirname(path), { recursive: true });
  const order = ["name", "description", "model", "model_reasoning_effort", "developer_instructions"];
  const lines = [];
  for (const key of order) {
    if (fields[key] === undefined || fields[key] === null) continue;
    lines.push(`${key} = ${JSON.stringify(String(fields[key]))}`);
  }
  writeFileSync(path, `${lines.join("\n")}\n`);
}

test("agents status reports Claude-only agent as missing in Codex", () => {
  const fixture = createFixture();
  writeClaudeAgent(
    join(fixture.project, ".claude/agents/sample.md"),
    { name: "sample", description: "Sample agent", model: "opus" },
    "Sample agent body"
  );
  mkdirSync(join(fixture.project, ".codex/agents"), { recursive: true });

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "agents", "--json"]));

  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].area, "agents");
  assert.equal(report.entries[0].risk, "safe");
  assert.deepEqual(report.entries[0].missingInCodex, ["sample"]);
  assert.deepEqual(report.entries[0].missingInClaude, []);
  assert.equal(report.entries[0].itemQualities.sample, "exact");
});

test("agents status reports Codex-only agent as missing in Claude", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/agents"), { recursive: true });
  writeCodexAgent(join(fixture.project, ".codex/agents/sample.toml"), {
    name: "sample",
    description: "Sample agent",
    model: "gpt-5.4",
    developer_instructions: "Sample agent body"
  });

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "agents", "--json"]));

  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].area, "agents");
  assert.deepEqual(report.entries[0].missingInClaude, ["sample"]);
  assert.deepEqual(report.entries[0].missingInCodex, []);
  assert.equal(report.entries[0].itemQualities.sample, "exact");
});

test("agents status flags same-name agents with diverged bodies as conflict", () => {
  const fixture = createFixture();
  writeClaudeAgent(
    join(fixture.project, ".claude/agents/sample.md"),
    { name: "sample", description: "Sample", model: "opus" },
    "Claude side body"
  );
  writeCodexAgent(join(fixture.project, ".codex/agents/sample.toml"), {
    name: "sample",
    description: "Sample",
    model: "gpt-5.4",
    developer_instructions: "Different codex body"
  });

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "agents", "--json"]));

  const conflictEntry = report.entries.find((entry) => entry.area === "agents" && Array.isArray(entry.conflicts) && entry.conflicts.length > 0);
  assert.ok(conflictEntry, "expected an agents conflict entry");
  assert.equal(conflictEntry.risk, "manual");
  assert.deepEqual(conflictEntry.conflicts, ["sample"]);
});

test("agents status treats transform-equivalent bodies as no diff", () => {
  const fixture = createFixture();
  const body = "Use opus for the latest model";
  writeClaudeAgent(
    join(fixture.project, ".claude/agents/sample.md"),
    { name: "sample", description: "Sample", model: "opus" },
    body
  );
  writeCodexAgent(join(fixture.project, ".codex/agents/sample.toml"), {
    name: "sample",
    description: "Sample",
    model: "gpt-5.4",
    developer_instructions: `\n${body}\n`
  });

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "agents", "--json"]));

  const agentsEntries = report.entries.filter((entry) => entry.area === "agents");
  assert.equal(agentsEntries.length, 0);
});

test("agents status ignores migration preamble in Codex developer_instructions", () => {
  const fixture = createFixture();
  const body = "Shared agent body";
  writeClaudeAgent(
    join(fixture.project, ".claude/agents/sample.md"),
    { name: "sample", description: "Sample", model: "opus" },
    body
  );
  writeCodexAgent(join(fixture.project, ".codex/agents/sample.toml"), {
    name: "sample",
    description: "Sample",
    model: "gpt-5.4",
    developer_instructions: `Migrated from Claude agent: /old/path\n\n\n${body}\n`
  });

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "agents", "--json"]));

  const agentsEntries = report.entries.filter((entry) => entry.area === "agents");
  assert.equal(agentsEntries.length, 0);
});

test("agents sync apply copies Claude agent to Codex with model alias", () => {
  const fixture = createFixture();
  writeClaudeAgent(
    join(fixture.project, ".claude/agents/sample.md"),
    { name: "sample", description: "Example agent", model: "opus" },
    "Hello, agent body."
  );
  mkdirSync(join(fixture.project, ".codex/agents"), { recursive: true });

  const output = runCli(fixture, ["sync", "--scope", "project", "--include", "agents:sample", "--apply"]);
  const codexFile = readFileSync(join(fixture.project, ".codex/agents/sample.toml"), "utf8");

  assert.match(output, /copied agent sample -> .*\.codex\/agents\/sample\.toml/);
  assert.match(output, /Backup root: /);
  assert.match(codexFile, /^name = "sample"$/m);
  assert.match(codexFile, /^description = "Example agent"$/m);
  assert.match(codexFile, /^model = "gpt-5\.5"$/m);
  assert.match(codexFile, /developer_instructions = "[^"]*Hello, agent body\./);
});

test("agents sync apply derives name and description from body when Claude frontmatter is missing them", () => {
  const fixture = createFixture();
  const claudePath = join(fixture.project, ".claude/agents/sample.md");
  mkdirSync(dirname(claudePath), { recursive: true });
  writeFileSync(claudePath, "---\nmodel: opus\n---\n# Sample Heading\n\nThis agent reviews pull requests for security issues.\n\nMore detailed instructions follow.\n");
  mkdirSync(join(fixture.project, ".codex/agents"), { recursive: true });

  runCli(fixture, ["sync", "--scope", "project", "--include", "agents:sample", "--apply"]);
  const codexFile = readFileSync(join(fixture.project, ".codex/agents/sample.toml"), "utf8");

  assert.match(codexFile, /^name = "sample"$/m);
  assert.match(codexFile, /^description = "This agent reviews pull requests for security issues\."$/m);
});

test("agents sync apply copies Codex agent to Claude with reverse model alias", () => {
  const fixture = createFixture();
  mkdirSync(join(fixture.project, ".claude/agents"), { recursive: true });
  writeCodexAgent(join(fixture.project, ".codex/agents/sample.toml"), {
    name: "sample",
    description: "Example agent",
    model: "gpt-5.4",
    developer_instructions: "Migrated from Claude agent: /old/path\n\nReal codex content"
  });

  const output = runCli(
    fixture,
    ["sync", "--scope", "project", "--include", "agents:sample", "--apply"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );
  const claudeFile = readFileSync(join(fixture.project, ".claude/agents/sample.md"), "utf8");

  assert.match(output, /copied agent sample -> .*\.claude\/agents\/sample\.md/);
  assert.match(claudeFile, /^name: sample$/m);
  assert.match(claudeFile, /^description: Example agent$/m);
  assert.match(claudeFile, /^model: sonnet$/m);
  assert.match(claudeFile, /Real codex content/);
  assert.doesNotMatch(claudeFile, /Migrated from Claude agent/);
});

test("agents sync apply preserves Codex metadata-only fields when overwriting", () => {
  const fixture = createFixture();
  writeClaudeAgent(
    join(fixture.project, ".claude/agents/sample.md"),
    { name: "sample", description: "Sample", model: "opus", tools: "Read,Edit", color: "blue" },
    "Claude side body"
  );
  writeCodexAgent(join(fixture.project, ".codex/agents/sample.toml"), {
    name: "sample",
    description: "Sample",
    model: "gpt-5.4",
    model_reasoning_effort: "high",
    developer_instructions: "Older codex body"
  });

  runCli(fixture, ["sync", "--scope", "project", "--include", "agents:sample", "--apply"]);
  const codexFile = readFileSync(join(fixture.project, ".codex/agents/sample.toml"), "utf8");

  assert.match(codexFile, /^model_reasoning_effort = "high"$/m);
  assert.match(codexFile, /developer_instructions = "[^"]*Claude side body/);
  assert.doesNotMatch(codexFile, /Older codex body/);
});

test("agents sync apply preserves Claude metadata-only fields when overwriting", () => {
  const fixture = createFixture();
  writeClaudeAgent(
    join(fixture.project, ".claude/agents/sample.md"),
    { name: "sample", description: "Sample", model: "opus", tools: "Read,Edit", color: "blue" },
    "Older claude body"
  );
  writeCodexAgent(join(fixture.project, ".codex/agents/sample.toml"), {
    name: "sample",
    description: "Sample",
    model: "gpt-5.4",
    developer_instructions: "Codex side body"
  });

  runCli(
    fixture,
    ["sync", "--scope", "project", "--include", "agents:sample", "--apply"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );
  const claudeFile = readFileSync(join(fixture.project, ".claude/agents/sample.md"), "utf8");

  assert.match(claudeFile, /^tools: Read,Edit$/m);
  assert.match(claudeFile, /^color: blue$/m);
  assert.match(claudeFile, /Codex side body/);
  assert.doesNotMatch(claudeFile, /Older claude body/);
});

test("agents sync apply with selector limits work to a single agent", () => {
  const fixture = createFixture();
  for (const name of ["foo", "bar"]) {
    writeClaudeAgent(
      join(fixture.project, ".claude/agents", `${name}.md`),
      { name, description: `Agent ${name}`, model: "opus" },
      `Body of ${name}`
    );
  }
  mkdirSync(join(fixture.project, ".codex/agents"), { recursive: true });

  runCli(fixture, ["sync", "--scope", "project", "--include", "agents:foo", "--apply"]);

  assert.equal(existsSync(join(fixture.project, ".codex/agents/foo.toml")), true);
  assert.equal(existsSync(join(fixture.project, ".codex/agents/bar.toml")), false);
});

test("agents status labels mapping quality as exact for matched agents", () => {
  const fixture = createFixture();
  writeClaudeAgent(
    join(fixture.project, ".claude/agents/foo.md"),
    { name: "foo", description: "Agent foo", model: "opus" },
    "Foo body"
  );
  writeClaudeAgent(
    join(fixture.project, ".claude/agents/bar.md"),
    { name: "bar", description: "Agent bar", model: "opus" },
    "Bar body"
  );
  writeCodexAgent(join(fixture.project, ".codex/agents/foo.toml"), {
    name: "foo",
    description: "Agent foo",
    model: "gpt-5.4",
    developer_instructions: "\nFoo body\n"
  });

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "agents", "--json"]));

  const entry = report.entries.find((item) => item.area === "agents");
  assert.ok(entry, "expected agents entry");
  assert.deepEqual(entry.missingInCodex, ["bar"]);
  assert.equal(entry.itemQualities.bar, "exact");
});

test("agents sync propagates Claude-side deletion to Codex after baseline", () => {
  const fixture = createFixture();
  writeClaudeAgent(
    join(fixture.project, ".claude/agents/sample.md"),
    { name: "sample", description: "Sample", model: "opus" },
    "Sample body"
  );
  mkdirSync(join(fixture.project, ".codex/agents"), { recursive: true });

  runCli(fixture, ["sync", "--scope", "project", "--apply"]);
  assert.equal(existsSync(join(fixture.project, ".codex/agents/sample.toml")), true);

  rmSync(join(fixture.project, ".claude/agents/sample.md"));

  const plan = JSON.parse(runCli(fixture, [
    "sync",
    "--scope",
    "project",
    "--include",
    "agents:sample",
    "--plan-json"
  ]));

  assert.equal(plan.hasBaseline, true);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].action, "delete-items");
  assert.equal(plan.operations[0].area, "agents");
  assert.equal(plan.operations[0].from, "claude");
  assert.equal(plan.operations[0].to, "codex");
  assert.deepEqual(plan.operations[0].itemNames, ["sample"]);
});

function callsArchivePath(output) {
  const match = output.match(/^Calls archive: (.+)$/m);
  assert.ok(match, "apply output should include a calls archive path");
  return match[1];
}

function writeSkillManifest(skillDir, host, body) {
  const filename = host === "claude" ? "skill.md" : "SKILL.md";
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, filename), body);
}

test("sync apply transforms Agent call inside skill body to Codex marker plus rendered prose", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".claude/skills/preview"),
    "claude",
    [
      "# Preview",
      'Agent({ description: "Run preview tests", subagent_type: "general-purpose", prompt: "Read .claude/agents/preview-tester.md and run." })',
      ""
    ].join("\n")
  );

  runCli(fixture, ["sync", "--scope", "project", "--include", "skills:preview", "--apply"]);
  const codexBody = readFileSync(join(fixture.project, ".agents/skills/preview/SKILL.md"), "utf8");

  assert.match(codexBody, /<!-- ai-config-sync:agent-call \{/);
  assert.match(codexBody, /"call":"Agent"/);
  assert.match(codexBody, /"description":"Run preview tests"/);
  assert.match(codexBody, /"subagent_type":"general-purpose"/);
  assert.match(codexBody, /Use `spawn_agent` with agent_type: "Run preview tests"\./);
  assert.match(codexBody, /\nTask:\n/);
  assert.match(codexBody, /\.codex\/agents\/preview-tester\.toml/);
  assert.doesNotMatch(codexBody, /Agent\(\{/);
});

test("sync apply round-trips Codex agent-call marker back into Claude Agent({...}) call", () => {
  const fixture = createFixture();
  const codexSkillDir = join(fixture.project, ".agents/skills/preview");
  const markerFields = {
    description: "Run preview tests",
    subagent_type: "general-purpose",
    prompt: "Read .codex/agents/preview-tester.toml and run."
  };
  const markerPayload = JSON.stringify({ call: "Agent", fields: markerFields });
  writeSkillManifest(
    codexSkillDir,
    "codex",
    [
      "# Preview",
      `<!-- ai-config-sync:agent-call ${markerPayload} -->`,
      'Use `spawn_agent` with agent_type: "Run preview tests".',
      "",
      "Task:",
      "Read .codex/agents/preview-tester.toml and run.",
      ""
    ].join("\n")
  );

  runCli(
    fixture,
    ["sync", "--scope", "project", "--include", "skills:preview", "--apply"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );
  const claudeBody = readFileSync(join(fixture.project, ".claude/skills/preview/skill.md"), "utf8");

  assert.match(claudeBody, /Agent\(\{/);
  assert.match(claudeBody, /subagent_type: "general-purpose"/);
  assert.match(claudeBody, /description: "Run preview tests"/);
  assert.match(claudeBody, /prompt: "Read \.claude\/agents\/preview-tester\.md and run\."/);
});

test("sync apply leaves unparseable Agent call intact and emits a manual-review marker", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".claude/skills/preview"),
    "claude",
    [
      "# Preview",
      "Agent({ description: someVar, prompt: `Hello ${name}` })",
      ""
    ].join("\n")
  );

  runCli(fixture, ["sync", "--scope", "project", "--include", "skills:preview", "--apply"]);
  const codexBody = readFileSync(join(fixture.project, ".agents/skills/preview/SKILL.md"), "utf8");

  assert.match(codexBody, /Agent\(\{/);
  assert.match(codexBody, /<!-- ai-config-sync:manual-review [^>]*-->Agent\(\{/);
});

test("sync apply does not transform identifier-suffixed call names like MyAgent", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".claude/skills/preview"),
    "claude",
    [
      "# Preview",
      "MyAgent({ x: 1 })",
      ""
    ].join("\n")
  );

  runCli(fixture, ["sync", "--scope", "project", "--include", "skills:preview", "--apply"]);
  const codexBody = readFileSync(join(fixture.project, ".agents/skills/preview/SKILL.md"), "utf8");

  assert.match(codexBody, /MyAgent\(\{/);
  assert.doesNotMatch(codexBody, /<!-- ai-config-sync:agent-call /);
  assert.doesNotMatch(codexBody, /<!-- ai-config-sync:manual-review /);
});

test("sync apply strips unsupported TaskCreate call and writes archive entry", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".claude/skills/preview"),
    "claude",
    [
      "# Preview",
      'TaskCreate({ items: ["task1","task2"] })',
      ""
    ].join("\n")
  );

  const output = runCli(fixture, ["sync", "--scope", "project", "--include", "skills:preview", "--apply"]);
  const codexBody = readFileSync(join(fixture.project, ".agents/skills/preview/SKILL.md"), "utf8");

  assert.doesNotMatch(codexBody, /TaskCreate\(/);
  assert.match(codexBody, /<!-- ai-config-sync:stripped /);
  assert.match(codexBody, /"call":"TaskCreate"/);
  assert.match(codexBody, /"items":\["task1","task2"\]/);

  const archivePath = callsArchivePath(output);
  assert.ok(existsSync(archivePath), `archive file should exist at ${archivePath}`);
  const archive = JSON.parse(readFileSync(archivePath, "utf8"));
  assert.ok(Array.isArray(archive), "archive content should be an array");
  const stripped = archive.find(
    (entry) => entry.call === "TaskCreate" && entry.action === "stripped" && entry.direction === "claude->codex"
  );
  assert.ok(stripped, "expected a stripped TaskCreate entry in the archive");
});

test("sync apply records archive entries for each unsupported call in skill body", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".claude/skills/preview"),
    "claude",
    [
      "# Preview",
      'TaskCreate({ items: ["a"] })',
      'TeamCreate({ name: "alpha" })',
      ""
    ].join("\n")
  );

  const output = runCli(fixture, ["sync", "--scope", "project", "--include", "skills:preview", "--apply"]);
  const archive = JSON.parse(readFileSync(callsArchivePath(output), "utf8"));

  const calls = archive.map((entry) => entry.call);
  assert.ok(calls.includes("TaskCreate"), `expected TaskCreate entry, got: ${calls.join(",")}`);
  assert.ok(calls.includes("TeamCreate"), `expected TeamCreate entry, got: ${calls.join(",")}`);
  assert.ok(archive.length >= 2, `expected at least 2 archive entries, got ${archive.length}`);
});

test("sync apply restores stripped Codex marker into a Claude TaskCreate call", () => {
  const fixture = createFixture();
  const markerPayload = JSON.stringify({
    call: "TaskCreate",
    fields: { items: ["task1", "task2"] },
    reason: "Codex has no native todo/task tracker tool"
  });
  writeSkillManifest(
    join(fixture.project, ".agents/skills/preview"),
    "codex",
    [
      "# Preview",
      `<!-- ai-config-sync:stripped ${markerPayload} -->`,
      ""
    ].join("\n")
  );

  const output = runCli(
    fixture,
    ["sync", "--scope", "project", "--include", "skills:preview", "--apply"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );
  const claudeBody = readFileSync(join(fixture.project, ".claude/skills/preview/skill.md"), "utf8");

  assert.match(claudeBody, /TaskCreate\(\{/);
  assert.match(claudeBody, /items: \["task1","task2"\]/);

  const archive = JSON.parse(readFileSync(callsArchivePath(output), "utf8"));
  const restored = archive.find(
    (entry) => entry.call === "TaskCreate" && entry.action === "restored" && entry.direction === "codex->claude"
  );
  assert.ok(restored, "expected a restored TaskCreate entry in the archive");
});

test("sync dry-run does not write the calls archive file to disk", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".claude/skills/preview"),
    "claude",
    [
      "# Preview",
      'TaskCreate({ items: ["task1","task2"] })',
      ""
    ].join("\n")
  );

  runCli(fixture, ["sync", "--scope", "project", "--include", "skills:preview", "--dry-run"]);
  const backupsRoot = join(fixture.home, ".ai-config-sync-manager/backups");
  assert.equal(
    existsSync(backupsRoot),
    false,
    "dry-run should not create the backups directory or any archive file"
  );
});

test("sync apply renames lowercase Claude skill manifest to uppercase SKILL.md on Codex side", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".claude/skills/foo"),
    "claude",
    "# Foo\nbody\n"
  );

  runCli(fixture, ["sync", "--scope", "project", "--include", "skills:foo", "--apply"]);
  const codexEntries = readdirSync(join(fixture.project, ".agents/skills/foo"));

  assert.ok(codexEntries.includes("SKILL.md"), `expected SKILL.md, got: ${codexEntries.join(",")}`);
  assert.ok(!codexEntries.includes("skill.md"), `did not expect skill.md in ${codexEntries.join(",")}`);
});

test("sync apply renames uppercase Codex skill manifest to lowercase skill.md on Claude side", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".codex/skills/bar"),
    "codex",
    "# Bar\nbody\n"
  );

  runCli(
    fixture,
    ["sync", "--scope", "project", "--include", "skills:bar", "--apply"],
    undefined,
    { AI_CONFIG_SYNC_HOST: "codex" }
  );
  const claudeEntries = readdirSync(join(fixture.project, ".claude/skills/bar"));

  assert.ok(claudeEntries.includes("skill.md"), `expected skill.md, got: ${claudeEntries.join(",")}`);
  assert.ok(!claudeEntries.includes("SKILL.md"), `did not expect SKILL.md in ${claudeEntries.join(",")}`);
});

test("sync apply rewrites skill.md body references to SKILL.md when copying to Codex", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".claude/skills/foo"),
    "claude",
    "# Foo\nRead skill.md for full details.\n"
  );

  runCli(fixture, ["sync", "--scope", "project", "--include", "skills:foo", "--apply"]);
  const codexBody = readFileSync(join(fixture.project, ".agents/skills/foo/SKILL.md"), "utf8");

  assert.match(codexBody, /Read SKILL\.md for full details\./);
  assert.doesNotMatch(codexBody, /Read skill\.md for full details\./);
});

test("status treats identical skill content with mismatched manifest casing as no conflict", () => {
  const fixture = createFixture();
  const sharedBody = "# Foo\nshared body\n";
  writeSkillManifest(join(fixture.project, ".claude/skills/foo"), "claude", sharedBody);
  writeSkillManifest(join(fixture.project, ".agents/skills/foo"), "codex", sharedBody);

  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "skills", "--json"]));
  const skillsEntries = report.entries.filter((entry) => entry.area === "skills");

  assert.equal(
    skillsEntries.length,
    0,
    `expected no skills entries, got: ${JSON.stringify(skillsEntries)}`
  );
});

test("status treats transformed skill content as equivalent after apply", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".claude/skills/foo"),
    "claude",
    "# Foo\nUse CLAUDE.md with Opus.\n"
  );

  runCli(fixture, ["sync", "--scope", "project", "--include", "skills:foo", "--apply"]);
  const report = JSON.parse(runCli(fixture, ["status", "--scope", "project", "--include", "skills:foo", "--json"]));
  const skillsEntries = report.entries.filter((entry) => entry.area === "skills");

  assert.equal(
    skillsEntries.length,
    0,
    `expected transformed skills to be equivalent, got: ${JSON.stringify(skillsEntries)}`
  );
});

test("sync apply maps English agent-team term to canonical multiple spawn_agent invocations on Codex side", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".claude/skills/team"),
    "claude",
    "# Team\nUse agent team mode for parallel review.\n"
  );

  runCli(fixture, ["sync", "--scope", "project", "--include", "skills:team", "--apply"]);
  const codexBody = readFileSync(join(fixture.project, ".agents/skills/team/SKILL.md"), "utf8");

  assert.match(codexBody, /Use multiple spawn_agent invocations for parallel review\./);
  assert.doesNotMatch(codexBody, /agent team mode/);
});

test("sync apply maps Korean agent-team term to canonical multiple spawn_agent invocations on Codex side", () => {
  const fixture = createFixture();
  writeSkillManifest(
    join(fixture.project, ".claude/skills/team"),
    "claude",
    "# Team\n에이전트팀 모드를 사용하라.\n"
  );

  runCli(fixture, ["sync", "--scope", "project", "--include", "skills:team", "--apply"]);
  const codexBody = readFileSync(join(fixture.project, ".agents/skills/team/SKILL.md"), "utf8");

  assert.match(codexBody, /multiple spawn_agent invocations/);
  assert.doesNotMatch(codexBody, /에이전트팀/);
});
