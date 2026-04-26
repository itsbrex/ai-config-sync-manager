#!/usr/bin/env node

import { chmodSync, copyFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist");
const claudeMarketplace = join(dist, "claude-marketplace");
const claudePlugin = join(claudeMarketplace, "plugins/config-manager");
const codexPlugin = join(dist, "codex-plugin");
const sharedDirs = ["bin", "packages", "schemas", "rules"];
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
      plugins: [
        {
          name: "config-manager",
          version: "0.1.0",
          description: "Sync Claude and Codex agent config from an OSS bundled plugin.",
          source: "./plugins/config-manager"
        }
      ]
    },
    null,
    2
  )}\n`
);

chmodSync(join(claudePlugin, "bin/ai-config-sync"), 0o755);
chmodSync(join(codexPlugin, "bin/ai-config-sync"), 0o755);

console.log("Built dist/claude-marketplace and dist/codex-plugin");
