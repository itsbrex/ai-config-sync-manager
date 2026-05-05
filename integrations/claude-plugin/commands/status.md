---
description: Show Claude and Codex configuration sync status.
argument-hint: "[--scope global|project|all] [--include area[,area:item]] [--exclude area[,area:item]]"
disable-model-invocation: true
allowed-tools: Bash(*)
---

!`AI_CONFIG_SYNC_HOST=claude bash -lc '"${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" status '"$ARGUMENTS"`

Print the CLI output as-is so the area/item hierarchy remains visible. Do not summarize, regroup, or modify files from this command.
