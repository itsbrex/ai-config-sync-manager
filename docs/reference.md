# AI Config Sync Manager Reference

Generated reference for every command, area, risk level, mapping quality, sync action verb, terminology layer, hidden marker, and known file location.

## Commands

### `connect`

Checks Claude and Codex installation state, registers missing local host integrations when possible, and prints manual actions when writes are blocked.

- `-h, --help` — Show connect help

### `status`

Print diff status between Claude and Codex configuration.

- `--json` — Print the full status report as JSON
- `--compact` — Print one compact line per diff entry
- `--tree` — Print scope/area/item tree output
- `--scope global|project|all` — Limit status scope
- `--include area[:item][,...]` — Include only selected areas or items
- `--exclude area[:item][,...]` — Exclude selected areas or items
- `-h, --help` — Show status help

### `sync`

Plan or apply synchronization between Claude and Codex configuration.

- `--dry-run` — Preview planned operations without writing files (default)
- `--apply` — Apply planned operations with backups
- `--plan-json` — Print the sync plan as JSON
- `--from claude|codex` — Source host (overrides AI_CONFIG_SYNC_HOST)
- `--to claude|codex` — Target host (overrides AI_CONFIG_SYNC_HOST)
- `--scope global|project|all` — Limit sync scope
- `--include area[:item][,...]` — Include only selected areas or items
- `--exclude area[:item][,...]` — Exclude selected areas or items
- `-h, --help` — Show sync help

### `reference`

Print this markdown reference document.

- `--output <path>` — Write the reference markdown to `<path>` (parent directories are created)
- `-h, --help` — Show reference help

## Areas

Areas are the canonical buckets diffed and synced between hosts.

- `instructions` — Top-level instruction file (`CLAUDE.md` ↔ `AGENTS.md`).
- `skills` — Skill directories under `.claude/skills` and `.codex/skills` (one folder per skill).
- `agents` — Subagent definitions: Claude markdown frontmatter under `.claude/agents` ↔ Codex TOML under `.codex/agents`.
- `mcp` — MCP server registrations (`.mcp.json`, `.claude.json`, `settings.json` ↔ `config.toml [mcp_servers.*]`).
- `permissions` — Tool/bash/web permission rules (`settings.json` permissions ↔ Codex `[approvals]` / `default.rules`).
- `hooks` — Lifecycle hook configuration (`settings.json` hooks ↔ Codex `[[hooks.Event]]` blocks).

## Risk levels

- `safe` — Apply automatically; the source meaning is fully preserved on the target.
- `manual` — Hold for explicit review; mapping is lossy or the source file is missing. Apply will skip operations marked `approvalRequired: true` until rerun explicitly.

## Mapping qualities

Per-item indicator of how well one host's meaning is preserved on the other side.

- `exact` — Same value, same semantics on both hosts.
- `equivalent` — Different shape, identical effect (for example `CLAUDE.md` ↔ `AGENTS.md` instructions).
- `approximate` — Closest-fit mapping; behavior is similar but not identical (broad approval policies, prefix rules).
- `metadata-only` — The wrapper is preserved but inner behavior cannot be enforced on the target host.
- `unsupported` — No mapping exists; the item is left for manual review.

## Sync action verbs

Plan operations carry an `action` field that `applySyncPlan` dispatches on.

- `copy-file` — Copy a single file from source host to target host.
- `write-instructions` — Write transformed instruction content (after term/template/call rewrites) to the target instruction file.
- `copy-missing-skills` — Copy skill directories that are missing on the target, overwriting any conflicting skill bodies.
- `merge-agents` — Translate Claude agent frontmatter ↔ Codex agent TOML and write per-agent files.
- `merge-settings-items` — Merge permission or hook items into the target settings file.
- `merge-mcp-servers` — Merge MCP server entries into the target host's MCP config.
- `delete-items` — Delete items from the target that the baseline shows were removed on the source.
- `source-missing` — Source path does not exist; flagged manual and skipped on apply.
- `manual-review` — Area has no automatic mapping; surfaced for the user to handle.

### Status output symbols

- `+` — Item will be added on the target (copy from source).
- `-` — Item will be removed on the target (baseline-tracked deletion).
- `~` — Item exists on both hosts but content differs (will be overwritten on apply).
- `!` — Conflict that requires manual review.

## Terminology layers

Terminology rules live in `rules/terminology-map.json` (override at `~/.ai-config-sync-manager/rules/terminology-map.json` or `<project>/rules/terminology-map.json`). Each layer groups rules that rewrite host-specific vocabulary when transforming text between Claude and Codex.

See [docs/customizing-rules.md](customizing-rules.md) for override precedence, merge semantics, and per-file recipes.

### `files`

Host-specific config and instruction file names.

- `agent-product`
- `instruction-file`
- `global-settings-file`
- `mcp-config-file`
- `agent-file-path` — regex rule
- `skill-file-path` — regex rule
- `skill-manifest-filename` — regex rule

### `host-surfaces`

Host UI and extension surfaces.

- `slash-command-term`
- `skill-surface-term`

### `orchestration`

Generic agent delegation and reasoning vocabulary. Workflow-specific intents live in host-target-templates.json.

- `reasoning-budget`
- `plan-mode`
- `subagent-term`
- `task-delegation`
- `agent-team`

### `permissions`

Permission and sandbox vocabulary used in text instructions.

- `permission-term`
- `bash-permission-term`
- `workspace-write-term`
- `approval-policy-term`

### `hooks-mcp`

Hook, MCP, and web access vocabulary used in text instructions.

- `hook-term`
- `command-hook-term`
- `mcp-tool-permission-term`
- `web-access-term`

### `model` (from `rules/agents-map.json`)

Model alias rules come from `rules/agents-map.json` `models.tiers` rather than the terminology map.

- `latest-frontier-model` — `opus` ↔ `gpt-5.5`
- `balanced-model` — `sonnet` ↔ `gpt-5.4`
- `small-fast-model` — `haiku` ↔ `gpt-5.4-mini`

## Hidden markers

HTML comment markers the call compiler emits inside transformed text. They round-trip on a reverse sync and are not user-visible during normal use.

- `ai-config-sync:agent-call` — Supported call transformed (Claude `Agent({...})` ↔ Codex prose `spawn_agent`).
- `ai-config-sync:stripped` — Unsupported call removed (`TaskCreate`, `TaskUpdate`, `TeamCreate`); original archived under the backup root.
- `ai-config-sync:manual-review` — Call left intact because it could not be parsed; needs manual translation.

## Default direction precedence

1. Explicit `--from <host>` / `--to <host>` flags on `sync`.
2. `AI_CONFIG_SYNC_HOST=codex` environment variable — sets default direction to `codex -> claude`.
3. Otherwise the default is `claude -> codex`.

`status` follows the same default direction so that `+/-/~` symbols and `details` text describe the apply that would run with no override.

## File locations

### User-writable

- `~/.ai-config-sync-manager/state/<scope>.json` — Sync state baseline (one file per scope; project scope hashes the project root).
- `~/.ai-config-sync-manager/backups/<timestamp>/...` — Backup root for each apply run.
- `~/.ai-config-sync-manager/backups/<timestamp>/unsupported-calls.json` — Archive of stripped or manual-review calls (when applicable).
- `~/.ai-config-sync-manager/status-details/<timestamp>.txt` — Full diff detail when status is collapsed.
- `~/.ai-config-sync-manager/rules/agents-map.json` — Agent field and model alias rules (user customization point).
- `~/.ai-config-sync-manager/rules/status-ignore.json` — Persistent ignore rules used by `status` and `sync`.

### Bundled defaults (under the runtime root)

- `<repo>/rules/terminology-map.json` — Bundled terminology defaults (override at home or project).
- `<repo>/rules/host-target-templates.json` — Bundled target templates.
- `<repo>/rules/call-templates.json` — Bundled SDK call transform templates.

Override precedence for any rule file: `<project>/rules/<name>.json` → `~/.ai-config-sync-manager/rules/<name>.json` → `<repo>/rules/<name>.json`. Layers are merged by id (rule.id, template.id, areas key, fields claude+codex pair, models.tiers id) — partial overlays only need to declare the entries they want to add or change.
