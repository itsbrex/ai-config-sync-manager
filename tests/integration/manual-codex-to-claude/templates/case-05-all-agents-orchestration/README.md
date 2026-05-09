# case-05-all-agents-orchestration

Multi-agent MCP setup with CLI fallback rules for Codex and Claude delegation. Includes one custom routing skill.

Expected areas: `instructions`, `skills`, `mcp`, `permissions`.

## Expected `status` result (post-`sync --apply`)

```
No diff detected for global scope.
```

- entries: 0
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

`.agents/skills/agent-router/SKILL.md` maps to `.claude/skills/agent-router/skill.md`, and the multiple MCP servers and CLI fallback rules in `.codex/config.toml` map equivalently to `.claude.json` / `.claude/settings.json`.
