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
  scripts/set-home-to-test-lab.sh
                           # Source in a manual shell to export AI_CONFIG_SYNC_HOME for lab/<case>
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
source scripts/set-home-to-test-lab.sh "${case}"

node ../../../bin/ai-config-sync.mjs status --scope global

node ../../../bin/ai-config-sync.mjs sync \
  --scope global --from codex --to claude --dry-run

node ../../../bin/ai-config-sync.mjs sync \
  --scope global --from codex --to claude --apply

# MCP-only manual run. case-10 exports global; other cases export project.
(
  cd "$AI_CONFIG_SYNC_HOME" &&
  node "$AI_CONFIG_SYNC_REPO_ROOT/bin/ai-config-sync.mjs" sync \
    --scope "$AI_CONFIG_SYNC_MANUAL_MCP_SCOPE" --include mcp --from codex --to claude --dry-run
)

# Prompt-driven/manual commands now use lab/${case} as AI_CONFIG_SYNC_HOME.
# Cases with templates/<case>/mcp.scope also export AI_CONFIG_SYNC_MANUAL_MCP_SCOPE.
ai-config-sync status --scope global
ai-config-sync paraphrase --map "Skill=verification routine" --apply

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
TSV summary to `/tmp/manual-cases-results.tsv` (13 columns: case, status_rc,
dry_rc, apply_rc, claude_diff_rc, claude_json_rc, mcp_json_rc, codex_rc,
agents_rc, claude_cli_rc, codex_cli_rc, codex_project_cli_rc, lab_rules_rc —
all `0` = PASS).

Cases that ship a `setup.sh` (e.g. `case-09-ecc-rules-pre-registered`) have it
run automatically after `sync --apply` so paraphrase/status-ignore
registrations are part of the verified flow. The lab's
`.ai-config-sync-manager/rules/*.json` is reverse-normalized
(`__LAB_HOME__`, `__REGISTERED_AT__` placeholders) and diffed against
`expected/<case>/.ai-config-sync-manager/rules/` (mirroring the lab path).
Cases without `setup.sh` get a no-op `lab_rules_rc=0`.

No real secrets are stored here. Placeholder values are intentionally synthetic.
Remote MCP server ids use `manual_*` names where needed to avoid Codex project config merging with a developer's real global MCP entries.
