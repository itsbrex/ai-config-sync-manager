#!/usr/bin/env bash
# Reset lab/<case> by overwriting from templates/<case>.
# Usage: scripts/reset.sh [case-name | all]
set -u
BASE="$(cd "$(dirname "$0")/.." && pwd)"
TMPL="$BASE/templates"
LAB="$BASE/lab"
target="${1:-all}"

reset_one() {
  local c="$1"
  if [ ! -d "$TMPL/$c" ]; then
    echo "missing template: $TMPL/$c" >&2
    return 1
  fi
  rm -rf "$LAB/$c"
  cp -R "$TMPL/$c" "$LAB/$c"
  # Substitute __LAB_HOME__ placeholder in any pre-seeded rule files so
  # paraphrase overrides can pin absolute paths under the user's lab dir.
  # No-op for cases that don't use the placeholder.
  if [ -d "$LAB/$c/.ai-config-sync-manager/rules" ]; then
    find "$LAB/$c/.ai-config-sync-manager/rules" -type f -name '*.json' -print0 \
      | xargs -0 sed -i.bak "s|__LAB_HOME__|$LAB/$c|g" 2>/dev/null || true
    find "$LAB/$c/.ai-config-sync-manager/rules" -type f -name '*.bak' -delete 2>/dev/null || true
  fi
  echo "reset: $c"
}

if [ "$target" = "all" ]; then
  for d in "$TMPL"/case-*; do
    name="$(basename "$d")"
    [ "$name" = "case-template" ] && continue
    reset_one "$name"
  done
else
  reset_one "$target"
fi
