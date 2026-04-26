# Workflow

## Install From Claude

```text
/plugin install ai-config-sync-manager@...
/config-manager:connect
```

## Install From Codex

```text
Codex plugin install
/config-manager:connect
```

## Connect

```text
1. Detect current host.
2. Check Claude and Codex installation state.
3. Register the missing host integration when possible.
4. Print exact manual install steps when blocked.
5. Re-run status validation.
```

## Status

`/config-manager:status` calls the bundled `bin/ai-config-sync status` and prints a risk-classified diff.

By default, status checks both global and current project scopes. Use `--scope global` or `--scope project` to narrow the report.

## Sync

`/config-manager:sync` calls the bundled `bin/ai-config-sync sync --dry-run` by default. Apply mode must create backups and ask for confirmation before writing.

Manual review entries are shown in the dry-run diff. In the MVP, `sync --apply` applies mapped manual items after the user explicitly runs apply mode; a future `--force-manual` flag can restore per-item confirmation.

## Full Mapping Workflow

Reference: `docs/maximal-one-to-one-mapping.md`

### Completed Baseline

1. Workflow docs exist before deeper implementation.
2. Global and project diff checks include settings-backed areas.
3. Claude `Bash(...)` permissions can map to Codex `rules/*.rules` `prefix_rule()` entries.
4. Claude MCP tool permissions can map to Codex per-tool MCP approval settings.
5. MCP server definitions are structurally merged into Codex `[mcp_servers.*]` blocks.
6. Claude command hooks can map to Codex native hook TOML when the event/handler is supported.
7. Unsupported fields are preserved as managed metadata and shown in `status`.
8. `status`, targeted `sync --dry-run`, temp-home `sync --apply`, and `build:dist` have been verified.

### Current State

- `connect`: detects install state and prints required actions. It does not yet auto-register the missing host.
- `status`: supports global/project scopes, grouped area/item output, and `--include`/`--exclude` selectors.
- `sync`: supports dry-run/apply, backups, selectors, skills missing-copy, permissions item merge, hooks item merge, MCP server merge, and Codex native mapping for Bash/MCP/hook targets.
- `permissions`: Claude to Codex native mapping exists for Bash prefix rules, MCP tool approvals, and workspace-write sandbox hints.
- `hooks`: command hooks can be converted to Codex native hook TOML; unsupported handlers remain metadata.
- `mcp`: server-level merge exists with selectors such as `mcp:notion` and `mcp:playwright`.
- `skills`: only missing skill directories are copied; conflicts, deletes, and same-name content drift are not resolved.
- `agents`: AGENTS/CLAUDE instruction files are compared, but standalone agent file sync is not implemented.
- `commands`: slash command conversion is not implemented.
- `tests`: no repo-owned automated tests yet; validation is currently command/fixture based.
- `package check`: TypeScript check is blocked by package manager/workspace setup.
- `dist`: local Claude marketplace and Codex plugin dist build succeeds.

### Execution Order

```text
1. Update workflow docs.
2. Implement native mapping in this order:
   permissions -> MCP -> hooks -> project/global status.
3. Run status to verify area/item diff visibility.
4. Run sync dry-run with a focused selector.
5. Run npm check and dist build.
6. Commit the verified changes.
```

### MVP Rule

Do not auto-allow broad or destructive commands while migrating permissions. If an item cannot be mapped safely, preserve it as metadata and keep it visible in `status`.

## Remaining Core Work Order

1. Package manager and check pipeline
   - Fix package manager setup so `npm run check` or an equivalent TypeScript check runs cleanly in this repo without relying on parent workspace state.
   - Keep `build:dist` as a required verification step after CLI changes.

2. Automated tests
   - Add minimal `node:test` CLI fixture tests.
   - Cover selector parsing, Bash prefix conversion, MCP tool approval conversion, MCP server merge, hook conversion, and backup/apply behavior.

3. MCP item patch/merge
   - Keep server-level selectors working: `mcp:notion`, `mcp:playwright`.
   - Add item-level patch preview for each MCP server before apply.
   - Preserve secret-like env keys as review/metadata items instead of silently syncing values.

4. Commands, agents, and skills refinement
   - Define skill conflict policy for delete, same-name different content, overwrite, and skip.
   - Decide whether standalone Claude agent files and Codex agent definitions are in MVP scope.
   - Add standalone agent file sync if included: Claude `agents/*.md` <-> Codex agent definitions.
   - Define command conversion policy: Claude slash commands <-> Codex skills/plugin commands.

5. Connect auto-install
   - Implement the target behavior: installing on Claude can register Codex, and installing on Codex can register Claude.
   - Keep status-only diagnostics when auto-install is blocked by missing permissions or unsupported host state.
   - Re-run `connect` validation after registration.

6. Reverse mapping
   - Improve Codex-to-Claude conversion for `prefix_rule()`, MCP tool approvals, and native Codex hooks.
   - Keep non-reversible mappings as metadata with explicit `status` labels.

7. Schema-aware conversion
   - Replace managed comment blocks with native TOML/JSON structures when Codex and Claude schemas are confirmed.
   - Keep managed blocks only for unsupported or metadata-only fields.

8. Status and sync UX
   - Add `status --tree` and `status --compact`.
   - Add `sync --plan-json`.
   - Add `sync --interactive`.
   - Expand `--include`/`--exclude` examples for area and item selectors.
   - Add per-item mapping quality labels: `exact`, `equivalent`, `approximate`, `metadata-only`, `unsupported`.

9. Manual and risk controls
   - Add safer permission review policy for broad interpreters, shell wrappers, destructive commands, and secret-like env keys.
   - Add item-level patch preview so users can inspect exact writes before `sync --apply`.
   - Implement future manual controls: `--force-manual`, optional per-item confirmation, and explicit `--allow-risky` only for reviewed mappings.

10. Distribution readiness
    - Create or connect the GitHub repo remote.
    - Tighten README install guide.
    - Document Claude marketplace install flow.
    - Document Codex plugin local/OSS install flow.
    - Decide whether to publish an npm package or keep CLI bundled in plugin dist for MVP.

11. Milestone verification
    - After each milestone: build dist, install/update Claude plugin, run Codex command, run Claude command, and verify both hosts report the same `status`.
