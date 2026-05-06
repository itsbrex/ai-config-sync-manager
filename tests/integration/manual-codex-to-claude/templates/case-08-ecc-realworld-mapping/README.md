# case-08-ecc-realworld-mapping

Real-world fixture sourced from the public **everything-claude-code (ECC)** repo
(`affaan-m/everything-claude-code` @ `main`). Verifies that terminology mapping
and tool-paraphrase rules behave correctly against unmodified upstream content
that was authored without `ai-config-sync-manager` in mind.

Files captured verbatim from upstream:

- `.codex/AGENTS.md` — references `Hooks`, `Subagent Task tool`, `Skills`,
  `MCP`. The codex-to-claude sync should leave the `Task tool` token untouched
  on the claude side (claude-native vocabulary), and the codex side stays
  unchanged.
- `.codex/config.toml` — multi_agent + 6 MCP servers (manual_github,
  context7, manual_exa, memory, playwright, sequential-thinking). Two ids are
  prefixed `manual_*` per the parent README guidance to avoid colliding with
  the harness's `CODEX_CONFLICT_HOME` global config; remaining ids match
  upstream verbatim. The streamable_http exa entry also gets an explicit
  `transport` field that ECC upstream omits — the current Codex CLI requires
  it when `url` is present.
- `.codex/agents/explorer.toml` — multi-agent role config layer.
- `.agents/skills/verification-loop/SKILL.md` — paraphrase-trigger keywords
  (`Claude Code sessions`, `PostToolUse hooks`, `/verify` slash command). When
  copied to `.claude/skills/verification-loop/skill.md`, the terminology layer
  rewrites the codex-only `/verify` reference.

Expected sync surfaces: `instructions`, `skills`, `mcp`.

Source: https://github.com/affaan-m/everything-claude-code (MIT-licensed,
trimmed to the subset relevant to mapping/paraphrase verification).

## `status` 결과 (pre-`--apply`, expected)

setup.sh 가 없어 paraphrase override 미등록 상태로 status 가 vocab finding 1건을 보고합니다.

```
No diff detected for global scope. 1 vocab mismatch(es) detected.
```

- entries: 0
- vocabFindings: 1
  - `codex skills/verification-loop L9 col 21: token="Skill" side=claude_only`
  - 원인: `.agents/skills/verification-loop/SKILL.md:9` 의 `# Verification Loop Skill` 에 들어 있는 `Skill` 토큰이 host-strict-vocab 사전상 claude-only 로 등록돼 있어 codex 측 노출이 manual review 로 표시. `.claude/skills/verification-loop/skill.md` 측은 동일 토큰이 허용되므로 finding 없음.
- paraphraseOverrides: 0 active / 0 stale

해소 방법: `paraphrase --apply --map "Skill=verification routine"` 으로 codex 측 토큰을 치환 + override 등록 (= case-09 setup 과 동일 흐름). 그 외 `MAPPING-NOTES.md` 표의 `Codex CLI ↔ Claude Code`, `AGENTS.md ↔ CLAUDE.md`, `.codex/config.toml ↔ .claude/settings.json`, `.codex/agents/*.toml ↔ .claude/agents/*.md` 매핑은 모두 동등 처리되어 entries 에는 잡히지 않음.
