---
description: Preview or apply Claude/Codex configuration sync through AI Config Sync Manager.
argument-hint: '[--scope global|project|all] [--from claude|codex --to claude|codex] [--include area[,area:item]] [--exclude area[,area:item]] [--apply]'
allowed-tools: Bash(*)
---

First run a sync plan:

!`bash -lc 'case " $ARGUMENTS " in *" --apply "*) "${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" sync '"$ARGUMENTS"' ;; *) "${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" sync '"$ARGUMENTS"' --dry-run ;; esac'`

Before applying changes:

- Review every planned file change.
- Ensure backups will be created.
- Use `--confirm` when an interactive approval gate is required.
- Manual-risk entries are plan candidates; `--apply` executes the planned operations after backups.
- Summarize the CLI output exactly; do not call a target an overwrite unless the CLI reports that the target exists.

Apply only after confirmation:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" sync $ARGUMENTS --apply
```
