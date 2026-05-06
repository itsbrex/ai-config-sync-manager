<!-- markdownlint-disable MD033 MD041 MD028 -->

<p align="center">
  <img width="12%" src="./assets/icon.png" alt="ai-config-sync-manager" />
</p>

<h1 align="center">AI Config Sync Manager</h1>

<p align="center">
  <b>Keep Claude Code and Codex agent config in lockstep — one CLI, both hosts.</b>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/ai-config-sync-manager"></a>
  <a href="https://www.npmjs.com/package/ai-config-sync-manager"><img alt="Version" src="https://img.shields.io/npm/v/ai-config-sync-manager"></a>
  <a href="https://www.npmjs.com/package/ai-config-sync-manager"><img alt="Downloads" src="https://img.shields.io/npm/dt/ai-config-sync-manager"></a>
  <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white">
  <img alt="Runtime deps" src="https://img.shields.io/badge/runtime%20deps-0-success">
  <img alt="ESM" src="https://img.shields.io/badge/ESM-only-F7DF1E?logo=javascript&logoColor=black">
  <img alt="Hosts" src="https://img.shields.io/badge/hosts-Claude%20%7C%20Codex-blueviolet">
</p>

<p align="center">
  <img src="./assets/diagram.png" alt="ai-config-sync-manager — data flow at a glance" width="100%" />
</p>

## Highlights

- **Bidirectional sync** — `claude → codex` and `codex → claude`, drift auto-detected.
- **Diff-first workflow** — `status` to compare → `sync --dry-run` to preview → `--apply` to write.
- **Risk-tagged operations** — `permissions`, `hooks`, custom commands labeled `safe` / `partial` / `manual`.
- **Backup-on-write** — every overwrite snapshotted under `.backups/`, FIFO retention (30).
- **Selector mini-DSL** — `--include skills:assignment-test,instructions --exclude mcp` style filtering.
- **Native semantic mapping** — Claude `Write` → Codex `sandbox_mode = "workspace-write"`, etc.
- **Zero runtime dependencies** — single ESM file (`bin/ai-config-sync.mjs`), Node built-ins only.
- **Thin host plugins** — `/config-manager:*` for Claude, `config-manager-*` for Codex.

## Why this exists

Claude Code and Codex use the **same concepts** (instructions / skills / mcp / permissions / hooks) but in **different files, formats, and names**:

| Concept | Claude | Codex |
|---|---|---|
| Instructions | `~/.claude/CLAUDE.md` | `~/.codex/AGENTS.md` |
| Skills | `~/.claude/skills/` | `~/.codex/skills/` |
| Settings | `~/.claude/settings.json` | `~/.codex/config.toml` |
| MCP | `~/.claude/.mcp.json` | `[mcp_servers.*]` in `config.toml` |

Hand-rolling the sync invites **drift, semantic loss, and accidental secret leaks**. This CLI keeps the two hosts aligned while preserving host-native meaning.

## Quick Start

```bash
npm install -g ai-config-sync-manager
ai-config-sync connect           # register the plugin in Claude + Codex
ai-config-sync status            # show drift across global + project scopes
ai-config-sync sync --dry-run    # preview changes (default mode)
ai-config-sync sync --apply      # apply with automatic backups
```

## Requirements

- Node.js **≥ 20**
- Claude Code and/or Codex CLI installed (host plugins are auto-registered by `connect`)

## Table of Contents

| Category | Sections |
| --- | --- |
| **Commands** | [Bundled CLI](#bundled-cli) · [Host plugin commands](#host-plugin-commands) |
| **Workflow** | [Selector mini-DSL](#selector-mini-dsl) · [Sync direction](#sync-direction) · [Scopes](#scopes) |
| **Safety** | [Safety defaults](#safety-defaults) · [Risk levels](#risk-levels) · [Retention](#retention) |
| **Mapping** | [Native mapping](#native-mapping-claude--codex) · [Areas](#areas) |
| **Architecture** | [Architecture](#architecture) · [Install resolution](#install-resolution) |
| **Reference** | [Documentation](#documentation) · [Local dev](#local-dev-from-this-repo) · [Gotchas](#gotchas) · [API surface](#api-surface) |

## Commands

### Bundled CLI

```bash
./bin/ai-config-sync.mjs connect
./bin/ai-config-sync.mjs status
./bin/ai-config-sync.mjs status --json
./bin/ai-config-sync.mjs status --scope global
./bin/ai-config-sync.mjs status --scope project
./bin/ai-config-sync.mjs status --include skills:assignment-test,instructions --exclude mcp
./bin/ai-config-sync.mjs sync --dry-run
./bin/ai-config-sync.mjs sync --scope project --dry-run
./bin/ai-config-sync.mjs sync --scope global --apply
./bin/ai-config-sync.mjs sync --include instructions,skills:assignment-test --exclude mcp --dry-run
./bin/ai-config-sync.mjs sync --from claude --to codex
./bin/ai-config-sync.mjs sync --from codex --to claude
./bin/ai-config-sync.mjs reference
./bin/ai-config-sync.mjs paraphrase
```

| Command | Purpose |
| --- | --- |
| `connect` | Detect installed hosts and register the matching plugin |
| `status` | Compare global + project config across both hosts |
| `status --json` | Machine-readable diff |
| `sync --dry-run` | Preview the merge plan without writing |
| `sync --apply` | Apply the plan, snapshot to `.backups/` |
| `reference` | Emit / persist a self-generated markdown reference |
| `paraphrase` | Line-level override archive for instruction wording |

### Host plugin commands

| Host | Connect | Status | Sync |
| --- | --- | --- | --- |
| **Claude** | `/config-manager:connect` | `/config-manager:status` | `/config-manager:sync` |
| **Codex** | `config-manager-connect` | `config-manager-status` | `config-manager-sync` |

## Selector mini-DSL

`--include` narrows the plan first, then `--exclude` removes matches. Both accept `area` or `area:item` syntax; itemized areas (`skills`, `permissions`, `hooks`, `agents`, `mcp`, `commands`) accept glob items.

```bash
ai-config-sync sync --include skills:assignment-test,instructions --exclude mcp --dry-run
ai-config-sync sync --include "permissions:Write*" --exclude "permissions:Bash(rm:*)" --dry-run
```

### Areas

| Area | Itemized? | Apply granularity |
| --- | --- | --- |
| `instructions` | — | file merge |
| `skills` | yes | per skill |
| `agents` | yes | per agent |
| `mcp` | yes | per server |
| `permissions` | yes | item-by-item patch |
| `hooks` | yes | item-by-item patch |
| `commands` | yes | per command |

## Sync direction

| Trigger | Default direction |
| --- | --- |
| `AI_CONFIG_SYNC_HOST=codex` (Codex plugin invocation) | `codex → claude` |
| Otherwise (Claude plugin / direct CLI) | `claude → codex` |
| `--from <host> --to <host>` | Explicit override |

## Scopes

| Scope | Path coverage |
| --- | --- |
| `global` | `~/.claude/**`, `~/.codex/**` |
| `project` | `<cwd>/.claude/**`, `<cwd>/.codex/**`, `<cwd>/AGENTS.md`, `<cwd>/CLAUDE.md` |
| default / `all` | `global + project` |

## Safety defaults

- **Dry-run first** — `sync` defaults to dry-run; `--apply` is required for any write.
- **Backups on every write** — atomic snapshot to `.backups/<area>/<host>/<timestamp>/...` before overwrite.
- **Risk labels** — high-impact entries (`permissions`, `hooks`, custom commands) marked with their risk level in the diff.
- **Strict-vocab guard** — host-only tokens (e.g. Codex `update_plan`) flagged on cross-host copy.
- **Secret pass-through** — MCP env values are copied by default; set `AI_CONFIG_SYNC_STRIP_SECRETS=1` to redact.
- **Schema version** — baseline state requires `schemaVersion: 1`; unknown versions abort.

### Risk levels

| Level | Meaning | Behavior |
| --- | --- | --- |
| `safe` | Lossless, deterministic mapping | Auto-applied |
| `partial` | Maps to a near-equivalent on the other host | Auto-applied with annotation |
| `manual` | No safe automatic equivalent | Listed in the plan but **always review** before `--apply` |

### Retention

| Directory | Keep | Strategy |
| --- | --- | --- |
| `.backups/<area>/<host>/` | 30 | FIFO (oldest pruned on next write) |
| `~/.config/ai-config-sync/status-details/` | 100 | FIFO |

## Native mapping (Claude ↔ Codex)

| Claude | Codex |
| --- | --- |
| `permissions.allow: ["Write"]` | `sandbox_mode = "workspace-write"` |
| command-like `permissions.allow` (e.g. `Bash(npm:*)`) | `approval_policy = "on-request"` |
| `.mcp.json` server entries | `[mcp_servers.<name>]` TOML tables |
| `hooks.PreToolUse` / `PostToolUse` | mapped where a Codex equivalent exists, else `manual` |
| `~/.claude/skills/<name>/SKILL.md` | `~/.codex/skills/<name>/SKILL.md` |

Full mapping reference: [`maximal-one-to-one-mapping.md`](./.claude/docs/maximal-one-to-one-mapping.md).

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  bin/ai-config-sync.mjs    single ESM · zero runtime deps · ~8.6k LOC  │
│                                                                        │
│   parser  ──▶  planner  ──▶  applier  ──▶  archiver                    │
│   status/      diff +        atomic         backup +                   │
│   sync/...     risk-tag      patch/copy     status-detail              │
└────────────────────────────────────────────────────────────────────────┘
            ▲                                                ▼
   ┌────────┴────────┐                              ┌────────┴────────┐
   │ Claude          │  ◀── bidirectional sync ──▶  │ Codex           │
   │ ~/.claude/*     │                              │ ~/.codex/*      │
   │ /config-manager │                              │ config-manager- │
   └─────────────────┘                              └─────────────────┘
```

The shared engine lives in `bin/ai-config-sync.mjs` (single ESM file, zero runtime deps). Host-specific plugins are thin wrappers around the bundled CLI.

Detailed analysis: [`.claude/docs/repo-analysis/`](./.claude/docs/repo-analysis/).

## Install resolution

The plugin launcher resolves the CLI in this order:

1. `AI_CONFIG_SYNC_ROOT` env (dev override)
2. PATH `ai-config-sync` (`npm install -g` or `npm link`)
3. `npm exec --yes --package=ai-config-sync-manager@<pin>` fallback

After `npm install -g`, every host calls the same npm package, so two hosts cannot drift to different versions.

## Local dev from this repo

`npm install` runs the `prepare` script, which builds `dist/` (without touching active plugin caches) so the launcher and host plugin trees are ready to inspect immediately after clone.

```bash
npm install           # also runs `prepare` -> build:dist:no-sync
npm run dev:setup     # = npm link + npm run build:dist (with active cache sync)
npm run dev:teardown  # revert
npm test              # node:test integration suite
npm run check         # opt-in JSDoc / @ts-check
npm run lint
npm run format:check
```

## Documentation

| Topic | File |
| --- | --- |
| Architecture overview | [`architecture.md`](./.claude/docs/architecture.md) |
| Install / connect flow | [`install-flow.md`](./.claude/docs/install-flow.md) |
| Distribution policy | [`distribution-workflow.md`](./.claude/docs/distribution-workflow.md) |
| Maximal 1-to-1 mapping | [`maximal-one-to-one-mapping.md`](./.claude/docs/maximal-one-to-one-mapping.md) |
| Integration test guide | [`integration-test-workflow.md`](./.claude/docs/integration-test-workflow.md) |
| Repo analysis bundle | [`repo-analysis/`](./.claude/docs/repo-analysis/) |
| Customizing rules | [`docs/customizing-rules.md`](./docs/customizing-rules.md) |

## Gotchas

- **No programmatic API.** `bin/ai-config-sync.mjs` executes on import. Do not `import` it from another module — see [API surface](#api-surface).
- **Symlink skills are status-only.** They appear in `status` but are excluded from `sync`; link vs target-content policy is deferred (see workflow §8.4).
- **Permissions and hooks are patched item-by-item**, not whole-file copied. `--include permissions:Write` is the supported way to scope a single item.
- **Codex host inversion** — when invoked through the Codex plugin, `AI_CONFIG_SYNC_HOST=codex` flips the default direction to `codex → claude`. Use `--from`/`--to` for an explicit override.
- **MCP env values are copied verbatim by default** — opt in to redaction with `AI_CONFIG_SYNC_STRIP_SECRETS=1`.
- **`--apply` is final**, but reversible: every write creates a `.backups/` snapshot. `--dry-run` is the default for a reason.

## API surface

This is a **CLI tool**, not a library. There is no programmatic API — `import`-ing this package from another Node module is not supported and the bundled `bin/ai-config-sync.mjs` is not designed to be loaded as a library (it executes the command on import). All functionality is exposed through the `ai-config-sync` command and the host plugins. If you need programmatic access to a specific function (mapping rules, plan generation, status diff), open an issue describing the use case so the surface can be designed deliberately.

## Roadmap

Tracked in [`workflow.md` §8.4](./.claude/docs/workflow.md). Highlights of upcoming scope:

| Item | Status | Notes |
| --- | --- | --- |
| **Additional host integrations** (Cursor, Windsurf, …) | Planned | The launcher pattern is reusable. Each new host gets its own `integrations/<host>-plugin/` after a survey of its plugin/extension spec and config storage layout. |
| **Memory / context sync** | Deferred (RFC-first) | `memory`, implicit context, and agent runtime state currently sit outside the sync surface. The first phase will be **read-only discovery / status**; `--apply` is reserved for opt-in selectors (e.g. `--include memories:<name>`) once storage location, schema, redaction, and conflict policy are settled. |
| Skill symlink full support | Deferred | Symlinked skills appear in `status` only. `sync` will engage once the link-preserve vs target-materialize policy is finalized. |
| Extra mappings (`rules/*.json` import, TOML parser swap) | Tracked | Mechanical refactors with no user-visible API change. |

If any of these unblocks your workflow, an issue with the concrete use case helps prioritize the order.

## License

MIT
