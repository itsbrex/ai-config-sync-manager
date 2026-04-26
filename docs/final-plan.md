# AI Config Sync Manager Final Plan

## Goal

AI Config Sync Manager lets users install the project from either Claude or Codex, run `/config-manager:connect` in Claude or `config-manager-connect` in Codex, and make the sync commands available from both environments.

Primary commands:

- Claude: `/config-manager:connect`, `/config-manager:status`, `/config-manager:sync`
- Codex: `config-manager-connect`, `config-manager-status`, `config-manager-sync`

Bundled CLI:

```bash
./bin/ai-config-sync connect
./bin/ai-config-sync status
./bin/ai-config-sync status --json
./bin/ai-config-sync sync --dry-run
./bin/ai-config-sync sync --scope global --apply
./bin/ai-config-sync sync --from claude --to codex
./bin/ai-config-sync sync --from codex --to claude
```

## Repository Structure

```text
AI Config Sync Manager/
  packages/
    core/
    cli/

  integrations/
    claude-plugin/
      .claude-plugin/plugin.json
      commands/
        connect.md
        status.md
        sync.md
      skills/
        config-manager/SKILL.md
      .mcp.json

    codex-plugin/
      .codex-plugin/plugin.json
      skills/
        config-manager-connect/SKILL.md
        config-manager-status/SKILL.md
        config-manager-sync/SKILL.md
      scripts/

  schemas/
    canonical-config.schema.json

  rules/
    claude-to-codex.json
    codex-to-claude.json

  docs/
    architecture.md
    config-mapping.md
    workflow.md
    final-plan.md
```

## Architecture

```text
Claude config -> Claude adapter -> canonical snapshot
Codex config  -> Codex adapter  -> canonical snapshot
                                      |
                                    diff
                                      |
                              sync plan / apply
```

The project should not use a `tmpl` generation pipeline. The gstack pipeline is a workflow reference only. This project should use a `schema + rules + adapters` design so the implementation has its own shape and can support more hosts later.

## Install UX

### Claude First

```text
/plugin install ai-config-sync-manager@...
/config-manager:connect
```

### Codex First

```text
Codex plugin install
config-manager-connect
```

### Connect Flow

```text
1. Detect the current host.
2. Check Claude and Codex installation state.
3. Check whether the opposite plugin or integration can be installed.
4. Install/register it when possible.
5. If blocked by host permissions or sandboxing, print the exact manual install command.
6. Re-run status validation for both sides.
```

## Sync Scope

### Automatic In MVP

- `CLAUDE.md` <-> `AGENTS.md`
- skills
- MCP server config

### Semi-Automatic In MVP

- permissions
- hooks
- custom commands

### Deferred

- memory
- implicit context
- agent runtime state

## Safety Policy

- `sync` defaults to dry-run.
- Real writes require backups.
- Diff entries are classified as `safe`, `partial`, or `manual`.
- `--apply` applies selected file and skill operations, including entries marked `manual`.
- Permissions, hooks, and custom commands must show risk level and conversion notes.

## MVP Completion Criteria

- Detect Claude and Codex config locations.
- Generate canonical snapshots.
- Print status diff.
- Detect the opposite host from `connect`.
- Generate sync dry-run plans.
- Support `CLAUDE.md` <-> `AGENTS.md`, skills, and MCP diffs.
- Support partial sync selectors with `--include area[,area:item]` and `--exclude area[,area:item]` for itemized areas including `skills`, `permissions`, and `hooks`.
- Report permissions and hooks with risk labels before apply.

## Implementation Order

1. Create `/Users/maxx/dev/projects/AI Config Sync Manager`.
2. Scaffold workspace directories.
3. Define `core` scanner, adapter, diff, and sync types.
4. Scaffold `cli` commands: `connect`, `status`, `sync`.
5. Scaffold Claude plugin.
6. Scaffold Codex plugin.
7. Write architecture, config mapping, and workflow docs.
8. Implement status MVP.
9. Implement sync dry-run.
10. Implement apply with backups.

## Commit Message

```text
feat: scaffold ai config sync manager plan
```

## Future Work

- Add schema-aware conversion for permissions, hooks, custom commands, and host-specific MCP formats.
- Add richer project-scope detection for nested repositories and monorepos.
- Add published install docs for Claude marketplace, Codex plugin, and npm package usage.
- Add automated regression tests for connect, status, dry-run, apply, and backup behavior.
