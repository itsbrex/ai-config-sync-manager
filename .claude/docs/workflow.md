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

Reference: `.claude/docs/maximal-one-to-one-mapping.md`

### Completed Baseline

1. Workflow docs exist before deeper implementation.
2. Global and project diff checks include settings-backed areas.
3. Claude `Bash(...)` permissions can map to Codex `rules/*.rules` `prefix_rule()` entries.
4. Claude MCP tool permissions can map to Codex per-tool MCP approval settings.
5. MCP server definitions are structurally merged into Codex `[mcp_servers.*]` blocks.
6. Claude command hooks can map to Codex native hook TOML when the event/handler is supported.
7. Unsupported fields are preserved as managed metadata and shown in `status`.
8. `status`, targeted `sync --dry-run`, temp-home `sync --apply`, and `build:dist` have been verified.
9. Package manager setup and `npm run check` are repo-local and verified.
10. Minimal `node:test` CLI fixture tests cover selectors, native mappings, MCP merge safety, hooks, and apply backups.
11. MCP sync output includes per-server patch previews, and secret-like MCP env keys are shown as metadata-only review items instead of being copied.
12. Skills policy is defined and same-name content drift is surfaced as a manual conflict; standalone agents and command conversion remain manual-review/outside MVP.
13. `connect` can register missing local Claude and Codex host integrations in an isolated home and re-print the resulting install state.
14. Codex-to-Claude reverse mapping covers `prefix_rule()`, MCP tool approvals, and native command hooks.
15. Schema-aware Codex writes avoid managed comment blocks for exact native permission and command-hook mappings; managed metadata remains only for unsupported or non-exact fields.
16. Status UX supports compact and tree renderers; sync can emit a machine-readable `--plan-json` plan; each command exposes command-specific `--help`.

### Current State

- `connect`: detects install state, registers missing local Claude/Codex host integrations when filesystem writes are available, prints manual actions when blocked, and supports `connect --help`.
- `status`: supports global/project scopes, default/grouped output, `--compact`, `--tree`, and `--include`/`--exclude` selectors.
- `sync`: supports dry-run/apply, `--plan-json`, command help, backups, selectors, skills missing-copy, permissions item merge, hooks item merge, MCP server merge, and Codex native mapping for Bash/MCP/hook targets.
- `permissions`: Claude to Codex native mapping exists for Bash prefix rules, MCP tool approvals, and workspace-write sandbox hints; exact Bash/MCP mappings no longer leave duplicate managed comments.
- `permissions reverse`: Codex `prefix_rule()` and MCP tool approvals can be converted back to Claude permission buckets when reversible.
- `hooks`: command hooks can be converted in both directions between Claude settings and Codex native hook TOML; unsupported handlers remain managed metadata.
- `mcp`: server-level merge exists with selectors such as `mcp:notion` and `mcp:playwright`; sync output shows per-server patch previews and skips secret-like env values as metadata-only review items.
- `skills`: missing skill directories are copied; same-name content drift is reported as a manual conflict; deletes and overwrites are not in MVP.
- `agents`: AGENTS/CLAUDE instruction files are compared; standalone agent file sync is outside MVP until Codex agent schema is confirmed.
- `commands`: slash command conversion is partial/manual-review only and is not auto-written.
- `tests`: minimal repo-owned `node:test` CLI fixtures exist for selector parsing, Bash prefix conversion, MCP tool approval conversion, MCP server merge, hook conversion, and backup/apply behavior.
- `package check`: repo-local `npm run check` passes with the npm lockfile setup.
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

1. Status and sync UX
   - Add `sync --interactive`.
   - Add per-item mapping quality labels: `exact`, `equivalent`, `approximate`, `metadata-only`, `unsupported`.

2. Manual and risk controls
   - Add safer permission review policy for broad interpreters, shell wrappers, destructive commands, and secret-like env keys.
   - Add item-level patch preview so users can inspect exact writes before `sync --apply`.
   - Implement future manual controls: `--force-manual`, optional per-item confirmation, and explicit `--allow-risky` only for reviewed mappings.

3. Distribution readiness
   - Create or connect the GitHub repo remote.
   - Tighten README install guide.
   - Document Claude marketplace install flow.
   - Document Codex plugin local/OSS install flow.
   - Decide whether to publish an npm package or keep CLI bundled in plugin dist for MVP.

4. Milestone verification
   - After each milestone: build dist, install/update Claude plugin, run Codex command, run Claude command, and verify both hosts report the same `status`.
