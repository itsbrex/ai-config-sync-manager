---
description: Preview or apply Claude/Codex configuration sync through AI Config Sync Manager.
argument-hint: "[--scope global|project|all] [--from claude|codex --to claude|codex] [--include area[,area:item]] [--exclude area[,area:item]] [--apply]"
allowed-tools: Bash(*)
---

First run a sync plan:

!`AI_CONFIG_SYNC_HOST=claude bash -lc 'case " $ARGUMENTS " in *" --apply "*) "${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" sync '"$ARGUMENTS"' ;; *) "${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" sync '"$ARGUMENTS"' --dry-run ;; esac'`

Confirmation flow:

- The slash command always shows a dry-run plan first.
- After reviewing the plan, ask the user in chat whether to apply.
- On the user's explicit yes, re-run this command with `--apply`.

Before applying changes:

- Summarize the CLI output exactly; do not call a target an overwrite unless the CLI reports that the target exists.
- Highlight `manual` and `partial` risk entries explicitly to the user before asking for approval.
- Ensure backups are created automatically by the CLI on apply (`Backup root: ...` line).
- Manual-risk entries are still plan candidates; `--apply` executes them after backups.

Apply only after the user explicitly confirms in chat:

```bash
AI_CONFIG_SYNC_HOST=claude "${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" sync $ARGUMENTS --apply
```
