# case-02-ecc-context7-playwright-reviewer

ECC-style project config: Context7, Playwright, GitHub MCP tool scoping, Sequential Thinking, read-only sandbox, and two Codex agents.

Expected areas: `instructions`, `agents`, `mcp`, `permissions`.

## Expected `status` result (post-`sync --apply`)

```
No diff detected for global scope.
```

- entries: 0
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

`.codex/agents/{explorer,reviewer}.toml` maps to `.claude/agents/{explorer,reviewer}.md` as equivalent, and `.codex/config.toml`'s MCP (context7, playwright, github, sequential-thinking) and read-only sandbox (only `web_search` allowed) match 1:1.
