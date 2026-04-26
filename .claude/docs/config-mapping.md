# Config Mapping

## Safe

| Area | Claude | Codex |
| --- | --- | --- |
| Instructions | `CLAUDE.md` | `AGENTS.md` |
| Skills | Claude skills | Codex skills |
| MCP | MCP server config | MCP server config |

## Partial

| Area | Note |
| --- | --- |
| Commands | Claude slash commands may become Codex skills or script wrappers. |

## Skills Policy

Missing skills are copied directory-by-directory. Same-name skills with different content are reported as manual conflicts. Deletes and overwrites are outside the MVP and must be reviewed explicitly.

## Agents And Commands Policy

Standalone Claude `agents/*.md` and Codex agent definitions are outside the MVP until the Codex agent schema is confirmed. Slash command conversion is partial and manual-review only: command bodies may become Codex skills, plugin commands, or scripts, but the CLI should not auto-write converted commands yet.

## Manual

| Area | Note |
| --- | --- |
| Permissions | Claude rules and Codex sandbox/approval policy are structurally different. Show diff first and require approval before apply. |
| Hooks | Hook event names and payloads need host-specific review. Show diff first and require approval before apply. |

Manual review does not mean "never sync". It means the diff is visible, conversion notes are shown, and the write is blocked until the user explicitly approves.

## Scopes

| Scope | Claude | Codex |
| --- | --- | --- |
| Global | `~/.claude/settings.json`, `~/.claude/skills`, `~/.claude/commands`, `~/.claude/mcp.json` | `~/.codex/config.toml`, `~/.codex/skills`, `~/.agents/plugins` |
| Project | `CLAUDE.md`, `.claude/*` | `AGENTS.md`, `.agents/*`, `.codex/*` |

## Deferred

- memory
- implicit context
- agent runtime state
