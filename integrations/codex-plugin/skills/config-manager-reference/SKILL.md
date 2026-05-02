---
name: config-manager-reference
description: Print the AI Config Sync Manager reference (commands, areas, risk levels, mapping qualities, action verbs, terminology layers, hidden markers, file locations) through the bundled open-source CLI.
---

# Config Manager Reference

Use this skill when the user asks for an AI Config Sync Manager reference, cheatsheet, or a full listing of CLI commands, areas, risk levels, mapping qualities, sync action verbs, terminology layers, hidden markers, or known file locations.

## Behavior

- Resolve the bundled CLI from the Codex plugin root:
  `"$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" reference`.
  The launcher resolves the runtime via `AI_CONFIG_SYNC_ROOT` (dev override) → PATH `ai-config-sync` → `npm exec` fallback.
- Default mode prints the markdown reference to stdout. Print the CLI output as-is — do not rewrite, summarize, or regroup the sections.
- When the user asks for a saved snapshot, pass `--output <path>`:
  `"$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" reference --output <path>` writes the markdown to the given path and prints the resolved absolute path on success.
- The repository also commits a static snapshot at `docs/reference.md` for offline / GitHub browsing. Mention that path when the user asks where to read the reference without running the CLI.
- Reference is read-only; it does not modify any host configuration.
- If the bundled CLI is unavailable, report that the user must `npm install -g ai-config-sync-manager` (or run `npm link` from the repo) and re-run `connect`.

## Safety

- Reference is read-only. Do not chain it with sync, connect, or any write operations from this skill.
- Do not regenerate `docs/reference.md` automatically; only run with `--output` when the user explicitly asks for a written copy.
