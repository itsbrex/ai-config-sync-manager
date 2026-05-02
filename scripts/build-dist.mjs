#!/usr/bin/env node

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncActivePluginCaches } from "./sync-plugin-cache.mjs";
import { writeHostLauncher } from "./lib/host-launcher.mjs";

const root = process.cwd();
const dist = join(root, "dist");
const claudeMarketplace = join(dist, "claude-marketplace");
const claudePlugin = join(claudeMarketplace, "plugins/config-manager");
const codexPlugin = join(dist, "codex-plugin");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packageName = pkg.name;
const pinnedVersion = pkg.version;

rmSync(claudeMarketplace, { recursive: true, force: true });
rmSync(codexPlugin, { recursive: true, force: true });

mkdirSync(join(claudeMarketplace, ".claude-plugin"), { recursive: true });
mkdirSync(claudePlugin, { recursive: true });

cpSync(join(root, "integrations/claude-plugin"), claudePlugin, { recursive: true });
cpSync(join(root, "integrations/codex-plugin"), codexPlugin, { recursive: true });

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
        version: pinnedVersion
      },
      plugins: [
        {
          name: "config-manager",
          version: pinnedVersion,
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

writeHostLauncher(join(claudePlugin, "bin/ai-config-sync"), "claude", { pinnedVersion, packageName });
writeHostLauncher(join(codexPlugin, "bin/ai-config-sync"), "codex", { pinnedVersion, packageName });

console.log("Built dist/claude-marketplace and dist/codex-plugin");

if (!process.argv.includes("--skip-sync")) syncActivePluginCaches();
