---
description: Connect Claude configuration to AI Config Sync Manager.
argument-hint: "[-h | --help]"
disable-model-invocation: true
allowed-tools: Bash(*)
---

!`AI_CONFIG_SYNC_HOST=claude bash -lc '"${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" connect '"$ARGUMENTS"`

The scaffold CLI does not write files from `connect` yet. When apply support is added, keep it behind backups and manual confirmation.
