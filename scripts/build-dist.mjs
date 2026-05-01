#!/usr/bin/env node

import { chmodSync, copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncActivePluginCaches } from "./sync-plugin-cache.mjs";

const root = process.cwd();
const dist = join(root, "dist");
const claudeMarketplace = join(dist, "claude-marketplace");
const claudePlugin = join(claudeMarketplace, "plugins/config-manager");
const codexPlugin = join(dist, "codex-plugin");
const sharedDirs = ["bin", "packages", "schemas", "rules", "integrations"];
const sharedFiles = ["package.json", "tsconfig.json"];

rmSync(claudeMarketplace, { recursive: true, force: true });
rmSync(codexPlugin, { recursive: true, force: true });

mkdirSync(join(claudeMarketplace, ".claude-plugin"), { recursive: true });
mkdirSync(claudePlugin, { recursive: true });

cpSync(join(root, "integrations/claude-plugin"), claudePlugin, { recursive: true });
cpSync(join(root, "integrations/codex-plugin"), codexPlugin, { recursive: true });

for (const name of sharedDirs) {
  cpSync(join(root, name), join(claudePlugin, name), { recursive: true });
  cpSync(join(root, name), join(codexPlugin, name), { recursive: true });
}

for (const name of sharedFiles) {
  copyFileSync(join(root, name), join(claudePlugin, name));
  copyFileSync(join(root, name), join(codexPlugin, name));
}

writeFileSync(
  join(claudeMarketplace, ".claude-plugin/marketplace.json"),
  `${JSON.stringify(
    {
      name: "ai-config-sync-manager",
      owner: {
        name: "Maxx",
        email: "slash9494@gmail.com"
      },
      metadata: {
        description: "Local marketplace for AI Config Sync Manager.",
        version: "0.1.0"
      },
      plugins: [
        {
          name: "config-manager",
          version: "0.1.0",
          description: "Sync Claude and Codex agent config from an OSS bundled plugin.",
          author: {
            name: "Maxx",
            email: "slash9494@gmail.com"
          },
          source: "./plugins/config-manager"
        }
      ]
    },
    null,
    2
  )}\n`
);

writeHostLauncher(join(claudePlugin, "bin/ai-config-sync"), "claude");
writeHostLauncher(join(codexPlugin, "bin/ai-config-sync"), "codex");

console.log("Built dist/claude-marketplace and dist/codex-plugin");

if (!process.argv.includes("--skip-sync")) syncActivePluginCaches();

function writeHostLauncher(targetPath, host) {
  const script = `#!/usr/bin/env bash
set -euo pipefail

export AI_CONFIG_SYNC_HOST="\${AI_CONFIG_SYNC_HOST:-${host}}"

ROOT="\${AI_CONFIG_SYNC_ROOT:-}"
if [ -z "$ROOT" ]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

DIST="$ROOT/packages/cli/dist/index.js"
SRC="$ROOT/packages/cli/src/index.ts"
RUNTIME="$ROOT/bin/ai-config-sync.mjs"

if [ -f "$DIST" ]; then
  exec node "$DIST" "$@"
fi

if [ -f "$RUNTIME" ]; then
  exec node "$RUNTIME" "$@"
fi

if [ -f "$SRC" ]; then
  exec node --experimental-strip-types "$SRC" "$@"
fi

echo "ai-config-sync CLI not found under $ROOT" >&2
exit 1
`;
  writeFileSync(targetPath, script);
  chmodSync(targetPath, 0o755);
}
