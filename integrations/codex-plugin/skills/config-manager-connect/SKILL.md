---
name: config-manager-connect
description: Connect Codex with the bundled open-source AI Config Sync Manager CLI.
---

# Config Manager Connect

Use this skill when the user asks to connect Codex, Claude, or another supported host through AI Config Sync Manager.

## Behavior

- Resolve the bundled CLI first:
  `AI_CONFIG_SYNC_ROOT="${AI_CONFIG_SYNC_ROOT:-$HOME/.ai-config-sync-manager}"; "$AI_CONFIG_SYNC_ROOT/bin/ai-config-sync" connect`.
- Do not edit Codex, Claude, skills, commands, MCP, permissions, or hooks directly from this skill.
- If the bundled CLI is unavailable, report that the plugin repository must be installed or `AI_CONFIG_SYNC_ROOT` must point to it.
- Prefer explicit user confirmation before installing, registering, or writing anything outside the current plugin flow.
- Preserve the OSS purpose: this plugin is a thin open-source bridge to the bundled CLI, not a proprietary sync service.

## Safety

- Treat host permissions, hooks, and custom commands as manual-review areas.
- When the CLI proposes changes, show the summary and ask for confirmation before continuing.
- If the CLI reports backups, mention their location before any apply step proceeds.
