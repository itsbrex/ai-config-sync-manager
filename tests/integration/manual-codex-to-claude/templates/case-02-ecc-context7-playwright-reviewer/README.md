# case-02-ecc-context7-playwright-reviewer

ECC-style project config: Context7, Playwright, GitHub MCP tool scoping, Sequential Thinking, read-only sandbox, and two Codex agents.

Expected areas: `instructions`, `agents`, `mcp`, `permissions`.

## `status` 결과 (pre-`--apply`, expected)

```
No diff detected for global scope.
```

- entries: 0
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

`.codex/agents/{explorer,reviewer}.toml` 가 `.claude/agents/{explorer,reviewer}.md` 로 동등 매핑되고, `.codex/config.toml` 의 MCP(context7, playwright, github, sequential-thinking) / read-only sandbox(`web_search` 만 allow) 가 1:1 일치.
