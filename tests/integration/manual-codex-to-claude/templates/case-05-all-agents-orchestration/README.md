# case-05-all-agents-orchestration

Multi-agent MCP setup with CLI fallback rules for Codex and Claude delegation. Includes one custom routing skill.

Expected areas: `instructions`, `skills`, `mcp`, `permissions`.

## `status` 결과 (pre-`--apply`, expected)

```
No diff detected for global scope.
```

- entries: 0
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

`.agents/skills/agent-router/SKILL.md` 가 `.claude/skills/agent-router/skill.md` 로, `.codex/config.toml` 의 다중 MCP 와 CLI fallback 규칙이 `.claude.json` / `.claude/settings.json` 과 동등 매핑.
