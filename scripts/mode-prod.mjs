#!/usr/bin/env node

import { execSync } from "node:child_process";

const tag = process.argv[2] ?? "beta";

console.log(`→ Switching to PROD mode (npm @${tag} + marketplace plugins)`);

try {
  execSync("npm unlink -g ai-config-sync-manager", { stdio: "inherit" });
} catch {
  // already unlinked — proceed
}

execSync(`npm i -g ai-config-sync-manager@${tag}`, { stdio: "inherit" });

let whichOutput;
try {
  whichOutput = execSync("which ai-config-sync", { encoding: "utf8" }).trim();
} catch {
  whichOutput = "(not found in PATH)";
}

console.log("✓ PROD mode active for npm");
console.log(`  ai-config-sync: ${whichOutput}`);
console.log("");
console.log("⚠ Plugin caches still point to dev dist. Reinstall manually:");
console.log("  Claude: /plugin uninstall config-manager@ai-config-sync-manager");
console.log("          /plugin install   config-manager@ai-config-sync-manager");
console.log("  Codex : (use Codex plugin manager equivalent)");
