# Manual Codex to Claude Integration Lab

Local-only manual fixtures (gitignored). Each case runs `ai-config-sync` in-place
against `lab/<case>/` (a flat HOME directory) and compares the result against
`expected/<case>/`.

## Layout

```
manual-codex-to-claude/
  templates/<case>/        # Pristine flat HOME baseline (.codex/, .agents/, .claude/, optional .claude.json)
  lab/<case>/              # Working copy — sync mutates this in-place
  expected/<case>/         # Expected post-sync Claude tree (claude-home/.claude{,.json})
  scripts/reset.sh         # Restore lab/<case> from templates/<case>
  scripts/run-cases.sh     # Reset all → run status/dry-run/apply → diff vs expected
  templates/case-template/ # Generic skeleton for new cases (legacy split layout)
```

## Workflow

```bash
# Reset one case (or all)
scripts/reset.sh case-01-gstack-notion-exa-grep
scripts/reset.sh all

# Manual single-case run
case=case-01-gstack-notion-exa-grep
AI_CONFIG_SYNC_HOME="$(pwd)/lab/${case}" \
  node ../../../bin/ai-config-sync.mjs status --scope global

AI_CONFIG_SYNC_HOME="$(pwd)/lab/${case}" \
  node ../../../bin/ai-config-sync.mjs sync \
    --scope global --from codex --to claude --dry-run

AI_CONFIG_SYNC_HOME="$(pwd)/lab/${case}" \
  node ../../../bin/ai-config-sync.mjs sync \
    --scope global --from codex --to claude --apply

# Compare
diff -ruN --exclude='.ai-config-sync-manager' \
  expected/${case}/claude-home/.claude lab/${case}/.claude
diff -uN expected/${case}/claude-home/.claude.json lab/${case}/.claude.json

# Verify codex source unchanged
diff -ruN templates/${case}/.codex   lab/${case}/.codex
diff -ruN templates/${case}/.agents  lab/${case}/.agents

# Full pipeline for all 7 cases
scripts/run-cases.sh
```

`run-cases.sh` writes per-case logs and diffs to `/tmp/manual-cases-out/` and a
TSV summary to `/tmp/manual-cases-results.tsv` (11 columns: case, status_rc,
dry_rc, apply_rc, claude_diff_rc, claude_json_rc, mcp_json_rc, codex_rc,
agents_rc, claude_cli_rc, codex_cli_rc — all `0` = PASS).

No real secrets are stored here. Placeholder values are intentionally synthetic.
