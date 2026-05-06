#!/usr/bin/env bash
# Post-sync setup for case-09: register paraphrase override and status-ignore
# rules dynamically (matching real-world flow where the user runs these
# commands manually after a sync). run-cases.sh invokes this after sync apply.
#
# Required env: AI_CONFIG_SYNC_HOME (absolute path to lab/<case>)
# Required argv: $1 = repo root (so we can locate bin/ai-config-sync.mjs)
set -u
HOME_DIR="${AI_CONFIG_SYNC_HOME}"
REPO="${1:?repo root path required as \$1}"

# 1) Run paraphrase --apply: rewrites the Skill token on the codex side
#    (skills/verification-loop/SKILL.md L9) and registers the override.
node "$REPO/bin/ai-config-sync.mjs" paraphrase \
  --scope global \
  --apply \
  --map "Skill=verification routine" \
  --non-interactive

# 2) Extend paraphrase-map.json with an extra dictionary entry that the
#    override does NOT use yet — exercises the "map = library, override =
#    matched-line registry" split. The Hooks token has no matching line in
#    this fixture so no override is registered, but the mapping persists
#    for future paraphrase --apply runs.
node -e '
const fs = require("fs");
const path = process.argv[1];
const data = fs.existsSync(path)
  ? JSON.parse(fs.readFileSync(path, "utf8"))
  : { version: 1, claude_only: {}, codex_only: {} };
data.claude_only = data.claude_only || {};
data.claude_only.Hooks = "event handlers";
fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
' "$HOME_DIR/.ai-config-sync-manager/rules/paraphrase-map.json"

# 3) Hand-author status-ignore.json to mask over-translated table cells in
#    the instructions area.
mkdir -p "$HOME_DIR/.ai-config-sync-manager/rules"
cat > "$HOME_DIR/.ai-config-sync-manager/rules/status-ignore.json" <<'EOF'
{
  "version": 1,
  "exclude": [
    { "area": "instructions", "term": "Codex CLI" },
    { "area": "instructions", "term": "AGENTS.md" }
  ]
}
EOF
