#!/usr/bin/env node

import { execSync } from "node:child_process";

console.log("→ Switching to DEV mode (npm link + plugin cache sync)");

execSync("npm link", { stdio: "inherit" });
execSync("npm run build:dist", { stdio: "inherit" });

let whichOutput;
try {
  whichOutput = execSync("which ai-config-sync", { encoding: "utf8" }).trim();
} catch {
  whichOutput = "(not found in PATH)";
}

console.log("✓ DEV mode active");
console.log(`  ai-config-sync: ${whichOutput}`);
console.log("  next: edit src → npm run build:dist (auto-syncs caches)");
