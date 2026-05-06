#!/usr/bin/env bash
# Source this file to point manual ai-config-sync commands at lab/<case>.
# Usage: source scripts/set-home-to-test-lab.sh case-name

script_path="${BASH_SOURCE[0]:-$0}"
base="$(cd "$(dirname "$script_path")/.." && pwd)"
lab="$base/lab"
case_name="${1:-}"
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
  echo "  source $script_path case-name" >&2
  exit 2
fi

if [ -z "$case_name" ]; then
  echo "usage: source $script_path case-name" >&2
  return 2
fi

if [ ! -d "$lab/$case_name" ]; then
  echo "missing lab case: $lab/$case_name" >&2
  echo "run scripts/reset.sh $case_name first if you need to create it" >&2
  return 1
fi

export AI_CONFIG_SYNC_HOME="$lab/$case_name"

echo "AI_CONFIG_SYNC_HOME=$AI_CONFIG_SYNC_HOME"
