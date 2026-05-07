#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const tag = process.argv[2];
const installSpec = tag ? `ai-config-sync-manager@${tag}` : "ai-config-sync-manager";
const tagLabel = tag ? `@${tag}` : "@latest";

const home = homedir();
const claudePluginDir = join(home, ".claude/plugins/config-manager@ai-config-sync-manager");
const claudeInstalledPath = join(home, ".claude/plugins/installed_plugins.json");
const codexMarketplacePath = join(home, ".agents/plugins/marketplace.json");
const codexPluginDir = join(home, "plugins/ai-config-sync-manager");

console.log(`→ Switching to PROD mode (npm ${tagLabel} + marketplace plugins)`);

console.log("\n[1/3] Cleanup plugin install traces");
removePluginDir(claudePluginDir, "config-manager@ai-config-sync-manager");
removeKeyFromJson(claudeInstalledPath, "config-manager@ai-config-sync-manager");
filterPluginsArray(codexMarketplacePath, "ai-config-sync-manager");
removePluginDir(codexPluginDir, "ai-config-sync-manager");

console.log("\n[2/3] npm unlink + install");
try {
  execSync("npm unlink -g ai-config-sync-manager", { stdio: "inherit" });
} catch {
  // already unlinked — proceed
}

execSync(`npm i -g ${installSpec}`, { stdio: "inherit" });

console.log("\n[3/3] Status");
let whichOutput;
try {
  whichOutput = execSync("which ai-config-sync", { encoding: "utf8" }).trim();
} catch {
  whichOutput = "(not found in PATH)";
}

console.log("✓ PROD mode active for npm");
console.log(`  ai-config-sync: ${whichOutput}`);
console.log("");
console.log("Next steps:");
console.log("  1. ai-config-sync connect    (registers plugins for installed hosts)");
console.log("  2. Restart Claude Code / Codex CLI to pick up the plugins");

function removePluginDir(path, expectedBasename) {
  if (!existsSync(path)) {
    console.log(`skipped ${path} (not present)`);
    return;
  }
  if (basename(path) !== expectedBasename) {
    console.warn(`warn: ${path} basename mismatch — left as-is`);
    return;
  }
  rmSync(path, { recursive: true, force: true });
  console.log(`removed ${path}`);
}

function removeKeyFromJson(path, key) {
  if (!existsSync(path)) {
    console.log(`skipped ${path} (not present)`);
    return;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.warn(`warn: ${path} could not be parsed — left as-is`);
    return;
  }
  if (!data?.plugins || !(key in data.plugins)) {
    console.log(`skipped ${path} (entry not present)`);
    return;
  }
  delete data.plugins[key];
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`updated ${path} (removed ${key})`);
}

function filterPluginsArray(path, pluginName) {
  if (!existsSync(path)) {
    console.log(`skipped ${path} (not present)`);
    return;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.warn(`warn: ${path} could not be parsed — left as-is`);
    return;
  }
  if (!Array.isArray(data?.plugins)) {
    console.log(`skipped ${path} (no plugins array)`);
    return;
  }
  const next = data.plugins.filter((plugin) => plugin?.name !== pluginName);
  if (next.length === data.plugins.length) {
    console.log(`skipped ${path} (entry not present)`);
    return;
  }
  data.plugins = next;
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`updated ${path} (removed ${pluginName})`);
}
