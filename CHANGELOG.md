# Ai-config-sync-manager

## v0.1.0 (2026-05-08)

First stable release. Consolidates the `0.1.0-beta.0` → `0.1.0-beta.6` series. No code changes from beta.6.

## v0.1.0-beta.6 (2026-05-08)

### 🐛 Bug Fixes

- **yaml frontmatter**: extract a strict-safe scalar guard at `bin/util/yaml-scalar.mjs` and route claude→codex sync serialization through it. Bare scalars starting with YAML 1.2 indicators (e.g. `globs: **/*.{js,ts,jsx,tsx,py,go,java}`) used to parse on Claude's lenient loader but trip Codex's strict 1.2 parser as aliases (`unidentified alias "*/*."`), dropping the whole frontmatter — including `name` — so the affected skill silently lost its identity on the Codex side. Guard covers rule [22] c-indicators (`- ? : , [ ] { } # & * ! | > ' " % @ \``), YAML 1.1 coercion compat (single-letter bools `y/Y/n/N`, `null/true/false/yes/no/on/off`variants, integers/floats/exponents/hex/octal/binary, special floats`.NaN/.inf`, ISO 8601 timestamps), and the `<<`merge key. Round-trip verified against`js-yaml`.

### 📝 Docs

- Add `AGENTS.md` (agent-facing project instruction) at the repo root, capturing the ESM/zero-deps conventions, test and build commands, and the yaml-scalar guard rule. `CLAUDE.md` is a symlink to `AGENTS.md` so claude-code reads the same source.

### 🛠 Chore

- Move `lint-staged` config to `.lintstagedrc.mjs` and filter symlinks via `lstatSync` before invoking `prettier`/`eslint`. Prettier 3 hard-errors on symlink arguments and ignores `.prettierignore` for explicit paths, so the previous `package.json` shorthand blocked staging `CLAUDE.md`.

## v0.1.0-beta.4 (2026-05-08)

### 🐛 Bug Fixes

- **connect**: switch Codex plugin install to user-marketplace direct manipulation. `codex plugin install` / `enable` non-interactive subcommands do not exist, and `policy.installation: "INSTALLED_BY_DEFAULT"` on a managed marketplace does not auto-install on `marketplace add`, so beta.3 left the plugin registered but inactive. `connect` now copies the bundle to `~/.ai-config-sync-manager/codex-plugin/` and upserts an entry into `~/.agents/plugins/marketplace.json` (user marketplace, default name `local-plugins`) using the openai/codex#17885 schema, then writes `[plugins."ai-config-sync-manager@local-plugins"] enabled = true` to `~/.codex/config.toml`. Beta.3 stale entries (`[marketplaces.ai-config-sync-manager]`, `[plugins."ai-config-sync-manager@ai-config-sync-manager"]`, `~/.ai-config-sync-manager/codex-marketplace/`) are not auto-cleaned — remove manually if upgrading.

## v0.1.0-beta.3 (2026-05-08)

### 🐛 Bug Fixes

- **connect**: fix Codex marketplace manifest path and schema to the official spec — manifest now lives at `<root>/.agents/plugins/marketplace.json` (not `.codex-plugin/marketplace.json`) and uses `interface.displayName`, `source: { source: "local", path: "./plugins/..." }`, and `policy: { installation: "INSTALLED_BY_DEFAULT", authentication: "ON_INSTALL" }`. `INSTALLED_BY_DEFAULT` triggers automatic plugin install on marketplace add. Resolves "invalid marketplace file: marketplace root does not contain a supported manifest" reported during beta.2 verification.

## v0.1.0-beta.2 (2026-05-08)

### 🐛 Bug Fixes

- **connect**: delegate plugin install to host CLIs (`claude plugin marketplace add` + `claude plugin install`, `codex plugin marketplace add` + `~/.codex/config.toml` enable table) instead of writing plugin manifests directly. Earlier betas wrote a guessed schema that Claude Code cleaned up on launch and Codex never activated; the marketplace appeared but the plugin never did.
- **connect**: every host CLI call is wrapped so a second `connect` run is a noop, and path arguments are quoted to survive whitespace in `$HOME`.

### 🛠 CI

- pre-push hook skips inside CI (`CI=true`), avoiding the duplicate test run that previously failed the release workflow's tag step.

## v0.1.0-beta.1 (2026-05-07)

### 🐛 Bug Fixes

- **connect**: also register the Claude marketplace in `~/.claude/plugins/known_marketplaces.json` so `installed_plugins.json` entries stay valid after `npm i -g` → `connect`. Without this Claude Code dropped the entry on launch and the plugin never appeared.
- **connect**: write Codex marketplace entries using the current schema so freshly registered plugins are picked up by Codex CLI.

## v0.1.0-beta.0 (2026-05-07)

Initial public beta. See README for the full feature surface.
