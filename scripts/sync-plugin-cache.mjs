import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGIN_NAMES = new Set(["ai-config-sync-manager", "config-manager"]);

const HOSTS = [
  {
    label: "Claude",
    cacheRoot: join(homedir(), ".claude/plugins/cache"),
    distSource: join(process.cwd(), "dist/claude-marketplace/plugins/config-manager"),
    targetPattern: /\/\.claude\/plugins\/cache\/[^/]+\/[^/]+\/[^/]+(?:\/plugins\/[^/]+)?$/,
  },
  {
    label: "Codex",
    cacheRoot: join(homedir(), ".codex/plugins/cache"),
    distSource: join(process.cwd(), "dist/codex-plugin"),
    targetPattern: /\/\.codex\/plugins\/cache\/[^/]+\/[^/]+\/[^/]+(?:\/plugins\/[^/]+)?$/,
  },
];

export function syncActivePluginCaches() {
  try {
    let synced = 0;
    for (const host of HOSTS) {
      if (!existsSync(host.cacheRoot)) continue;
      if (!existsSync(host.distSource)) continue;
      const targets = findActiveCaches(host.cacheRoot, PLUGIN_NAMES);
      for (const target of targets) {
        if (!target.startsWith(`${host.cacheRoot}/`) || !host.targetPattern.test(target)) {
          console.warn(
            `Plugin cache sync skipped (${host.label}): ${target} does not match expected cache pattern; remove it manually if you want a clean reinstall.`
          );
          continue;
        }
        rmSync(target, { recursive: true, force: true });
        cpSync(host.distSource, target, { recursive: true, force: true });
        console.log(`Synced ${host.label} cache: ${target}`);
        synced += 1;
      }
    }
    if (synced === 0) {
      console.log("No active plugin caches to sync.");
    } else {
      console.log(`Synced ${synced} active plugin cache${synced === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Plugin cache sync skipped: ${message}`);
  }
}

export function findActiveCaches(cacheRoot, pluginNames) {
  const results = [];
  const marketplaces = readdirSync(cacheRoot, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory()
  );
  for (const marketplace of marketplaces) {
    const marketplaceDir = join(cacheRoot, marketplace.name);
    const plugins = readdirSync(marketplaceDir, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory()
    );
    for (const plugin of plugins) {
      if (!pluginNames.has(plugin.name)) continue;
      const pluginDir = join(marketplaceDir, plugin.name);
      const versions = readdirSync(pluginDir, { withFileTypes: true }).filter((entry) =>
        entry.isDirectory()
      );
      for (const version of versions) {
        const versionDir = join(pluginDir, version.name);
        if (existsSync(join(versionDir, ".orphaned_at"))) continue;
        const root = resolvePluginRoot(versionDir);
        if (root) results.push(root);
      }
    }
  }
  return results;
}

export function resolvePluginRoot(versionDir) {
  if (existsSync(join(versionDir, "bin"))) return versionDir;
  for (const nested of ["config-manager", "ai-config-sync-manager"]) {
    const candidate = join(versionDir, "plugins", nested);
    if (existsSync(join(candidate, "bin"))) return candidate;
  }
  return null;
}
