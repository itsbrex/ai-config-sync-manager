# AI Config Sync Manager — Developer Guide

> `CLAUDE.md` is a symlink to `AGENTS.md`. Edit `AGENTS.md`; both hosts read the same file.

A zero-runtime-deps Node ESM CLI that compares, converts, and syncs Claude/Codex developer settings.
Primary entry point: `bin/ai-config-sync.mjs`.

---

## Pre-work reading order

1. `README.md` — user-facing CLI reference.
2. `package.json`, `scripts/build-dist.mjs` — confirm `scripts` and `files` policy.
3. Reading source directly is the last resort.

---

## Directory overview

```
bin/                       CLI entry point (~8800 lines) + utilities
bin/util/                  Shared helpers (yaml-scalar.mjs is the only one so far)
integrations/              Host plugin trees shipped to end users
  claude-plugin/           Commands (connect/status/sync/paraphrase/reference) + skills
  codex-plugin/            Skills (config-manager-connect/-status/-sync/-paraphrase/-reference)
rules/                     JSON mapping files (terminology, paraphrase, host-strict-vocab, etc.)
schemas/                   JSON schema for canonical config
scripts/                   Build, dev/prod mode, cache refresh, upstream snapshot
docs/                      Supplementary docs (customizing-rules, reference, status-ignore example)
snapshots/                 Upstream host release/schema snapshots (claude, codex)
tests/                     Unit tests (*.test.mjs)
tests/integration/         Integration tests, fixtures, and helpers
  codex-to-claude/         Per-area integration tests (agents, hooks, instructions, mcp, ...)
  helpers/                 Shared test utilities (fixture, golden, invariants, readers, run-cli, snapshot)
  fixtures/                Test fixture data
```

---

## YAML serialization rule (most important — always go through this)

**When serializing a YAML scalar or deciding whether it needs quoting, you MUST use the utility below.**

```js
import { serializeYamlScalar, yamlScalarRequiresQuoting } from "./util/yaml-scalar.mjs";
// in tests:
import { yamlScalarRequiresQuoting } from "../bin/util/yaml-scalar.mjs";
```

- **Forbidden** to write your own quote/escape logic. **Forbidden** to judge indicators directly with regex.
- **Forbidden** to add wrappers like `serializeFrontmatterScalar` (we have removed such wrappers before).
- When you find a new quoting edge case: add the rule to `bin/util/yaml-scalar.mjs` + add a unit case to `tests/yaml-scalar.test.mjs`.
- Reason: guarantee Claude (lenient YAML) ↔ Codex (strict YAML 1.2) round-trip. If even one site uses its own quoting, the strict parser fails to parse the entire frontmatter and fields like `name` go missing (this has actually happened).

---

## Code conventions

- ESM only. `.mjs` extension is required in import paths.
- double quotes, semicolons, function declarations.
- **No new external runtime dependencies** (zero-runtime-deps policy; devDependencies are allowed).
- Comments: one WHY line only — one reason, on one physical line, never wrapped onto a second. No WHAT or task references. If it does not fit, restate the reason more tersely; do not wrap. Comments written before this rule are still wrapped, so rewrite one only when you are already changing that code.
- Splitting `bin/ai-config-sync.mjs` is on hold. Cross-cutting helpers may be extracted into a separate `.mjs` under `bin/util/` (`yaml-scalar.mjs` is the precedent).

---

## Tests

- Framework: `node:test` + `node:assert/strict`.
- Locations: `tests/*.test.mjs` (unit/fixture), `tests/integration/codex-to-claude/*.test.mjs` (integration).
- Run all: `npm test`.
- Run one: `node --test tests/<file>.test.mjs`.
- Test names are behavior sentences (`test("agents sync apply ...", ...)`).
- New helpers must come with both a unit case and an integration case.

---

## Build / publish

- `npm run build:dist` → produces `dist/claude-marketplace`, `dist/codex-plugin`.
- Only the host-launcher (`scripts/lib/host-launcher.mjs`) is a wrapper; `bin/` ships as-is.
- `prepare` script: `husky && node scripts/build-dist.mjs --skip-sync` (runs on `npm install`).
- `package.json` `files` ships: `bin/`, `dist/`, `integrations/`, `rules/`, `schemas/`, `scripts/build-dist.mjs`, `scripts/sync-plugin-cache.mjs`, `scripts/lib/`, `CHANGELOG.md`.
- ESM relative imports resolve directly. No bundling step.

---

## Linting / formatting

- `npm run lint` / `npm run lint:fix` — ESLint (`eslint.config.mjs`).
- `npm run format:check` / `npm run format` — Prettier (`.prettierrc.json`).
- `npm run check` — TypeScript type-checking via JSDoc annotations (`tsc -p tsconfig.check.json`).
- The pre-commit hook (husky + lint-staged) runs lint + format on staged files.

---

## Dev / prod mode

- `npm run dev` — `npm link` + rebuild dist with cache sync (local dev mode).
- `npm run prod` — unlink + install published release from npm.

---

## Commits

- Conventional Commits: `fix:`, `feat:`, `test:`, `chore(...)`, `docs:`.
- Body should focus on WHY.
