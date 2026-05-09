# case-06-plugin-hooks-frontend-design

Plugin-style frontend design skill with Codex native hooks and formatter shell allowlist.

Expected areas: `instructions`, `skills`, `hooks`, `permissions`.

## Expected `status` result (post-`sync --apply`)

```
No diff detected for global scope.
```

- entries: 0
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

`.agents/skills/frontend-design/SKILL.md` maps to `.claude/skills/frontend-design/skill.md`, and the hooks (e.g. PostToolUse formatter) and shell allow rules in `.codex/config.toml` convert equivalently to the hooks / permissions in `.claude/settings.json`.
