# case-01-gstack-notion-exa-grep

Mixed Codex-heavy setup: custom `gstack` skill, Notion MCP, remote Exa MCP, web search, workspace-write sandbox, and a grep prefix rule.

Expected areas: `instructions`, `skills`, `mcp`, `permissions`.

## Expected `status` result (post-`sync --apply`)

After `sync --apply`, running `ai-config-sync status --scope global`:

```
No diff detected for global scope.
```

- entries: 0
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

Tokens in `.codex/AGENTS.md`, `.codex/config.toml`, and `.agents/skills/gstack/SKILL.md` are interpreted as equivalent to those in `.claude/CLAUDE.md`, `.claude/settings.json`, and `.claude/skills/gstack/skill.md` through host-strict-vocab mappings (`Codex CLI`↔`Claude Code`, `AGENTS.md`↔`CLAUDE.md`, `SKILL.md`↔`skill.md`, etc.). MCP (notion/exa) and permissions (WebSearch, Bash:grep:*) also map 1:1.
