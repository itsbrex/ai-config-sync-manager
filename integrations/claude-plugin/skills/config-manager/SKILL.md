---
name: config-manager
description: Use AI Config Sync Manager's bundled OSS CLI for Claude configuration status, connect, and sync workflows.
---

# Config Manager

AI Config Sync Manager is an OSS workflow for keeping AI assistant configuration explicit, inspectable, and recoverable.

## Rules

- Resolve the bundled CLI first: `AI_CONFIG_SYNC_ROOT="${AI_CONFIG_SYNC_ROOT:-$HOME/.ai-config-sync-manager}"`.
- Prefer `"$AI_CONFIG_SYNC_ROOT/bin/ai-config-sync" ... --dry-run` before any write.
- Status checks both global and current project scopes by default.
- Manual review means show the diff and require explicit approval before apply.
- Verify backups before applying changes.
- Require manual confirmation before running commands that modify Claude configuration.
- Keep output focused on changed paths, skipped paths, and recovery steps.

## Commands

```bash
AI_CONFIG_SYNC_ROOT="${AI_CONFIG_SYNC_ROOT:-$HOME/.ai-config-sync-manager}"
"$AI_CONFIG_SYNC_ROOT/bin/ai-config-sync" status
"$AI_CONFIG_SYNC_ROOT/bin/ai-config-sync" connect
"$AI_CONFIG_SYNC_ROOT/bin/ai-config-sync" sync --from claude --to codex --dry-run
```
