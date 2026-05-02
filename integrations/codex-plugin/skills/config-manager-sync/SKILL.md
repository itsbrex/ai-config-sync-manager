---
name: config-manager-sync
description: Preview and apply AI config sync plans through the bundled open-source CLI.
---

# Config Manager Sync

Use this skill when the user asks to sync Codex and Claude configuration with AI Config Sync Manager.

## Behavior

- Resolve the bundled CLI from the Codex plugin root: `"$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync"`.
  The launcher resolves the runtime via `AI_CONFIG_SYNC_ROOT` (dev override) → PATH `ai-config-sync` → `npm exec` fallback.
- Always export `AI_CONFIG_SYNC_HOST=codex` before invoking the CLI from this skill so the default sync direction is `codex -> claude`.
- Default to dry-run: `AI_CONFIG_SYNC_HOST=codex "$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" sync --dry-run`.
- Default sync scope is global and project when `--scope` is omitted.
- Use `--scope global`, `--scope project`, or `--scope all` to narrow or make the sync scope explicit.
- For explicit direction, pass the requested hosts, for example `AI_CONFIG_SYNC_HOST=codex "$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" sync --from claude --to codex --dry-run`. Explicit `--from`/`--to` overrides the env-based default.
- For partial sync, pass selectors with `--include area[,area:item]` and `--exclude area[,area:item]`. Include is applied first, exclude is applied last. Item selectors are supported for itemized areas such as `skills`, `permissions`, and `hooks`.
- Text sync for `instructions` and `skills` uses `rules/terminology-map.json` for layered terms/model names and `rules/host-target-templates.json` for generic host surfaces. Product/workflow-specific vocabularies should be supplied through project-level overrides under `rules/`.
- Manual-risk entries are still sync plan candidates. Treat `partial` and `manual` entries as higher-risk entries that must be clearly shown in the dry-run.
- If the bundled CLI is unavailable, report that the user must `npm install -g ai-config-sync-manager` (or run `npm link` from the repo) and re-run `connect`.

## Confirmation Flow

- Always run a dry-run first and show the plan to the user.
- Ask the user in chat whether to apply. Wait for an explicit yes.
- On confirmation, re-run the same arguments with `--apply`.

Example apply call after the user confirms:

```bash
AI_CONFIG_SYNC_HOST=codex "$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" sync $ARGS --apply
```

## Safety

- Require backups before any real write — the CLI prints `Backup root: ...` on apply.
- Confirm the backup location to the user before applying changes.
- Treat `partial` and `manual` entries as higher-risk; call them out explicitly in the dry-run summary.
- Apply may run selected file, skill, and settings item merge operations even when they are marked `manual`.
- Do not bypass CLI safeguards from this skill.
