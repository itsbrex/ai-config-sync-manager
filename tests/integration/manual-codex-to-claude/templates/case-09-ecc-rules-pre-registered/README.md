# case-09-ecc-rules-pre-registered

Same upstream source as `case-08-ecc-realworld-mapping` (no rules pre-seeded
in templates). The harness invokes `setup.sh` after `sync --apply` so that
the post-sync rule registrations match the real-world flow a user would run
manually:

1. `paraphrase --apply --map "Skill=verification routine"` —
   rewrites the `Skill` token on the codex-side
   `.agents/skills/verification-loop/SKILL.md` (line 6) and registers the
   override under `paraphrase-overrides.json`. Also seeds
   `paraphrase-map.json` with `Skill -> verification routine`.
2. `paraphrase --apply --map "claude_only:Hooks=event handlers"` —
   registers an extra dictionary entry through the CLI map path. This token
   has no matching line in the fixture, so it never produces an override; it
   only lives in the map. This split (override = matched-line registry, map =
   lookup library) keeps the two files distinct rather than redundant copies.
3. Hand-authored `.ai-config-sync-manager/rules/status-ignore.json` —
   masks the over-translated `Codex CLI` / `AGENTS.md` table cells in the
   instructions area.

## Layout

```
templates/case-09-ecc-rules-pre-registered/
  .codex/, .agents/, .claude/        # raw upstream (matches case-08)
  setup.sh                           # post-sync registration script

expected/case-09-ecc-rules-pre-registered/
  claude-home/.claude{,.json}        # post-sync claude tree
  codex-home/.codex/, .agents/       # post-paraphrase codex tree
                                     # (codex SKILL.md L6 token rewritten)
  .ai-config-sync-manager/rules/{paraphrase-overrides,paraphrase-map,status-ignore}.json
                                     # canonical rule snapshots mirroring
                                     # the lab path, with __LAB_HOME__ +
                                     # __REGISTERED_AT__ placeholders
```

`run-cases.sh` invokes `setup.sh` automatically and compares the lab's
rules JSON (after reverse-substituting the lab path and timestamp into
placeholders) against `expected/<case>/.ai-config-sync-manager/rules/` —
so the registrations are deterministically verified across machines.

## Manual reproduction

```bash
case=case-09-ecc-rules-pre-registered
scripts/reset.sh "$case"

AI_CONFIG_SYNC_HOME="$(pwd)/lab/${case}" \
  node ../../../bin/ai-config-sync.mjs sync \
    --scope global --from codex --to claude --apply

AI_CONFIG_SYNC_HOME="$(pwd)/lab/${case}" \
  ./templates/${case}/setup.sh "$(cd ../../.. && pwd)"

AI_CONFIG_SYNC_HOME="$(pwd)/lab/${case}" \
  node ../../../bin/ai-config-sync.mjs status --scope global
# Expect: "1 paraphrase override(s) active, 0 stale."
```

Reference: `case-08-ecc-realworld-mapping/MAPPING-NOTES.md` for the line/token
inventory the rules target.

## `status` 결과 (pre-`--apply`, expected)

setup.sh 가 paraphrase override 1건과 status-ignore 룰 2건을 등록한 뒤 실행되는 status:

```
1 diff(s) detected for global scope. 1 paraphrase override(s) active, 0 stale.
```

- entries: 1
  - `global/skills: !verification-loop [unsupported] (conflict, manual)`
- vocabFindings: 0 (case-08의 vocab finding은 paraphrase override 가 흡수)
- paraphraseOverrides: 1 active / 0 stale
  - `global-skills-verification-loop-codex-L9` — claude L7 `# Verification Loop Skill` ↔ codex L9 `# Verification Loop verification routine`

`.claude/skills/verification-loop/skill.md` 와 `.agents/skills/verification-loop/SKILL.md` 의 본문 차이:

| 위치 | claude (`skill.md`) | codex (`SKILL.md`) |
| --- | --- | --- |
| frontmatter | `name`, `description`(unquoted), `model: sonnet` (4줄) | `name`, `description`(quoted), `model: gpt-5.4`, `model_reasoning_effort`, `sandbox_mode` (6줄) |
| heading | L7 `# Verification Loop Skill` | L9 `# Verification Loop verification routine` (paraphrased) |
| body | `Claude Code sessions`, `PostToolUse hooks`, `/verify` | 동일 토큰을 host-strict-vocab 매핑으로 동등 처리 |

활성 override 가 heading 라인을 mask 하지만, frontmatter 길이/필드 차이(`model`, `model_reasoning_effort`, `sandbox_mode`)는 host-strict 매핑으로 동등 판정되지 않아 skills 비교가 `unsupported conflict` 로 잔존. 즉 entries=1 은 설계상 paraphrase override 만으로는 해소되지 않는 잔여 차이를 보여주는 것이며, `--include skills:verification-loop --apply` 로만 해소 가능 (또는 frontmatter 동등 규칙을 추가 등록).

`.codex/AGENTS.md` 측 `Codex CLI` / `AGENTS.md` 표 셀 over-translation 은 status-ignore 룰 2건이 instructions 영역에서 흡수하므로 entries 에 추가로 등장하지 않음.
