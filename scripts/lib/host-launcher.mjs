// @ts-check

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @typedef {Object} LauncherIdentity
 * @property {string} pinnedVersion - Semver-like version pinned at build time
 * @property {string} packageName - npm package name used by npm exec fallback
 */

// Resolution order (see .claude/docs/distribution-workflow.md §4):
//   1) AI_CONFIG_SYNC_ROOT env (dev/local override)
//   2) PATH lookup with self-exclude + version compatibility check
//   3) npm exec --yes --package=<pkg>@<pin> -- ai-config-sync "$@"
//   4) friendly abort
//
// Version compare policy (§6.2):
//   patch diff -> ignore, minor diff -> warn, major diff or unparsable -> abort.
/**
 * @param {string} targetPath - Absolute path of the launcher script to write
 * @param {string} host - "claude" or "codex"; injected as AI_CONFIG_SYNC_HOST default
 * @param {LauncherIdentity} identity
 * @returns {void}
 */
export function writeHostLauncher(targetPath, host, { pinnedVersion, packageName }) {
  if (!host || !pinnedVersion || !packageName) {
    throw new Error("writeHostLauncher requires host, pinnedVersion, packageName");
  }

  const script = renderLauncherScript({ host, pinnedVersion, packageName });
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, script);
  chmodSync(targetPath, 0o755);
}

/**
 * @param {{ host: string } & LauncherIdentity} options
 * @returns {string}
 */
function renderLauncherScript({ host, pinnedVersion, packageName }) {
  return `#!/usr/bin/env bash
set -euo pipefail

export AI_CONFIG_SYNC_HOST="\${AI_CONFIG_SYNC_HOST:-${host}}"

PINNED_VERSION="${pinnedVersion}"
PACKAGE_NAME="${packageName}"
LAUNCHER_PATH="$0"

abort() {
  echo "ai-config-sync launcher: $1" >&2
  exit 1
}

# Compare two semver-like strings (X.Y.Z). Echoes one of: equal | patch | minor | major | unknown
compare_versions() {
  node -e '
    const [a, b] = process.argv.slice(1);
    const re = /^(\\d+)\\.(\\d+)\\.(\\d+)/;
    const ma = re.exec(a || "");
    const mb = re.exec(b || "");
    if (!ma || !mb) { console.log("unknown"); process.exit(0); }
    const [, a1, a2, a3] = ma.map(Number);
    const [, b1, b2, b3] = mb.map(Number);
    if (a1 !== b1) { console.log("major"); process.exit(0); }
    if (a2 !== b2) { console.log("minor"); process.exit(0); }
    if (a3 !== b3) { console.log("patch"); process.exit(0); }
    console.log("equal");
  ' "$1" "$2" 2>/dev/null || echo "unknown"
}

# 1) AI_CONFIG_SYNC_ROOT env override
if [ -n "\${AI_CONFIG_SYNC_ROOT:-}" ]; then
  RUNTIME="$AI_CONFIG_SYNC_ROOT/bin/ai-config-sync.mjs"
  if [ -f "$RUNTIME" ]; then
    exec node "$RUNTIME" "$@"
  fi
  abort "AI_CONFIG_SYNC_ROOT=$AI_CONFIG_SYNC_ROOT but $RUNTIME does not exist"
fi

# 2) PATH lookup with self-exclude
FOUND="$(command -v ai-config-sync 2>/dev/null || true)"
if [ -n "$FOUND" ]; then
  LAUNCHER_REAL="$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$LAUNCHER_PATH" 2>/dev/null || echo "$LAUNCHER_PATH")"
  FOUND_REAL="$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$FOUND" 2>/dev/null || echo "$FOUND")"

  if [ "$LAUNCHER_REAL" != "$FOUND_REAL" ]; then
    PATH_VERSION="$("$FOUND" --version 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
    DIFF="$(compare_versions "$PINNED_VERSION" "$PATH_VERSION")"

    case "$DIFF" in
      equal|patch)
        exec "$FOUND" "$@"
        ;;
      minor)
        echo "ai-config-sync launcher: PATH binary $PATH_VERSION differs from launcher pin $PINNED_VERSION (minor); proceeding" >&2
        exec "$FOUND" "$@"
        ;;
      major)
        abort "PATH binary $PATH_VERSION incompatible with launcher pin $PINNED_VERSION (major). Run: npm update -g $PACKAGE_NAME"
        ;;
      *)
        echo "ai-config-sync launcher: unable to read --version from $FOUND ($PATH_VERSION); proceeding" >&2
        exec "$FOUND" "$@"
        ;;
    esac
  fi
fi

# 3) npm exec fallback (network)
if command -v npm >/dev/null 2>&1; then
  exec npm exec --yes --package="$PACKAGE_NAME@$PINNED_VERSION" -- ai-config-sync "$@"
fi

# 4) friendly abort
abort "no ai-config-sync runtime resolved. Install Node + npm and run: npm install -g $PACKAGE_NAME@$PINNED_VERSION (or set AI_CONFIG_SYNC_ROOT to a checkout)"
`;
}
