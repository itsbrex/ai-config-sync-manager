---
name: config-manager-status
description: Check AI Config Sync Manager status through the bundled open-source CLI.
---

# Config Manager Status

Use this skill when the user asks for config sync status, host detection, or Claude/Codex drift.

## Behavior

- Resolve the bundled CLI from the Codex plugin root:
  `AI_CONFIG_SYNC_HOST=codex "$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" status`.
  The launcher resolves the runtime via `AI_CONFIG_SYNC_ROOT` (dev override) → PATH `ai-config-sync` → `npm exec` fallback.
- Always export `AI_CONFIG_SYNC_HOST=codex` before invoking the CLI from this skill so the default sync direction is `codex -> claude`.
- Default status checks both global and current project scopes.
- Use `--scope global`, `--scope project`, or `--scope all` only when the user asks to narrow the report.
- Use `--include area[,area:item]` and `--exclude area[,area:item]` when the user asks for a filtered diff. Item selectors are supported for itemized areas such as `skills`, `permissions`, and `hooks`.
- Use `... status --json` only when structured output is needed for follow-up automation.
- Print the CLI output as-is for user-facing status. Do not rewrite it into a different summary format.
- The CLI may collapse 10+ item diffs per scope/area into counts such as `+12`, `-3`, `~10`, or `!2`; when that happens, tell the user to open the printed detail file for the full item list and before/after previews.
- Preserve the CLI's concrete item/source details when relaying status. Do not collapse items into vague phrases such as "content differs" or "missing skills" without the detail-file pointer.
- Do not infer sync state by editing or scanning config files directly when the CLI is available.
- If the bundled CLI is unavailable, report that the user must `npm install -g ai-config-sync-manager` (or run `npm link` from the repo) and re-run `connect`.

## Safety

- Status is read-only.
- Highlight items marked `manual`, `partial`, permissions, hooks, or custom commands as higher-risk apply targets.
- Do not apply changes from a status command.
