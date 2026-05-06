# case-01-gstack-notion-exa-grep

Mixed Codex-heavy setup: custom `gstack` skill, Notion MCP, remote Exa MCP, web search, workspace-write sandbox, and a grep prefix rule.

Expected areas: `instructions`, `skills`, `mcp`, `permissions`.

## `status` 결과 (pre-`--apply`, expected)

`sync --apply` 후 `ai-config-sync status --scope global` 실행 시:

```
No diff detected for global scope.
```

- entries: 0
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

`.codex/AGENTS.md`, `.codex/config.toml`, `.agents/skills/gstack/SKILL.md` 의 토큰이 host-strict-vocab 매핑(`Codex CLI`↔`Claude Code`, `AGENTS.md`↔`CLAUDE.md`, `SKILL.md`↔`skill.md` 등)으로 `.claude/CLAUDE.md`, `.claude/settings.json`, `.claude/skills/gstack/skill.md` 와 동등 해석. MCP(notion/exa) / permissions(WebSearch, Bash:grep:*) 도 1:1 매핑.
