# case-09-ecc-rules-pre-registered

Same upstream source as `case-08-ecc-realworld-mapping` (no rules pre-seeded
in templates). The harness invokes `setup.sh` after `sync --apply` so that
the post-sync rule registrations match the real-world flow a user would run
manually:

1. `paraphrase --apply --map "Skill=verification routine"` —
   rewrites the `Skill` token on the codex-side
   `.agents/skills/verification-loop/SKILL.md` (line 6) and registers the
   override under `paraphrase-overrides.json`. Also seeds
   `paraphrase-map.json` with `Skill -> verification routine`.
2. Extra dictionary entry appended to `paraphrase-map.json` —
   `Hooks -> event handlers`. This token has no matching line in the
   fixture, so it never produces an override; it only lives in the map.
   This split (override = matched-line registry, map = lookup library)
   keeps the two files distinct rather than redundant copies.
3. Hand-authored `.ai-config-sync-manager/rules/status-ignore.json` —
   masks the over-translated `Codex CLI` / `AGENTS.md` table cells in the
   instructions area.

## Layout

```
templates/case-09-ecc-rules-pre-registered/
  .codex/, .agents/, .claude/        # raw upstream (matches case-08)
  setup.sh                           # post-sync registration script

expected/case-09-ecc-rules-pre-registered/
  claude-home/.claude{,.json}        # post-sync claude tree
  codex-home/.codex/, .agents/       # post-paraphrase codex tree
                                     # (codex SKILL.md L6 token rewritten)
  .ai-config-sync-manager/rules/{paraphrase-overrides,paraphrase-map,status-ignore}.json
                                     # canonical rule snapshots mirroring
                                     # the lab path, with __LAB_HOME__ +
                                     # __REGISTERED_AT__ placeholders
```

`run-cases.sh` invokes `setup.sh` automatically and compares the lab's
rules JSON (after reverse-substituting the lab path and timestamp into
placeholders) against `expected/<case>/.ai-config-sync-manager/rules/` —
so the registrations are deterministically verified across machines.

## Manual reproduction

```bash
case=case-09-ecc-rules-pre-registered
scripts/reset.sh "$case"

AI_CONFIG_SYNC_HOME="$(pwd)/lab/${case}" \
  node ../../../bin/ai-config-sync.mjs sync \
    --scope global --from codex --to claude --apply

AI_CONFIG_SYNC_HOME="$(pwd)/lab/${case}" \
  ./templates/${case}/setup.sh "$(cd ../../.. && pwd)"

AI_CONFIG_SYNC_HOME="$(pwd)/lab/${case}" \
  node ../../../bin/ai-config-sync.mjs status --scope global
# Expect: "1 paraphrase override(s) active, 0 stale."
```

Reference: `case-08-ecc-realworld-mapping/MAPPING-NOTES.md` for the line/token
inventory the rules target.
