---
name: config-manager-paraphrase
description: Paraphrase host-strict-vocab tokens (Claude-only in codex files, Codex-only in claude files) and register per-line overrides through the bundled open-source CLI so the result is masked from future status diffs.
---

# Config Manager Paraphrase

Use this skill when the user asks to paraphrase host-strict vocabulary mismatches, register manual-review overrides, or pre-register lines that were already paraphrased outside the CLI.

## Behavior

- Resolve the bundled CLI from the Codex plugin root:
  `AI_CONFIG_SYNC_HOST=codex "$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" paraphrase`.
  The launcher resolves the runtime via `AI_CONFIG_SYNC_ROOT` (dev override) → PATH `ai-config-sync` → `npm exec` fallback.
- Always export `AI_CONFIG_SYNC_HOST=codex` before invoking the CLI from this skill so the default sync direction is `codex -> claude`. Paraphrase processes both directions regardless: claude-only tokens in codex files become codex-side paraphrases, and codex-only tokens in claude files become claude-side paraphrases.
- Default mode is dry-run preview. Apply only after the user explicitly confirms in chat.
- Default scope is global+project unless the user passes `--scope global`, `--scope project`, or `--scope all`.
- For partial paraphrase, pass selectors with `--include area[:item][,...]` and `--exclude area[:item][,...]`. Item selectors are supported for itemized areas such as `agents`, `skills`, and `instructions`.
- Print the CLI output as-is. Do not rewrite or summarize the dry-run report into a different format.
- The CLI registers each rewritten line in `rules/paraphrase-overrides.json`. Verify the entries match the planned changes before applying.
- If the bundled CLI is unavailable, report that the user must `npm install -g ai-config-sync-manager` (or run `npm link` from the repo) and re-run `connect`.

## Natural-Language Intent → CLI Flag Mapping

If the user gives natural-language intent (Korean or English) instead of CLI flags, translate it to flags before running:

- `"X를 Y로 치환"` / `"X to Y"` → `--map "X=Y"` (다중 매핑은 콤마 구분: `--map "Read=Inspect,Write=Emit"`)
- `"codex에서 실행가능한 단어로 치환"` / `"host-strict 자동 치환"` / `"일반 paraphrase"` → no `--map` (uses bundled `rules/paraphrase-map.json`)
- 특정 agent/skill 명시 (예: `"repo-code-analyst만"`) → `--include agents:<name>` 또는 `--include skills:<name>`
- `"등록만"` / `"등록해줘"` / `"register only"` / `"파일은 그대로 두고 override만"` / `"이미 치환된 라인"` / `"pre-paraphrased"` / `"수동으로 치환된"` → `--register` (skip the rewrite stage, append override entries directly when the effective map equates the diverging line pair)
- 이미 `--` 로 시작하는 CLI flags → 그대로 통과

When the user passes ambiguous tokens (e.g. `Read`, `Write`), prefix the map entry with `claude_only:` or `codex_only:` to force the direction.

## Confirmation Flow

- Always run a dry-run first and show the preview to the user.
- Highlight tokens that have no paraphrase yet (CLI labels them `pendingTokens`) and ask the user for explicit mappings before applying.
- Ask the user in chat whether to apply. Wait for an explicit yes.
- On confirmation, re-run the same arguments with `--apply` appended.

Example apply call after the user confirms:

```bash
AI_CONFIG_SYNC_HOST=codex "$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" paraphrase $ARGS --apply
```

## Commands

```bash
AI_CONFIG_SYNC_HOST=codex "$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" paraphrase
AI_CONFIG_SYNC_HOST=codex "$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" paraphrase --map "Read=Inspect,Write=Emit"
AI_CONFIG_SYNC_HOST=codex "$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" paraphrase --scope global --include agents:repo-code-analyst
AI_CONFIG_SYNC_HOST=codex "$HOME/plugins/ai-config-sync-manager/bin/ai-config-sync" paraphrase --register --include skills:commit-insight-pipeline --map "Read=Inspect,Write=Emit" --apply
```

## Safety

- `--apply` rewrites source files under agent/skill/instruction areas and appends to `rules/paraphrase-overrides.json`. Treat it as a write operation.
- Stale overrides (counterpart text drifted) are auto-invalidated at status time, restoring the conflict — do not pre-emptively delete entries from `paraphrase-overrides.json`.
- `--register` does not rewrite files but still appends override entries; require the same explicit confirmation as `--apply`.
- Do not bypass the `pendingTokens` prompt by passing `--non-interactive` without first surfacing the unmapped tokens to the user.
- Do not edit Codex, Claude, agent, skill, or instruction files directly from this skill — go through the CLI so override registration stays consistent.
