# case-09-ecc-rules-pre-registered

Same upstream content as `case-08-ecc-realworld-mapping`, but with three rule
files pre-seeded under `.ai-config-sync-manager/rules/` so that:

1. **status-ignore** suppresses the over-translated `Codex CLI` / `AGENTS.md`
   table cells from showing up as conflicts.
2. **paraphrase-overrides** masks the `Skill` vocab mismatch on
   `verification-loop/SKILL.md` line 6 — the active override means the pair
   is treated as in sync without rewriting either side.
3. **paraphrase-map** registers the codex paraphrase for `Skill`
   (`verification routine`) so a future `ai-config-sync paraphrase --apply`
   would rewrite host-native tokens using the shared mapping.

## Placeholder substitution

`paraphrase-overrides.json` pins absolute `claude_path` / `codex_path`. Since
those depend on each user's lab location, the JSON ships with a
`__LAB_HOME__` placeholder. `scripts/reset.sh` substitutes it for the actual
`lab/<case>` absolute path on every reset, so no manual editing is needed:

```bash
scripts/reset.sh case-09-ecc-rules-pre-registered
# rules/paraphrase-overrides.json now contains absolute paths under
# .../lab/case-09-ecc-rules-pre-registered/...
```

## Verifying the rules took effect

After `sync --apply`, status should report 1 active paraphrase override and
no `instructions` conflict on the over-translated lines:

```bash
case=case-09-ecc-rules-pre-registered
AI_CONFIG_SYNC_HOME="$(pwd)/lab/${case}" \
  node ../../../bin/ai-config-sync.mjs status --scope global
# Expect:
#   "1 paraphrase override(s) active, 0 stale."
```

Reference: `case-08-ecc-realworld-mapping/MAPPING-NOTES.md` for the line/token
inventory the rule files target.
