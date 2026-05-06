#!/usr/bin/env bash
# Source this file to point manual ai-config-sync commands at lab/<case>.
# Usage:
#   source scripts/set-home-to-test-lab.sh                # paths only
#   source scripts/set-home-to-test-lab.sh case-name      # + per-case home
#   source scripts/set-home-to-test-lab.sh                # from lab/<case> infers case

script_path="${BASH_SOURCE[0]:-$0}"
base="$(cd "$(dirname "$script_path")/.." && pwd)"
repo="$(cd "$base/../../.." && pwd)"
lab="$base/lab"
templates="$base/templates"

is_sourced=0
if [ -n "${ZSH_EVAL_CONTEXT:-}" ]; then
  case "$ZSH_EVAL_CONTEXT" in
    *:file) is_sourced=1 ;;
  esac
elif [ -n "${BASH_SOURCE:-}" ] && [ "${BASH_SOURCE[0]}" != "$0" ]; then
  is_sourced=1
fi

if [ "$is_sourced" -ne 1 ]; then
  echo "source this script so it can update the current shell:" >&2
  echo "  source $script_path [case-name]" >&2
  exit 2
fi

# Always exported base paths so reset.sh / run-cases.sh can reuse them.
export MANUAL_TEST_BASE_DIR="$base"
export MANUAL_TEST_LAB_DIR="$lab"
export MANUAL_TEST_TEMPLATES_DIR="$templates"
export MANUAL_TEST_REPO_DIR="$repo"

case_name="${1:-}"
if [ -z "$case_name" ]; then
  current_dir="${INIT_CWD:-$(pwd)}"
  case "$current_dir" in
    "$lab"/*)
      lab_relative="${current_dir#"$lab"/}"
      case_name="${lab_relative%%/*}"
      ;;
  esac
fi

if [ -z "$case_name" ]; then
  return 0
fi

if [ ! -d "$lab/$case_name" ]; then
  echo "missing lab case: $lab/$case_name" >&2
  echo "run scripts/reset.sh $case_name first if you need to create it" >&2
  return 1
fi

export AI_CONFIG_SYNC_HOME="$lab/$case_name"
export AI_CONFIG_SYNC_REPO_ROOT="$repo"
export AI_CONFIG_SYNC_MANAGER_ROOT="$AI_CONFIG_SYNC_HOME/.ai-config-sync-manager"
mkdir -p "$AI_CONFIG_SYNC_MANAGER_ROOT"

mcp_scope="project"
[ -f "$templates/$case_name/mcp.scope" ] && mcp_scope="$(tr -d '[:space:]' < "$templates/$case_name/mcp.scope")"
export AI_CONFIG_SYNC_MANUAL_MCP_SCOPE="$mcp_scope"

echo "AI_CONFIG_SYNC_HOME=$AI_CONFIG_SYNC_HOME"
echo "AI_CONFIG_SYNC_REPO_ROOT=$AI_CONFIG_SYNC_REPO_ROOT"
echo "AI_CONFIG_SYNC_MANAGER_ROOT=$AI_CONFIG_SYNC_MANAGER_ROOT"
echo "AI_CONFIG_SYNC_MANUAL_MCP_SCOPE=$AI_CONFIG_SYNC_MANUAL_MCP_SCOPE"
