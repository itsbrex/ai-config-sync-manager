# Manual Codex to Claude Integration Lab

`tests/integration` is the automated node:test suite. This folder is intentionally named `intergration` to match the manual test request and keep these fixtures out of the automated glob.

## Layout

```
manual-codex-to-claude/
  templates/              # Copy when adding a new manual case.
  lab/<case>/             # Input trees: codex-home + optional claude-home pre-state.
  expected/<case>/        # Expected post-sync Claude tree + Codex unchanged marker.
  SOURCES.md              # GitHub references used to shape the cases.
```

## Manual Run

```bash
case_name=case-01-gstack-notion-exa-grep
tmp_home="$(mktemp -d)"

cp -R "tests/intergration/manual-codex-to-claude/lab/${case_name}/codex-home/." "${tmp_home}/"
cp -R "tests/intergration/manual-codex-to-claude/lab/${case_name}/claude-home/." "${tmp_home}/"

AI_CONFIG_SYNC_HOME="${tmp_home}" node bin/ai-config-sync.mjs sync \
  --scope global \
  --from codex \
  --to claude \
  --apply
```

Compare:

- Claude output: `${tmp_home}/.claude`, `${tmp_home}/.claude.json` against `expected/${case_name}/claude-home`.
- Codex source: `${tmp_home}/.codex`, `${tmp_home}/.agents` against `lab/${case_name}/codex-home`.
- Ignore `.ai-config-sync-manager/` backup and state output.

No real secrets are stored here. Placeholder values are intentionally synthetic.
