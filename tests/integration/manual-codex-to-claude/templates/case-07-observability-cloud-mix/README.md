# case-07-observability-cloud-mix

Cloud observability stack with GCloud, Azure, Tavily, and paper-search MCP patterns plus mixed shell allow/deny rules.

Expected areas: `instructions`, `skills`, `mcp`, `permissions`.

## Expected `status` result (post-`sync --apply`)

```
No diff detected for global scope.
```

- entries: 0
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

`.agents/skills/cloud-triage/SKILL.md` maps to `.claude/skills/cloud-triage/skill.md`, and the GCloud / Azure / Tavily / paper-search MCP plus mixed shell allow/deny rules in `.codex/config.toml` match `.claude.json` / `.claude/settings.json` 1:1.
