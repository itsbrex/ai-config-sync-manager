# Ai-config-sync-manager

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
