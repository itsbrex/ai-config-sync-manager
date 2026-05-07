#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const home = homedir();
const claudeKnownMarketplacesPath = path.join(home, ".claude/plugins/known_marketplaces.json");
const distMarketplacePath = path.join(process.cwd(), "dist/claude-marketplace");

console.log("→ Switching to DEV mode (npm link + plugin cache sync)");

console.log("\n[1/3] Link + build");
execSync("npm link", { stdio: "inherit" });
execSync("npm run build:dist", { stdio: "inherit" });

console.log("\n[2/3] Register Claude marketplace (directory source)");
upsertTopLevelKeyInJson(claudeKnownMarketplacesPath, "ai-config-sync-manager", {
  source: { source: "directory", path: distMarketplacePath },
  installLocation: distMarketplacePath,
  lastUpdated: new Date().toISOString(),
});

console.log("\n[3/3] Status");
let whichOutput;
try {
  whichOutput = execSync("which ai-config-sync", { encoding: "utf8" }).trim();
} catch {
  whichOutput = "(not found in PATH)";
}

console.log("✓ DEV mode active");
console.log(`  ai-config-sync: ${whichOutput}`);
console.log("  next: edit src → npm run build:dist (auto-syncs caches)");

function upsertTopLevelKeyInJson(filePath, key, value) {
  if (!existsSync(filePath)) {
    console.warn(
      `warn: ${filePath} not found — Claude has not been launched yet; skipping marketplace registration`
    );
    return;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    console.warn(`warn: ${filePath} could not be parsed — left as-is`);
    return;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.warn(`warn: ${filePath} is not a JSON object — left as-is`);
    return;
  }
  const existed = key in data;
  data[key] = value;
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  const verb = existed ? "updated" : "registered";
  console.log(`${verb} ${key} → ${value.installLocation}`);
}
