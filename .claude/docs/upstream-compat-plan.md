# Upstream Compatibility Follow-up Plan

The rule files of AI Config Sync Manager (`rules/terminology-map.json`, `rules/agents-map.json`, `rules/call-templates.json`, `rules/host-target-templates.json`) must reflect the latest behavior of both Claude Code and Codex CLI. Whenever either host adds, renames, or deprecates a feature, our rules lag. This document describes a 4-layer follow-up strategy that **detects that lag automatically** and **isolates the points that need human judgment**.

## Goals

- Notice upstream CLI changes as early as possible (weekly granularity is acceptable).
- Use machine-comparable sources (schemas, releases JSON) as the single source of truth.
- Items that need semantic judgment are not automated; they are isolated as GitHub Issues.
- Run with near-zero burden on a solo maintainer (within the GitHub Actions free tier).

## Sources

| Host   | Type            | URL                                                          |
| ------ | --------------- | ------------------------------------------------------------ |
| Claude | Settings schema | https://json.schemastore.org/claude-code-settings.json       |
| Claude | Releases        | https://api.github.com/repos/anthropics/claude-code/releases |
| Claude | Changelog       | https://code.claude.com/docs/en/changelog                    |
| Codex  | Config schema   | https://developers.openai.com/codex/config-schema.json       |
| Codex  | Releases        | https://api.github.com/repos/openai/codex/releases           |
| Codex  | Changelog       | https://developers.openai.com/codex/changelog                |

## Layer 1 — Passive Snapshot Diff (automated; introduce first)

A cron schedule runs twice a week (Tue/Fri 03:17 UTC), plus `workflow_dispatch`, fetches each source above, and stores it under `snapshots/{claude,codex}/` in deterministic form. If `git diff --exit-code` is empty, exit; otherwise file a GitHub Issue automatically. The twice-weekly schedule lines up with US release days (Mon/Thu PT afternoons) to minimize lag.

### Layout

```
snapshots/
├ claude/
│  ├ settings-schema.json    # sorted with jq -S
│  ├ releases.json           # top 5 releases { tag_name, published_at, body }
│  └ changelog.md            # extracted from HTML
└ codex/
   ├ config-schema.json
   ├ releases.json
   └ changelog.md
.github/workflows/upstream-compat.yml
scripts/snapshot-upstream.mjs
```

### Auto-issue format

- Label: `compatibility`
- Title: `Upstream CLI compatibility drift detected (<date>)`
- Body: `git diff` output (wrapped in a code block), the list of changed files, a priority hint.

### Cost to introduce

About 1 PR. No external dependencies (`curl`, `jq`, and `gh` CLI are all preinstalled on GitHub Actions runners).

## Layer 2 — Priority Watchlist (manual reference)

| Host   | Priority | Item                                                                              | Affected rules                                       |
| ------ | -------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Codex  | top      | `config.toml` schema (`AgentsToml`, `mcp_servers`, `approval_policy`, sandbox modes) | terminology-map (permissions, hooks-mcp), agents-map |
| Codex  | high     | `spawn_agent` signature, model aliases                                            | call-templates, agents-map.models                    |
| Codex  | medium   | CLI flags, MCP server config locations                                            | terminology-map (files, hooks-mcp)                   |
| Claude | top      | `settings.json` schema (permissions keys, hooks event enums)                      | terminology-map (permissions, hooks-mcp)             |
| Claude | high     | agent frontmatter fields, `.claude/agents` location rules                         | agents-map.fields                                    |
| Claude | medium   | CLI flags, MCP locations, web policy                                              | terminology-map (hooks-mcp)                          |
| Both   | medium   | sub-agent invocation patterns (`Agent({...})` ↔ `spawn_agent`)                    | call-templates                                       |

When a Layer 1 issue arrives, review the affected rule files in this priority order.

## Layer 3 — Fixture Roundtrip (regression check, optional)

Verifies _runtime behavior_ changes that the schema alone cannot catch. Introduce only if Layer 1 reports false positives often, or if a semantic change is suspected.

### Layout

```
tests/upstream-compat/
├ claude-fixtures/
│  ├ settings.json
│  ├ agents/sample.md
│  └ skills/sample/skill.md
├ codex-fixtures/
│  ├ config.toml
│  ├ agents/sample.toml
│  └ skills/sample/SKILL.md
└ roundtrip.test.mjs
```

`roundtrip.test.mjs`:

1. claude-fixtures → ai-config-sync → verify the resulting Codex output.
2. The resulting files pass `codex config validate` (where the CLI provides such a command).
3. Sync codex → claude back and confirm idempotency.

Because the CI must install the `codex` / `claude` binaries, run this in a separate cron job. Do not introduce it up front; decide based on Layer 1 results.

## Layer 4 — Manual Review (cannot be automated)

The following decisions are not automated:

- **Whether deprecated aliases are still accepted at runtime.** A name dropped from the schema may still work in practice.
- **Permission / sandbox security equivalence.** When a new sandbox mode is added, a human must judge whether the existing mapping (`workspace-write` ↔ `Write/Edit/MultiEdit`) is still safe.
- **Semantic change behind a permission rename.** Whether `permissions.allow` → `permissions.allowList` is a pure rename or carries a subtle behavior change.
- **The intent of a new vendor's host.** Reading the changelog body in natural language.

The Layer 1 issue body includes a "needs manual review" checklist so these are not missed.

## Roadmap

| Phase             | Deliverable                                                | Trigger                                                |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Phase 1 (now)     | Layer 1 cron + snapshot diff                               | 1 PR after this document is approved                   |
| Phase 2 (if needed) | Layer 3 roundtrip tests                                    | When Layer 1 misses a semantic change in practice      |
| Phase 3 (option)  | `bin/ai-config-sync compat` local diagnostic subcommand    | On user request                                        |

## References

- [Plugin update detection (Claude Code issue #31462)](https://github.com/anthropics/claude-code/issues/31462)
- [marckrenn/claude-code-changelog](https://github.com/marckrenn/claude-code-changelog) — community changelog tracker
- [SchemaStore claude-code-settings.json](https://json.schemastore.org/claude-code-settings.json)
- [Codex config-schema.json](https://developers.openai.com/codex/config-schema.json)
- [Renovate docs](https://docs.renovatebot.com/getting-started/running/) — pattern reference
