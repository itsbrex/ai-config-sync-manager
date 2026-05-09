# case-11-plugins-installed

Each host has a different user-installed plugin alongside the self-managed
`config-manager@ai-config-sync-manager` / `ai-config-sync-manager` entries:

- Claude only: `frontend-design@user-marketplace`
- Codex only: `review-tools`

Plugin sync is unsupported (status-only), so both manifests must remain
byte-for-byte unchanged after `sync --apply`, even though they describe
different plugin sets. This case proves the invariant "sync sees the
asymmetry and still does not touch either host's plugin manifest."

Expected areas: `instructions`, `skills`, `plugins` (status-only).

## Expected `status` result (post-`sync --apply`)

After `sync --apply`, running `ai-config-sync status --scope global`:

- `global/plugins`: `frontend-design@user-marketplace` (claude-only) and `review-tools` (codex-only) are listed as `unsupported` (manual review). Self-managed entries are excluded.
- entries: 1 (plugins area only, statusOnly)
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

`.claude/plugins/installed_plugins.json` and `.agents/plugins/marketplace.json` are never touched by `sync` (statusOnly invariant).
