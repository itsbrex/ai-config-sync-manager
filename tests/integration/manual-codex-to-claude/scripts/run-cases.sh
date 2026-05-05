#!/usr/bin/env bash
# Run status, sync --dry-run, sync --apply for each case in-place under lab/<case>/.
# Then diff lab/<case>/.claude{,.json} against expected/<case>/claude-home/ and
# verify .codex/.agents unchanged vs templates/<case>/.
# Usage: scripts/run-cases.sh
set -u
BASE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$BASE/../../.." && pwd)"
TMPL="$BASE/templates"
LAB="$BASE/lab"
EXP="$BASE/expected"
LOGS=/tmp/manual-cases-out
RESULTS=/tmp/manual-cases-results.tsv
CODEX_CONFLICT_HOME=/tmp/manual-cases-codex-conflict-home

rm -rf "$LOGS"; mkdir -p "$LOGS"
rm -rf "$CODEX_CONFLICT_HOME"; mkdir -p "$CODEX_CONFLICT_HOME/.codex"
: > "$RESULTS"
overall_rc=0

cat > "$CODEX_CONFLICT_HOME/.codex/config.toml" <<EOF
[projects."$REPO"]
trust_level = "trusted"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp_servers.exa]
command = "npx"
args = ["-y", "exa-mcp-server"]

[mcp_servers.notion]
url = "https://mcp.notion.com/mcp"
EOF

canonical_mcp_json() {
  node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]));
}
process.stdout.write(`${JSON.stringify({ mcpServers: sortValue(data.mcpServers || {}) }, null, 2)}\n`);
' "$1"
}

# 1) reset all cases from templates
"$BASE/scripts/reset.sh" all >/dev/null

cases=()
for d in "$TMPL"/case-*; do
  name="$(basename "$d")"
  [ "$name" = "case-template" ] && continue
  cases+=("$name")
done

for c in "${cases[@]}"; do
  HOME_DIR="$LAB/$c"

  AI_CONFIG_SYNC_HOME="$HOME_DIR" node "$REPO/bin/ai-config-sync.mjs" status --scope global \
    > "$LOGS/$c.status.out" 2> "$LOGS/$c.status.err"
  status_rc=$?

  AI_CONFIG_SYNC_HOME="$HOME_DIR" node "$REPO/bin/ai-config-sync.mjs" sync \
    --scope global --from codex --to claude --dry-run \
    > "$LOGS/$c.dryrun.out" 2> "$LOGS/$c.dryrun.err"
  dry_rc=$?

  AI_CONFIG_SYNC_HOME="$HOME_DIR" node "$REPO/bin/ai-config-sync.mjs" sync \
    --scope global --from codex --to claude --apply \
    > "$LOGS/$c.apply.out" 2> "$LOGS/$c.apply.err"
  apply_rc=$?

  # Per-case post-sync hook: setup.sh runs additional registrations
  # (paraphrase --apply, status-ignore.json) so the fixture exercises
  # rule-registration flows that real users perform after sync.
  if [ -x "$TMPL/$c/setup.sh" ]; then
    AI_CONFIG_SYNC_HOME="$HOME_DIR" "$TMPL/$c/setup.sh" "$REPO" \
      > "$LOGS/$c.setup.out" 2> "$LOGS/$c.setup.err"
    setup_rc=$?
    [ "$apply_rc" -eq 0 ] && apply_rc="$setup_rc"
  fi

  diff -ruN --exclude='.ai-config-sync-manager' \
    --exclude='backups' --exclude='telemetry' \
    "$EXP/$c/claude-home/.claude" "$HOME_DIR/.claude" > "$LOGS/$c.claude.diff" 2>&1
  claude_diff_rc=$?

  if [ -f "$EXP/$c/claude-home/.mcp.json" ]; then
    : > "$LOGS/$c.claude.json.diff"; claude_json_rc=0
  elif [ -f "$EXP/$c/claude-home/.claude.json" ] || [ -f "$HOME_DIR/.claude.json" ]; then
    if [ -f "$EXP/$c/claude-home/.claude.json" ] && [ -f "$HOME_DIR/.claude.json" ] \
      && { grep -q '"mcpServers"' "$EXP/$c/claude-home/.claude.json" || grep -q '"mcpServers"' "$HOME_DIR/.claude.json"; }; then
      canonical_mcp_json "$EXP/$c/claude-home/.claude.json" > "$LOGS/$c.expected.claude.json"
      canonical_mcp_json "$HOME_DIR/.claude.json" > "$LOGS/$c.actual.claude.json"
      diff -uN "$LOGS/$c.expected.claude.json" "$LOGS/$c.actual.claude.json" > "$LOGS/$c.claude.json.diff" 2>&1
      claude_json_rc=$?
    else
      diff -uN "$EXP/$c/claude-home/.claude.json" "$HOME_DIR/.claude.json" > "$LOGS/$c.claude.json.diff" 2>&1
      claude_json_rc=$?
    fi
  else
    : > "$LOGS/$c.claude.json.diff"; claude_json_rc=0
  fi

  expected_mcp="$EXP/$c/claude-home/.mcp.json"
  actual_mcp="$HOME_DIR/.mcp.json"
  [ -f "$actual_mcp" ] || actual_mcp="$HOME_DIR/.claude.json"
  if [ -f "$expected_mcp" ] || [ -f "$HOME_DIR/.mcp.json" ]; then
    if [ -f "$expected_mcp" ] && [ -f "$actual_mcp" ]; then
      canonical_mcp_json "$expected_mcp" > "$LOGS/$c.expected.mcp.json"
      canonical_mcp_json "$actual_mcp" > "$LOGS/$c.actual.mcp.json"
      diff -uN "$LOGS/$c.expected.mcp.json" "$LOGS/$c.actual.mcp.json" > "$LOGS/$c.mcp.json.diff" 2>&1
      mcp_json_rc=$?
    else
      echo "missing expected or actual MCP JSON" > "$LOGS/$c.mcp.json.diff"; mcp_json_rc=1
    fi
  else
    : > "$LOGS/$c.mcp.json.diff"; mcp_json_rc=0
  fi

  # Default: codex/agents source must equal templates (sync-only cases).
  # When expected/<c>/codex-home/{.codex,.agents} exists, prefer it — that
  # signals a setup.sh case that legitimately mutates the codex side
  # (e.g. paraphrase --apply rewriting tokens).
  codex_base="$TMPL/$c/.codex"
  [ -d "$EXP/$c/codex-home/.codex" ] && codex_base="$EXP/$c/codex-home/.codex"
  diff -ruN "$codex_base" "$HOME_DIR/.codex" > "$LOGS/$c.codex.diff" 2>&1
  codex_rc=$?

  agents_base="$TMPL/$c/.agents"
  [ -d "$EXP/$c/codex-home/.agents" ] && agents_base="$EXP/$c/codex-home/.agents"
  if [ -d "$agents_base" ] || [ -d "$HOME_DIR/.agents" ]; then
    diff -ruN "$agents_base" "$HOME_DIR/.agents" > "$LOGS/$c.agents.diff" 2>&1
    agents_rc=$?
  else
    : > "$LOGS/$c.agents.diff"; agents_rc=0
  fi

  # Lab rules comparison: when expected/<c>/.ai-config-sync-manager/rules/
  # exists, normalize lab's .ai-config-sync-manager/rules/*.json by
  # reverse-substituting the absolute lab path and registered_at timestamp
  # into placeholders, then diff against the expected canonical form.
  if [ -d "$EXP/$c/.ai-config-sync-manager/rules" ]; then
    rm -rf "$LOGS/$c.lab-rules-canonical"
    mkdir -p "$LOGS/$c.lab-rules-canonical"
    for f in "$HOME_DIR/.ai-config-sync-manager/rules"/*.json; do
      [ -f "$f" ] || continue
      sed -e "s|$HOME_DIR|__LAB_HOME__|g" \
          -e 's|"registered_at": "[^"]*"|"registered_at": "__REGISTERED_AT__"|g' \
          "$f" > "$LOGS/$c.lab-rules-canonical/$(basename "$f")"
    done
    diff -ruN "$EXP/$c/.ai-config-sync-manager/rules" "$LOGS/$c.lab-rules-canonical" > "$LOGS/$c.lab-rules.diff" 2>&1
    lab_rules_rc=$?
  else
    : > "$LOGS/$c.lab-rules.diff"; lab_rules_rc=0
  fi

  HOME="$HOME_DIR" claude mcp list > "$LOGS/$c.claude-cli.out" 2> "$LOGS/$c.claude-cli.err"
  claude_cli_rc=$?
  if [ -f "$HOME_DIR/.claude.json" ] && grep -q '"mcpServers"' "$HOME_DIR/.claude.json"; then
    for name in $(jq -r '.mcpServers // {} | keys[]' "$HOME_DIR/.claude.json"); do
      if ! grep -q "^${name}:" "$LOGS/$c.claude-cli.out"; then
        [ "$claude_cli_rc" -eq 0 ] && claude_cli_rc=1
      fi
    done
  fi

  HOME="$HOME_DIR" codex mcp list > "$LOGS/$c.codex-cli.out" 2> "$LOGS/$c.codex-cli.err"
  codex_cli_rc=$?
  if [ -f "$HOME_DIR/.codex/config.toml" ]; then
    for name in $(sed -n 's/^\[mcp_servers\.\([^].]\{1,\}\)\]$/\1/p' "$HOME_DIR/.codex/config.toml"); do
      if ! grep -q "^${name}[[:space:]]" "$LOGS/$c.codex-cli.out"; then
        [ "$codex_cli_rc" -eq 0 ] && codex_cli_rc=1
      fi
    done
  fi

  (cd "$HOME_DIR" && HOME="$CODEX_CONFLICT_HOME" codex mcp list) > "$LOGS/$c.codex-project-cli.out" 2> "$LOGS/$c.codex-project-cli.err"
  codex_project_cli_rc=$?
  if [ -f "$HOME_DIR/.codex/config.toml" ]; then
    for name in $(sed -n 's/^\[mcp_servers\.\([^].]\{1,\}\)\]$/\1/p' "$HOME_DIR/.codex/config.toml"); do
      if ! grep -q "^${name}[[:space:]]" "$LOGS/$c.codex-project-cli.out"; then
        [ "$codex_project_cli_rc" -eq 0 ] && codex_project_cli_rc=1
      fi
    done
  fi

  printf "%s\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\t%d\n" \
    "$c" "$status_rc" "$dry_rc" "$apply_rc" \
    "$claude_diff_rc" "$claude_json_rc" "$mcp_json_rc" "$codex_rc" "$agents_rc" \
    "$claude_cli_rc" "$codex_cli_rc" "$codex_project_cli_rc" "$lab_rules_rc" \
    >> "$RESULTS"
  if [ "$status_rc" -ne 0 ] || [ "$dry_rc" -ne 0 ] || [ "$apply_rc" -ne 0 ] \
    || [ "$claude_diff_rc" -ne 0 ] || [ "$claude_json_rc" -ne 0 ] || [ "$mcp_json_rc" -ne 0 ] \
    || [ "$codex_rc" -ne 0 ] || [ "$agents_rc" -ne 0 ] \
    || [ "$claude_cli_rc" -ne 0 ] || [ "$codex_cli_rc" -ne 0 ] || [ "$codex_project_cli_rc" -ne 0 ] \
    || [ "$lab_rules_rc" -ne 0 ]; then
    overall_rc=1
  fi
done

echo "----- RESULTS (case status dry apply claude claude_json mcp_json codex agents claude_cli codex_cli codex_project_cli lab_rules) -----"
cat "$RESULTS"
exit "$overall_rc"
