#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hosts = new Set(["claude", "codex"]);
const [command = "help", ...argv] = process.argv.slice(2);
const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.AI_CONFIG_SYNC_HOME ?? homedir();

try {
  if (command === "connect") {
    noOptions(argv, "connect");
    runConnect();
  } else if (command === "status") {
    const { json, scopes, selectors } = parseStatus(argv);
    const report = createStatusReport(scopes, selectors);
    console.log(
      json
        ? JSON.stringify(report, null, 2)
        : renderStatus(report)
    );
  } else if (command === "sync") {
    const options = parseSync(argv);
    const mode = options.apply ? "apply" : "dry-run";
    const plan = createSyncPlan(options, mode);
    if (mode === "apply") {
      applySyncPlan(plan);
    }
    console.log(renderSyncPlan(plan));
  } else {
    printHelp();
  }
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : "Unknown CLI error");
}

function parseStatus(argv) {
  let json = false;
  let scopes = ["global", "project"];
  const selectors = emptySelectors();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      json = true;
    } else if (token === "--scope") {
      const value = argv[index + 1];
      scopes = parseScopes(value, true);
      index += 1;
    } else if (token === "--include" || token === "--exclude") {
      addSelectors(selectors, token, argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown option for status: ${token}`);
    }
  }

  return { json, scopes, selectors };
}

function createStatusReport(scopes, selectors = emptySelectors()) {
  const entries = filterEntries(
    scopes.flatMap((scope) => diffScope(scope)),
    selectors
  );

  return {
    source: "claude",
    target: "codex",
    scopes,
    include: renderSelectors(selectors.include),
    exclude: renderSelectors(selectors.exclude),
    scaffold: false,
    entries,
    summary:
      entries.length === 0
        ? `No diff detected for ${scopes.join("+")} scope.`
        : `${entries.length} diff(s) detected for ${scopes.join("+")} scope.`
  };
}

function renderStatus(report) {
  const lines = [
    "AI Config Sync Manager status",
    `Scopes: ${report.scopes.join(", ")}`,
    `Include: ${report.include.length ? report.include.join(", ") : "all"}`,
    `Exclude: ${report.exclude.length ? report.exclude.join(", ") : "none"}`,
    report.summary
  ];

  for (const [scope, scopeEntries] of groupBy(report.entries, "scope")) {
    lines.push("");
    lines.push(`Scope: ${scope}`);

    for (const [area, areaEntries] of groupBy(scopeEntries, "area")) {
      lines.push(`  Area: ${area}`);

      for (const entry of areaEntries) {
        lines.push(`    [${entry.risk}] ${entry.summary}`);
        lines.push(`      Claude: ${entry.claudePath} (${entry.claude})`);
        lines.push(`      Codex:  ${entry.codexPath} (${entry.codex})`);

        for (const item of statusItems(entry)) {
          lines.push(`      - ${item}`);
        }
      }
    }
  }

  return lines.join("\n");
}

function statusItems(entry) {
  if (entry.missingInCodex || entry.missingInClaude) {
    return [
      ...(entry.missingInCodex ?? []).map((name) => `missing-in-codex: ${name}`),
      ...(entry.missingInClaude ?? []).map((name) => `missing-in-claude: ${name}`)
    ];
  }

  return [`${entry.area}: claude=${entry.claude}, codex=${entry.codex}`];
}

function groupBy(entries, key) {
  const groups = new Map();

  for (const entry of entries) {
    const value = entry[key];
    const group = groups.get(value) ?? [];
    group.push(entry);
    groups.set(value, group);
  }

  return groups;
}

function emptySelectors() {
  return { include: [], exclude: [] };
}

function addSelectors(selectors, token, value) {
  if (!value) throw new Error(`Missing value for ${token}`);
  const target = token === "--include" ? selectors.include : selectors.exclude;

  for (const raw of value.split(",")) {
    const selector = parseSelector(raw);
    if (selector) target.push(selector);
  }
}

function parseSelector(raw) {
  const value = raw.trim();
  if (!value) return null;

  const [area, ...itemParts] = value.split(":");
  if (!area || itemParts.length > 1) {
    throw new Error(`Invalid selector: ${raw}. Use area or area:item.`);
  }

  return {
    area,
    item: itemParts[0] || null
  };
}

function renderSelectors(selectors) {
  return selectors.map((selector) => selector.item ? `${selector.area}:${selector.item}` : selector.area);
}

function filterEntries(entries, selectors) {
  return entries
    .filter((entry) => isIncluded(entry, selectors.include))
    .map((entry) => filterEntryItems(entry, selectors))
    .filter((entry) => entry && !isExcluded(entry, selectors.exclude));
}

function isIncluded(entry, include) {
  if (include.length === 0) return true;
  return include.some((selector) => selectorMatchesEntry(selector, entry));
}

function isExcluded(entry, exclude) {
  return exclude.some((selector) => selectorMatchesEntry(selector, entry));
}

function selectorMatchesEntry(selector, entry) {
  if (selector.area !== entry.area) return false;
  if (!selector.item) return true;
  return entryItems(entry).includes(selector.item);
}

function filterEntryItems(entry, selectors) {
  if (!entry.missingInCodex && !entry.missingInClaude) return entry;

  const includes = selectors.include.filter((selector) => selector.area === entry.area && selector.item);
  const excludes = selectors.exclude.filter((selector) => selector.area === entry.area && selector.item);
  const includeItems = includes.map((selector) => selector.item);
  const excludeItems = excludes.map((selector) => selector.item);
  const filtered = { ...entry };

  filtered.missingInCodex = filterItems(entry.missingInCodex ?? [], includeItems, excludeItems);
  filtered.missingInClaude = filterItems(entry.missingInClaude ?? [], includeItems, excludeItems);

  if (filtered.missingInCodex.length === 0 && filtered.missingInClaude.length === 0) return null;
  return filtered;
}

function filterItems(items, includeItems, excludeItems) {
  return items.filter((item) => {
    if (includeItems.length > 0 && !includeItems.includes(item)) return false;
    return !excludeItems.includes(item);
  });
}

function entryItems(entry) {
  if (entry.missingInCodex || entry.missingInClaude) {
    return [...(entry.missingInCodex ?? []), ...(entry.missingInClaude ?? [])];
  }

  return [entry.area];
}

function directionalItems(entry, to) {
  if (to === "codex") return entry.missingInCodex ?? [];
  if (to === "claude") return entry.missingInClaude ?? [];
  return entryItems(entry);
}

function createSyncPlan(options, mode) {
  const entries = filterEntries(diffScope(options.scope), options.selectors);
  const operations = entries.map((entry) => createOperation(entry, options.from, options.to)).filter(Boolean);

  return {
    from: options.from,
    to: options.to,
    scope: options.scope,
    mode,
    include: renderSelectors(options.selectors.include),
    exclude: renderSelectors(options.selectors.exclude),
    canApply: true,
    backupRoot: `${home}/.ai-config-sync-manager/backups/${new Date().toISOString().replaceAll(":", "-")}`,
    operations,
    results: []
  };
}

function createOperation(entry, from, to) {
  const sourcePath = from === "claude" ? entry.claudePath : entry.codexPath;
  const targetPath = to === "claude" ? entry.claudePath : entry.codexPath;

  if (entry.area === "permissions" || entry.area === "hooks") {
    const itemNames = directionalItems(entry, to);
    if (itemNames.length === 0) return null;

    if (!existsSync(sourcePath)) {
      return {
        scope: entry.scope,
        area: entry.area,
        risk: "manual",
        action: "source-missing",
        sourcePath,
        targetPath,
        backupRequired: false,
        approvalRequired: true
      };
    }

    return {
      scope: entry.scope,
      area: entry.area,
      risk: entry.risk,
      action: "merge-settings-items",
      from,
      to,
      sourcePath,
      targetPath,
      itemNames,
      backupRequired: true,
      approvalRequired: false
    };
  }

  if (entry.area === "instructions" || entry.area === "mcp") {
    if (!existsSync(sourcePath)) {
      return {
        scope: entry.scope,
        area: entry.area,
        risk: "manual",
        action: "source-missing",
        sourcePath,
        targetPath,
        backupRequired: false,
        approvalRequired: true
      };
    }

    return {
      scope: entry.scope,
      area: entry.area,
      risk: entry.risk,
      action: "copy-file",
      sourcePath,
      targetPath,
      backupRequired: true,
      approvalRequired: false
    };
  }

  if (entry.area === "skills") {
    const missing = to === "claude" ? entry.missingInClaude ?? [] : entry.missingInCodex ?? [];
    return {
      scope: entry.scope,
      area: entry.area,
      risk: entry.risk,
      action: "copy-missing-skills",
      sourcePath,
      targetPath,
      skillNames: missing,
      backupRequired: true,
      approvalRequired: entry.risk !== "safe"
    };
  }

  return {
    scope: entry.scope,
    area: entry.area,
    risk: entry.risk,
    action: "manual-review",
    sourcePath,
    targetPath,
    backupRequired: true,
    approvalRequired: true
  };
}

function renderSyncPlan(plan) {
  const lines = [
    "AI Config Sync Manager sync",
    `Route: ${plan.from} -> ${plan.to}`,
    `Scope: ${plan.scope}`,
    `Mode: ${plan.mode}`,
    `Include: ${plan.include.length ? plan.include.join(", ") : "all"}`,
    `Exclude: ${plan.exclude.length ? plan.exclude.join(", ") : "none"}`,
    `Backup root: ${plan.backupRoot}`
  ];

  if (plan.operations.length === 0) {
    lines.push("No sync operations planned.");
  }

  for (const operation of plan.operations) {
    lines.push("");
    lines.push(`[${operation.risk}] ${operation.scope}/${operation.area}: ${operation.action}`);
    lines.push(`  Source: ${operation.sourcePath}`);
    lines.push(`  Target: ${operation.targetPath}`);
    lines.push(`  Backup required: ${operation.backupRequired ? "yes" : "no"}`);
    lines.push(`  Approval required: ${operation.approvalRequired ? "yes" : "no"}`);
    if (operation.skillNames?.length) {
      lines.push(`  Skills: ${operation.skillNames.join(", ")}`);
    }
    if (operation.itemNames?.length && operation.area !== "skills") {
      lines.push(`  Items: ${operation.itemNames.join(", ")}`);
    }
    if (operation.skillNames && operation.skillNames.length === 0) {
      lines.push("  Skills: none missing in target direction");
    }
  }

  if (plan.mode === "apply") {
    lines.push("");
    lines.push("Apply results:");
    for (const result of plan.results) {
      lines.push(`  ${result.status}: ${result.message}`);
    }
  } else {
    lines.push("");
    lines.push("Dry-run only. No files were modified.");
  }

  return lines.join("\n");
}

function applySyncPlan(plan) {
  mkdirSync(plan.backupRoot, { recursive: true });

  for (const operation of plan.operations) {
    if (operation.approvalRequired) {
      plan.results.push({
        status: "skipped",
        message: `${operation.scope}/${operation.area} requires explicit approval`
      });
      continue;
    }

    try {
      if (operation.action === "copy-file") {
        applyCopyFile(plan, operation);
      } else if (operation.action === "copy-missing-skills") {
        applyCopyMissingSkills(plan, operation);
      } else if (operation.action === "merge-settings-items") {
        applyMergeSettingsItems(plan, operation);
      } else {
        plan.results.push({
          status: "skipped",
          message: `${operation.scope}/${operation.area} action ${operation.action} is not implemented`
        });
      }
    } catch (error) {
      plan.results.push({
        status: "error",
        message: `${operation.scope}/${operation.area}: ${error instanceof Error ? error.message : "unknown error"}`
      });
    }
  }

  if (plan.results.length === 0) {
    plan.results.push({ status: "noop", message: "No operations to apply" });
  }
}

function applyCopyFile(plan, operation) {
  if (!existsSync(operation.sourcePath)) {
    plan.results.push({ status: "skipped", message: `source missing: ${operation.sourcePath}` });
    return;
  }

  mkdirSync(dirname(operation.targetPath), { recursive: true });
  backupPath(plan, operation.targetPath);
  copyFileSync(operation.sourcePath, operation.targetPath);
  plan.results.push({ status: "applied", message: `copied ${operation.sourcePath} -> ${operation.targetPath}` });
}

function applyCopyMissingSkills(plan, operation) {
  mkdirSync(operation.targetPath, { recursive: true });

  for (const skillName of operation.skillNames ?? []) {
    const source = join(operation.sourcePath, skillName);
    const target = join(operation.targetPath, skillName);

    if (!existsSync(source)) {
      plan.results.push({ status: "skipped", message: `skill source missing: ${source}` });
      continue;
    }

    if (existsSync(target)) {
      plan.results.push({ status: "skipped", message: `skill already exists: ${target}` });
      continue;
    }

    cpSync(source, target, { recursive: true, dereference: false });
    plan.results.push({ status: "applied", message: `copied skill ${skillName}` });
  }
}

function applyMergeSettingsItems(plan, operation) {
  mkdirSync(dirname(operation.targetPath), { recursive: true });
  backupPath(plan, operation.targetPath);

  if (operation.to === "claude") {
    mergeIntoClaudeSettings(operation.targetPath, operation.sourcePath, operation.from, operation.area, operation.itemNames ?? []);
  } else {
    mergeIntoCodexSettings(operation.targetPath, operation.sourcePath, operation.from, operation.area, operation.itemNames ?? []);
  }

  plan.results.push({
    status: "applied",
    message: `merged ${operation.area} item(s): ${(operation.itemNames ?? []).join(", ")}`
  });
}

function mergeIntoClaudeSettings(targetPath, sourcePath, sourceHost, area, itemNames) {
  const target = readJsonFile(targetPath, {});

  if (area === "permissions") {
    target.permissions ??= {};
    for (const itemName of itemNames) {
      const { bucket, value } = parsePermissionItem(itemName);
      const list = Array.isArray(target.permissions[bucket]) ? target.permissions[bucket] : [];
      if (!list.includes(value)) list.push(value);
      target.permissions[bucket] = list;
    }
  }

  if (area === "hooks") {
    target.hooks ??= {};
    const sourceHooks = sourceHost === "codex"
      ? codexManagedValues("hooks", sourcePath)
      : readJsonFile(sourcePath, {}).hooks ?? {};

    for (const itemName of itemNames) {
      if (!target.hooks[itemName]) {
        target.hooks[itemName] = sourceHooks[itemName] ?? [];
      }
    }
  }

  writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`);
}

function mergeIntoCodexSettings(targetPath, sourcePath, sourceHost, area, itemNames) {
  const sourceValues = sourceHost === "claude"
    ? claudeManagedValues(area, sourcePath, itemNames)
    : codexManagedValues(area, sourcePath);
  const text = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  writeFileSync(targetPath, replaceManagedBlock(text, area, sourceValues, itemNames));
}

function claudeManagedValues(area, sourcePath, itemNames) {
  const data = readJsonFile(sourcePath, {});
  const values = {};

  if (area === "permissions") {
    for (const itemName of itemNames) {
      const { bucket, value } = parsePermissionItem(itemName);
      values[`${bucket}:${value}`] = { bucket, value };
    }
  }

  if (area === "hooks") {
    const hooks = data.hooks ?? {};
    for (const itemName of itemNames) {
      values[itemName] = hooks[itemName] ?? [];
    }
  }

  return values;
}

function codexManagedValues(area, sourcePath) {
  if (!existsSync(sourcePath)) return {};
  const text = readFileSync(sourcePath, "utf8");
  const values = {};

  if (area === "permissions") {
    for (const match of text.matchAll(/^\s*#\s*permissions\.(allow|deny|ask)\s*=\s*(.+)$/gm)) {
      try {
        const value = JSON.parse(match[2]);
        values[`${match[1]}:${value}`] = { bucket: match[1], value };
      } catch {
        // Ignore malformed managed comments.
      }
    }
  }

  if (area === "hooks") {
    for (const match of text.matchAll(/^\s*#\s*hooks\.([A-Za-z0-9_-]+)\s*=\s*(.+)$/gm)) {
      try {
        values[match[1]] = JSON.parse(match[2]);
      } catch {
        values[match[1]] = [];
      }
    }
  }

  return values;
}

function replaceManagedBlock(text, area, sourceValues, itemNames) {
  const begin = `# BEGIN ai-config-sync ${area}`;
  const end = `# END ai-config-sync ${area}`;
  const existing = parseManagedBlock(text, area);
  const merged = { ...existing };

  for (const itemName of itemNames) {
    const key = area === "permissions" ? permissionKey(itemName) : itemName;
    if (sourceValues[key] !== undefined) merged[key] = sourceValues[key];
  }

  const lines = [
    begin,
    ...Object.entries(merged)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => managedLine(area, key, value)),
    end
  ];
  const block = lines.join("\n");
  const pattern = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, "m");

  if (pattern.test(text)) {
    return text.replace(pattern, block);
  }

  return `${text.replace(/\s*$/, "")}\n\n${block}\n`;
}

function parseManagedBlock(text, area) {
  const begin = `# BEGIN ai-config-sync ${area}`;
  const end = `# END ai-config-sync ${area}`;
  const pattern = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, "m");
  const match = text.match(pattern);
  if (!match) return {};

  const tempPath = "__managed_block__";
  return area === "permissions"
    ? parsePermissionManagedLines(match[0])
    : parseHookManagedLines(match[0], tempPath);
}

function parsePermissionManagedLines(text) {
  const values = {};
  for (const match of text.matchAll(/^\s*#\s*permissions\.(allow|deny|ask)\s*=\s*(.+)$/gm)) {
    try {
      const value = JSON.parse(match[2]);
      values[`${match[1]}:${value}`] = { bucket: match[1], value };
    } catch {
      // Ignore malformed managed comments.
    }
  }
  return values;
}

function parseHookManagedLines(text) {
  const values = {};
  for (const match of text.matchAll(/^\s*#\s*hooks\.([A-Za-z0-9_-]+)\s*=\s*(.+)$/gm)) {
    try {
      values[match[1]] = JSON.parse(match[2]);
    } catch {
      values[match[1]] = [];
    }
  }
  return values;
}

function managedLine(area, key, value) {
  if (area === "permissions") {
    return `# permissions.${value.bucket} = ${JSON.stringify(value.value)}`;
  }

  return `# hooks.${key} = ${JSON.stringify(value)}`;
}

function parsePermissionItem(itemName) {
  const [maybeBucket, ...rest] = itemName.split(":");
  if (rest.length > 0 && ["allow", "deny", "ask"].includes(maybeBucket)) {
    return { bucket: maybeBucket, value: rest.join(":") };
  }
  return { bucket: "allow", value: itemName };
}

function permissionKey(itemName) {
  const { bucket, value } = parsePermissionItem(itemName);
  return `${bucket}:${value}`;
}

function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function backupPath(plan, targetPath) {
  if (!existsSync(targetPath)) return;

  const backupTarget = join(plan.backupRoot, targetPath.replace(/^\/+/, ""));
  mkdirSync(dirname(backupTarget), { recursive: true });
  cpSync(targetPath, backupTarget, { recursive: true, dereference: false });
}

function diffScope(scope) {
  const paths = scope === "global" ? globalPaths() : projectPaths(process.cwd());
  const entries = [];

  compareFile(entries, scope, "instructions", paths.claude.instructions, paths.codex.instructions);
  compareSkillDirs(entries, scope, paths.claude.skills, paths.codex.skills);
  compareFile(entries, scope, "mcp", paths.claude.mcp, paths.codex.mcp);

  if (scope === "global") {
    compareSettingsItems(entries, scope, "permissions", paths.claude.settings, paths.codex.settings);
    compareSettingsItems(entries, scope, "hooks", paths.claude.settings, paths.codex.settings);
  }

  return entries;
}

function globalPaths() {
  return {
    claude: {
      instructions: `${home}/.claude/CLAUDE.md`,
      skills: `${home}/.claude/skills`,
      mcp: `${home}/.claude/mcp.json`,
      settings: `${home}/.claude/settings.json`
    },
    codex: {
      instructions: `${home}/.codex/AGENTS.md`,
      skills: `${home}/.agents/skills`,
      mcp: firstExisting([`${home}/.codex/.mcp.json`, `${home}/.codex/mcp.json`, `${home}/.agents/plugins/marketplace.json`]),
      settings: `${home}/.codex/config.toml`
    }
  };
}

function projectPaths(root) {
  return {
    claude: {
      instructions: `${root}/CLAUDE.md`,
      skills: `${root}/.claude/skills`,
      mcp: firstExisting([`${root}/.claude/mcp.json`, `${root}/.mcp.json`])
    },
    codex: {
      instructions: `${root}/AGENTS.md`,
      skills: firstExisting([`${root}/.agents/skills`, `${root}/.codex/skills`]),
      mcp: firstExisting([`${root}/.codex/.mcp.json`, `${root}/.codex/mcp.json`, `${root}/.mcp.json`])
    }
  };
}

function firstExisting(paths) {
  return paths.find((path) => existsSync(path)) ?? paths[0];
}

function compareFile(entries, scope, area, claudePath, codexPath) {
  const claude = fileState(claudePath);
  const codex = fileState(codexPath);

  if (!claude.exists && !codex.exists) return;

  if (claude.hash !== codex.hash) {
    entries.push({
      scope,
      area,
      risk: classifyFileRisk(area, claudePath, codexPath),
      summary: `${label(area)} differs`,
      claudePath,
      codexPath,
      claude: claude.summary,
      codex: codex.summary
    });
  }
}

function classifyFileRisk(area, claudePath, codexPath) {
  if (area === "instructions") return "safe";
  if (area === "mcp" && !claudePath.endsWith("marketplace.json") && !codexPath.endsWith("marketplace.json")) {
    return "safe";
  }
  return "manual";
}

function comparePresence(entries, scope, area, claudePath, codexPath, risk) {
  const claude = fileState(claudePath);
  const codex = fileState(codexPath);
  if (claude.exists === codex.exists) return;

  entries.push({
    scope,
    area,
    risk,
    summary: `${label(area)} presence differs`,
    claudePath,
    codexPath,
    claude: claude.summary,
    codex: codex.summary
  });
}

function compareSkillDirs(entries, scope, claudeDir, codexDir) {
  const claude = skillNames(claudeDir);
  const codex = skillNames(codexDir);
  const missingInCodex = claude.filter((name) => !codex.includes(name));
  const missingInClaude = codex.filter((name) => !claude.includes(name));

  if (missingInCodex.length === 0 && missingInClaude.length === 0) return;

  entries.push({
    scope,
    area: "skills",
    risk: "safe",
    summary: "skills differ",
    claudePath: claudeDir,
    codexPath: codexDir,
    claude: `${claude.length} skill(s)`,
    codex: `${codex.length} skill(s)`,
    missingInCodex,
    missingInClaude
  });
}

function compareSettingsItems(entries, scope, area, claudePath, codexPath) {
  const claude = settingsItems("claude", area, claudePath);
  const codex = settingsItems("codex", area, codexPath);
  const missingInCodex = claude.filter((name) => !codex.includes(name));
  const missingInClaude = codex.filter((name) => !claude.includes(name));

  if (missingInCodex.length === 0 && missingInClaude.length === 0) return;

  entries.push({
    scope,
    area,
    risk: "manual",
    summary: `${label(area)} differ`,
    claudePath,
    codexPath,
    claude: `${claude.length} item(s)`,
    codex: `${codex.length} item(s)`,
    missingInCodex,
    missingInClaude
  });
}

function settingsItems(host, area, path) {
  if (!existsSync(path)) return [];

  if (host === "claude") {
    return claudeSettingsItems(area, path);
  }

  return codexSettingsItems(area, path);
}

function claudeSettingsItems(area, path) {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));

    if (area === "permissions") {
      return uniqueStrings([
        ...permissionItems("allow", data.permissions?.allow),
        ...permissionItems("deny", data.permissions?.deny),
        ...permissionItems("ask", data.permissions?.ask)
      ]);
    }

    if (area === "hooks") {
      return Object.keys(data.hooks ?? {}).sort();
    }
  } catch {
    return [];
  }

  return [];
}

function permissionItems(prefix, values) {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value) => typeof value === "string")
    .flatMap((value) => [value, `${prefix}:${value}`]);
}

function codexSettingsItems(area, path) {
  const text = readFileSync(path, "utf8");
  const items = [];

  if (area === "permissions") {
    for (const match of text.matchAll(/^\s*#\s*permissions\.(allow|deny|ask)\s*=\s*"([^"]+)"/gm)) {
      items.push(match[2], `${match[1]}:${match[2]}`);
    }
    for (const match of text.matchAll(/^\s*(approval_policy|approvals_reviewer|sandbox_mode)\s*=/gm)) {
      items.push(match[1]);
    }
  }

  if (area === "hooks") {
    for (const match of text.matchAll(/^\s*#\s*hooks\.([A-Za-z0-9_-]+)/gm)) {
      items.push(match[1]);
    }
  }

  return uniqueStrings(items);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function skillNames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

function fileState(path) {
  if (!path || !existsSync(path)) {
    return { exists: false, hash: "missing", summary: "missing" };
  }

  const content = readFileSync(path);
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return { exists: true, hash, summary: `${content.length} bytes sha256:${hash}` };
}

function label(area) {
  return area.replaceAll("-", " ");
}

function runConnect() {
  const defaultRoot = `${home}/.ai-config-sync-manager`;
  const claudePlugin = findClaudePlugin();
  const codexPlugin = `${home}/plugins/ai-config-sync-manager`;
  const codexMarketplace = `${home}/.agents/plugins/marketplace.json`;

  console.log("AI Config Sync Manager connect");
  console.log(`Runtime root: ${runtimeRoot}`);
  console.log(`Default root: ${formatPathState(defaultRoot)}`);
  console.log(`Claude plugin: ${claudePlugin ? formatPathState(claudePlugin) : "missing"}`);
  console.log(`Codex plugin: ${formatPathState(codexPlugin)}`);
  console.log(`Codex marketplace: ${formatPathState(codexMarketplace)}`);

  if (!existsSync(defaultRoot)) {
    console.log(`Action needed: link the default root with: ln -s "${runtimeRoot}" "${defaultRoot}"`);
  }

  if (!claudePlugin) {
    console.log("Action needed: install Claude plugin with /plugin install config-manager@ai-config-sync-manager");
  }

  if (!existsSync(codexPlugin) || !codexMarketplaceIncludes(codexMarketplace)) {
    console.log("Action needed: register Codex plugin in ~/.agents/plugins/marketplace.json");
  }

  console.log("No files were modified by connect.");
}

function findClaudePlugin() {
  const installedPath = `${home}/.claude/plugins/installed_plugins.json`;
  if (!existsSync(installedPath)) return null;

  try {
    const data = JSON.parse(readFileSync(installedPath, "utf8"));
    const installed = data.plugins?.["config-manager@ai-config-sync-manager"]?.[0]?.installPath;
    return typeof installed === "string" ? installed : null;
  } catch {
    return null;
  }
}

function codexMarketplaceIncludes(path) {
  if (!existsSync(path)) return false;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return Boolean(data.plugins?.some((plugin) => plugin.name === "ai-config-sync-manager"));
  } catch {
    return false;
  }
}

function formatPathState(path) {
  if (!existsSync(path)) return `${path} (missing)`;
  const stat = lstatSync(path);
  return `${path}${stat.isSymbolicLink() ? " (symlink)" : ""}`;
}

function parseSync(argv) {
  let from = "claude";
  let to = "codex";
  let dryRun = false;
  let apply = false;
  let scope = "project";
  const selectors = emptySelectors();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      dryRun = true;
    } else if (token === "--apply") {
      apply = true;
    } else if (token === "--from" || token === "--to") {
      const value = argv[index + 1];
      if (!hosts.has(value)) throw new Error(`Missing or invalid value for ${token}`);
      if (token === "--from") from = value;
      if (token === "--to") to = value;
      index += 1;
    } else if (token === "--scope") {
      scope = parseScopes(argv[index + 1], false)[0];
      index += 1;
    } else if (token === "--include" || token === "--exclude") {
      addSelectors(selectors, token, argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown option for sync: ${token}`);
    }
  }

  if (dryRun && apply) throw new Error("Choose either --dry-run or --apply, not both.");
  if (from === to) throw new Error("--from and --to must be different hosts.");

  return { from, to, apply, scope, selectors };
}

function parseScopes(value, allowAll) {
  if (allowAll && (!value || value === "all")) return ["global", "project"];
  if (value === "global" || value === "project") return [value];
  throw new Error(allowAll ? "Supported scopes are global, project, and all." : "Supported sync scopes are global and project.");
}

function noOptions(argv, command) {
  if (argv.length > 0) throw new Error(`${command} does not accept options.`);
}

function printHelp() {
  console.log(`Usage:
  ai-config-sync connect
  ai-config-sync status
  ai-config-sync status --json
  ai-config-sync status --scope global|project|all
  ai-config-sync status --include skills:foo --exclude mcp
  ai-config-sync sync --dry-run
  ai-config-sync sync --scope global|project --dry-run
  ai-config-sync sync --scope global|project --apply
  ai-config-sync sync --include instructions,skills:foo --exclude mcp --dry-run
  ai-config-sync sync --from claude --to codex
  ai-config-sync sync --from codex --to claude`);
}
