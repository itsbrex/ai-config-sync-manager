---
name: config-manager
description: Use AI Config Sync Manager's bundled OSS CLI for Claude configuration status, connect, and sync workflows.
---

# Config Manager

AI Config Sync Manager is an OSS workflow for keeping AI assistant configuration explicit, inspectable, and recoverable.

## Rules

- Resolve the bundled CLI from the host plugin root: `${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync`. The plugin's launcher resolves the runtime in this order: `AI_CONFIG_SYNC_ROOT` (dev override), PATH `ai-config-sync` (`npm install -g` or `npm link`), then `npm exec` fallback.
- Always export `AI_CONFIG_SYNC_HOST=claude` before invoking the CLI from this skill so the default sync direction is `claude -> codex`.
- Prefer `--dry-run` before any write.
- Status checks both global and current project scopes by default.
- Print status CLI output as-is. Do not rewrite Codex and Claude status into different summary formats.
- If status prints a detail file path, point the user to that file for full item lists and before/after previews.
- Text sync for instructions and skills uses layered `rules/terminology-map.json` and generic `rules/host-target-templates.json`; user/project overrides may add product-specific workflow vocabularies and host-specific target templates.
- Manual review means show the diff and require explicit approval before apply.
- Verify backups before applying changes.
- Require manual confirmation before running commands that modify Claude configuration.
- Keep output focused on changed paths, skipped paths, and recovery steps.

## Commands

```bash
AI_CONFIG_SYNC_HOST=claude "${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" status
AI_CONFIG_SYNC_HOST=claude "${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" connect
AI_CONFIG_SYNC_HOST=claude "${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" sync --from claude --to codex --dry-run
```
