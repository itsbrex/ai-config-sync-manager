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
