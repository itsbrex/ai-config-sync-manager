# case-08 mapping & paraphrase reference

Index for quickly locating where to make changes when something needs adjusting.
Paths are relative to `templates/case-08-ecc-realworld-mapping/`.

## Terminology mapping (instructions: `.codex/AGENTS.md` → `.claude/CLAUDE.md`)

| line | source token (codex)              | target token (claude)              |
| ---- | --------------------------------- | ---------------------------------- |
| 1    | `Codex CLI`                       | `Claude Code`                      |
| 3    | `AGENTS.md`                       | `CLAUDE.md`                        |
| 17   | `SKILL.md`                        | `skill.md`                         |
| 36   | `.codex/config.toml`              | `~/.claude/settings.json`          |
| 36   | `~/.codex/config.toml`            | `~/.claude/settings.json`          |
| 50   | `.codex/config.toml`              | `~/.claude/settings.json`          |
| 52   | `.codex/agents/`                  | `.claude/agents/`                  |
| 53   | `Codex CLI`                       | `Claude Code`                      |
| 56   | `.codex/agents/explorer.toml`     | `.claude/agents/explorer.md`       |
| 57   | `.codex/agents/reviewer.toml`     | `.claude/agents/reviewer.md`       |
| 58   | `.codex/agents/docs-researcher.toml` | `.claude/agents/docs-researcher.md` |
| 62   | `Codex CLI` (table cell)          | `Claude Code` (over-translation)   |
| 65   | `AGENTS.md` ×2 (table cell)       | `CLAUDE.md` ×2 (over-translation)  |

Edit start point: the lines above in `.codex/AGENTS.md`. Expected result: `expected/.../claude-home/.claude/CLAUDE.md`.

## Skill body mapping (`.agents/skills/verification-loop/SKILL.md` → `.claude/skills/verification-loop/skill.md`)

| line | change                                                      |
| ---- | ----------------------------------------------------------- |
| 3    | frontmatter `description` quoting: `"..."` → `...` (unquoted) |

The body is unchanged (`Claude Code`, `PostToolUse hooks`, `/verify` do not trigger any paraphrase).

## Permissions mapping (`.codex/config.toml` → `.claude/settings.json` `permissions.allow[]`)

| source                            | line | derived items in `permissions.allow` | quality   |
| --------------------------------- | ---- | ------------------------------------- | --------- |
| `sandbox_mode = "workspace-write"` | 2    | `Edit`, `MultiEdit`, `Write`          | equivalent |
| `web_search = "live"`              | 3    | `WebSearch`                           | exact     |

Edit start point: lines 2–3 of `.codex/config.toml`. Expected result: `expected/.../claude-home/.claude/settings.json`.

## MCP server mapping (`.codex/config.toml [mcp_servers.X]` → `.claude.json mcpServers.X`)

| section line | id                  | transport       | claude `type` |
| ------------ | ------------------- | --------------- | ------------- |
| 7            | `manual_github`     | stdio (command) | `stdio`       |
| 12           | `context7`          | stdio (command) | `stdio`       |
| 17           | `manual_exa`        | streamable_http | `http`        |
| 22           | `memory`            | stdio (command) | `stdio`       |
| 27           | `playwright`        | stdio (command) | `stdio`       |
| 32           | `sequential-thinking` | stdio (command) | `stdio`       |

Edit start point: the corresponding sections of `.codex/config.toml`. Expected result: `expected/.../claude-home/.claude.json` `mcpServers`.

## Paraphrase (vocab mismatch — no auto-fix, manual review)

| file (codex side)                                       | line | token   | classification                  | recommended action                              |
| ------------------------------------------------------- | ---- | ------- | ------------------------------- | ----------------------------------------------- |
| `.agents/skills/verification-loop/SKILL.md`             | 6    | `Skill` | `claude-only; not callable on codex` | leave as-is, or register an override with `paraphrase --apply --map "Skill=verification routine"` |

Edit start point: SKILL.md L6 (`# Verification Loop Skill`). Registering a paraphrase override leaves an active entry under `~/.ai-config-sync-manager/rules/paraphrase-overrides.json` (sandboxed within the lab).

## Unintended over-translation (currently frozen into the fixture)

Captured in the golden output to expose limitations of the mapping rules:

- `.claude/CLAUDE.md` L62: table header `| Claude Code | Claude Code |` (originally `Codex CLI` should be on the right side for the meaning to survive)
- `.claude/CLAUDE.md` L65: `CLAUDE.md + CLAUDE.md` (originally `CLAUDE.md + AGENTS.md`)

These are candidates for a future paraphrase override or status-ignore rule. Right now they are frozen into the expected output and reproduce identically on subsequent syncs (regression guard).

## status-ignore / paraphrase override / paraphrase map registration cases

`case-09-ecc-rules-pre-registered/` is the variant case where rule files are
pre-registered against the same source. It masks the over-translation lines
above with `status-ignore` and resolves the `Skill` vocab mismatch as an
active `paraphrase-overrides` entry. For the rule file format and placeholder
substitution flow, see that case's `README.md`.
