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

## `status` 결과 (pre-`--apply`, expected)

`sync --apply` 후 `ai-config-sync status --scope global` 실행 시:

- `global/plugins`: `frontend-design@user-marketplace` (claude-only), `review-tools` (codex-only) 가 `unsupported` 로 표시 (manual review). self-managed 항목은 제외.
- entries: 1 (plugins area only, statusOnly)
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

`.claude/plugins/installed_plugins.json`, `.agents/plugins/marketplace.json` 은 sync 가 건드리지 않는다 (statusOnly invariant).
