---
description: Print the AI Config Sync Manager reference (commands, areas, risk levels, mapping qualities, action verbs, terminology layers, hidden markers, file locations).
argument-hint: '[--output <path>]'
disable-model-invocation: true
allowed-tools: Bash(*)
---

!`bash -lc '"${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" reference '"$ARGUMENTS"`

Print the CLI output as-is. The reference markdown enumerates every command, area, risk level, mapping quality, sync action verb, terminology layer, hidden marker, and known file location.

Options:

- `--output <path>` — Write the reference markdown to `<path>` (parent directories are created) instead of printing to stdout. The CLI prints the resolved absolute path on success.

For an offline-browsable snapshot committed in the repo, see `docs/reference.md`.
