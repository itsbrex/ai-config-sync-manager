#!/usr/bin/env bash
# Reset lab/<case> by overwriting from templates/<case>.
# Usage: scripts/reset.sh [case-name | all]
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
target="${1:-all}"
# Source for base path exports only — clear positional args so set-home.sh
# doesn't interpret the case-name as its own first arg.
set --
# shellcheck disable=SC1091
. "$SCRIPT_DIR/set-home-to-test-lab.sh"

reset_one() {
  local c="$1"
  local case_dir="$MANUAL_TEST_LAB_DIR/$c"
  local current_pwd
  if [ ! -d "$MANUAL_TEST_TEMPLATES_DIR/$c" ]; then
    echo "missing template: $MANUAL_TEST_TEMPLATES_DIR/$c" >&2
    return 1
  fi
  current_pwd="$(pwd -P 2>/dev/null || true)"
  case "$current_pwd" in
    "$case_dir"/*)
      echo "cannot reset while cwd is inside target case subdirectory: $case_dir" >&2
      echo "cd to $case_dir or outside lab, then retry" >&2
      return 1
      ;;
  esac
  mkdir -p "$case_dir" || return 1
  find "$case_dir" -mindepth 1 -maxdepth 1 -exec rm -rf {} + || return 1
  cp -R "$MANUAL_TEST_TEMPLATES_DIR/$c"/. "$case_dir"/ || return 1
  # Substitute __LAB_HOME__ placeholder in any pre-seeded rule files so
  # paraphrase overrides can pin absolute paths under the user's lab dir.
  # No-op for cases that don't use the placeholder.
  if [ -d "$case_dir/.ai-config-sync-manager/rules" ]; then
    find "$case_dir/.ai-config-sync-manager/rules" -type f -name '*.json' -print0 \
      | xargs -0 sed -i.bak "s|__LAB_HOME__|$case_dir|g" 2>/dev/null || true
    find "$case_dir/.ai-config-sync-manager/rules" -type f -name '*.bak' -delete 2>/dev/null || true
  fi
  echo "reset: $c"
}

if [ "$target" = "all" ]; then
  for d in "$MANUAL_TEST_TEMPLATES_DIR"/case-*; do
    name="$(basename "$d")"
    [ "$name" = "case-template" ] && continue
    reset_one "$name"
  done
else
  reset_one "$target"
fi
