# Integration Tests

One-way Codex → Claude sync integration suite. Runs the real CLI
(`bin/ai-config-sync.mjs`) against a temporary HOME and verifies the six
areas (`instructions`, `skills`, `agents`, `mcp`, `permissions`, `hooks`)
through golden-tree and reader helpers.

## Layout

```
tests/integration/
  helpers/                 # fixture/run-cli/snapshot/golden/readers/invariants
  codex-to-claude/         # one .test.mjs per area + sync-all.test.mjs
  fixtures/areas/<area>/<variant>/
    codex-home/            # input: applied as AI_CONFIG_SYNC_HOME
    pre-claude/            # (optional) host state seeded before apply
    expected-claude/       # golden: target of assertGolden comparison
```

## Running

```bash
node --test tests/integration/codex-to-claude/*.test.mjs   # full suite
node --test tests/integration/codex-to-claude/mcp.test.mjs # single area
KEEP_FIXTURE=1 node --test tests/integration/codex-to-claude/mcp.test.mjs  # debug failures (preserves tmpdir)
```

## Adding a new fixture

1. Place the input tree under `fixtures/areas/<area>/<variant>/codex-home/`.
2. Place the expected post-apply tree (golden) under `expected-claude/`.
3. If host state must exist before apply, add it under `pre-claude/`.
4. Add the case to the area's test file using `layCodexHome` /
   `layExpectedClaude`.

Current variant matrix:
- `instructions`: happy, multi-section, empty-source
- `skills`: happy, symlink-unsupported, manual-overwrite
- `agents`: happy, manual-overwrite
- `mcp`: happy, secret-env, manual-conflict
- `permissions`: manual-allow
- `hooks`: manual-pre-tool-use

Not yet covered: bidirectional (claude → codex), the `commands` area,
deletion scenarios.

## Fixture authoring constraints

- **Frontmatter (SKILL.md / agents)**: only `key: value` single-line form.
  Multi-line literals (`|`), folded scalars (`>`), and nested objects are
  unsupported — `helpers/readers.mjs` `parseFrontmatter` is a minimal parser.
- **Symlinks**: copied with `cpSync({ verbatimSymlinks: true })`, preserving
  relative targets — write fixtures with relative targets too. Comparison
  uses raw `readlinkSync()` without canonicalization.
- **Secret-like values**: in fixtures such as `secret-env`, use synthetic
  placeholders like `secret-token-value`. `KEEP_FIXTURE=1` preserves
  `/tmp/...` for debugging, so real tokens in fixtures would leak.
