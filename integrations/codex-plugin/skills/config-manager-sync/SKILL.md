---
name: config-manager-sync
description: Preview and apply AI config sync plans through the bundled open-source CLI.
---

# Config Manager Sync

Use this skill when the user asks to sync Codex and Claude configuration with AI Config Sync Manager.

## Behavior

- Resolve the bundled CLI first:
  `AI_CONFIG_SYNC_ROOT="${AI_CONFIG_SYNC_ROOT:-$HOME/.ai-config-sync-manager}"`.
- Default to dry-run: `"$AI_CONFIG_SYNC_ROOT/bin/ai-config-sync" sync --dry-run`.
- Default sync scope is global and project when `--scope` is omitted, including dry-run, apply, and confirm.
- Use `--scope global`, `--scope project`, or `--scope all` to narrow or make the sync scope explicit.
- For explicit direction, pass the requested hosts, for example `"$AI_CONFIG_SYNC_ROOT/bin/ai-config-sync" sync --from claude --to codex --dry-run`.
- For partial sync, pass selectors with `--include area[,area:item]` and `--exclude area[,area:item]`. Include is applied first, exclude is applied last. Item selectors are supported for itemized areas such as `skills`, `permissions`, and `hooks`.
- Do not apply a sync plan unless the user manually confirms after seeing the dry-run summary.
- Manual-risk entries are still sync plan candidates. The CLI approval gate is `--confirm`; `--apply` executes planned operations after backups.
- If the bundled CLI is unavailable, report that the plugin repository must be installed or `AI_CONFIG_SYNC_ROOT` must point to it.

## Safety

- Require backups before any real write.
- Confirm the backup location before applying changes.
- Treat `partial` and `manual` entries as higher-risk entries that must be clearly shown in the dry-run.
- Apply may run selected file, skill, and settings item merge operations even when they are marked `manual`.
- Do not bypass CLI safeguards from this skill.
