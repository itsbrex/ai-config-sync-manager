---
description: Paraphrase host-strict-vocab tokens (Claude-only in codex files, Codex-only in claude files) and register per-line overrides so the result is masked from future status diffs.
argument-hint: '[--scope global|project|all] [--include area[:item][,...]] [--map token=paraphrase[,...]] [--apply] [--register] [--non-interactive] | [자연어 의도]'
allowed-tools: Bash(*)
---

If `$ARGUMENTS` is natural-language intent (Korean or English) instead of CLI flags, translate it into the matching paraphrase CLI flags before running. Mapping rules:

- `"X를 Y로 치환"` / `"X to Y"` → `--map "X=Y"` (다중 매핑은 콤마 구분: `--map "Read=Inspect,Write=Emit"`)
- `"codex에서 실행가능한 단어로 치환"` / `"host-strict 자동 치환"` / `"일반 paraphrase"` → no `--map` (uses bundled `rules/paraphrase-map.json`)
- 특정 agent/skill 명시 (예: `"repo-code-analyst만"`) → `--include agents:<name>` 또는 `--include skills:<name>`
- `"등록만"` / `"등록해줘"` / `"register only"` / `"파일은 그대로 두고 override만"` / `"이미 치환된 라인"` / `"pre-paraphrased"` / `"수동으로 치환된"` → `--register` (skip the rewrite stage, append override entries directly when the effective map equates the diverging line pair)
- 이미 `--` 로 시작하는 CLI flags → 그대로 통과

First run a dry-run preview (paraphrase defaults to dry-run unless `--apply` is given). When `$ARGUMENTS` looks like CLI flags or is empty, the CLI runs immediately; when it looks like natural-language intent, the bash branch prints a notice and you should translate it to flags using the mapping rules above, then re-invoke with the explicit flags:

!`AI_CONFIG_SYNC_HOST=claude bash -lc 'case "$ARGUMENTS" in ""|--*) "${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" paraphrase '"$ARGUMENTS"' ;; *) echo "[자연어 의도 감지] $ARGUMENTS — translate to paraphrase CLI flags using the mapping rules above, then run the bash command at the bottom of this skill." ;; esac'`

Confirmation flow:

- The slash command always shows a dry-run preview first.
- After reviewing the preview, ask the user in chat whether to apply.
- On the user's explicit yes, re-run this command with `--apply` appended.

Before applying changes:

- Summarize the CLI output exactly; show which files and lines will be rewritten.
- Highlight tokens that have no paraphrase yet (CLI labels them `pendingTokens`) and ask the user for explicit mappings before applying.
- The CLI registers each rewritten line in `rules/paraphrase-overrides.json`; verify the entries match the planned changes.

Apply only after the user explicitly confirms in chat:

```bash
AI_CONFIG_SYNC_HOST=claude "${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync" paraphrase $ARGUMENTS --apply
```
