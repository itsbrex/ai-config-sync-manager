#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
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
  if (entry.missingInCodex || entry.missingInClaude || entry.conflicts) {
    return [
      ...(entry.missingInCodex ?? []).map((name) => `missing-in-codex: ${name}`),
      ...(entry.missingInClaude ?? []).map((name) => `missing-in-claude: ${name}`),
      ...(entry.conflicts ?? []).map((name) => `conflict: ${name}`)
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

  const separator = value.indexOf(":");
  const area = separator === -1 ? value : value.slice(0, separator);
  const item = separator === -1 ? null : value.slice(separator + 1);

  if (!area || item === "") {
    throw new Error(`Invalid selector: ${raw}. Use area or area:item.`);
  }

  return {
    area,
    item
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
  if (!entry.missingInCodex && !entry.missingInClaude && !entry.conflicts) return entry;

  const includes = selectors.include.filter((selector) => selector.area === entry.area && selector.item);
  const excludes = selectors.exclude.filter((selector) => selector.area === entry.area && selector.item);
  const includeItems = includes.map((selector) => selector.item);
  const excludeItems = excludes.map((selector) => selector.item);
  const filtered = { ...entry };

  filtered.missingInCodex = filterItems(entry.missingInCodex ?? [], includeItems, excludeItems);
  filtered.missingInClaude = filterItems(entry.missingInClaude ?? [], includeItems, excludeItems);
  filtered.conflicts = filterItems(entry.conflicts ?? [], includeItems, excludeItems);

  if (
    filtered.missingInCodex.length === 0
    && filtered.missingInClaude.length === 0
    && filtered.conflicts.length === 0
  ) return null;
  return filtered;
}

function filterItems(items, includeItems, excludeItems) {
  return items.filter((item) => {
    if (includeItems.length > 0 && !includeItems.some((includeItem) => itemMatchesSelector(item, includeItem))) return false;
    return !excludeItems.some((excludeItem) => itemMatchesSelector(item, excludeItem));
  });
}

function itemMatchesSelector(item, selector) {
  return item === selector || item.replace(/^(allow|ask|deny):/, "") === selector;
}

function entryItems(entry) {
  if (entry.missingInCodex || entry.missingInClaude || entry.conflicts) {
    return [...(entry.missingInCodex ?? []), ...(entry.missingInClaude ?? []), ...(entry.conflicts ?? [])];
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
    const itemNames = entry.area === "permissions"
      ? permissionOperationItems(directionalItems(entry, to))
      : directionalItems(entry, to);
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

  if (entry.area === "mcp") {
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
      action: "merge-mcp-servers",
      from,
      to,
      sourcePath,
      targetPath,
      serverNames: directionalItems(entry, to),
      patchPreview: mcpPatchPreview(sourcePath, targetPath, from, to, directionalItems(entry, to)),
      backupRequired: true,
      approvalRequired: false
    };
  }

  if (entry.area === "instructions") {
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
    if (operation.serverNames?.length) {
      lines.push(`  MCP servers: ${operation.serverNames.join(", ")}`);
    }
    if (operation.patchPreview?.length) {
      lines.push("  MCP patch preview:");
      for (const patch of operation.patchPreview) {
        lines.push(`    - ${patch.server}: ${patch.action}`);
        for (const change of patch.changes) {
          lines.push(`      ${change}`);
        }
      }
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
      } else if (operation.action === "merge-mcp-servers") {
        applyMergeMcpServers(plan, operation);
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
  if (operation.area === "permissions" && operation.to === "codex") {
    backupPath(plan, codexRulesPath(operation.targetPath));
  }

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

function applyMergeMcpServers(plan, operation) {
  mkdirSync(dirname(operation.targetPath), { recursive: true });
  backupPath(plan, operation.targetPath);

  if (operation.to === "codex") {
    mergeMcpIntoCodex(operation.targetPath, operation.sourcePath, operation.from, operation.serverNames ?? []);
  } else {
    mergeMcpIntoClaude(operation.targetPath, operation.sourcePath, operation.from, operation.serverNames ?? []);
  }

  plan.results.push({
    status: "applied",
    message: `merged MCP servers ${operation.from} -> ${operation.to}: ${(operation.serverNames ?? []).join(", ")}`
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
      ? codexHookValues(sourcePath)
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
  const managedValues = sourceHost === "claude"
    ? codexManagedFallbackValues(area, sourceValues, itemNames)
    : sourceValues;
  let nextText = replaceManagedBlock(text, area, managedValues, itemNames, { dropMissingSelected: sourceHost === "claude" });

  if (area === "permissions" && sourceHost === "claude") {
    nextText = applyCodexNativePermissionMapping(nextText, itemNames);
    writeCodexPermissionRules(codexRulesPath(targetPath), itemNames);
  }

  if (area === "hooks" && sourceHost === "claude") {
    nextText = applyCodexNativeHookMapping(nextText, sourceValues, itemNames);
  }

  writeFileSync(targetPath, nextText);
}

function codexManagedFallbackValues(area, sourceValues, itemNames) {
  if (area === "permissions") return codexManagedPermissionFallbackValues(sourceValues, itemNames);
  if (area === "hooks") return codexManagedHookFallbackValues(sourceValues, itemNames);
  return sourceValues;
}

function codexManagedPermissionFallbackValues(sourceValues, itemNames) {
  const values = {};

  for (const itemName of itemNames) {
    const { bucket, value } = parsePermissionItem(itemName);
    if (hasExactCodexPermissionMapping(bucket, value)) continue;
    const key = permissionKey(itemName);
    if (sourceValues[key] !== undefined) values[key] = sourceValues[key];
  }

  return values;
}

function hasExactCodexPermissionMapping(bucket, value) {
  if (parseMcpPermission(value)) return true;

  const prefixRule = codexPrefixRuleForPermission(bucket, value);
  return Boolean(prefixRule && !prefixRule.startsWith("# skipped risky"));
}

function codexManagedHookFallbackValues(sourceValues, itemNames) {
  const values = {};

  for (const itemName of itemNames) {
    const groups = sourceValues[itemName];
    if (!Array.isArray(groups) || !groups.every(isCodexNativeHookGroup)) {
      if (sourceValues[itemName] !== undefined) values[itemName] = sourceValues[itemName];
    }
  }

  return values;
}

function isCodexNativeHookGroup(group) {
  const hooks = group?.hooks;
  return Array.isArray(hooks)
    && hooks.length > 0
    && hooks.every((hook) => hook?.type === "command" && typeof hook.command === "string");
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

function codexHookValues(sourcePath) {
  if (!existsSync(sourcePath)) return {};
  const text = readFileSync(sourcePath, "utf8");
  const values = codexManagedValues("hooks", sourcePath);

  for (const [eventName, groups] of Object.entries(parseCodexNativeHooks(text))) {
    values[eventName] ??= groups;
  }

  return values;
}

function parseCodexNativeHooks(text) {
  const values = {};
  const lines = text.split(/\r?\n/);
  let currentEvent = null;
  let currentGroup = null;
  let currentHook = null;

  for (const line of lines) {
    const eventMatch = line.match(/^\s*\[\[hooks\.([A-Za-z0-9_-]+)\]\]\s*$/);
    if (eventMatch) {
      currentEvent = eventMatch[1];
      currentGroup = { hooks: [] };
      values[currentEvent] ??= [];
      values[currentEvent].push(currentGroup);
      currentHook = null;
      continue;
    }

    const hookMatch = line.match(/^\s*\[\[hooks\.([A-Za-z0-9_-]+)\.hooks\]\]\s*$/);
    if (hookMatch) {
      currentEvent = hookMatch[1];
      values[currentEvent] ??= [];
      currentGroup = currentGroup && values[currentEvent].includes(currentGroup)
        ? currentGroup
        : { hooks: [] };
      if (!values[currentEvent].includes(currentGroup)) values[currentEvent].push(currentGroup);
      currentHook = {};
      currentGroup.hooks.push(currentHook);
      continue;
    }

    const keyValue = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/);
    if (!keyValue) continue;

    const [, key, rawValue] = keyValue;
    const value = parseTomlScalar(rawValue);

    if (currentHook) {
      currentHook[key] = value;
    } else if (currentGroup) {
      currentGroup[key] = value;
    }
  }

  return values;
}

function parseTomlScalar(value) {
  const trimmed = value.trim();
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return parseJsonLike(trimmed, trimmed.replace(/^"|"$/g, ""));
}

function replaceManagedBlock(text, area, sourceValues, itemNames, options = {}) {
  const begin = `# BEGIN ai-config-sync ${area}`;
  const end = `# END ai-config-sync ${area}`;
  const existing = parseManagedBlock(text, area);
  const merged = { ...existing };

  for (const itemName of itemNames) {
    const key = area === "permissions" ? permissionKey(itemName) : itemName;
    if (sourceValues[key] !== undefined) {
      merged[key] = sourceValues[key];
    } else if (options.dropMissingSelected) {
      delete merged[key];
    }
  }

  const pattern = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, "m");

  if (Object.keys(merged).length === 0) {
    return pattern.test(text) ? text.replace(pattern, "").replace(/\s*$/, "\n") : text;
  }

  const lines = [
    begin,
    ...Object.entries(merged)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => managedLine(area, key, value)),
    end
  ];
  const block = lines.join("\n");

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

function permissionOperationItems(itemNames) {
  const bucketed = new Set(
    itemNames
      .filter((itemName) => /^(allow|ask|deny):/.test(itemName))
      .map((itemName) => itemName.replace(/^(allow|ask|deny):/, ""))
  );

  return itemNames.filter((itemName) => {
    if (/^(allow|ask|deny):/.test(itemName)) return true;
    return !bucketed.has(itemName);
  });
}

function applyCodexNativePermissionMapping(text, itemNames) {
  let nextText = text;
  const values = itemNames.map((itemName) => parsePermissionItem(itemName).value);

  if (values.some((value) => ["Write", "Edit", "MultiEdit"].includes(value))) {
    nextText = setTomlRootString(nextText, "sandbox_mode", "workspace-write");
  }

  if (values.some((value) => isCommandLikePermission(value) && !value.startsWith("Bash(") && value !== "Bash" && !value.startsWith("mcp__"))) {
    nextText = setTomlRootString(nextText, "approval_policy", "on-request");
  }

  nextText = applyCodexMcpToolApprovals(nextText, itemNames);

  return nextText;
}

function isCommandLikePermission(value) {
  return value === "Bash"
    || value.startsWith("Bash(")
    || value === "WebFetch"
    || value === "WebSearch"
    || value === "Agent"
    || value === "SendMessage"
    || value.startsWith("mcp__");
}

function setTomlRootString(text, key, value) {
  const line = `${key} = ${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, "m");

  if (pattern.test(text)) {
    return text.replace(pattern, line);
  }

  return `${line}\n${text}`;
}

function setTomlTableBoolean(text, table, key, value) {
  const tableLine = `[${table}]`;
  const valueLine = `${key} = ${value ? "true" : "false"}`;
  const tablePattern = new RegExp(`^\\[${escapeRegExp(table)}\\]\\n([\\s\\S]*?)(?=^\\[|$)`, "m");
  const match = text.match(tablePattern);

  if (!match) {
    return `${text.replace(/\s*$/, "")}\n\n${tableLine}\n${valueLine}\n`;
  }

  const body = match[1];
  const keyPattern = new RegExp(`^${escapeRegExp(key)}\\s*=.*$`, "m");
  const nextBody = keyPattern.test(body)
    ? body.replace(keyPattern, valueLine)
    : `${body.replace(/\s*$/, "")}\n${valueLine}\n`;

  return text.replace(tablePattern, `${tableLine}\n${nextBody}`);
}

function applyCodexMcpToolApprovals(text, itemNames) {
  let nextText = text;

  for (const itemName of itemNames) {
    const { bucket, value } = parsePermissionItem(itemName);
    const mcp = parseMcpPermission(value);
    if (!mcp) continue;

    const approvalMode = bucket === "deny" ? "deny" : bucket === "ask" ? "prompt" : "approve";
    nextText = setTomlMcpToolApproval(nextText, mcp.server, mcp.tool, approvalMode);
  }

  return nextText;
}

function setTomlMcpToolApproval(text, server, tool, approvalMode) {
  const table = `[mcp_servers.${server}.tools.${tool}]`;
  const line = `approval_mode = ${JSON.stringify(approvalMode)}`;
  const tablePattern = new RegExp(`^\\[mcp_servers\\.${escapeRegExp(server)}\\.tools\\.${escapeRegExp(tool)}\\]\\n([\\s\\S]*?)(?=^\\[|$)`, "m");
  const match = text.match(tablePattern);

  if (!match) {
    return `${text.replace(/\s*$/, "")}\n\n${table}\n${line}\n`;
  }

  const body = match[1];
  const approvalPattern = /^approval_mode\s*=.*$/m;
  const nextBody = approvalPattern.test(body)
    ? body.replace(approvalPattern, line)
    : `${body.replace(/\s*$/, "")}\n${line}\n`;

  return text.replace(tablePattern, `${table}\n${nextBody}`);
}

function parseMcpPermission(value) {
  const match = value.match(/^mcp__([^_]+(?:_[^_]+)*)__([^_].*)$/);
  if (!match) return null;
  return { server: match[1].replaceAll("_", "-"), tool: match[2] };
}

function writeCodexPermissionRules(path, itemNames) {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = [];

  for (const itemName of itemNames) {
    const { bucket, value } = parsePermissionItem(itemName);
    const rule = codexPrefixRuleForPermission(bucket, value);
    if (!rule) continue;
    lines.push(rule);
  }

  if (lines.length === 0) return;

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, replaceTextBlock(existing, "permissions-rules", uniqueStrings(lines).join("\n")));
}

function replaceTextBlock(text, name, body) {
  const begin = `# BEGIN ai-config-sync ${name}`;
  const end = `# END ai-config-sync ${name}`;
  const block = `${begin}\n${body}\n${end}`;
  const pattern = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, "m");

  if (pattern.test(text)) {
    return text.replace(pattern, block);
  }

  return `${text.replace(/\s*$/, "")}\n\n${block}\n`;
}

function codexPrefixRuleForPermission(bucket, value) {
  const pattern = bashPattern(value);
  if (!pattern) return null;

  if (pattern.risky) {
    return `# skipped risky Claude permission ${JSON.stringify(value)}; review before creating a prefix_rule`;
  }

  const decision = bucket === "deny" ? "forbidden" : bucket === "ask" ? "prompt" : "allow";
  return `prefix_rule(pattern=${JSON.stringify(pattern.parts)}, decision=${JSON.stringify(decision)}, justification=${JSON.stringify(`Migrated from Claude ${bucket} permission ${value}.`)})`;
}

function bashPattern(value) {
  if (value === "Bash") return { risky: true, parts: [] };
  const match = value.match(/^Bash\((.*)\)$/);
  if (!match) return null;

  const raw = match[1].trim().replace(/:\*$/, " *").replace(/\s+\*$/, "");
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { risky: true, parts };

  const riskyCommands = new Set(["bash", "zsh", "sh", "python", "python3", "node", "rm", "sudo", "chmod", "chown", "curl", "wget"]);
  return {
    risky: riskyCommands.has(parts[0]),
    parts
  };
}

function applyCodexNativeHookMapping(text, sourceValues, itemNames) {
  const hookLines = [];

  for (const itemName of itemNames) {
    const groups = sourceValues[itemName];
    if (!Array.isArray(groups)) continue;

    for (const group of groups) {
      const commandHooks = Array.isArray(group.hooks)
        ? group.hooks.filter((hook) => hook?.type === "command" && typeof hook.command === "string")
        : [];
      if (commandHooks.length === 0) continue;

      hookLines.push(`[[hooks.${itemName}]]`);
      if (typeof group.matcher === "string") {
        hookLines.push(`matcher = ${JSON.stringify(group.matcher)}`);
      }

      for (const hook of commandHooks) {
        hookLines.push(`[[hooks.${itemName}.hooks]]`);
        hookLines.push('type = "command"');
        hookLines.push(`command = ${JSON.stringify(hook.command)}`);
        if (Number.isInteger(hook.timeout)) hookLines.push(`timeout = ${hook.timeout}`);
        if (typeof hook.statusMessage === "string") {
          hookLines.push(`statusMessage = ${JSON.stringify(hook.statusMessage)}`);
        }
      }
    }
  }

  if (hookLines.length === 0) return text;

  const withFeature = setTomlTableBoolean(text, "features", "codex_hooks", true);
  return replaceTextBlock(withFeature, "native-hooks", hookLines.join("\n"));
}

function codexRulesPath(configPath) {
  return join(dirname(configPath), "rules/default.rules");
}

function mergeMcpIntoCodex(targetPath, sourcePath, sourceHost, serverNames) {
  const sourceServers = pickServers(sourceHost === "claude"
    ? readClaudeMcpServers(sourcePath)
    : readCodexMcpServers(sourcePath), serverNames);
  const targetServers = readCodexMcpServers(targetPath);
  const merged = { ...targetServers, ...sourceServers };
  const text = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";

  writeFileSync(targetPath, replaceTextBlock(text, "mcp-servers", renderCodexMcpServers(merged)));
}

function mergeMcpIntoClaude(targetPath, sourcePath, sourceHost, serverNames) {
  const sourceServers = pickServers(sourceHost === "codex"
    ? readCodexMcpServers(sourcePath)
    : readClaudeMcpServers(sourcePath), serverNames);
  const target = readJsonFile(targetPath, {});
  target.mcpServers = { ...(target.mcpServers ?? {}), ...sourceServers };
  writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`);
}

function pickServers(servers, names) {
  if (!names.length) return servers;
  return Object.fromEntries(Object.entries(servers).filter(([name]) => names.includes(name)));
}

function mcpPatchPreview(sourcePath, targetPath, sourceHost, targetHost, serverNames) {
  const sourceServers = sourceHost === "claude"
    ? readClaudeMcpServerDetails(sourcePath)
    : readCodexMcpServerDetails(sourcePath);
  const targetServers = targetHost === "claude"
    ? readClaudeMcpServerDetails(targetPath)
    : readCodexMcpServerDetails(targetPath);
  const selected = serverNames.length ? serverNames : Object.keys(sourceServers).sort();
  const patches = [];

  for (const name of selected) {
    const source = sourceServers[name];
    if (!source) continue;

    const target = targetServers[name];
    const changes = mcpServerChanges(source, target);
    if (changes.length === 0) continue;

    patches.push({
      server: name,
      action: target ? "update" : "add",
      changes
    });
  }

  return patches;
}

function mcpServerChanges(source, target) {
  const changes = [];

  for (const key of ["command", "url"]) {
    if (source[key] && source[key] !== target?.[key]) {
      changes.push(`${key}: ${JSON.stringify(source[key])}`);
    }
  }

  if (source.args?.length && JSON.stringify(source.args) !== JSON.stringify(target?.args ?? [])) {
    changes.push(`args: ${JSON.stringify(source.args)}`);
  }

  for (const [key, value] of Object.entries(source.env ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    if (target?.env?.[key] !== value) {
      changes.push(`env.${key}: ${JSON.stringify(value)}`);
    }
  }

  for (const key of source.secretEnvKeys ?? []) {
    changes.push(`metadata-only env.${key}: skipped secret-like value`);
  }

  return changes;
}

function readClaudeMcpServerDetails(path) {
  const data = readJsonFile(path, {});
  return normalizeMcpServerDetails(data.mcpServers ?? data.servers ?? {});
}

function readCodexMcpServerDetails(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const servers = {};
  const tablePattern = /^\[mcp_servers\.([^\].]+)\]\n([\s\S]*?)(?=^\[|$)/gm;

  for (const match of text.matchAll(tablePattern)) {
    const server = {};
    const body = match[2];
    const command = body.match(/^command\s*=\s*"([^"]*)"/m);
    const url = body.match(/^url\s*=\s*"([^"]*)"/m);
    const args = body.match(/^args\s*=\s*(\[.*\])/m);
    const env = body.match(/^env\s*=\s*(\{.*\})/m);

    if (command) server.command = command[1];
    if (url) server.url = url[1];
    if (args) server.args = parseJsonLike(args[1], []);
    if (env) server.env = parseInlineTomlObject(env[1]);
    servers[match[1]] = server;
  }

  return normalizeMcpServerDetails(servers);
}

function readClaudeMcpServers(path) {
  const data = readJsonFile(path, {});
  return normalizeMcpServers(data.mcpServers ?? data.servers ?? {});
}

function readCodexMcpServers(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  const servers = {};
  const tablePattern = /^\[mcp_servers\.([^\].]+)\]\n([\s\S]*?)(?=^\[|$)/gm;

  for (const match of text.matchAll(tablePattern)) {
    const server = {};
    const body = match[2];
    const command = body.match(/^command\s*=\s*"([^"]*)"/m);
    const url = body.match(/^url\s*=\s*"([^"]*)"/m);
    const args = body.match(/^args\s*=\s*(\[.*\])/m);
    const env = body.match(/^env\s*=\s*(\{.*\})/m);

    if (command) server.command = command[1];
    if (url) server.url = url[1];
    if (args) server.args = parseJsonLike(args[1], []);
    if (env) server.env = parseInlineTomlObject(env[1]);
    servers[match[1]] = server;
  }

  return normalizeMcpServers(servers);
}

function normalizeMcpServers(servers) {
  return Object.fromEntries(
    Object.entries(normalizeMcpServerDetails(servers)).map(([name, value]) => [name, {
      ...(value.command ? { command: value.command } : {}),
      ...(value.url ? { url: value.url } : {}),
      ...(value.args?.length ? { args: value.args } : {}),
      ...(value.env && Object.keys(value.env).length > 0 ? { env: value.env } : {})
    }])
  );
}

function normalizeMcpServerDetails(servers) {
  return Object.fromEntries(
    Object.entries(servers)
      .filter(([name, value]) => name && value && typeof value === "object")
      .map(([name, value]) => [name, {
        ...(typeof value.command === "string" ? { command: value.command } : {}),
        ...(typeof value.url === "string" ? { url: value.url } : {}),
        ...(Array.isArray(value.args) ? { args: value.args.filter((item) => typeof item === "string") } : {}),
        ...(value.env && typeof value.env === "object" ? { env: safeEnv(value.env) } : {}),
        ...(value.env && typeof value.env === "object" ? { secretEnvKeys: secretEnvKeys(value.env) } : {})
      }])
  );
}

function safeEnv(env) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => typeof value === "string" && !isSecretEnvKey(key))
  );
}

function isSecretEnvKey(key) {
  return /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key);
}

function secretEnvKeys(env) {
  return Object.keys(env).filter((key) => isSecretEnvKey(key)).sort();
}

function renderCodexMcpServers(servers) {
  const lines = [];

  for (const [name, server] of Object.entries(servers).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`[mcp_servers.${name}]`);
    if (server.command) lines.push(`command = ${JSON.stringify(server.command)}`);
    if (server.url) lines.push(`url = ${JSON.stringify(server.url)}`);
    if (server.args?.length) lines.push(`args = ${JSON.stringify(server.args)}`);
    if (server.env && Object.keys(server.env).length > 0) {
      lines.push(`env = { ${Object.entries(server.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(", ")} }`);
    }
  }

  return lines.join("\n");
}

function parseJsonLike(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseInlineTomlObject(value) {
  const env = {};
  for (const match of value.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/g)) {
    env[match[1]] = match[2];
  }
  return env;
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
  compareMcpServers(entries, scope, paths.claude.mcp, paths.codex.mcp);

  if (paths.claude.settings && paths.codex.settings) {
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
      mcp: `${home}/.codex/config.toml`,
      settings: `${home}/.codex/config.toml`
    }
  };
}

function projectPaths(root) {
  return {
    claude: {
      instructions: `${root}/CLAUDE.md`,
      skills: `${root}/.claude/skills`,
      mcp: firstExisting([`${root}/.claude/mcp.json`, `${root}/.mcp.json`]),
      settings: `${root}/.claude/settings.json`
    },
    codex: {
      instructions: `${root}/AGENTS.md`,
      skills: firstExisting([`${root}/.agents/skills`, `${root}/.codex/skills`]),
      mcp: `${root}/.codex/config.toml`,
      settings: `${root}/.codex/config.toml`
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
  const conflicts = claude
    .filter((name) => codex.includes(name))
    .filter((name) => directoryHash(join(claudeDir, name)) !== directoryHash(join(codexDir, name)));

  if (missingInCodex.length > 0 || missingInClaude.length > 0) {
    entries.push({
      scope,
      area: "skills",
      risk: "safe",
      summary: "skills missing in one host",
      claudePath: claudeDir,
      codexPath: codexDir,
      claude: `${claude.length} skill(s)`,
      codex: `${codex.length} skill(s)`,
      missingInCodex,
      missingInClaude
    });
  }

  if (conflicts.length > 0) {
    entries.push({
      scope,
      area: "skills",
      risk: "manual",
      summary: "skills conflict",
      claudePath: claudeDir,
      codexPath: codexDir,
      claude: `${claude.length} skill(s)`,
      codex: `${codex.length} skill(s)`,
      conflicts
    });
  }
}

function compareMcpServers(entries, scope, claudePath, codexPath) {
  const claudeServers = Object.keys(readClaudeMcpServers(claudePath)).sort();
  const codexServers = Object.keys(readCodexMcpServers(codexPath)).sort();
  const missingInCodex = claudeServers.filter((name) => !codexServers.includes(name));
  const missingInClaude = codexServers.filter((name) => !claudeServers.includes(name));

  if (missingInCodex.length === 0 && missingInClaude.length === 0) return;

  entries.push({
    scope,
    area: "mcp",
    risk: "safe",
    summary: "MCP servers differ",
    claudePath,
    codexPath,
    claude: `${claudeServers.length} server(s)`,
    codex: `${codexServers.length} server(s)`,
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
    for (const item of codexRulePermissionItems(codexRulesPath(path))) {
      items.push(item, item.replace(/^(allow|ask|deny):/, ""));
    }
    for (const item of codexMcpApprovalItems(text)) {
      items.push(item, item.replace(/^(allow|ask|deny):/, ""));
    }
  }

  if (area === "hooks") {
    for (const match of text.matchAll(/^\s*#\s*hooks\.([A-Za-z0-9_-]+)/gm)) {
      items.push(match[1]);
    }
    for (const match of text.matchAll(/^\s*\[\[hooks\.([A-Za-z0-9_-]+)\]\]/gm)) {
      items.push(match[1]);
    }
  }

  return uniqueStrings(items);
}

function codexRulePermissionItems(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const items = [];

  for (const match of text.matchAll(/prefix_rule\(pattern=(\[[^\)]*?\]),\s*decision="(allow|prompt|forbidden)"/g)) {
    const parts = parseJsonLike(match[1], []);
    if (!Array.isArray(parts) || parts.some((part) => typeof part !== "string")) continue;

    const bucket = match[2] === "forbidden" ? "deny" : match[2] === "prompt" ? "ask" : "allow";
    const value = `Bash(${parts.join(" ")}:*)`;
    items.push(`${bucket}:${value}`);
  }

  return items;
}

function codexMcpApprovalItems(text) {
  const items = [];
  const tablePattern = /^\[mcp_servers\.([^\].]+)\.tools\.([^\]]+)\]\n([\s\S]*?)(?=^\[|$)/gm;

  for (const match of text.matchAll(tablePattern)) {
    const approval = match[3].match(/^approval_mode\s*=\s*"([^"]+)"/m);
    if (!approval) continue;

    const bucket = approval[1] === "deny" ? "deny" : approval[1] === "prompt" ? "ask" : "allow";
    items.push(`${bucket}:mcp__${match[1].replaceAll("-", "_")}__${match[2]}`);
  }

  return items;
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

function directoryHash(path) {
  if (!existsSync(path)) return "missing";
  const hash = createHash("sha256");

  for (const file of directoryFiles(path)) {
    hash.update(file);
    hash.update(readFileSync(join(path, file)));
  }

  return hash.digest("hex").slice(0, 12);
}

function directoryFiles(root, prefix = "") {
  if (!existsSync(root)) return [];

  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(root, entry.name);

      if (entry.isDirectory()) {
        return directoryFiles(absolute, relative);
      }

      if (entry.isFile()) {
        return [relative];
      }

      return [];
    })
    .sort();
}

function label(area) {
  return area.replaceAll("-", " ");
}

function runConnect() {
  const state = connectState();
  const results = registerMissingIntegrations(state);
  const nextState = connectState();

  console.log("AI Config Sync Manager connect");
  console.log(`Runtime root: ${runtimeRoot}`);
  console.log(`Default root: ${formatPathState(nextState.defaultRoot)}`);
  console.log(`Claude plugin: ${nextState.claudePlugin ? formatPathState(nextState.claudePlugin) : "missing"}`);
  console.log(`Codex plugin: ${formatPathState(nextState.codexPlugin)}`);
  console.log(`Codex marketplace: ${formatPathState(nextState.codexMarketplace)}`);

  for (const result of results) {
    console.log(`${result.status}: ${result.message}`);
  }

  if (!existsSync(nextState.defaultRoot)) {
    console.log(`Action needed: link the default root with: ln -s "${runtimeRoot}" "${nextState.defaultRoot}"`);
  }

  if (!nextState.claudePlugin) {
    console.log("Action needed: install Claude plugin with /plugin install config-manager@ai-config-sync-manager");
  }

  if (!existsSync(nextState.codexPlugin) || !codexMarketplaceIncludes(nextState.codexMarketplace)) {
    console.log("Action needed: register Codex plugin in ~/.agents/plugins/marketplace.json");
  }
}

function connectState() {
  const codexPlugin = `${home}/plugins/ai-config-sync-manager`;

  return {
    defaultRoot: `${home}/.ai-config-sync-manager`,
    claudePlugin: findClaudePlugin(),
    claudePluginTarget: `${home}/.claude/plugins/config-manager@ai-config-sync-manager`,
    codexPlugin,
    codexMarketplace: `${home}/.agents/plugins/marketplace.json`
  };
}

function registerMissingIntegrations(state) {
  const results = [];

  tryConnectAction(results, "registered default root", () => {
    if (!existsSync(state.defaultRoot)) {
      mkdirSync(dirname(state.defaultRoot), { recursive: true });
      symlinkSync(runtimeRoot, state.defaultRoot, "dir");
    }
  });

  tryConnectAction(results, "registered Claude plugin", () => {
    if (!state.claudePlugin) {
      installClaudePlugin(state.claudePluginTarget);
    }
  });

  tryConnectAction(results, "registered Codex plugin", () => {
    if (!existsSync(state.codexPlugin)) {
      installCodexPlugin(state.codexPlugin);
    }

    if (!codexMarketplaceIncludes(state.codexMarketplace)) {
      updateCodexMarketplace(state.codexMarketplace, state.codexPlugin);
    }
  });

  return results;
}

function tryConnectAction(results, message, action) {
  try {
    action();
    results.push({ status: "ok", message });
  } catch (error) {
    results.push({
      status: "blocked",
      message: `${message}: ${error instanceof Error ? error.message : "unknown error"}`
    });
  }
}

function installClaudePlugin(targetPath) {
  copyPluginRoot("integrations/claude-plugin", targetPath);
  const installedPath = `${home}/.claude/plugins/installed_plugins.json`;
  const data = readJsonFile(installedPath, {});

  data.plugins ??= {};
  data.plugins["config-manager@ai-config-sync-manager"] = [
    {
      installPath: targetPath,
      source: "ai-config-sync-manager",
      version: "0.1.0"
    }
  ];

  mkdirSync(dirname(installedPath), { recursive: true });
  writeFileSync(installedPath, `${JSON.stringify(data, null, 2)}\n`);
}

function installCodexPlugin(targetPath) {
  copyPluginRoot("integrations/codex-plugin", targetPath);
}

function copyPluginRoot(integrationDir, targetPath) {
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(join(runtimeRoot, integrationDir), targetPath, { recursive: true, dereference: false });

  for (const name of ["bin", "packages", "schemas", "rules"]) {
    cpSync(join(runtimeRoot, name), join(targetPath, name), { recursive: true, dereference: false });
  }

  for (const name of ["package.json", "tsconfig.json", "tsconfig.check.json", "package-lock.json"]) {
    const source = join(runtimeRoot, name);
    if (existsSync(source)) copyFileSync(source, join(targetPath, name));
  }
}

function updateCodexMarketplace(path, pluginPath) {
  const data = readJsonFile(path, {});
  const plugins = Array.isArray(data.plugins) ? data.plugins : [];

  data.plugins = [
    ...plugins.filter((plugin) => plugin?.name !== "ai-config-sync-manager"),
    {
      name: "ai-config-sync-manager",
      version: "0.1.0",
      path: pluginPath,
      source: pluginPath
    }
  ];

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
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
