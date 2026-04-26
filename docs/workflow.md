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

### Pending Work

1. Document the execution workflow before implementation.
2. Apply project and global diff checks for settings-backed areas, not only files and skills.
3. Convert Claude `Bash(...)` permissions to Codex `rules/*.rules` `prefix_rule()` entries.
4. Convert Claude MCP tool permissions to Codex per-tool MCP approval settings.
5. Convert MCP server definitions structurally instead of copying raw files.
6. Convert command hooks to Codex native hook TOML where the event/handler is supported.
7. Keep unsupported fields as managed metadata and show them in `status`.
8. Run the workflow: `status`, targeted `sync --dry-run`, `check`, and `build:dist`.

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

1. Fix package manager setup so `npm run check` or an equivalent TypeScript check runs cleanly in this repo without relying on parent workspace state.
2. Add focused automated tests around selector parsing, Bash prefix conversion, MCP tool approval conversion, MCP server merge, and hook conversion.
3. Improve Codex-to-Claude reverse mapping for `prefix_rule()`, MCP tool approvals, and native Codex hooks.
4. Add `status` mapping quality labels per item: `exact`, `equivalent`, `approximate`, `metadata-only`, `unsupported`.
5. Add safer permission review policy: broad interpreters, shell wrappers, destructive commands, and secret-like env keys must remain visible as review items.
6. Add item-level patch preview output so users can inspect the exact write before `sync --apply`.
7. Implement future manual controls: `--force-manual`, optional per-item confirmation, and explicit `--allow-risky` only for reviewed mappings.
8. Re-run real plugin workflow after each milestone: build dist, install/update Claude plugin, run Codex command, run Claude command, verify both hosts see the same `status`.
