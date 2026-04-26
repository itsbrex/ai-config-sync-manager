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

Manual review entries are shown in the dry-run diff and require explicit approval before any write.
