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
