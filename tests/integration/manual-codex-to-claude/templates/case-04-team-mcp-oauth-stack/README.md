# case-04-team-mcp-oauth-stack

Team-style MCP stack: remote GitHub, Linear, Sentry, and local Docker Postgres with environment placeholders.

Expected areas: `instructions`, `mcp`, `permissions`.

## Expected `status` result (post-`sync --apply`)

```
No diff detected for global scope.
```

- entries: 0
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

The 4 MCP servers in `.codex/config.toml` (remote GitHub OAuth, Linear, Sentry, local Docker Postgres) carry their placeholder env values verbatim into `.claude.json` `mcpServers`, and the team operating rules in `.codex/AGENTS.md` are equivalent to `.claude/CLAUDE.md`.
