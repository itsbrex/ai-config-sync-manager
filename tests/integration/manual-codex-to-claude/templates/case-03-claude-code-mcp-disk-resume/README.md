# case-03-claude-code-mcp-disk-resume

Codex registers Claude Code as an MCP server, with placeholder disk-resume env and explicit Claude CLI shell prompt rules.

Expected areas: `instructions`, `mcp`, `permissions`.

## `status` 결과 (pre-`--apply`, expected)

```
No diff detected for global scope.
```

- entries: 0
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

`.codex/config.toml` 의 `[mcp_servers.claude_code]` 항목 (npx `@anthropic-ai/claude-code mcp serve`, `CLAUDE_CODE_RESUME_FROM_DISK` placeholder env) 이 `.claude.json` 의 mcpServers 로 동등 변환. `.codex/AGENTS.md` 의 Claude CLI 셸 프롬프트 규칙은 `.claude/CLAUDE.md` 와 host-strict 매핑으로 일치.
