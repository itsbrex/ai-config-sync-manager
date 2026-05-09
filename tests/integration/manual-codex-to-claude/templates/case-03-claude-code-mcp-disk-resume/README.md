# case-03-claude-code-mcp-disk-resume

Codex registers Claude Code as an MCP server, with placeholder disk-resume env and explicit Claude CLI shell prompt rules.

Expected areas: `instructions`, `mcp`, `permissions`.

## Expected `status` result (post-`sync --apply`)

```
No diff detected for global scope.
```

- entries: 0
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

The `[mcp_servers.claude_code]` entry in `.codex/config.toml` (npx `@anthropic-ai/claude-code mcp serve`, `CLAUDE_CODE_RESUME_FROM_DISK` placeholder env) converts as equivalent to `mcpServers` in `.claude.json`. The Claude CLI shell prompt rules in `.codex/AGENTS.md` match `.claude/CLAUDE.md` via host-strict mapping.
