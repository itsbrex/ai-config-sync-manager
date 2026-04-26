# AI Config Sync Manager

AI Config Sync Manager is an OSS toolkit for keeping Claude and Codex developer configuration aligned.

Install it from either host, run `/config-manager:connect` in Claude or `config-manager-connect` in Codex, and the manager helps register the missing integration so both Claude and Codex can use:

- Claude: `/config-manager:connect`, `/config-manager:status`, `/config-manager:sync`
- Codex: `config-manager-connect`, `config-manager-status`, `config-manager-sync`

The shared engine lives in `packages/core`. Host-specific plugins are thin wrappers around the bundled `bin/ai-config-sync` CLI.

## Current Status

The bundled CLI now scans real global/project config diffs, previews sync plans, and applies selected entries with backups.

## Safety Defaults

- `sync` starts as dry-run.
- Real writes must create backups.
- `permissions`, `hooks`, and custom commands are marked with their risk level in the diff.
- Apply runs selected file, skill, and settings item merge operations, including entries marked `manual`.
- Status checks both global and current project scopes by default.
- Review the dry-run before apply, especially for entries marked `manual`.

## Bundled CLI

```bash
./bin/ai-config-sync connect
./bin/ai-config-sync status
./bin/ai-config-sync status --json
./bin/ai-config-sync status --scope global
./bin/ai-config-sync status --scope project
./bin/ai-config-sync status --include skills:assignment-test,instructions --exclude mcp
./bin/ai-config-sync sync --dry-run
./bin/ai-config-sync sync --scope project --dry-run
./bin/ai-config-sync sync --scope global --apply
./bin/ai-config-sync sync --include instructions,skills:assignment-test --exclude mcp --dry-run
./bin/ai-config-sync sync --from claude --to codex
./bin/ai-config-sync sync --from codex --to claude
```

Selectors use `area` or `area:item` syntax. `--include` narrows the plan first, then `--exclude` removes matching areas or items. Item selectors are supported for itemized areas such as `skills`, `permissions`, and `hooks`. `permissions` and `hooks` are patched item-by-item instead of copying the whole settings file.

`npm install -g` is optional. Plugin and local installs should call the bundled CLI through `AI_CONFIG_SYNC_ROOT` or the repository-local `bin/ai-config-sync` path.
