# case-11-plugins-installed

Both hosts have user plugins pre-registered alongside the self-managed
`config-manager@ai-config-sync-manager` / `ai-config-sync-manager` entries.
Plugin sync is unsupported (status-only), so the plugin manifests must remain
byte-for-byte unchanged after `sync --apply`.

Expected areas: `instructions`, `skills`, `plugins` (status-only).

## `status` 결과 (pre-`--apply`, expected)

`sync --apply` 후 `ai-config-sync status --scope global` 실행 시:

- `global/plugins`: `frontend-design@user-marketplace`, `review-tools@user-marketplace`, `frontend-design`, `review-tools` 가 `unsupported` 로 표시 (manual review). self-managed 항목은 제외.
- entries: 1 (plugins area only, statusOnly)
- vocabFindings: 0
- paraphraseOverrides: 0 active / 0 stale

`.claude/plugins/installed_plugins.json`, `.agents/plugins/marketplace.json` 은 sync 가 건드리지 않는다 (statusOnly invariant).
