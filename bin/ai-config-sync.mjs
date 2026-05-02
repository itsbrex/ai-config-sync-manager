#!/usr/bin/env node

import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
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
  await main();
} catch (error) {
  process.exitCode = 1;
  console.error(error instanceof Error ? error.message : "Unknown CLI error");
}

async function main() {
  if (command === "connect") {
    if (isHelp(argv)) {
      printConnectHelp();
    } else {
      noOptions(argv, "connect");
      runConnect();
    }
  } else if (command === "status") {
    if (isHelp(argv)) {
      printStatusHelp();
    } else {
      const { format, json, scopes, selectors } = parseStatus(argv);
      const report = createStatusReport(scopes, selectors);
      console.log(
        json
          ? JSON.stringify(report, null, 2)
          : renderStatus(report, format)
      );
    }
  } else if (command === "sync") {
    if (isHelp(argv)) {
      printSyncHelp();
    } else {
      const options = parseSync(argv);
      const mode = options.apply ? "apply" : "dry-run";
      const plans = createSyncPlans(options, mode);
      if (mode === "apply") {
        for (const plan of plans) applySyncPlan(plan);
      }
      console.log(options.planJson ? JSON.stringify(formatPlanOutput(plans), null, 2) : renderSyncPlans(plans));
    }
  } else if (command === "reference") {
    if (isHelp(argv)) {
      printReferenceHelp();
    } else {
      const { output } = parseReference(argv);
      const markdown = generateReferenceMarkdown();
      if (output) {
        const resolved = resolve(expandHome(output));
        mkdirSync(dirname(resolved), { recursive: true });
        writeFileSync(resolved, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
        console.log(`Reference written to ${resolved}`);
      } else {
        console.log(markdown);
      }
    }
  } else {
    printHelp();
  }
}

function createSyncPlans(options, mode) {
  return options.scopes.map((scope) => createSyncPlan({ ...options, scope }, mode));
}

function formatPlanOutput(plans) {
  return plans.length === 1 ? plans[0] : {
    mode: plans[0]?.mode ?? "dry-run",
    scopes: plans.map((plan) => plan.scope),
    plans
  };
}

function parseStatus(argv) {
  let format = "default";
  let json = false;
  let scopes = ["global", "project"];
  const selectors = emptySelectors();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      json = true;
    } else if (token === "--compact") {
      format = "compact";
    } else if (token === "--tree") {
      format = "tree";
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

  return { format, json, scopes, selectors };
}

function defaultSyncDirection() {
  const sessionHost = process.env.AI_CONFIG_SYNC_HOST === "codex" ? "codex" : "claude";
  return sessionHost === "codex"
    ? { from: "codex", to: "claude" }
    : { from: "claude", to: "codex" };
}

function createStatusReport(scopes, selectors = emptySelectors()) {
  const direction = defaultSyncDirection();
  const ignoreSource = ignoreListSource();
  const ignoreRules = (ignoreSource.data?.exclude ?? []).filter(Boolean);
  const filtered = filterIgnoredEntries(filterEntries(
    scopes.flatMap((scope) => diffScope(scope, ignoreRules)),
    selectors
  ));
  const entries = filtered.entries;

  return {
    source: direction.from,
    target: direction.to,
    direction,
    scopes,
    include: renderSelectors(selectors.include),
    exclude: renderSelectors(selectors.exclude),
    statusIgnorePath: filtered.path,
    statusIgnoreRules: filtered.rules ?? [],
    statusIgnored: filtered.ignored,
    scaffold: false,
    entries,
    summary:
      entries.length === 0
        ? `No diff detected for ${scopes.join("+")} scope.`
        : `${entries.length} diff(s) detected for ${scopes.join("+")} scope.`
  };
}

function renderStatus(report, format = "default") {
  if (format === "compact") return renderCompactStatus(report);
  if (format === "tree") return renderTreeStatus(report);
  const detailPath = report.entries.length > 0 ? writeStatusDetailFile(report) : null;

  const lines = [
    "AI Config Sync Manager status",
    `Default sync direction: ${report.direction.from} -> ${report.direction.to} (override with --from/--to or AI_CONFIG_SYNC_HOST)`,
    `Scopes: ${report.scopes.join(", ")}`,
    `Include: ${report.include.length ? report.include.join(", ") : "all"}`,
    `Exclude: ${report.exclude.length ? report.exclude.join(", ") : "none"}`,
    formatStatusIgnoreLine(report.statusIgnorePath, report.statusIgnoreRules, report.statusIgnored),
    report.summary
  ];

  if (report.entries.length > 0) {
    lines.push("");
    lines.push(renderStatusResult(report.entries, report.statusIgnoreRules ?? []));
    lines.push("");
    lines.push("Diff status:");
    lines.push(renderDiffStatus(report.entries, report.statusIgnoreRules ?? []));
    lines.push("");
    if (detailPath) {
      lines.push(`Detail file: ${detailPath}`);
      lines.push("Open the detail file for the full item list and before/after diff preview.");
      lines.push("");
    }
    lines.push("Run a listed command with --dry-run first when risk is manual.");
  }

  return lines.join("\n");
}

function renderStatusList(entries, ignoreRules = []) {
  const rows = statusTableRows(entries, ignoreRules);
  return rows.map((row, index) => [
    `${index + 1}. ${row.scope}/${row.area} [${row.risk}]`,
    `   change: ${row.change}`,
    `   item: ${row.item}`,
    `   details: ${row.details}`,
    `   action: ${row.action}`,
    `   apply: ${row.command}`
  ].join("\n")).join("\n\n");
}

function renderStatusResult(entries, ignoreRules = []) {
  const rows = statusTableRows(entries, ignoreRules);
  const safeCount = rows.filter((row) => row.risk === "safe").length;
  const manualCount = rows.filter((row) => row.risk !== "safe").length;

  return [
    "Result:",
    `  - ${safeCount} safe item(s)`,
    `  - ${manualCount} manual-risk item(s)`
  ].join("\n");
}

function renderDiffStatus(entries, ignoreRules = []) {
  const rows = statusTableRows(entries, ignoreRules);
  const groups = [
    ["claude", rows.filter((row) => row.target === "claude")],
    ["codex", rows.filter((row) => row.target === "codex")],
    ["review", rows.filter((row) => row.target === "review")]
  ].filter(([, groupRows]) => groupRows.length > 0);

  return groups.map(([target, groupRows]) => [
    `  ${target}:`,
    ...renderDiffStatusRows(groupRows)
  ].join("\n")).join("\n");
}

function renderDiffStatusRows(rows) {
  return groupRowsForDisplay(rows).flatMap((group) => {
    if (group.rows.length < 10) return group.rows.map(renderDiffStatusRow);
    return [renderDiffStatusSummaryRow(group)];
  });
}

function groupRowsForDisplay(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.scope}/${row.area}`;
    const group = groups.get(key) ?? { scope: row.scope, area: row.area, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function renderDiffStatusSummaryRow(group) {
  const counts = countRowSymbols(group.rows);
  const risk = group.rows.some((row) => row.risk !== "safe") ? "manual-risk" : "safe";
  return [
    `    - ${group.scope}/${group.area}: ${formatSymbolCounts(counts)} (${group.rows.length} diff(s), ${risk})`,
    "      details: hidden because this area has 10+ item diffs; see detail file for all items and before/after previews",
    `      apply: ai-config-sync sync --scope ${group.scope} --include ${group.area} --apply`
  ].join("\n");
}

function countRowSymbols(rows) {
  return rows.reduce((counts, row) => {
    counts[row.symbol] = (counts[row.symbol] ?? 0) + 1;
    return counts;
  }, {});
}

function formatSymbolCounts(counts) {
  return ["+", "-", "~", "!"]
    .filter((symbol) => counts[symbol])
    .map((symbol) => `${symbol}${counts[symbol]}`)
    .join(", ");
}

function formatIgnoreRule(rule) {
  if (typeof rule === "string") return rule;
  if (rule && typeof rule === "object") return JSON.stringify(rule);
  return String(rule);
}

function formatIgnoreRulesSegment(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return "";
  return ` rules: [${rules.map(formatIgnoreRule).join(", ")}]`;
}

function formatStatusIgnoreLine(path, rules, ignored) {
  return `Status ignore: ${path}${formatIgnoreRulesSegment(rules)} (${ignored} hidden)`;
}

function formatPlanIgnoreLine(path, rules, ignored) {
  return `Ignore: ${path}${formatIgnoreRulesSegment(rules)} (${ignored} hidden)`;
}

function formatCompactIgnoreSegment(rules, ignored) {
  const parts = [];
  if (Array.isArray(rules) && rules.length > 0) {
    parts.push(`ignore_rules=${rules.map(formatIgnoreRule).join(",")}`);
  }
  if (typeof ignored === "number" && ignored > 0) {
    parts.push(`hidden=${ignored}`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function renderDiffStatusRow(row) {
  const lines = [
    `    - ${row.scope}/${row.area}: ${row.symbol}${row.item} (${row.change}, ${row.risk})`,
    `      details: ${row.details}`,
    `      action: ${row.action}`,
    `      apply: ${row.command}`
  ];

  if (row.preview?.length) {
    lines.push("      diff:");
    for (const line of row.preview) lines.push(`        ${line}`);
  }

  return lines.join("\n");
}

function writeStatusDetailFile(report) {
  const detailPath = statusDetailPath();
  const rows = statusTableRows(report.entries, report.statusIgnoreRules ?? []);
  const lines = [
    "AI Config Sync Manager status detail",
    `Default sync direction: ${report.direction.from} -> ${report.direction.to}`,
    `Scopes: ${report.scopes.join(", ")}`,
    `Include: ${report.include.length ? report.include.join(", ") : "all"}`,
    `Exclude: ${report.exclude.length ? report.exclude.join(", ") : "none"}`,
    report.summary,
    ""
  ];

  for (const [target, targetRows] of [
    ["claude", rows.filter((row) => row.target === "claude")],
    ["codex", rows.filter((row) => row.target === "codex")],
    ["review", rows.filter((row) => row.target === "review")]
  ]) {
    if (targetRows.length === 0) continue;
    lines.push(`${target}:`);
    for (const row of targetRows) {
      lines.push(renderDiffStatusRow(row).replace(/^    /gm, "  "));
    }
    lines.push("");
  }

  mkdirSync(dirname(detailPath), { recursive: true });
  writeFileSync(detailPath, `${lines.join("\n").trimEnd()}\n`);
  return detailPath;
}

function statusDetailPath() {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return `${home}/.ai-config-sync-manager/status-details/${stamp}.txt`;
}

function statusTableRows(entries, ignoreRules = []) {
  return entries.flatMap((entry) => {
    const rows = [];

    for (const item of entry.unsupported ?? []) {
      rows.push(statusTableRow(entry, "unsupported", item, "manual review", ignoreRules));
    }

    for (const item of entry.missingInCodex ?? []) {
      rows.push(statusTableRow(entry, "missing in Codex", item, statusAction(entry, "codex"), ignoreRules));
    }

    for (const item of entry.missingInClaude ?? []) {
      rows.push(statusTableRow(entry, "missing in Claude", item, statusAction(entry, "claude"), ignoreRules));
    }

    for (const item of entry.conflicts ?? []) {
      rows.push(statusTableRow(entry, "conflict", item, "sync area", ignoreRules));
    }

    if (rows.length === 0) {
      rows.push(statusTableRow(entry, "content differs", entry.area, "sync area", ignoreRules));
    }

    return rows;
  });
}

function statusTableRow(entry, change, item, action, ignoreRules = []) {
  const selector = statusSelector(entry.area, item);
  const command = action === "manual review"
    ? "manual review"
    : `ai-config-sync sync --scope ${entry.scope} --include ${shellQuote(selector)} --apply`;

  return {
    scope: entry.scope,
    area: entry.area,
    risk: entry.risk,
    change,
    item: statusDisplayItem(entry, item),
    action,
    command,
    details: statusDetails(entry, change),
    preview: statusPreview(entry, change, item, ignoreRules),
    target: statusTarget(change, action),
    symbol: statusSymbol(change, action)
  };
}

function statusDisplayItem(entry, item) {
  const quality = entry.itemQualities?.[item] ?? entry.itemQualities?.[item.replace(/^(allow|ask|deny):/, "")] ?? entry.mappingQuality;
  return quality ? `${item} [${quality}]` : item;
}

function statusTarget(change, action) {
  if (action === "copy Claude -> Codex" || action === "delete from Codex") return "codex";
  if (action === "copy Codex -> Claude" || action === "delete from Claude") return "claude";
  if (change === "missing in Codex") return "codex";
  if (change === "missing in Claude") return "claude";
  return "review";
}

function statusSymbol(change, action) {
  if (action.startsWith("copy ")) return "+";
  if (action.startsWith("delete ")) return "-";
  if (change === "conflict" || change === "unsupported") return "!";
  return "~";
}

function statusDetails(entry, change) {
  const { from, to } = defaultSyncDirection();
  const fromLabel = from === "claude" ? "Claude" : "Codex";
  const toLabel = to === "claude" ? "Claude" : "Codex";
  if (change === "unsupported") return `Skill symlink is unsupported and excluded from sync. Claude: ${statusPathSummary(entry, "claude")}; Codex: ${statusPathSummary(entry, "codex")}`;
  if (change === "missing in Codex") return `Claude has it; Codex missing. Claude: ${statusPathSummary(entry, "claude")} -> Codex: ${statusPathSummary(entry, "codex")}`;
  if (change === "missing in Claude") return `Codex has it; Claude missing. Codex: ${statusPathSummary(entry, "codex")} -> Claude: ${statusPathSummary(entry, "claude")}`;
  if (change === "conflict") return `Both hosts have this item with different content. Default sync updates ${toLabel} from ${fromLabel}. Claude: ${statusPathSummary(entry, "claude")}; Codex: ${statusPathSummary(entry, "codex")}`;
  return `Default sync updates ${toLabel} from ${fromLabel}. Claude: ${statusPathSummary(entry, "claude")} (${entry.claude}); Codex: ${statusPathSummary(entry, "codex")} (${entry.codex})`;
}

function statusPreview(entry, change, item, ignoreRules = []) {
  const { from, to } = defaultSyncDirection();
  const fromLabel = from === "claude" ? "Claude" : "Codex";
  const toLabel = to === "claude" ? "Claude" : "Codex";
  const terms = entryMaskTerms(entry, item, ignoreRules);

  if (change === "content differs" && entry.area === "instructions") {
    const targetContent = to === "claude" ? entry.claudeInstructionContent : entry.codexInstructionContent;
    const sourceContent = from === "claude" ? entry.claudeInstructionContent : entry.codexInstructionContent;
    return contentChangePreview(
      `${toLabel} current`,
      targetContent ?? "",
      `After apply from ${fromLabel}`,
      transformTextForHost(sourceContent ?? "", from, to),
      terms
    );
  }

  if (change === "conflict" && entry.area === "skills") {
    const targetContent = skillPreviewContent(to === "claude" ? entry.claudePath : entry.codexPath, item);
    const sourceContent = transformTextForHost(
      skillPreviewContent(from === "claude" ? entry.claudePath : entry.codexPath, item),
      from,
      to
    );
    return contentChangePreview(`${toLabel} current`, targetContent, `After apply from ${fromLabel}`, sourceContent, terms);
  }

  if (change === "conflict" && entry.area === "agents") {
    const targetPath = to === "claude" ? entry.claudeAgentPaths?.[item] : entry.codexAgentPaths?.[item];
    const sourcePath = from === "claude" ? entry.claudeAgentPaths?.[item] : entry.codexAgentPaths?.[item];
    const targetContent = agentPreviewContentFromPath(targetPath, to);
    const rawSource = agentPreviewContentFromPath(sourcePath, from);
    const sourceContent = from === "claude"
      ? transformTextForHost(rawSource, "claude", "codex")
      : transformTextForHost(stripAgentMigrationPreamble(rawSource), "codex", "claude");
    return contentChangePreview(`${toLabel} current`, targetContent, `After apply from ${fromLabel}`, sourceContent, terms);
  }

  return [];
}

function entryMaskTerms(entry, item, ignoreRules) {
  if (!Array.isArray(ignoreRules) || ignoreRules.length === 0) return [];
  return uniqueStrings([
    ...applicableTermRules(ignoreRules, entry, item, "claude"),
    ...applicableTermRules(ignoreRules, entry, item, "codex")
  ]);
}

function statusPathSummary(entry, host) {
  if (host === "claude") {
    return instructionPathSummary(entry.claudeInstructionPaths, entry.claudeInstructionCheckedPaths)
      ?? firstClaudeMcpDisplayPath(entry.claudeMcpPaths)
      ?? entry.claudePath;
  }

  const base = instructionPathSummary(entry.codexInstructionPaths, entry.codexInstructionCheckedPaths)
    ?? firstStatusPath(entry.codexMcpPaths)
    ?? entry.codexPath;

  if (entry.area === "permissions" && entry.codexPath && permissionItemsTouchRules(entry)) {
    return `${base} + ${codexRulesPath(entry.codexPath)}`;
  }

  return base;
}

function permissionItemsTouchRules(entry) {
  const buckets = [entry.missingInCodex, entry.missingInClaude, entry.conflicts];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const itemName of bucket) {
      if (typeof itemName !== "string") continue;
      const { bucket: permBucket, value } = parsePermissionItem(itemName);
      if (codexPrefixRuleForPermission(permBucket, value)) return true;
    }
  }
  return false;
}

function instructionPathSummary(sourcePaths, checkedPaths) {
  if (!Array.isArray(checkedPaths) || checkedPaths.length === 0) return firstStatusPath(sourcePaths);
  const sources = Array.isArray(sourcePaths) && sourcePaths.length > 0
    ? sourcePaths.join(", ")
    : "none";
  return `sources: ${sources}; checked: ${checkedPaths.join(", ")}`;
}

function firstStatusPath(paths) {
  return Array.isArray(paths) && paths.length > 0 ? paths[0] : null;
}

function statusAction(entry, missingTarget) {
  const { from, to } = defaultSyncDirection();
  if (missingTarget === to) {
    return `copy ${toLabel(from)} -> ${toLabel(to)}`;
  }
  return `delete from ${toLabel(to)}`;
}

function statusSelector(area, item) {
  if (!item || item === area) return area;
  return `${area}:${item}`;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function renderCompactStatus(report) {
  const lines = [
    `status: ${report.summary}`,
    `direction=${report.direction.from}->${report.direction.to} scopes=${report.scopes.join(",")} include=${report.include.length ? report.include.join(",") : "all"} exclude=${report.exclude.length ? report.exclude.join(",") : "none"}${formatCompactIgnoreSegment(report.statusIgnoreRules, report.statusIgnored)}`
  ];

  for (const entry of report.entries) {
    lines.push(`${entry.scope}/${entry.area} [${entry.risk}] ${statusItems(entry).join("; ")}`);
  }

  return lines.join("\n");
}

function renderTreeStatus(report) {
  const lines = [
    "AI Config Sync Manager status",
    `Default sync direction: ${report.direction.from} -> ${report.direction.to}`
  ];

  const hasIgnoreRules = Array.isArray(report.statusIgnoreRules) && report.statusIgnoreRules.length > 0;
  const hasHidden = typeof report.statusIgnored === "number" && report.statusIgnored > 0;
  if (report.statusIgnorePath && (hasIgnoreRules || hasHidden)) {
    lines.push(formatStatusIgnoreLine(report.statusIgnorePath, report.statusIgnoreRules, report.statusIgnored));
  }

  lines.push(report.summary);

  for (const [scope, scopeEntries] of groupBy(report.entries, "scope")) {
    lines.push(`${scope}/`);

    for (const [area, areaEntries] of groupBy(scopeEntries, "area")) {
      lines.push(`  ${area}/`);

      for (const entry of areaEntries) {
        lines.push(`    [${entry.risk}] ${entry.summary}`);
        for (const item of statusItems(entry)) {
          lines.push(`      ${item}`);
        }
      }
    }
  }

  return lines.join("\n");
}

function statusItems(entry) {
  if (entry.missingInCodex || entry.missingInClaude || entry.conflicts) {
    return [
      ...(entry.missingInCodex ?? []).map((name) => `missing-in-codex: ${formatQualityItem(entry, name)} | details: ${statusDetails(entry, "missing in Codex")}`),
      ...(entry.missingInClaude ?? []).map((name) => `missing-in-claude: ${formatQualityItem(entry, name)} | details: ${statusDetails(entry, "missing in Claude")}`),
      ...(entry.conflicts ?? []).map((name) => `conflict: ${formatQualityItem(entry, name)} | details: ${statusDetails(entry, "conflict")}`)
    ];
  }

  return [`${entry.area}: claude=${entry.claude}, codex=${entry.codex} [${entry.mappingQuality ?? "unsupported"}] | details: ${statusDetails(entry, "content differs")}`];
}

function formatQualityItem(entry, item) {
  const quality = entry.itemQualities?.[item] ?? entry.itemQualities?.[item.replace(/^(allow|ask|deny):/, "")];
  return quality ? `${item} [${quality}]` : item;
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

function filterIgnoredEntries(entries) {
  const source = ignoreListSource();
  const rules = Array.isArray(source.data.exclude) ? source.data.exclude : [];
  if (rules.length === 0) return { entries, ignored: 0, path: source.path, rules: [] };

  let ignored = 0;
  const filteredEntries = [];

  for (const entry of entries) {
    const filtered = filterIgnoredEntry(entry, rules);
    if (!filtered) {
      ignored += entryItems(entry).length;
    } else {
      ignored += entryItems(entry).length - entryItems(filtered).length;
      filteredEntries.push(filtered);
    }
  }

  return { entries: filteredEntries, ignored, path: source.path, rules };
}

function filterIgnoredEntry(entry, rules) {
  if (!entry.missingInCodex && !entry.missingInClaude && !entry.conflicts && !entry.unsupported) {
    return ignoreRulesMatchEntry(rules, entry, entry.area) ? null : entry;
  }

  const filtered = { ...entry };
  filtered.unsupported = (entry.unsupported ?? []).filter((item) => !ignoreRulesMatchEntry(rules, entry, item));
  filtered.missingInCodex = (entry.missingInCodex ?? []).filter((item) => !ignoreRulesMatchEntry(rules, entry, item));
  filtered.missingInClaude = (entry.missingInClaude ?? []).filter((item) => !ignoreRulesMatchEntry(rules, entry, item));
  filtered.conflicts = (entry.conflicts ?? []).filter((item) => !ignoreRulesMatchEntry(rules, entry, item));
  filtered.itemQualities = filterItemQualities(entry.itemQualities ?? {}, [
    ...filtered.unsupported,
    ...filtered.missingInCodex,
    ...filtered.missingInClaude,
    ...filtered.conflicts
  ]);

  if (
    filtered.unsupported.length === 0
    && filtered.missingInCodex.length === 0
    && filtered.missingInClaude.length === 0
    && filtered.conflicts.length === 0
  ) return null;
  return filtered;
}

function ignoreRulesMatchEntry(rules, entry, item) {
  return rules.some((rule) => ignoreRuleMatchesEntry(rule, entry, item));
}

function ignoreRuleMatchesEntry(rule, entry, item) {
  const normalized = normalizeIgnoreRule(rule);
  if (!normalized) return false;
  // term-bearing rules are line-level masks applied during compare, not entry-level ignores.
  if (normalized.term) return false;
  if (!ignoreRuleScopeMatchesEntry(normalized, entry, item)) return false;
  if (!normalized.path) return true;
  const paths = entryRulePaths(entry, item, normalized.host);
  return paths.some((path) => pathMatchesIgnoreRule(path, normalized.path));
}

function ignoreRuleScopeMatchesEntry(normalized, entry, item) {
  if (normalized.scope && normalized.scope !== entry.scope) return false;
  if (normalized.area && normalized.area !== entry.area) return false;
  if (normalized.item && !itemMatchesSelector(item, normalized.item)) return false;
  if (normalized.host && normalized.host !== "claude" && normalized.host !== "codex") return false;
  return true;
}

function applicableTermRules(rules, entry, item, host) {
  if (!Array.isArray(rules) || rules.length === 0) return [];
  const terms = [];
  for (const rule of rules) {
    const normalized = normalizeIgnoreRule(rule);
    if (!normalized || !normalized.term) continue;
    if (normalized.host && host && normalized.host !== host) continue;
    if (!ignoreRuleScopeMatchesEntry(normalized, entry, item)) continue;
    if (normalized.path) {
      const paths = entryRulePaths(entry, item, normalized.host || host);
      if (!paths.some((path) => pathMatchesIgnoreRule(path, normalized.path))) continue;
    }
    terms.push(normalized.term);
  }
  return uniqueStrings(terms);
}

function maskLinesContaining(content, terms) {
  if (!terms || terms.length === 0) return content;
  if (typeof content !== "string") return content;
  return content
    .split("\n")
    .filter((line) => !terms.some((term) => term && line.includes(term)))
    .join("\n");
}

function expandTermsBothDirections(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return [];
  const set = new Set();
  for (const term of terms) {
    if (typeof term !== "string" || !term) continue;
    set.add(term);
    const forward = transformTextForHost(term, "claude", "codex");
    if (typeof forward === "string" && forward && forward !== term) set.add(forward);
    const reverse = transformTextForHost(term, "codex", "claude");
    if (typeof reverse === "string" && reverse && reverse !== term) set.add(reverse);
  }
  return Array.from(set);
}

function normalizeIgnoreRule(rule) {
  if (typeof rule === "string" && rule.trim()) return parseIgnoreStringRule(rule.trim());
  if (!rule || typeof rule !== "object") return null;
  return {
    scope: typeof rule.scope === "string" ? rule.scope : null,
    area: typeof rule.area === "string" ? rule.area : null,
    item: typeof rule.item === "string" ? rule.item : null,
    host: typeof rule.host === "string" ? rule.host : null,
    path: typeof rule.path === "string" ? rule.path : null,
    term: typeof rule.term === "string" ? rule.term : null
  };
}

function parseIgnoreStringRule(value) {
  const selector = value.includes(":") && !value.includes("/") ? parseSelector(value) : null;
  return selector
    ? { scope: null, area: selector.area, item: selector.item, host: null, path: null, term: null }
    : { scope: null, area: null, item: null, host: null, path: value, term: null };
}

function entryRulePaths(entry, item, host) {
  const paths = [];
  const claudeMcpFiles = (entry.claudeMcpPaths ?? []).map(claudeMcpSourceFile);
  if (!host || host === "claude") {
    paths.push(entry.claudePath, ...(entry.claudeInstructionPaths ?? []), ...(entry.claudeInstructionCheckedPaths ?? []), ...claudeMcpFiles);
    if (entry.area === "skills" && item) paths.push(join(entry.claudePath, item), join(entry.claudePath, item, "SKILL.md"));
    if (entry.area === "agents" && item) paths.push(join(entry.claudePath, `${item}.md`));
  }
  if (!host || host === "codex") {
    paths.push(entry.codexPath, ...(entry.codexInstructionPaths ?? []), ...(entry.codexInstructionCheckedPaths ?? []), ...(entry.codexMcpPaths ?? []));
    if (entry.area === "skills" && item) paths.push(join(entry.codexPath, item), join(entry.codexPath, item, "SKILL.md"));
    if (entry.area === "agents" && item) {
      const flat = item.includes("/") ? item.split("/").pop() : item;
      paths.push(join(entry.codexPath, `${flat}.toml`));
    }
  }
  return uniqueStrings(paths.filter(Boolean));
}

function pathMatchesIgnoreRule(path, pattern) {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedPattern = expandHome(pattern).replaceAll("\\", "/");
  if (normalizedPath === normalizedPattern || normalizedPath.endsWith(normalizedPattern)) return true;
  if (!/[*?]/.test(normalizedPattern)) return false;
  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function expandHome(value) {
  return value.startsWith("~/") ? `${home}/${value.slice(2)}` : value;
}

function globToRegExp(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        pattern += ".*";
        index += 1;
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += escapeRegExp(char);
    }
  }
  return new RegExp(`^${pattern}$`);
}

function ignoreListSource() {
  for (const path of ignoreListCandidates()) {
    if (existsSync(path)) return { path, data: readJsonFile(path, { exclude: [] }) };
  }
  return { path: projectIgnoreListPath(), data: { exclude: [] } };
}

function ignoreListCandidates() {
  return [
    projectIgnoreListPath(),
    `${home}/.ai-config-sync-manager/rules/status-ignore.json`
  ];
}

function projectIgnoreListPath() {
  return join(resolve(process.cwd()), ".ai-config-sync-manager/status-ignore.json");
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
  return entryItems(entry).some((item) => itemMatchesSelector(item, selector.item));
}

function filterEntryItems(entry, selectors) {
  if (!entry.missingInCodex && !entry.missingInClaude && !entry.conflicts && !entry.unsupported) return entry;

  const includes = selectors.include.filter((selector) => selector.area === entry.area && selector.item);
  const excludes = selectors.exclude.filter((selector) => selector.area === entry.area && selector.item);
  const includeItems = includes.map((selector) => selector.item);
  const excludeItems = excludes.map((selector) => selector.item);
  const filtered = { ...entry };

  filtered.unsupported = filterItems(entry.unsupported ?? [], includeItems, excludeItems);
  filtered.missingInCodex = filterItems(entry.missingInCodex ?? [], includeItems, excludeItems);
  filtered.missingInClaude = filterItems(entry.missingInClaude ?? [], includeItems, excludeItems);
  filtered.conflicts = filterItems(entry.conflicts ?? [], includeItems, excludeItems);
  filtered.itemQualities = filterItemQualities(entry.itemQualities ?? {}, [
    ...filtered.unsupported,
    ...filtered.missingInCodex,
    ...filtered.missingInClaude,
    ...filtered.conflicts
  ]);

  if (
    filtered.unsupported.length === 0
    && filtered.missingInCodex.length === 0
    && filtered.missingInClaude.length === 0
    && filtered.conflicts.length === 0
  ) return null;
  return filtered;
}

function filterItemQualities(itemQualities, items) {
  return Object.fromEntries(
    Object.entries(itemQualities).filter(([item]) => items.some((selected) => itemMatchesSelector(item, selected)))
  );
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
  if (entry.missingInCodex || entry.missingInClaude || entry.conflicts || entry.unsupported) {
    return [...(entry.unsupported ?? []), ...(entry.missingInCodex ?? []), ...(entry.missingInClaude ?? []), ...(entry.conflicts ?? [])];
  }

  return [entry.area];
}

function directionalItems(entry, to) {
  if (to === "codex") return entry.missingInCodex ?? [];
  if (to === "claude") return entry.missingInClaude ?? [];
  return entryItems(entry);
}

function createSyncPlan(options, mode) {
  const ignoreSource = ignoreListSource();
  const ignoreRules = (ignoreSource.data?.exclude ?? []).filter(Boolean);
  const filtered = filterIgnoredEntries(filterEntries(diffScope(options.scope, ignoreRules), options.selectors));
  const entries = filtered.entries;
  const baseline = readSyncState(options.scope);
  const callArchive = [];
  const operationOptions = { ...options, callArchive, ignoreRules: filtered.rules ?? [] };
  const operations = entries.flatMap((entry) => createOperations(entry, operationOptions)).filter(Boolean);
  const backupRoot = `${home}/.ai-config-sync-manager/backups/${new Date().toISOString().replaceAll(":", "-")}`;

  return {
    from: options.from,
    to: options.to,
    route: options.routeExplicit ? "explicit" : "auto",
    scope: options.scope,
    mode,
    statePath: syncStatePath(options.scope),
    hasBaseline: Boolean(baseline),
    include: renderSelectors(options.selectors.include),
    exclude: renderSelectors(options.selectors.exclude),
    ignorePath: filtered.path,
    ignoreRules: filtered.rules ?? [],
    ignored: filtered.ignored,
    canApply: true,
    backupRoot,
    callArchive,
    callArchivePath: join(backupRoot, "unsupported-calls.json"),
    operations,
    results: []
  };
}

function createOperations(entry, options) {
  if (entry.statusOnly) return [];

  const { from, to } = options;
  const missingInTarget = to === "codex" ? entry.missingInCodex ?? [] : entry.missingInClaude ?? [];
  const missingInSource = to === "codex" ? entry.missingInClaude ?? [] : entry.missingInCodex ?? [];
  const conflicts = entry.conflicts ?? [];
  const operations = [];

  if (missingInTarget.length > 0) {
    operations.push(createOperationForItems(entry, from, to, missingInTarget, options));
  }

  if (missingInSource.length > 0) {
    operations.push(createDeleteOperation(entry, from, to, missingInSource, options));
  }

  if (conflicts.length > 0 || operations.length === 0) {
    operations.push(createOperation(entry, from, to, options));
  }

  return operations;
}

function createOperationForItems(entry, from, to, itemNames, options) {
  const scoped = {
    ...entry,
    missingInCodex: to === "codex" ? itemNames : [],
    missingInClaude: to === "claude" ? itemNames : []
  };
  return createOperation(scoped, from, to, options);
}

function createDeleteOperation(entry, from, to, itemNames, options) {
  const deletableAreas = ["mcp", "permissions", "hooks", "skills", "agents"];
  if (!deletableAreas.includes(entry.area)) {
    return {
      scope: entry.scope,
      area: entry.area,
      risk: "manual",
      action: "delete-items",
      from,
      to,
      itemNames,
      backupRequired: true,
      approvalRequired: true
    };
  }

  const targetPath = to === "claude" ? entry.claudePath : entry.codexPath;
  const sourcePath = from === "claude" ? entry.claudePath : entry.codexPath;
  const skillTargetIndex = entry.area === "skills"
    ? (to === "claude" ? entry.claudeSkillIndex ?? {} : entry.codexSkillIndex ?? {})
    : undefined;
  return {
    scope: entry.scope,
    area: entry.area,
    risk: entry.risk,
    action: "delete-items",
    from,
    to,
    sourcePath,
    targetPath,
    sourceMcpPaths: from === "claude" ? entry.claudeMcpPaths : entry.codexMcpPaths,
    targetMcpPaths: to === "claude" ? entry.claudeMcpPaths : entry.codexMcpPaths,
    itemNames,
    serverNames: entry.area === "mcp" ? itemNames : undefined,
    skillNames: entry.area === "skills" ? itemNames : undefined,
    skillTargetIndex,
    agentNames: entry.area === "agents" ? itemNames : undefined,
    itemQualities: operationItemQualities(entry, itemNames),
    backupRequired: true,
    approvalRequired: false
  };
}

function createOperation(entry, from, to, options = {}) {
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
      itemQualities: operationItemQualities(entry, itemNames),
      patchPreview: settingsItemPatchPreview(entry.area, from, to, sourcePath, itemNames),
      reviewNotes: entry.area === "permissions" ? permissionReviewNotes(itemNames) : [],
      backupRequired: true,
      approvalRequired: false
    };
  }

  if (entry.area === "mcp") {
    const sourceMcpPaths = from === "claude" ? entry.claudeMcpPaths ?? [sourcePath] : entry.codexMcpPaths ?? [sourcePath];
    const targetMcpPaths = to === "claude" ? entry.claudeMcpPaths ?? [targetPath] : entry.codexMcpPaths ?? [targetPath];

    if (!mcpSourceExists(sourceMcpPaths)) {
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
      sourceMcpPaths,
      targetMcpPaths,
      serverNames: directionalItems(entry, to),
      itemQualities: operationItemQualities(entry, directionalItems(entry, to)),
      patchPreview: mcpPatchPreview(sourceMcpPaths, targetMcpPaths, from, to, directionalItems(entry, to)),
      backupRequired: true,
      approvalRequired: false
    };
  }

  if (entry.area === "instructions") {
    const instructionContent = transformTextForHost(
      from === "claude" ? entry.claudeInstructionContent : entry.codexInstructionContent,
      from,
      to,
      { callArchive: options.callArchive }
    );
    if (!existsSync(sourcePath) && !instructionContent) {
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
      action: instructionContent ? "write-instructions" : "copy-file",
      sourcePath,
      targetPath,
      content: instructionContent,
      termMappingPath: terminologyMapPath(),
      targetTemplatePath: targetTemplatePath(),
      changePreview: contentChangePreview(
        `${toLabel(to)} current`,
        to === "claude" ? entry.claudeInstructionContent ?? "" : entry.codexInstructionContent ?? "",
        `After apply from ${fromLabel(from)}`,
        instructionContent ?? fileText(sourcePath),
        entryMaskTerms(entry, entry.area, options.ignoreRules ?? [])
      ),
      backupRequired: true,
      approvalRequired: false
    };
  }

  if (entry.area === "skills") {
    const missing = to === "claude" ? entry.missingInClaude ?? [] : entry.missingInCodex ?? [];
    const conflicts = entry.conflicts ?? [];
    const skillNames = [...missing, ...conflicts];
    const sourceIndex = from === "claude" ? entry.claudeSkillIndex ?? {} : entry.codexSkillIndex ?? {};
    return {
      scope: entry.scope,
      area: entry.area,
      risk: entry.risk,
      action: "copy-missing-skills",
      from,
      to,
      sourcePath,
      targetPath,
      skillNames,
      skillSourceIndex: sourceIndex,
      overwriteSkillNames: conflicts,
      itemQualities: operationItemQualities(entry, skillNames),
      termMappingPath: terminologyMapPath(),
      targetTemplatePath: targetTemplatePath(),
      changePreview: skillChangePreview(sourcePath, targetPath, conflicts, from, sourceIndex, entry, options.ignoreRules ?? []),
      backupRequired: true,
      approvalRequired: false
    };
  }

  if (entry.area === "agents") {
    const missing = to === "claude" ? entry.missingInClaude ?? [] : entry.missingInCodex ?? [];
    const conflicts = entry.conflicts ?? [];
    const agentNames = [...missing, ...conflicts];
    if (agentNames.length === 0) return null;

    return {
      scope: entry.scope,
      area: entry.area,
      risk: entry.risk,
      action: "merge-agents",
      from,
      to,
      sourcePath,
      targetPath,
      agentNames,
      overwriteAgentNames: conflicts,
      itemQualities: operationItemQualities(entry, agentNames),
      agentsMapPath: agentsMapPath(),
      termMappingPath: terminologyMapPath(),
      targetTemplatePath: targetTemplatePath(),
      changePreview: agentChangePreview(sourcePath, targetPath, conflicts, from, to, entry.claudeAgentPaths ?? {}, entry.codexAgentPaths ?? {}, entry, options.ignoreRules ?? []),
      backupRequired: true,
      approvalRequired: false
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
    approvalRequired: false
  };
}

function operationItemQualities(entry, items) {
  return Object.fromEntries(
    items.map((item) => [item, entry.itemQualities?.[item] ?? entry.itemQualities?.[item.replace(/^(allow|ask|deny):/, "")] ?? "unsupported"])
  );
}

function permissionReviewNotes(itemNames) {
  const notes = [];

  for (const itemName of itemNames) {
    const { bucket, value } = parsePermissionItem(itemName);
    const pattern = bashPattern(value);

    if (pattern?.risky) {
      notes.push(`${value}: broad, interpreter, shell-wrapper, network, or destructive command will be written as a prefix_rule; review before apply`);
      continue;
    }

    if (bucket === "allow" && value === "WebFetch") {
      notes.push(`${value}: maps to config.toml web_search = "live"; reverse sync will normalize to WebSearch (lossy)`);
      continue;
    }

    if (isAgentPermission(value) && !(bucket === "allow" && value === "Agent")) {
      notes.push(`${value}: unsupported on Codex (no spawn_agent gate); archived under unsupported-calls.json`);
      continue;
    }

    if (itemMappingQuality("permissions", itemName) === "approximate") {
      notes.push(`${value}: maps to a broad Codex approval policy; review before relying on equivalent behavior`);
    } else if (itemMappingQuality("permissions", itemName) === "unsupported") {
      notes.push(`${value}: unsupported permission mapping; preserved as metadata only`);
    }
  }

  return notes;
}

function settingsItemPatchPreview(area, from, to, sourcePath, itemNames) {
  if (area === "permissions") return permissionPatchPreview(to, itemNames);
  if (area === "hooks") return hookPatchPreview(from, to, sourcePath, itemNames);
  return [];
}

function permissionPatchPreview(to, itemNames) {
  return itemNames.map((itemName) => {
    const { bucket, value } = parsePermissionItem(itemName);
    const changes = [];

    if (to === "claude") {
      changes.push(`settings.json permissions.${bucket}: add ${JSON.stringify(value)}`);
      return { item: itemName, action: "merge-settings-item", changes };
    }

    if (isAgentPermission(value)) {
      if (bucket === "allow" && value === "Agent") {
        changes.push("no-op (codex default already permits spawn_agent)");
      } else {
        changes.push("archive unsupported permission to unsupported-calls.json");
      }
      return { item: itemName, action: "merge-settings-item", changes };
    }

    if (["Write", "Edit", "MultiEdit"].includes(value)) {
      changes.push('config.toml sandbox_mode = "workspace-write"');
    }
    if (bucket === "allow" && (value === "WebSearch" || value === "WebFetch")) {
      changes.push('config.toml web_search = "live"');
    }
    if (bucket === "ask") {
      changes.push('config.toml approval_policy = "on-request"');
    }
    const mcp = parseMcpPermission(value);
    if (mcp) {
      if (isMcpServerScopePermission(mcp)) {
        if (bucket === "deny") {
          changes.push(`config.toml [mcp_servers.${mcp.server}] enabled_tools = []`);
        } else {
          changes.push(`config.toml [mcp_servers.${mcp.server}] (no-op; codex defaults already allow every tool)`);
        }
      } else {
        const approvalMode = bucket === "deny" ? "deny" : bucket === "ask" ? "prompt" : "approve";
        changes.push(`config.toml [mcp_servers.${mcp.server}.tools.${mcp.tool}] approval_mode = ${JSON.stringify(approvalMode)}`);
        if (bucket === "allow") {
          changes.push(`config.toml [mcp_servers.${mcp.server}] enabled_tools += ${JSON.stringify(mcp.tool)}`);
        } else if (bucket === "deny") {
          changes.push(`config.toml [mcp_servers.${mcp.server}] disabled_tools += ${JSON.stringify(mcp.tool)}`);
        }
      }
    }
    const rule = codexPrefixRuleForPermission(bucket, value);
    if (rule) {
      changes.push(`rules/default.rules ${rule}`);
    }
    if (changes.length === 0 || itemMappingQuality("permissions", itemName) === "metadata-only") {
      changes.push(`managed metadata permissions.${bucket} = ${JSON.stringify(value)}`);
    }

    return { item: itemName, action: "merge-settings-item", changes };
  });
}

function hookPatchPreview(from, to, sourcePath, itemNames) {
  const sourceValues = to === "codex" && from === "claude"
    ? claudeManagedValues("hooks", sourcePath, itemNames)
    : {};

  return itemNames.map((itemName) => {
    const changes = [];

    if (to === "claude") {
      changes.push(`settings.json hooks.${itemName}: add or merge`);
    } else {
      changes.push("config.toml [features] codex_hooks = true");
      const groups = sourceValues[itemName];
      changes.push(
        Array.isArray(groups) && groups.every(isCodexNativeHookGroup)
          ? `config.toml [[hooks.${itemName}]] native command hook entries`
          : `managed metadata hooks.${itemName}`
      );
    }

    return { item: itemName, action: "merge-settings-item", changes };
  });
}

function renderSyncPlan(plan) {
  const lines = [
    "AI Config Sync Manager sync",
    `Route: ${plan.route === "auto" ? `auto (diff-directed, default ${plan.from} -> ${plan.to})` : `${plan.from} -> ${plan.to}`}`,
    `Scope: ${plan.scope}`,
    `Mode: ${plan.mode}`,
    `Include: ${plan.include.length ? plan.include.join(", ") : "all"}`,
    `Exclude: ${plan.exclude.length ? plan.exclude.join(", ") : "none"}`,
    formatPlanIgnoreLine(plan.ignorePath, plan.ignoreRules, plan.ignored),
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
      lines.push(`  Skills: ${formatOperationItems(operation, operation.skillNames).join(", ")}`);
    }
    if (operation.itemNames?.length && operation.area !== "skills") {
      lines.push(`  Items: ${formatOperationItems(operation, operation.itemNames).join(", ")}`);
    }
    if (operation.serverNames?.length) {
      lines.push(`  MCP servers: ${formatOperationItems(operation, operation.serverNames).join(", ")}`);
    }
    if (operation.termMappingPath) {
      lines.push(`  Term mapping: ${operation.termMappingPath}`);
    }
    if (operation.targetTemplatePath) {
      lines.push(`  Target templates: ${operation.targetTemplatePath}`);
    }
    if (operation.reviewNotes?.length) {
      lines.push("  Review notes:");
      for (const note of operation.reviewNotes) {
        lines.push(`    - ${note}`);
      }
    }
    if (operation.patchPreview?.length) {
      lines.push("  Patch preview:");
      for (const patch of operation.patchPreview) {
        lines.push(`    - ${patch.item ?? patch.server}: ${patch.action}`);
        for (const change of patch.changes) {
          lines.push(`      ${change}`);
        }
      }
    }
    if (operation.changePreview?.length) {
      lines.push("  Change preview:");
      for (const line of operation.changePreview) {
        lines.push(`    ${line}`);
      }
    }
    if (operation.skillNames && operation.skillNames.length === 0) {
      lines.push("  Skills: none missing in target direction");
    }
  }

  if (plan.mode === "apply" && plan.results.length > 0) {
    lines.push("");
    lines.push("Apply results:");
    for (const result of plan.results) {
      lines.push(`  ${result.status}: ${result.message}`);
    }
    if (Array.isArray(plan.callArchive) && plan.callArchive.length > 0) {
      lines.push(`Calls archive: ${plan.callArchivePath}`);
    }
  } else {
    lines.push("");
    lines.push("Dry-run only. No files were modified.");
  }

  return lines.join("\n");
}

function renderSyncPlans(plans) {
  return plans.map(renderSyncPlan).join("\n\n");
}


function formatOperationItems(operation, items) {
  return items.map((item) => {
    const quality = operation.itemQualities?.[item] ?? operation.itemQualities?.[item.replace(/^(allow|ask|deny):/, "")];
    return quality ? `${item} [${quality}]` : item;
  });
}

function terminologyMapPath() {
  return terminologyMapSource().path;
}

function targetTemplatePath() {
  return targetTemplateSource().path;
}

function terminologyMapSource() {
  return loadLayeredRule(
    terminologyMapCandidates(),
    { layers: [] },
    mergeTerminologyMap
  );
}

function terminologyMapCandidates() {
  return [
    join(resolve(process.cwd()), "rules/terminology-map.json"),
    `${home}/.ai-config-sync-manager/rules/terminology-map.json`,
    join(runtimeRoot, "rules/terminology-map.json")
  ];
}

function targetTemplateSource() {
  return loadLayeredRule(
    targetTemplateCandidates(),
    { templates: [] },
    mergeTargetTemplates
  );
}

function targetTemplateCandidates() {
  return [
    join(resolve(process.cwd()), "rules/host-target-templates.json"),
    `${home}/.ai-config-sync-manager/rules/host-target-templates.json`,
    join(runtimeRoot, "rules/host-target-templates.json")
  ];
}

function transformTextForHost(value, from, to, options = {}) {
  return applyTermMappings(
    applyTargetTemplates(
      applyCallTransforms(value, from, to, options.callArchive),
      from,
      to
    ),
    from,
    to
  );
}

function callTemplatesPath() {
  return callTemplatesSource().path;
}

function callTemplatesData() {
  return callTemplatesSource().data;
}

function callTemplatesSource() {
  return loadLayeredRule(
    callTemplatesCandidates(),
    { supported: [], unsupported: [] },
    mergeCallTemplates
  );
}

function callTemplatesCandidates() {
  return [
    join(resolve(process.cwd()), "rules/call-templates.json"),
    `${home}/.ai-config-sync-manager/rules/call-templates.json`,
    join(runtimeRoot, "rules/call-templates.json")
  ];
}

function routeMappingsSource(direction) {
  const fileName = direction === "codex-to-claude" ? "codex-to-claude.json" : "claude-to-codex.json";
  return loadLayeredRule(
    routeMappingsCandidates(fileName),
    { areas: {} },
    mergeRouteMappings
  );
}

function routeMappingsCandidates(fileName) {
  return [
    join(resolve(process.cwd()), `rules/${fileName}`),
    `${home}/.ai-config-sync-manager/rules/${fileName}`,
    join(runtimeRoot, `rules/${fileName}`)
  ];
}

function applyCallTransforms(value, from, to, archive) {
  const text = String(value ?? "");
  if (!text || from === to) return text;

  const data = callTemplatesData();
  const supported = Array.isArray(data?.supported) ? data.supported : [];
  const unsupported = Array.isArray(data?.unsupported) ? data.unsupported : [];

  if (from === "claude" && to === "codex") {
    return applyClaudeToCodexCallTransforms(text, supported, unsupported, archive);
  }
  if (from === "codex" && to === "claude") {
    return applyCodexToClaudeCallTransforms(text, supported, unsupported, archive);
  }
  return text;
}

function applyClaudeToCodexCallTransforms(text, supported, unsupported, archive) {
  let working = text;
  for (const rule of supported) {
    if (typeof rule?.claude_call !== "string" || !rule.claude_call) continue;
    working = transformClaudeCallsForward(working, rule, archive);
  }
  for (const rule of unsupported) {
    if (typeof rule?.claude_call !== "string" || !rule.claude_call) continue;
    working = stripClaudeCallsForward(working, rule, archive);
  }
  return working;
}

function applyCodexToClaudeCallTransforms(text, supported, unsupported, archive) {
  let working = text;
  for (const rule of supported) {
    if (typeof rule?.codex_marker !== "string" || !rule.codex_marker) continue;
    working = transformCodexProseReverse(working, rule, archive);
  }
  for (const rule of unsupported) {
    if (typeof rule?.codex_marker !== "string" || !rule.codex_marker) continue;
    working = restoreStrippedCallsReverse(working, rule, archive);
  }
  return working;
}

function transformClaudeCallsForward(text, rule, archive) {
  const callName = rule.claude_call;
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const match = findCallStart(text, callName, cursor);
    if (match === -1) {
      result += text.slice(cursor);
      break;
    }

    const openParen = text.indexOf("(", match + callName.length);
    if (openParen === -1) {
      result += text.slice(cursor);
      break;
    }

    const closeParen = findMatchingClose(text, openParen);
    if (closeParen === -1) {
      result += text.slice(cursor, match);
      result += emitManualReviewComment(callName, "unterminated call expression");
      result += text.slice(match);
      pushArchiveEntry(archive, {
        direction: "claude->codex",
        rule_id: rule.id ?? null,
        call: callName,
        action: "manual-review",
        original: text.slice(match),
        fields: null,
        reason: "unterminated call expression"
      });
      break;
    }

    const argText = text.slice(openParen + 1, closeParen);
    const fullCall = text.slice(match, closeParen + 1);
    const parsed = parseSingleObjectArgument(argText);

    result += text.slice(cursor, match);

    if (!parsed.ok) {
      result += emitManualReviewComment(callName, parsed.reason);
      result += fullCall;
      pushArchiveEntry(archive, {
        direction: "claude->codex",
        rule_id: rule.id ?? null,
        call: callName,
        action: "manual-review",
        original: fullCall,
        fields: null,
        reason: parsed.reason
      });
      cursor = closeParen + 1;
      continue;
    }

    const aliasedFields = renameFieldKeys(parsed.fields, rule.field_aliases?.claude_to_codex);
    const rendered = renderCodexTemplate(rule.codex_template, aliasedFields);
    const markerPayload = JSON.stringify({ call: callName, fields: parsed.fields });
    const marker = `<!-- ${rule.codex_marker} ${markerPayload} -->`;
    result += `${marker}\n${rendered}`;
    pushArchiveEntry(archive, {
      direction: "claude->codex",
      rule_id: rule.id ?? null,
      call: callName,
      action: "transformed",
      original: fullCall,
      fields: parsed.fields,
      reason: null
    });
    cursor = closeParen + 1;
  }

  return result;
}

function stripClaudeCallsForward(text, rule, archive) {
  const callName = rule.claude_call;
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const match = findCallStart(text, callName, cursor);
    if (match === -1) {
      result += text.slice(cursor);
      break;
    }

    const openParen = text.indexOf("(", match + callName.length);
    if (openParen === -1) {
      result += text.slice(cursor);
      break;
    }

    const closeParen = findMatchingClose(text, openParen);
    if (closeParen === -1) {
      result += text.slice(cursor, match);
      result += emitManualReviewComment(callName, "unterminated call expression");
      result += text.slice(match);
      pushArchiveEntry(archive, {
        direction: "claude->codex",
        rule_id: rule.id ?? null,
        call: callName,
        action: "manual-review",
        original: text.slice(match),
        fields: null,
        reason: "unterminated call expression"
      });
      break;
    }

    const argText = text.slice(openParen + 1, closeParen);
    const fullCall = text.slice(match, closeParen + 1);
    const parsed = parseSingleObjectArgument(argText);

    result += text.slice(cursor, match);

    if (!parsed.ok) {
      result += emitManualReviewComment(callName, parsed.reason);
      result += fullCall;
      pushArchiveEntry(archive, {
        direction: "claude->codex",
        rule_id: rule.id ?? null,
        call: callName,
        action: "manual-review",
        original: fullCall,
        fields: null,
        reason: parsed.reason
      });
      cursor = closeParen + 1;
      continue;
    }

    const reason = typeof rule.reason === "string" ? rule.reason : "";
    const markerPayload = JSON.stringify({
      call: callName,
      fields: parsed.fields,
      reason
    });
    result += `<!-- ${rule.codex_marker} ${markerPayload} -->`;
    pushArchiveEntry(archive, {
      direction: "claude->codex",
      rule_id: rule.id ?? null,
      call: callName,
      action: "stripped",
      original: fullCall,
      fields: parsed.fields,
      reason: reason || null
    });
    cursor = closeParen + 1;
  }

  return result;
}

function transformCodexProseReverse(text, rule, archive) {
  const marker = rule.codex_marker;
  const escaped = escapeRegExp(marker);
  const markerPattern = new RegExp(`<!--\\s*${escaped}\\s+(\\{[\\s\\S]*?\\})\\s*-->`, "g");
  let result = "";
  let cursor = 0;

  for (const match of text.matchAll(markerPattern)) {
    const start = match.index;
    const end = start + match[0].length;
    result += text.slice(cursor, start);

    const payload = parseMarkerPayload(match[1]);
    if (!payload.ok) {
      result += match[0];
      pushArchiveEntry(archive, {
        direction: "codex->claude",
        rule_id: rule.id ?? null,
        call: null,
        action: "manual-review",
        original: match[0],
        fields: null,
        reason: payload.reason
      });
      cursor = end;
      continue;
    }

    const callName = typeof payload.value.call === "string" ? payload.value.call : null;
    const fields = payload.value.fields;
    if (!callName || !fields || typeof fields !== "object") {
      result += match[0];
      pushArchiveEntry(archive, {
        direction: "codex->claude",
        rule_id: rule.id ?? null,
        call: callName,
        action: "manual-review",
        original: match[0],
        fields: fields ?? null,
        reason: "marker payload missing call or fields"
      });
      cursor = end;
      continue;
    }

    const proseEnd = findReverseProseBlockEnd(text, end, marker, rule, fields);
    if (proseEnd === -1) {
      result += emitManualReviewComment(callName, "could not delimit rendered prose");
      result += match[0];
      pushArchiveEntry(archive, {
        direction: "codex->claude",
        rule_id: rule.id ?? null,
        call: callName,
        action: "manual-review",
        original: match[0],
        fields,
        reason: "could not delimit rendered prose"
      });
      cursor = end;
      continue;
    }

    const aliased = renameFieldKeys(fields, rule.field_aliases?.codex_to_claude);
    const reconstruction = `${callName}(${formatObjectLiteral(aliased)})`;
    result += reconstruction;
    pushArchiveEntry(archive, {
      direction: "codex->claude",
      rule_id: rule.id ?? null,
      call: callName,
      action: "restored",
      original: text.slice(start, proseEnd),
      fields,
      reason: null
    });
    cursor = proseEnd;
  }

  result += text.slice(cursor);
  return result;
}

function restoreStrippedCallsReverse(text, rule, archive) {
  const marker = rule.codex_marker;
  const escaped = escapeRegExp(marker);
  const markerPattern = new RegExp(`<!--\\s*${escaped}\\s+(\\{[\\s\\S]*?\\})\\s*-->`, "g");
  let result = "";
  let cursor = 0;

  for (const match of text.matchAll(markerPattern)) {
    const start = match.index;
    const end = start + match[0].length;
    result += text.slice(cursor, start);

    const payload = parseMarkerPayload(match[1]);
    if (!payload.ok) {
      result += match[0];
      pushArchiveEntry(archive, {
        direction: "codex->claude",
        rule_id: rule.id ?? null,
        call: null,
        action: "manual-review",
        original: match[0],
        fields: null,
        reason: payload.reason
      });
      cursor = end;
      continue;
    }

    const callName = typeof payload.value.call === "string" ? payload.value.call : null;
    const fields = payload.value.fields;
    if (!callName || !fields || typeof fields !== "object") {
      result += match[0];
      pushArchiveEntry(archive, {
        direction: "codex->claude",
        rule_id: rule.id ?? null,
        call: callName,
        action: "manual-review",
        original: match[0],
        fields: fields ?? null,
        reason: "marker payload missing call or fields"
      });
      cursor = end;
      continue;
    }

    if (rule.claude_call && callName !== rule.claude_call) {
      result += match[0];
      cursor = end;
      continue;
    }

    const reconstruction = `${callName}(${formatObjectLiteral(fields)})`;
    result += reconstruction;
    pushArchiveEntry(archive, {
      direction: "codex->claude",
      rule_id: rule.id ?? null,
      call: callName,
      action: "restored",
      original: match[0],
      fields,
      reason: null
    });
    cursor = end;
  }

  result += text.slice(cursor);
  return result;
}

function findCallStart(text, callName, fromIndex) {
  const escaped = escapeRegExp(callName);
  const pattern = new RegExp(`(^|[^A-Za-z0-9_$])${escaped}\\s*\\(`, "g");
  pattern.lastIndex = fromIndex;
  const match = pattern.exec(text);
  if (!match) return -1;
  return match.index + match[1].length;
}

function findMatchingClose(text, openParen) {
  const length = text.length;
  let depth = 0;
  let index = openParen;

  while (index < length) {
    const ch = text[index];

    if (ch === '"' || ch === "'" || ch === "`") {
      index = skipStringLiteral(text, index);
      if (index === -1) return -1;
      continue;
    }

    if (ch === "(" || ch === "{" || ch === "[") {
      depth += 1;
      index += 1;
      continue;
    }

    if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0 && ch === ")") return index;
      if (depth < 0) return -1;
      index += 1;
      continue;
    }

    index += 1;
  }

  return -1;
}

function skipStringLiteral(text, start) {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    const ch = text[index];
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === quote) return index + 1;
    index += 1;
  }
  return -1;
}

function parseSingleObjectArgument(argText) {
  const trimmed = argText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return { ok: false, reason: "argument is not a single object literal" };
  }

  const reader = { text: trimmed, index: 0 };
  const value = readObjectLiteral(reader);
  if (!value.ok) return value;

  skipWhitespace(reader);
  if (reader.index !== reader.text.length) {
    return { ok: false, reason: "extra tokens after object literal" };
  }

  return { ok: true, fields: value.value };
}

function readValue(reader) {
  skipWhitespace(reader);
  const ch = reader.text[reader.index];
  if (ch === undefined) return { ok: false, reason: "unexpected end of value" };
  if (ch === "{") return readObjectLiteral(reader);
  if (ch === "[") return readArrayLiteral(reader);
  if (ch === '"' || ch === "'" || ch === "`") return readStringLiteral(reader);
  if (ch === "-" || (ch >= "0" && ch <= "9")) return readNumberLiteral(reader);
  if (matchKeyword(reader, "true")) return { ok: true, value: true };
  if (matchKeyword(reader, "false")) return { ok: true, value: false };
  if (matchKeyword(reader, "null")) return { ok: true, value: null };
  return { ok: false, reason: `unsupported value token at offset ${reader.index}` };
}

function readObjectLiteral(reader) {
  if (reader.text[reader.index] !== "{") {
    return { ok: false, reason: "expected '{'" };
  }
  reader.index += 1;
  const fields = {};

  while (true) {
    skipWhitespace(reader);
    const ch = reader.text[reader.index];
    if (ch === undefined) return { ok: false, reason: "unterminated object literal" };
    if (ch === "}") {
      reader.index += 1;
      return { ok: true, value: fields };
    }

    const key = readObjectKey(reader);
    if (!key.ok) return key;

    skipWhitespace(reader);
    if (reader.text[reader.index] !== ":") {
      return { ok: false, reason: "expected ':' after object key" };
    }
    reader.index += 1;

    const value = readValue(reader);
    if (!value.ok) return value;
    fields[key.value] = value.value;

    skipWhitespace(reader);
    const next = reader.text[reader.index];
    if (next === ",") {
      reader.index += 1;
      continue;
    }
    if (next === "}") {
      reader.index += 1;
      return { ok: true, value: fields };
    }
    return { ok: false, reason: "expected ',' or '}' in object literal" };
  }
}

function readArrayLiteral(reader) {
  if (reader.text[reader.index] !== "[") {
    return { ok: false, reason: "expected '['" };
  }
  reader.index += 1;
  const items = [];

  while (true) {
    skipWhitespace(reader);
    const ch = reader.text[reader.index];
    if (ch === undefined) return { ok: false, reason: "unterminated array literal" };
    if (ch === "]") {
      reader.index += 1;
      return { ok: true, value: items };
    }

    const value = readValue(reader);
    if (!value.ok) return value;
    items.push(value.value);

    skipWhitespace(reader);
    const next = reader.text[reader.index];
    if (next === ",") {
      reader.index += 1;
      continue;
    }
    if (next === "]") {
      reader.index += 1;
      return { ok: true, value: items };
    }
    return { ok: false, reason: "expected ',' or ']' in array literal" };
  }
}

function readObjectKey(reader) {
  skipWhitespace(reader);
  const ch = reader.text[reader.index];
  if (ch === '"' || ch === "'" || ch === "`") {
    const value = readStringLiteral(reader);
    return value;
  }
  const start = reader.index;
  while (reader.index < reader.text.length) {
    const c = reader.text[reader.index];
    if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "_" || c === "$") {
      reader.index += 1;
    } else {
      break;
    }
  }
  if (reader.index === start) {
    return { ok: false, reason: `expected object key at offset ${start}` };
  }
  return { ok: true, value: reader.text.slice(start, reader.index) };
}

function readStringLiteral(reader) {
  const quote = reader.text[reader.index];
  if (quote !== '"' && quote !== "'" && quote !== "`") {
    return { ok: false, reason: "expected string quote" };
  }
  let index = reader.index + 1;
  let result = "";
  while (index < reader.text.length) {
    const ch = reader.text[index];
    if (ch === "\\") {
      const next = reader.text[index + 1];
      if (next === undefined) return { ok: false, reason: "dangling escape in string literal" };
      result += unescapeChar(next);
      index += 2;
      continue;
    }
    if (quote === "`" && ch === "$" && reader.text[index + 1] === "{") {
      return { ok: false, reason: "template literal interpolation is not supported" };
    }
    if (ch === quote) {
      reader.index = index + 1;
      return { ok: true, value: result };
    }
    result += ch;
    index += 1;
  }
  return { ok: false, reason: "unterminated string literal" };
}

function unescapeChar(ch) {
  if (ch === "n") return "\n";
  if (ch === "r") return "\r";
  if (ch === "t") return "\t";
  if (ch === "b") return "\b";
  if (ch === "f") return "\f";
  if (ch === "0") return "\0";
  return ch;
}

function readNumberLiteral(reader) {
  const start = reader.index;
  if (reader.text[reader.index] === "-") reader.index += 1;
  while (reader.index < reader.text.length) {
    const ch = reader.text[reader.index];
    if ((ch >= "0" && ch <= "9") || ch === "." || ch === "e" || ch === "E" || ch === "+" || ch === "-") {
      reader.index += 1;
    } else {
      break;
    }
  }
  const slice = reader.text.slice(start, reader.index);
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(slice)) {
    return { ok: false, reason: `invalid number literal '${slice}'` };
  }
  return { ok: true, value: Number(slice) };
}

function matchKeyword(reader, keyword) {
  if (reader.text.slice(reader.index, reader.index + keyword.length) !== keyword) return false;
  const next = reader.text[reader.index + keyword.length];
  if (next !== undefined && /[A-Za-z0-9_$]/.test(next)) return false;
  reader.index += keyword.length;
  return true;
}

function skipWhitespace(reader) {
  while (reader.index < reader.text.length && /\s/.test(reader.text[reader.index])) {
    reader.index += 1;
  }
}

function renameFieldKeys(fields, aliases) {
  if (!fields || typeof fields !== "object" || !aliases) return { ...fields };
  const renamed = {};
  for (const key of Object.keys(fields)) {
    const aliasKey = typeof aliases[key] === "string" ? aliases[key] : key;
    renamed[aliasKey] = fields[key];
  }
  return renamed;
}

function renderCodexTemplate(template, fields) {
  if (typeof template !== "string") return "";
  return template.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_, key) => {
    const value = fields[key];
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

function formatObjectLiteral(fields) {
  const keys = Object.keys(fields ?? {});
  const parts = keys.map((key) => `${formatObjectKey(key)}: ${formatObjectValue(fields[key])}`);
  return `{ ${parts.join(", ")} }`;
}

function formatObjectKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function formatObjectValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function emitManualReviewComment(callName, reason) {
  const safeReason = String(reason ?? "").replace(/-->/g, "--&gt;").replace(/"/g, "'");
  return `<!-- ai-config-sync:manual-review reason="cannot parse ${callName} arguments: ${safeReason}" -->`;
}

function parseMarkerPayload(jsonText) {
  try {
    const value = JSON.parse(jsonText);
    if (value && typeof value === "object") return { ok: true, value };
    return { ok: false, reason: "marker payload is not an object" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "marker JSON parse error" };
  }
}

function findReverseProseBlockEnd(text, markerEnd, marker, rule, fields) {
  const renderedProse = renderCodexTemplate(rule?.codex_template, fields ?? {});
  if (renderedProse) {
    const proseStart = consumeLeadingNewline(text, markerEnd);
    if (text.startsWith(renderedProse, proseStart)) {
      return proseStart + renderedProse.length;
    }
  }

  const escaped = escapeRegExp(marker);
  const nextMarkerMatch = text.slice(markerEnd).match(new RegExp(`<!--\\s*${escaped}`));
  if (nextMarkerMatch) return markerEnd + nextMarkerMatch.index;

  return -1;
}

function consumeLeadingNewline(text, index) {
  if (text[index] === "\n") return index + 1;
  if (text[index] === "\r" && text[index + 1] === "\n") return index + 2;
  return index;
}

function pushArchiveEntry(archive, entry) {
  if (!Array.isArray(archive)) return;
  archive.push(entry);
}

function applyTargetTemplates(value, from, to) {
  const text = String(value ?? "");
  if (!text || from === to) return text;

  const { data } = targetTemplateSource();
  const templates = targetTemplates(data);
  const replacements = [];

  for (const template of templates) {
    const aliases = Array.isArray(template?.aliases?.[from])
      ? template.aliases[from].filter((item) => typeof item === "string" && item)
      : [];
    const target = template?.target?.[to];
    if (aliases.length === 0 || typeof target !== "string" || !target) continue;

    for (const alias of aliases) replacements.push({ source: alias, target });
  }

  replacements.sort((left, right) => right.source.length - left.source.length);
  return replacements.reduce(
    (nextText, { source, target }) => nextText.replace(new RegExp(escapeRegExp(source), "g"), target),
    text
  );
}

function targetTemplates(data) {
  if (Array.isArray(data?.templates)) return data.templates;
  return Array.isArray(data?.workflows) ? data.workflows : [];
}

function applyTermMappings(value, from, to) {
  const text = String(value ?? "");
  if (!text || from === to) return text;

  const { data } = terminologyMapSource();
  const rules = terminologyRules(data);
  const literalReplacements = [];
  let working = text;

  for (const rule of rules) {
    if (rule?.regex) {
      const pattern = rule[`${from}_pattern`];
      const replace = rule[`${to}_replace`];
      if (typeof pattern === "string" && pattern && typeof replace === "string") {
        working = working.replace(new RegExp(pattern, "g"), replace);
      }
      continue;
    }

    const sourceTerms = Array.isArray(rule?.[from]) ? rule[from].filter((item) => typeof item === "string" && item) : [];
    const targetTerms = Array.isArray(rule?.[to]) ? rule[to].filter((item) => typeof item === "string" && item) : [];
    if (sourceTerms.length === 0 || targetTerms.length === 0) continue;

    const target = targetTerms[0];
    for (const source of sourceTerms) literalReplacements.push({ source, target });
  }

  literalReplacements.sort((left, right) => right.source.length - left.source.length);
  return literalReplacements.reduce(
    (nextText, { source, target }) => nextText.replace(new RegExp(escapeRegExp(source), "g"), target),
    working
  );
}

function terminologyRules(data) {
  const layered = Array.isArray(data?.layers)
    ? data.layers.flatMap((layer) => Array.isArray(layer?.rules) ? layer.rules : [])
    : Array.isArray(data?.rules) ? data.rules : [];
  return [...modelTerminologyRules(), ...layered];
}

function toLabel(host) {
  return host === "claude" ? "Claude" : "Codex";
}

function fromLabel(host) {
  return toLabel(host);
}

function fileText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function skillChangePreview(sourcePath, targetPath, skillNames, from, sourceIndex = {}, entry = null, ignoreRules = []) {
  const lines = [];
  for (const skillName of skillNames) {
    const sourceDir = sourceIndex[skillName] ?? sourcePath;
    const source = transformTextForHost(skillPreviewContent(sourceDir, skillName), from, from === "claude" ? "codex" : "claude");
    const target = skillPreviewContent(targetPath, skillName);
    const terms = entry ? entryMaskTerms(entry, skillName, ignoreRules) : [];
    lines.push(`${skillName}: target will be replaced from ${fromLabel(from)}`);
    lines.push(...contentChangePreview("Target current", target, `After apply from ${fromLabel(from)}`, source, terms).map((line) => `  ${line}`));
  }
  return lines;
}

function skillPreviewContent(basePath, skillName) {
  const skillPath = join(basePath, skillName);
  const manifest = findSkillManifest(skillPath);
  if (manifest) return readFileSync(manifest, "utf8");
  if (existsSync(skillPath) && !lstatSync(skillPath).isDirectory()) return readFileSync(skillPath, "utf8");
  return "";
}

function agentChangePreview(sourceDir, targetDir, agentNames, from, to, claudeAgentPaths = {}, codexAgentPaths = {}, entry = null, ignoreRules = []) {
  const lines = [];
  const sourcePaths = from === "claude" ? claudeAgentPaths : codexAgentPaths;
  const targetPaths = to === "claude" ? claudeAgentPaths : codexAgentPaths;
  for (const agentName of agentNames) {
    lines.push(`${agentName}: target will be replaced from ${fromLabel(from)}`);
    const targetContent = agentPreviewContentFromPath(targetPaths[agentName], to)
      || agentPreviewContent(targetDir, agentName, to);
    const sourceRaw = agentPreviewContentFromPath(sourcePaths[agentName], from)
      || agentPreviewContent(sourceDir, agentName, from);
    const transformedSource = from === "claude"
      ? transformTextForHost(sourceRaw, "claude", "codex")
      : transformTextForHost(stripAgentMigrationPreamble(sourceRaw), "codex", "claude");
    const terms = entry ? entryMaskTerms(entry, agentName, ignoreRules) : [];
    lines.push(...contentChangePreview("Target current", targetContent, `After apply from ${fromLabel(from)}`, transformedSource, terms).map((line) => `  ${line}`));
  }
  return lines;
}

function agentPreviewContentFromPath(path, host) {
  if (!path || !existsSync(path)) return "";
  if (host === "claude") {
    return parseClaudeAgentFile(path).body ?? "";
  }
  return parseCodexAgentFile(path).developer_instructions ?? "";
}

function agentPreviewContent(baseDir, agentName, host) {
  if (!baseDir) return "";
  if (host === "claude") {
    const direct = join(baseDir, `${agentName}.md`);
    if (existsSync(direct)) {
      const parsed = parseClaudeAgentText(readFileSync(direct, "utf8"));
      return parsed.body;
    }
    // Fallback for folder-grouped layouts (e.g. baseDir/group/agentName.md). Match by
    // canonical frontmatter name to handle the case where the file stem differs from
    // the canonical agent name.
    if (existsSync(baseDir)) {
      for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const groupDir = join(baseDir, entry.name);
        const guess = join(groupDir, `${agentName}.md`);
        if (existsSync(guess)) {
          return parseClaudeAgentFile(guess).body ?? "";
        }
        for (const child of readdirSync(groupDir, { withFileTypes: true })) {
          if (!child.isFile() || !child.name.endsWith(".md")) continue;
          const childPath = join(groupDir, child.name);
          const stem = child.name.slice(0, -3);
          const parsed = parseClaudeAgentFile(childPath);
          const canonical = canonicalAgentName(parsed.frontmatter?.name, stem);
          if (canonical === agentName) return parsed.body ?? "";
        }
      }
    }
    return "";
  }

  const flatName = agentName.includes("/") ? agentName.split("/").pop() : agentName;
  const tomlPath = join(baseDir, `${flatName}.toml`);
  if (!existsSync(tomlPath)) return "";
  return parseCodexAgentText(readFileSync(tomlPath, "utf8")).developer_instructions ?? "";
}

function copySkillWithMappings(source, target, from, to, options = {}) {
  if (!existsSync(source)) return;

  const stat = lstatSync(source);
  if (!stat.isDirectory()) {
    copyFileWithMappings(source, target, from, to, options);
    return;
  }

  copySkillTreeWithMappings(source, target, from, to, options);
  normalizeSkillManifestCasing(target, to);
}

function copySkillTreeWithMappings(source, target, from, to, options) {
  mkdirSync(target, { recursive: true });
  for (const name of readdirSync(source)) {
    const sourcePath = join(source, name);
    const targetPath = join(target, name);
    if (lstatSync(sourcePath).isDirectory()) {
      copySkillTreeWithMappings(sourcePath, targetPath, from, to, options);
    } else {
      copyFileWithMappings(sourcePath, targetPath, from, to, options);
    }
  }
}

// After copying a skill directory, rename the manifest (SKILL.md/skill.md) to match
// the destination host's canonical casing. Skills written with the wrong casing
// would not be discovered by the destination host's loader. Uses readdirSync to read
// actual entry names because existsSync case-folds on case-insensitive filesystems.
//
// On case-insensitive filesystems (APFS default, NTFS), renameSync(skill.md, SKILL.md)
// is a no-op — the FS treats both paths as the same inode, so the on-disk casing is
// preserved and the wrong-cased file remains. To force the case change we read the
// wrong-cased manifest into memory, delete it, then write the canonical name. This
// sidesteps FS case-sensitivity entirely and works on both APFS and ext4.
function normalizeSkillManifestCasing(skillDir, host) {
  if (!existsSync(skillDir)) return;
  const canonical = skillManifestBasename(host);
  const wrong = canonical === "SKILL.md" ? "skill.md" : "SKILL.md";

  const entries = readdirSync(skillDir);
  const hasCanonical = entries.includes(canonical);
  const hasWrong = entries.includes(wrong);
  if (!hasWrong) return;

  const wrongPath = join(skillDir, wrong);
  const canonicalPath = join(skillDir, canonical);

  if (hasCanonical) {
    // Both casings present as distinct entries (only possible on case-sensitive FS).
    // Drop the wrong-cased one to avoid duplicate manifests.
    rmSync(wrongPath, { force: true });
    return;
  }

  // Read body, delete original, write under canonical name. On case-insensitive FS,
  // the delete + write pair forces the on-disk entry to be replaced with the new
  // casing. On case-sensitive FS, this is equivalent to a rename.
  const body = readFileSync(wrongPath);
  rmSync(wrongPath, { force: true });
  writeFileSync(canonicalPath, body);
}

function copyFileWithMappings(source, target, from, to, options = {}) {
  mkdirSync(dirname(target), { recursive: true });
  if (isTextMappingFile(source)) {
    let text = transformTextForHost(readFileSync(source, "utf8"), from, to, options);
    const sourceBasename = source.split("/").pop();
    if (isSkillManifestBasename(sourceBasename)) {
      text = normalizeYamlFrontmatter(text);
    }
    writeFileSync(target, text);
  } else {
    copyFileSync(source, target);
  }
}

// Re-serialize YAML frontmatter through the tolerant parser + quoting-aware serializer.
// Skill manifests authored against Claude's lenient loader can contain unquoted scalars
// with embedded `: ` (e.g. `description: First sentence. bias warning: edge case.`).
// YAML 1.2 strict parsers (Codex's loader) reject those. Reusing the existing helpers
// guarantees the destination's frontmatter is 1.2-compliant without changing parse or
// serialize behavior — only their application site.
function normalizeYamlFrontmatter(text) {
  if (!text.startsWith("---")) return text;
  const closing = text.indexOf("\n---", 3);
  if (closing === -1) return text;
  const { frontmatter, body } = parseClaudeAgentText(text);
  return serializeClaudeAgentFile(frontmatter, body);
}

function isTextMappingFile(path) {
  return /\.(md|mdx|txt|json|toml|yaml|yml|js|mjs|ts|tsx|jsx|py|sh|rules)$/i.test(path);
}

function contentChangePreview(beforeLabel, before, afterLabel, after, terms) {
  const beforeLines = previewLines(before);
  const afterLines = previewLines(after);
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const expandedTerms = Array.isArray(terms) && terms.length > 0 ? expandTermsBothDirections(terms) : [];
  const changes = [];

  for (let index = 0; index < maxLines; index += 1) {
    if (beforeLines[index] === afterLines[index]) continue;
    if (
      expandedTerms.length > 0
      && lineContainsAnyTerm(beforeLines[index], expandedTerms)
      && lineContainsAnyTerm(afterLines[index], expandedTerms)
    ) continue;
    changes.push(`- ${beforeLabel} L${index + 1}: ${previewLine(beforeLines[index])}`);
    changes.push(`+ ${afterLabel} L${index + 1}: ${previewLine(afterLines[index])}`);
    if (changes.length >= 12) {
      changes.push(`... ${Math.max(0, maxLines - index - 1)} more line(s) not shown`);
      break;
    }
  }

  return changes.length > 0 ? changes : ["No line-level preview available."];
}

function previewLines(value) {
  const lines = String(value ?? "").split(/\r?\n/);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

function previewLine(value) {
  if (value === undefined) return "<missing>";
  if (value === "") return "<blank>";
  return value.length > 140 ? `${value.slice(0, 137)}...` : value;
}

function lineContainsAnyTerm(line, terms) {
  if (typeof line !== "string") return false;
  return terms.some((term) => term && line.includes(term));
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
      } else if (operation.action === "write-instructions") {
        applyWriteInstructions(plan, operation);
      } else if (operation.action === "copy-missing-skills") {
        applyCopyMissingSkills(plan, operation);
      } else if (operation.action === "merge-agents") {
        applyMergeAgents(plan, operation);
      } else if (operation.action === "merge-settings-items") {
        applyMergeSettingsItems(plan, operation);
      } else if (operation.action === "merge-mcp-servers") {
        applyMergeMcpServers(plan, operation);
      } else if (operation.action === "delete-items") {
        applyDeleteItems(plan, operation);
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

  writeCallArchive(plan);

  if (plan.results.every((result) => result.status === "applied" || result.status === "noop")) {
    writeSyncState(plan.scope);
  }
}

function writeCallArchive(plan) {
  if (!Array.isArray(plan.callArchive) || plan.callArchive.length === 0) return;
  mkdirSync(dirname(plan.callArchivePath), { recursive: true });
  writeFileSync(plan.callArchivePath, `${JSON.stringify(plan.callArchive, null, 2)}\n`);
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

function applyWriteInstructions(plan, operation) {
  mkdirSync(dirname(operation.targetPath), { recursive: true });
  backupPath(plan, operation.targetPath);
  writeFileSync(operation.targetPath, operation.content.endsWith("\n") ? operation.content : `${operation.content}\n`);
  plan.results.push({ status: "applied", message: `wrote instructions ${operation.sourcePath} -> ${operation.targetPath}` });
}

function applyCopyMissingSkills(plan, operation) {
  mkdirSync(operation.targetPath, { recursive: true });
  const overwrite = new Set(operation.overwriteSkillNames ?? []);
  const sourceIndex = operation.skillSourceIndex ?? {};

  for (const skillName of operation.skillNames ?? []) {
    const sourceDir = sourceIndex[skillName] ?? operation.sourcePath;
    const source = join(sourceDir, skillName);
    const target = join(operation.targetPath, skillName);

    if (!existsSync(source)) {
      plan.results.push({ status: "skipped", message: `skill source missing: ${source}` });
      continue;
    }

    if (existsSync(target)) {
      if (!overwrite.has(skillName)) {
        plan.results.push({ status: "skipped", message: `skill already exists: ${target}` });
        continue;
      }
      backupPath(plan, target);
      rmSync(target, { recursive: true, force: true });
    }

    copySkillWithMappings(source, target, operation.from, operation.to, { callArchive: plan.callArchive });
    plan.results.push({ status: "applied", message: `${overwrite.has(skillName) ? "replaced" : "copied"} skill ${skillName}` });
  }
}

function applyMergeAgents(plan, operation) {
  mkdirSync(operation.targetPath, { recursive: true });
  const overwrite = new Set(operation.overwriteAgentNames ?? []);
  const sourceClaudeIndex = operation.from === "claude" ? new Map(enumerateClaudeAgents(operation.sourcePath).map((agent) => [agent.name, agent])) : null;
  const sourceCodexIndex = operation.from === "codex" ? new Map(enumerateCodexAgents(operation.sourcePath).map((agent) => [agent.name, agent])) : null;
  const existingClaudeIndex = operation.to === "claude" ? new Map(enumerateClaudeAgents(operation.targetPath).map((agent) => [agent.name, agent])) : null;
  const existingCodexIndex = operation.to === "codex" ? new Map(enumerateCodexAgents(operation.targetPath).map((agent) => [agent.name, agent])) : null;

  for (const agentName of operation.agentNames ?? []) {
    if (operation.to === "codex") {
      const sourceAgent = sourceClaudeIndex?.get(agentName);
      if (!sourceAgent) {
        plan.results.push({ status: "skipped", message: `agent source missing: ${agentName}` });
        continue;
      }
      const targetPath = agentTargetPath(agentName, operation.targetPath, "codex", sourceAgent);
      const existingAgent = existingCodexIndex?.get(agentName) ?? existingCodexIndex?.get(sourceAgent.name.split("/").pop());
      if (existingAgent && !overwrite.has(agentName)) {
        plan.results.push({ status: "skipped", message: `agent already exists: ${targetPath}` });
        continue;
      }

      const claudeParsed = parseClaudeAgentFile(sourceAgent.path);
      const existingFields = existingAgent ? parseCodexAgentFile(existingAgent.path) : {};
      const codexFields = mapAgentToCodex(claudeParsed, {
        preserveCodex: existingFields,
        fallbackName: agentName.split("/").pop(),
        callArchive: plan.callArchive
      });
      mkdirSync(dirname(targetPath), { recursive: true });
      if (existingAgent) backupPath(plan, existingAgent.path);
      writeFileSync(targetPath, serializeCodexAgentFile(codexFields));
      plan.results.push({ status: "applied", message: `${existingAgent ? "replaced" : "copied"} agent ${agentName} -> ${targetPath}` });
      continue;
    }

    const sourceAgent = sourceCodexIndex?.get(agentName) ?? sourceCodexIndex?.get(agentName.split("/").pop());
    if (!sourceAgent) {
      plan.results.push({ status: "skipped", message: `agent source missing: ${agentName}` });
      continue;
    }
    const existingAgent = existingClaudeIndex?.get(agentName);
    const targetPath = agentTargetPath(agentName, operation.targetPath, "claude", existingAgent);
    if (existingAgent && !overwrite.has(agentName)) {
      plan.results.push({ status: "skipped", message: `agent already exists: ${targetPath}` });
      continue;
    }

    const codexParsed = parseCodexAgentFile(sourceAgent.path);
    const existingClaude = existingAgent ? parseClaudeAgentFile(existingAgent.path) : { frontmatter: {}, body: "" };
    const claude = mapAgentToClaude(codexParsed, { preserveClaude: existingClaude.frontmatter, callArchive: plan.callArchive });
    mkdirSync(dirname(targetPath), { recursive: true });
    if (existingAgent) backupPath(plan, existingAgent.path);
    writeFileSync(targetPath, serializeClaudeAgentFile(claude.frontmatter, claude.body));
    plan.results.push({ status: "applied", message: `${existingAgent ? "replaced" : "copied"} agent ${agentName} -> ${targetPath}` });
  }
}

function applyMergeSettingsItems(plan, operation) {
  mkdirSync(dirname(operation.targetPath), { recursive: true });
  backupPath(plan, operation.targetPath);
  if (operation.area === "permissions" && operation.to === "codex") {
    backupPath(plan, codexRulesPath(operation.targetPath));
  }

  if (operation.area === "permissions" && operation.to === "codex") {
    archiveUnsupportedAgentPermissions(plan, operation.itemNames ?? []);
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

function archiveUnsupportedAgentPermissions(plan, itemNames) {
  for (const itemName of itemNames) {
    const { bucket, value } = parsePermissionItem(itemName);
    if (!isAgentPermission(value)) continue;
    if (bucket === "allow" && value === "Agent") continue;

    pushArchiveEntry(plan.callArchive, {
      direction: "claude->codex",
      rule_id: null,
      call: null,
      action: "unsupported-permission",
      original: itemName,
      fields: { bucket, value },
      reason: "codex has no spawn_agent gate; permission cannot be expressed natively"
    });
  }
}

function applyMergeMcpServers(plan, operation) {
  mkdirSync(dirname(operation.targetPath), { recursive: true });
  backupPath(plan, operation.targetPath);

  if (operation.to === "codex") {
    mergeMcpIntoCodex(operation.targetPath, operation.sourceMcpPaths ?? operation.sourcePath, operation.from, operation.serverNames ?? []);
  } else {
    mergeMcpIntoClaude(operation.targetPath, operation.sourceMcpPaths ?? operation.sourcePath, operation.from, operation.serverNames ?? []);
  }

  plan.results.push({
    status: "applied",
    message: `merged MCP servers ${operation.from} -> ${operation.to}: ${(operation.serverNames ?? []).join(", ")}`
  });
}

function applyDeleteItems(plan, operation) {
  if (operation.area === "skills") {
    deleteSkillItems(plan, operation);
  } else if (operation.area === "agents") {
    deleteAgentItems(plan, operation);
  } else {
    mkdirSync(dirname(operation.targetPath), { recursive: true });
    backupPath(plan, operation.targetPath);

    if (operation.area === "mcp") {
      if (operation.to === "claude") {
        const claudeTargets = operation.targetMcpPaths ?? [operation.targetPath];
        for (const spec of claudeTargets) {
          const file = claudeMcpSourceFile(spec);
          if (existsSync(file)) backupPath(plan, file);
        }
        deleteClaudeMcpServers(claudeTargets, operation.serverNames ?? []);
      } else {
        deleteCodexMcpServers(operation.targetPath, operation.serverNames ?? []);
      }
    } else if (operation.area === "permissions") {
      if (operation.to === "claude") {
        deleteClaudePermissions(operation.targetPath, operation.itemNames ?? []);
      } else {
        const remainingClaudeItemNames = remainingClaudePermissionItems(operation.sourcePath);
        deleteCodexNativePermissionItems(operation.targetPath, operation.itemNames ?? [], remainingClaudeItemNames);
        deleteCodexManagedItems(operation.targetPath, operation.area, operation.itemNames ?? []);
      }
    } else if (operation.area === "hooks") {
      if (operation.to === "claude") {
        deleteClaudeHooks(operation.targetPath, operation.itemNames ?? []);
      } else {
        deleteCodexManagedItems(operation.targetPath, operation.area, operation.itemNames ?? []);
      }
    }
  }

  const pathSummary = operation.area === "permissions" && operation.to === "codex"
    ? summarizeCodexPermissionDeletePaths(operation.itemNames ?? [])
    : "";
  plan.results.push({
    status: "applied",
    message: `deleted ${operation.area} item(s) from ${operation.to}${pathSummary}: ${(operation.itemNames ?? []).join(", ")}`
  });
}

function summarizeCodexPermissionDeletePaths(itemNames) {
  let touchesRules = false;
  let touchesConfig = false;
  for (const itemName of itemNames) {
    const { bucket, value } = parsePermissionItem(itemName);
    if (codexPrefixRuleForPermission(bucket, value)) touchesRules = true;
    if (
      parseMcpPermission(value)
      || ["Write", "Edit", "MultiEdit"].includes(value)
      || (bucket === "allow" && (value === "WebSearch" || value === "WebFetch"))
    ) {
      touchesConfig = true;
    }
  }
  const paths = [touchesConfig && "config.toml", touchesRules && "rules/default.rules"].filter(Boolean);
  return paths.length ? ` (${paths.join(" + ")})` : "";
}

function deleteSkillItems(plan, operation) {
  const targetIndex = operation.skillTargetIndex ?? {};
  for (const skillName of operation.skillNames ?? operation.itemNames ?? []) {
    const targetDir = targetIndex[skillName] ?? operation.targetPath;
    const target = join(targetDir, skillName);
    if (!existsSync(target)) continue;
    backupPath(plan, target);
    rmSync(target, { recursive: true, force: true });
  }
}

function deleteAgentItems(plan, operation) {
  const targetIndex = operation.to === "claude"
    ? new Map(enumerateClaudeAgents(operation.targetPath).map((agent) => [agent.name, agent]))
    : new Map(enumerateCodexAgents(operation.targetPath).map((agent) => [agent.name, agent]));

  for (const agentName of operation.agentNames ?? operation.itemNames ?? []) {
    const existing = targetIndex.get(agentName) ?? targetIndex.get(agentName.split("/").pop());
    if (!existing) continue;
    backupPath(plan, existing.path);
    rmSync(existing.path, { force: true });
  }
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
  if (sourceHost !== "claude") {
    throw new Error(`mergeIntoCodexSettings expected sourceHost "claude", got ${sourceHost}`);
  }

  const sourceValues = claudeManagedValues(area, sourcePath, itemNames);
  const text = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  const managedValues = codexManagedFallbackValues(area, sourceValues, itemNames);
  let nextText = replaceManagedBlock(text, area, managedValues, itemNames, { dropMissingSelected: true });

  if (area === "permissions") {
    nextText = applyCodexNativePermissionMapping(nextText, itemNames);
    writeCodexPermissionRules(codexRulesPath(targetPath), itemNames);
  }

  if (area === "hooks") {
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
  const mcp = parseMcpPermission(value);
  if (mcp) return true;
  if (bucket === "allow" && (value === "WebSearch" || value === "WebFetch")) return true;
  if (isAgentPermission(value)) return true;

  const prefixRule = codexPrefixRuleForPermission(bucket, value);
  return Boolean(prefixRule);
}

function isAgentPermission(value) {
  return value === "Agent" || /^Agent\(/.test(value);
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

function codexHookValues(sourcePath) {
  if (!existsSync(sourcePath)) return {};
  const text = readFileSync(sourcePath, "utf8");
  return parseCodexNativeHooks(text);
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
  const parsed = itemNames
    .map((itemName) => parsePermissionItem(itemName))
    .filter(({ value }) => !isAgentPermission(value));

  if (parsed.some(({ value }) => ["Write", "Edit", "MultiEdit"].includes(value))) {
    nextText = setTomlRootString(nextText, "sandbox_mode", "workspace-write");
  }

  if (parsed.some(({ bucket, value }) => bucket === "allow" && (value === "WebSearch" || value === "WebFetch"))) {
    nextText = setTomlRootString(nextText, "web_search", "live");
  }

  if (parsed.some(({ bucket }) => bucket === "ask")) {
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

    if (isMcpServerScopePermission(mcp)) {
      // Server-level (or wildcard tool) permission. Codex defaults to allowing all tools, so
      // allow/ask are noops at the codex layer. deny needs an explicit empty enabled_tools to
      // forbid every tool on the server.
      if (bucket === "deny") {
        nextText = setTomlMcpServerArray(nextText, mcp.server, "enabled_tools", []);
      } else {
        nextText = ensureTomlMcpServerTable(nextText, mcp.server);
      }
      continue;
    }

    const approvalMode = bucket === "deny" ? "deny" : bucket === "ask" ? "prompt" : "approve";
    nextText = setTomlMcpToolApproval(nextText, mcp.server, mcp.tool, approvalMode);

    if (bucket === "allow") {
      nextText = appendTomlMcpServerArray(nextText, mcp.server, "enabled_tools", mcp.tool);
    } else if (bucket === "deny") {
      nextText = appendTomlMcpServerArray(nextText, mcp.server, "disabled_tools", mcp.tool);
    }
  }

  return nextText;
}

function setTomlMcpServerArray(text, server, key, values) {
  const tableLine = `[mcp_servers.${server}]`;
  const tablePattern = new RegExp(`^\\[mcp_servers\\.${escapeRegExp(server)}\\]\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, "m");
  const match = text.match(tablePattern);
  const line = `${key} = ${formatTomlStringArray(values)}`;

  if (!match) {
    return `${text.replace(/\s*$/, "")}\n\n${tableLine}\n${line}\n`;
  }

  const body = match[1];
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*\\[[^\\]]*\\]\\s*$`, "m");
  const nextBody = keyPattern.test(body)
    ? body.replace(keyPattern, line)
    : `${body.replace(/\s*$/, "")}\n${line}\n`;

  return text.replace(tablePattern, `${tableLine}\n${nextBody}`);
}

function ensureTomlMcpServerTable(text, server) {
  const tableLine = `[mcp_servers.${server}]`;
  const tablePattern = new RegExp(`^\\[mcp_servers\\.${escapeRegExp(server)}\\]\\n`, "m");
  if (tablePattern.test(text)) return text;
  return `${text.replace(/\s*$/, "")}\n\n${tableLine}\n`;
}

function appendTomlMcpServerArray(text, server, key, tool) {
  const tableLine = `[mcp_servers.${server}]`;
  const tablePattern = new RegExp(`^\\[mcp_servers\\.${escapeRegExp(server)}\\]\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, "m");
  const match = text.match(tablePattern);

  if (!match) {
    const line = `${key} = ${formatTomlStringArray([tool])}`;
    return `${text.replace(/\s*$/, "")}\n\n${tableLine}\n${line}\n`;
  }

  const body = match[1];
  const existing = parseTomlStringArray(body, key);
  if (existing.includes(tool)) return text;

  const merged = [...existing, tool];
  const line = `${key} = ${formatTomlStringArray(merged)}`;
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*\\[[^\\]]*\\]\\s*$`, "m");
  const nextBody = keyPattern.test(body)
    ? body.replace(keyPattern, line)
    : `${body.replace(/\s*$/, "")}\n${line}\n`;

  return text.replace(tablePattern, `${tableLine}\n${nextBody}`);
}

function formatTomlStringArray(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
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
  const withTool = value.match(/^mcp__([^_]+(?:_[^_]+)*)__([^_].*)$/);
  if (withTool) {
    return { server: withTool[1].replaceAll("_", "-"), tool: withTool[2] };
  }
  const serverOnly = value.match(/^mcp__([^_]+(?:_[^_]+)*)$/);
  if (serverOnly) {
    return { server: serverOnly[1].replaceAll("_", "-"), tool: null };
  }
  return null;
}

function isMcpServerScopePermission(mcp) {
  return mcp !== null && (mcp.tool === null || mcp.tool === "*");
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

// Strip `[mcp_servers.X]` (and `[mcp_servers.X.tools.Y]`) tables that live OUTSIDE the
// managed block, for X in `serverNames`. Used before re-rendering the managed block
// so the same server isn't declared twice (TOML duplicate-key error).
function stripTopLevelMcpServerTables(text, serverNames, blockName = "mcp-servers") {
  if (!text || !Array.isArray(serverNames) || serverNames.length === 0) return text;

  const begin = `# BEGIN ai-config-sync ${blockName}`;
  const end = `# END ai-config-sync ${blockName}`;
  const blockMatch = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`, "m").exec(text);

  // Split into segments around the managed block so stripping never crosses the
  // BEGIN/END markers (otherwise a top-level table's body match could swallow them).
  const segments = blockMatch
    ? [
        { text: text.slice(0, blockMatch.index), strip: true },
        { text: blockMatch[0], strip: false },
        { text: text.slice(blockMatch.index + blockMatch[0].length), strip: true }
      ]
    : [{ text, strip: true }];

  const stripped = segments
    .map((segment) => (segment.strip ? stripMcpTablesFromSegment(segment.text, serverNames) : segment.text))
    .join("");

  // Collapse triple+ blank lines that may appear after removing tables, but preserve
  // a final newline if the original had one.
  const trailingNewline = /\n$/.test(text) ? "\n" : "";
  return stripped.replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "") + trailingNewline;
}

function stripMcpTablesFromSegment(segment, serverNames) {
  return serverNames.reduce((acc, name) => {
    // Match `[mcp_servers.X]` headers (NOT `[mcp_servers.X.tools.Y]` sub-tables —
    // those carry standalone tool-permission config the user may want to keep). The
    // body match consumes lines until the next TOML header (`[`) or a managed-block
    // marker (`# BEGIN/END ai-config-sync`), so it never accidentally swallows them.
    const pattern = new RegExp(
      `(^|\\n)\\[mcp_servers\\.${escapeRegExp(name)}\\][^\\n]*(?:\\n(?!\\[|# (?:BEGIN|END) ai-config-sync )[^\\n]*)*\\n?`,
      "g"
    );
    return acc.replace(pattern, (match, prefix) => (prefix === "\n" ? "\n" : ""));
  }, segment);
}

function codexPrefixRuleForPermission(bucket, value) {
  const pattern = bashPattern(value);
  if (!pattern) return null;

  const decision = bucket === "deny" ? "forbidden" : bucket === "ask" ? "prompt" : "allow";
  return `prefix_rule(pattern=${JSON.stringify(pattern.parts)}, decision=${JSON.stringify(decision)}, justification=${JSON.stringify(`Migrated from Claude ${bucket} permission ${value}.`)})`;
}

function bashPattern(value) {
  if (value === "Bash") return { risky: true, parts: ["bash"] };
  const match = value.match(/^Bash\((.*)\)$/);
  if (!match) return null;

  const raw = match[1].trim().replace(/:\*$/, " *").replace(/\s+\*$/, "");
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { risky: true, parts: ["bash"] };

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
  const original = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  // Strip top-level [mcp_servers.X] tables for any X we're about to render inside
  // the managed block — otherwise the same key appears twice and TOML rejects the file.
  const text = stripTopLevelMcpServerTables(original, Object.keys(merged), "mcp-servers");

  writeFileSync(targetPath, replaceTextBlock(text, "mcp-servers", renderCodexMcpServers(merged)));
}

function mergeMcpIntoClaude(targetPath, sourcePath, sourceHost, serverNames) {
  const sourceServers = pickServers(sourceHost === "codex"
    ? readCodexMcpServers(sourcePath)
    : readClaudeMcpServers(sourcePath), serverNames);
  const { file, projectKey } = parseClaudeMcpSource(targetPath);
  const target = readJsonFile(file, {});
  if (projectKey) {
    target.projects ??= {};
    target.projects[projectKey] ??= {};
    target.projects[projectKey].mcpServers = { ...(target.projects[projectKey].mcpServers ?? {}), ...sourceServers };
  } else {
    target.mcpServers = { ...(target.mcpServers ?? {}), ...sourceServers };
  }
  writeFileSync(file, `${JSON.stringify(target, null, 2)}\n`);
}

function deleteClaudeMcpServers(targetPath, serverNames) {
  const targets = Array.isArray(targetPath) ? targetPath : [targetPath];
  for (const spec of targets) {
    const { file, projectKey } = parseClaudeMcpSource(spec);
    if (!existsSync(file)) continue;
    const target = readJsonFile(file, {});
    const bag = projectKey
      ? (target.projects?.[projectKey]?.mcpServers)
      : target.mcpServers;
    if (!bag) continue;
    let mutated = false;
    for (const name of serverNames) {
      if (name in bag) {
        delete bag[name];
        mutated = true;
      }
    }
    if (mutated) writeFileSync(file, `${JSON.stringify(target, null, 2)}\n`);
  }
}

function deleteCodexMcpServers(targetPath, serverNames) {
  const text = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  let nextText = text;

  for (const name of serverNames) {
    const serverPattern = new RegExp(`^\\[mcp_servers\\.${escapeRegExp(name)}\\]\\n[\\s\\S]*?(?=^\\[mcp_servers\\.|(?![\\s\\S]))`, "gm");
    const toolsPattern = new RegExp(`^\\[mcp_servers\\.${escapeRegExp(name)}\\.tools\\.[^\\]]+\\]\\n[\\s\\S]*?(?=^\\[|(?![\\s\\S]))`, "gm");
    nextText = nextText.replace(serverPattern, "").replace(toolsPattern, "");
  }

  writeFileSync(targetPath, nextText.replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n"));
}

function deleteClaudePermissions(targetPath, itemNames) {
  const target = readJsonFile(targetPath, {});
  target.permissions ??= {};

  for (const itemName of itemNames) {
    const { bucket, value } = parsePermissionItem(itemName);
    const list = Array.isArray(target.permissions[bucket]) ? target.permissions[bucket] : [];
    target.permissions[bucket] = list.filter((item) => item !== value);
  }

  writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`);
}

function deleteClaudeHooks(targetPath, itemNames) {
  const target = readJsonFile(targetPath, {});
  target.hooks ??= {};

  for (const itemName of itemNames) {
    delete target.hooks[itemName];
  }

  writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`);
}

function deleteCodexManagedItems(targetPath, area, itemNames) {
  const text = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  const emptyValues = {};
  const nextText = replaceManagedBlock(text, area, emptyValues, itemNames, { dropMissingSelected: true });
  writeFileSync(targetPath, nextText);
}

// Reads the source-side claude settings.json and returns every permission value
// (across allow/ask/deny buckets) that still exists. Used to decide whether
// top-level codex toggles (sandbox_mode, web_search) should be torn down after
// the items that justified them are removed.
function remainingClaudePermissionItems(sourcePath) {
  if (!sourcePath || !existsSync(sourcePath)) return [];
  const data = readJsonFile(sourcePath, {});
  const permissions = data?.permissions ?? {};
  return Object.values(permissions)
    .flat()
    .filter((value) => typeof value === "string");
}

// Mirror of the forward writer (applyCodexNativePermissionMapping +
// writeCodexPermissionRules): for each deleted item, strip its native
// counterpart from config.toml / default.rules. Top-level toggles only fall
// away when no remaining claude item still requires them.
function deleteCodexNativePermissionItems(configPath, deletedItemNames, remainingClaudeItemNames) {
  const rulesPath = codexRulesPath(configPath);
  let configText = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  let rulesText = existsSync(rulesPath) ? readFileSync(rulesPath, "utf8") : "";

  for (const itemName of deletedItemNames) {
    const { bucket, value } = parsePermissionItem(itemName);

    const pattern = bashPattern(value);
    if (pattern) {
      const decision = bucket === "deny" ? "forbidden" : bucket === "ask" ? "prompt" : "allow";
      rulesText = removePrefixRuleLine(rulesText, pattern.parts, decision);
    }

    const mcp = parseMcpPermission(value);
    if (mcp) {
      if (isMcpServerScopePermission(mcp)) {
        if (bucket === "deny") {
          configText = removeTomlMcpServerKey(configText, mcp.server, "enabled_tools");
        }
      } else {
        configText = removeFromTomlMcpServerArray(configText, mcp.server, "enabled_tools", mcp.tool);
        configText = removeFromTomlMcpServerArray(configText, mcp.server, "disabled_tools", mcp.tool);
        configText = removeTomlMcpToolBlock(configText, mcp.server, mcp.tool);
      }
    }
  }

  const remainingHasFsWrite = remainingClaudeItemNames.some((value) => ["Write", "Edit", "MultiEdit"].includes(value));
  if (!remainingHasFsWrite) {
    configText = removeTomlRootKey(configText, "sandbox_mode");
  }

  const remainingHasWeb = remainingClaudeItemNames.some((value) => value === "WebSearch" || value === "WebFetch");
  if (!remainingHasWeb) {
    configText = removeTomlRootKey(configText, "web_search");
  }

  // network_access under [sandbox_workspace_write] is intentionally not auto-removed:
  // it is also user-controllable and only the forward writer for WebFetch sets it.

  writeFileSync(configPath, configText);
  if (existsSync(rulesPath)) {
    writeFileSync(rulesPath, rulesText);
  }
}

// Match prefix_rule(...) lines by their (parts, decision) tuple instead of by an
// exact-string match against codexPrefixRuleForPermission's output. Real-world
// default.rules files vary in whitespace inside the JSON array and may omit the
// trailing justification= argument (and may grow new fields in the future); the
// tuple is the only stable identity. Drops at most one matching line per call so
// repeated deletes stay idempotent against the forward writer's one-line-per-emit
// semantics.
function removePrefixRuleLine(text, parts, decision) {
  if (!Array.isArray(parts)) return text;
  const target = JSON.stringify(parts);
  const lines = text.split(/\r?\n/);
  const filtered = [];
  let removed = false;

  for (const line of lines) {
    if (!removed) {
      const match = line.match(/^\s*prefix_rule\(\s*pattern\s*=\s*(\[[^\]]*\])\s*,\s*decision\s*=\s*"([^"]+)"/);
      if (match) {
        const lineParts = parseJsonLike(match[1], null);
        const lineCanonical = Array.isArray(lineParts) ? JSON.stringify(lineParts) : null;
        if (lineCanonical === target && match[2] === decision) {
          removed = true;
          continue;
        }
      }
    }
    filtered.push(line);
  }

  return filtered.join("\n");
}

function removeTomlRootKey(text, key) {
  const pattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*\\r?\\n?`, "m");
  return text.replace(pattern, "");
}

function removeTomlMcpServerKey(text, server, key) {
  const tablePattern = new RegExp(`^\\[mcp_servers\\.${escapeRegExp(server)}\\]\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, "m");
  const match = text.match(tablePattern);
  if (!match) return text;

  const body = match[1];
  const keyPattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*\\r?\\n?`, "m");
  if (!keyPattern.test(body)) return text;

  const nextBody = body.replace(keyPattern, "");
  return text.replace(tablePattern, `[mcp_servers.${server}]\n${nextBody}`);
}

function removeFromTomlMcpServerArray(text, server, key, tool) {
  const tablePattern = new RegExp(`^\\[mcp_servers\\.${escapeRegExp(server)}\\]\\n([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`, "m");
  const match = text.match(tablePattern);
  if (!match) return text;

  const body = match[1];
  const existing = parseTomlStringArray(body, key);
  if (!existing.includes(tool)) return text;

  const remaining = existing.filter((item) => item !== tool);
  const keyPattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=\\s*\\[[^\\]]*\\][ \\t]*\\r?\\n?`, "m");

  const nextBody = remaining.length === 0
    ? body.replace(keyPattern, "")
    : body.replace(keyPattern, `${key} = ${formatTomlStringArray(remaining)}\n`);

  return text.replace(tablePattern, `[mcp_servers.${server}]\n${nextBody}`);
}

function removeTomlMcpToolBlock(text, server, tool) {
  const blockPattern = new RegExp(
    `^\\[mcp_servers\\.${escapeRegExp(server)}\\.tools\\.${escapeRegExp(tool)}\\]\\n[\\s\\S]*?(?=^\\[|(?![\\s\\S]))`,
    "m"
  );
  return text.replace(blockPattern, "");
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
  if (Array.isArray(path)) {
    return path.reduce((servers, item) => ({ ...servers, ...readClaudeMcpServerDetails(item) }), {});
  }
  const { file, projectKey } = parseClaudeMcpSource(path);
  const data = readJsonFile(file, {});
  const raw = projectKey
    ? (data?.projects?.[projectKey]?.mcpServers ?? {})
    : (data.mcpServers ?? data.servers ?? {});
  return normalizeMcpServerDetails(raw);
}

function readCodexMcpServerDetails(path) {
  if (Array.isArray(path)) {
    return path.reduce((servers, item) => ({ ...servers, ...readCodexMcpServerDetails(item) }), {});
  }
  if (!existsSync(path)) return {};
  if (path.endsWith(".json")) {
    const data = readJsonFile(path, {});
    return normalizeMcpServerDetails(data.mcpServers ?? data.servers ?? {});
  }
  const text = readFileSync(path, "utf8");
  const servers = {};
  const tablePattern = /^\[mcp_servers\.([^\].]+)\]\n([\s\S]*?)(?=^\[mcp_servers\.|(?![\s\S]))/gm;

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
  if (Array.isArray(path)) {
    return path.reduce((servers, item) => ({ ...servers, ...readClaudeMcpServers(item) }), {});
  }
  const { file, projectKey } = parseClaudeMcpSource(path);
  const data = readJsonFile(file, {});
  const raw = projectKey
    ? (data?.projects?.[projectKey]?.mcpServers ?? {})
    : (data.mcpServers ?? data.servers ?? {});
  return normalizeMcpServers(raw);
}

function readCodexMcpServers(path) {
  if (Array.isArray(path)) {
    return path.reduce((servers, item) => ({ ...servers, ...readCodexMcpServers(item) }), {});
  }
  if (!existsSync(path)) return {};
  if (path.endsWith(".json")) {
    const data = readJsonFile(path, {});
    return normalizeMcpServers(data.mcpServers ?? data.servers ?? {});
  }
  const text = readFileSync(path, "utf8");
  const servers = {};
  const tablePattern = /^\[mcp_servers\.([^\].]+)\]\n([\s\S]*?)(?=^\[mcp_servers\.|(?![\s\S]))/gm;

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
  const stripSecrets = stripSecretsEnabled();
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => typeof value === "string" && (!stripSecrets || !isSecretEnvKey(key)))
  );
}

function isSecretEnvKey(key) {
  return /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key);
}

function secretEnvKeys(env) {
  if (!stripSecretsEnabled()) return [];
  return Object.keys(env).filter((key) => isSecretEnvKey(key)).sort();
}

// Opt-out for users who want the conservative behavior of stripping secret-like
// env values during MCP sync. Default copies them because both source and target
// live under the same user's home directory and the source already stores the
// secret in plaintext — stripping just makes the synced target nonfunctional.
function stripSecretsEnabled() {
  const value = process.env.AI_CONFIG_SYNC_STRIP_SECRETS;
  return typeof value === "string" && /^(1|true|yes)$/i.test(value.trim());
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

function loadLayeredRule(candidates, defaults, mergeFn) {
  let merged = JSON.parse(JSON.stringify(defaults));
  const layers = [];
  const orderedFromBase = [...candidates].reverse();
  for (const path of orderedFromBase) {
    if (!existsSync(path)) continue;
    const overlay = readJsonFile(path, defaults);
    merged = mergeFn(merged, overlay);
    layers.push(path);
  }
  const firstMatch = candidates.find((path) => existsSync(path));
  return {
    path: firstMatch ?? candidates[candidates.length - 1],
    layers,
    data: merged
  };
}

function mergeTerminologyMap(base, overlay) {
  if (!overlay || typeof overlay !== "object") return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "layers" || key === "rules") continue;
    merged[key] = value;
  }
  const baseLayers = Array.isArray(base.layers) ? base.layers : [];
  const overlayLayers = Array.isArray(overlay.layers) ? [...overlay.layers] : [];
  if (Array.isArray(overlay.rules) && overlay.rules.length > 0) {
    overlayLayers.push({ id: "_overlay_top_rules", rules: overlay.rules });
  }
  const layerIndex = new Map();
  const ordered = [];
  for (const layer of baseLayers) {
    const clone = { ...layer, rules: Array.isArray(layer.rules) ? [...layer.rules] : [] };
    ordered.push(clone);
    if (clone.id != null) layerIndex.set(clone.id, clone);
  }
  for (const overlayLayer of overlayLayers) {
    if (overlayLayer.id != null && layerIndex.has(overlayLayer.id)) {
      const baseLayer = layerIndex.get(overlayLayer.id);
      const baseRules = Array.isArray(baseLayer.rules) ? baseLayer.rules : [];
      const overlayRules = Array.isArray(overlayLayer.rules) ? overlayLayer.rules : [];
      const ruleIndex = new Map();
      const orderedRules = [];
      for (const rule of baseRules) {
        const clone = { ...rule };
        orderedRules.push(clone);
        if (clone.id != null) ruleIndex.set(clone.id, clone);
      }
      for (const overlayRule of overlayRules) {
        if (overlayRule.id != null && ruleIndex.has(overlayRule.id)) {
          Object.assign(ruleIndex.get(overlayRule.id), overlayRule);
        } else {
          const clone = { ...overlayRule };
          orderedRules.push(clone);
          if (clone.id != null) ruleIndex.set(clone.id, clone);
        }
      }
      const { rules: _ignored, ...rest } = overlayLayer;
      Object.assign(baseLayer, rest);
      baseLayer.rules = orderedRules;
    } else {
      const clone = { ...overlayLayer, rules: Array.isArray(overlayLayer.rules) ? [...overlayLayer.rules] : [] };
      ordered.push(clone);
      if (clone.id != null) layerIndex.set(clone.id, clone);
    }
  }
  merged.layers = ordered;
  return merged;
}

function mergeTargetTemplates(base, overlay) {
  if (!overlay || typeof overlay !== "object") return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "templates") continue;
    merged[key] = value;
  }
  const baseTemplates = Array.isArray(base.templates) ? base.templates : [];
  const overlayTemplates = Array.isArray(overlay.templates) ? overlay.templates : [];
  const index = new Map();
  const ordered = [];
  for (const template of baseTemplates) {
    const clone = { ...template };
    ordered.push(clone);
    if (clone.id != null) index.set(clone.id, clone);
  }
  for (const overlayTemplate of overlayTemplates) {
    if (overlayTemplate.id != null && index.has(overlayTemplate.id)) {
      Object.assign(index.get(overlayTemplate.id), overlayTemplate);
    } else {
      const clone = { ...overlayTemplate };
      ordered.push(clone);
      if (clone.id != null) index.set(clone.id, clone);
    }
  }
  merged.templates = ordered;
  return merged;
}

function mergeCallTemplates(base, overlay) {
  if (!overlay || typeof overlay !== "object") return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "supported" || key === "unsupported") continue;
    merged[key] = value;
  }
  merged.supported = mergeByIdShallow(base.supported, overlay.supported);
  merged.unsupported = mergeByIdShallow(base.unsupported, overlay.unsupported);
  return merged;
}

function mergeByIdShallow(baseList, overlayList) {
  const baseArr = Array.isArray(baseList) ? baseList : [];
  const overlayArr = Array.isArray(overlayList) ? overlayList : [];
  const index = new Map();
  const ordered = [];
  for (const item of baseArr) {
    const clone = { ...item };
    ordered.push(clone);
    if (clone.id != null) index.set(clone.id, clone);
  }
  for (const overlayItem of overlayArr) {
    if (overlayItem.id != null && index.has(overlayItem.id)) {
      Object.assign(index.get(overlayItem.id), overlayItem);
    } else {
      const clone = { ...overlayItem };
      ordered.push(clone);
      if (clone.id != null) index.set(clone.id, clone);
    }
  }
  return ordered;
}

function mergeRouteMappings(base, overlay) {
  if (!overlay || typeof overlay !== "object") return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "areas") continue;
    merged[key] = value;
  }
  const baseAreas = base.areas && typeof base.areas === "object" ? base.areas : {};
  const overlayAreas = overlay.areas && typeof overlay.areas === "object" ? overlay.areas : {};
  const mergedAreas = {};
  for (const [areaKey, areaValue] of Object.entries(baseAreas)) {
    mergedAreas[areaKey] = { ...areaValue };
  }
  for (const [areaKey, overlayArea] of Object.entries(overlayAreas)) {
    if (mergedAreas[areaKey] && typeof mergedAreas[areaKey] === "object" && typeof overlayArea === "object" && overlayArea !== null) {
      mergedAreas[areaKey] = { ...mergedAreas[areaKey], ...overlayArea };
    } else {
      mergedAreas[areaKey] = overlayArea;
    }
  }
  merged.areas = mergedAreas;
  return merged;
}

function mergeAgentsMap(base, overlay) {
  if (!overlay || typeof overlay !== "object") return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "fields" || key === "models") continue;
    merged[key] = value;
  }
  const baseFields = Array.isArray(base.fields) ? base.fields : [];
  const overlayFields = Array.isArray(overlay.fields) ? overlay.fields : [];
  const fieldIndex = new Map();
  const orderedFields = [];
  const fieldKey = (entry) => `${entry.claude ?? ""}→${entry.codex ?? ""}`;
  for (const field of baseFields) {
    const clone = { ...field };
    orderedFields.push(clone);
    fieldIndex.set(fieldKey(clone), clone);
  }
  for (const overlayField of overlayFields) {
    const key = fieldKey(overlayField);
    if (fieldIndex.has(key)) {
      Object.assign(fieldIndex.get(key), overlayField);
    } else {
      const clone = { ...overlayField };
      orderedFields.push(clone);
      fieldIndex.set(key, clone);
    }
  }
  merged.fields = orderedFields;

  const baseModels = base.models && typeof base.models === "object" ? base.models : {};
  const overlayModels = overlay.models && typeof overlay.models === "object" ? overlay.models : null;
  if (overlayModels) {
    const mergedModels = { ...baseModels };
    for (const [key, value] of Object.entries(overlayModels)) {
      if (key === "tiers") continue;
      mergedModels[key] = value;
    }
    mergedModels.tiers = mergeByIdShallow(baseModels.tiers, overlayModels.tiers);
    merged.models = mergedModels;
  } else if (Object.keys(baseModels).length > 0) {
    merged.models = { ...baseModels };
  }
  return merged;
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

function diffScope(scope, ignoreRules = []) {
  const paths = scope === "global" ? globalPaths() : projectPaths(process.cwd());
  const entries = [];

  compareInstructions(entries, scope, paths.claude.instructions, paths.codex.instructions, paths.claude.instructionPaths, paths.codex.instructionPaths);
  compareSkillDirs(entries, scope, paths.claude.skills, paths.codex.skills, paths.claude.skillsPaths ?? [paths.claude.skills], paths.codex.skillsPaths ?? [paths.codex.skills], ignoreRules);
  compareAgents(entries, scope, paths.claude.agents, paths.codex.agents, ignoreRules);
  compareMcpServers(entries, scope, paths.claude.mcp, paths.codex.mcp, paths.claude.mcpPaths, paths.codex.mcpPaths);

  if (paths.claude.settings && paths.codex.settings) {
    compareSettingsItems(entries, scope, "permissions", paths.claude.settings, paths.codex.settings);
    compareSettingsItems(entries, scope, "hooks", paths.claude.settings, paths.codex.settings);
  }

  return entries;
}

function syncStatePath(scope) {
  const name = scope === "global"
    ? "global"
    : `project-${createHash("sha256").update(resolve(process.cwd())).digest("hex").slice(0, 16)}`;
  return `${home}/.ai-config-sync-manager/state/${name}.json`;
}

function readSyncState(scope) {
  const path = syncStatePath(scope);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeSyncState(scope) {
  const path = syncStatePath(scope);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(createSyncState(scope), null, 2)}\n`);
}

function createSyncState(scope) {
  const paths = scope === "global" ? globalPaths() : projectPaths(process.cwd());
  return {
    version: 1,
    scope,
    root: scope === "global" ? home : resolve(process.cwd()),
    updatedAt: new Date().toISOString(),
    areas: {
      mcp: {
        claude: Object.keys(readClaudeMcpServers(paths.claude.mcpPaths ?? paths.claude.mcp)).sort(),
        codex: Object.keys(readCodexMcpServers(paths.codex.mcpPaths ?? paths.codex.mcp)).sort()
      },
      permissions: {
        claude: settingsItems("claude", "permissions", paths.claude.settings),
        codex: settingsItems("codex", "permissions", paths.codex.settings)
      },
      hooks: {
        claude: settingsItems("claude", "hooks", paths.claude.settings),
        codex: settingsItems("codex", "hooks", paths.codex.settings)
      },
      agents: {
        claude: enumerateClaudeAgents(paths.claude.agents).map((agent) => agent.name).sort(),
        codex: enumerateCodexAgents(paths.codex.agents).map((agent) => agent.name).sort()
      },
      skills: {
        claude: [...enumerateSkillIndex(paths.claude.skillsPaths ?? [paths.claude.skills]).keys()].sort(),
        codex: [...enumerateSkillIndex(paths.codex.skillsPaths ?? [paths.codex.skills]).keys()].sort()
      }
      // TODO: track instructions presence/hash per host once item-level diffs land for that area.
    }
  };
}

function globalPaths() {
  return {
    claude: {
      instructions: `${home}/.claude/CLAUDE.md`,
      instructionPaths: [`${home}/.claude/CLAUDE.md`, `${home}/.claude/settings.json`],
      skills: `${home}/.claude/skills`,
      skillsPaths: [`${home}/.claude/skills`],
      agents: `${home}/.claude/agents`,
      mcp: `${home}/.claude.json`,
      mcpPaths: [`${home}/.claude.json`],
      settings: `${home}/.claude/settings.json`
    },
    codex: {
      instructions: `${home}/.codex/AGENTS.md`,
      instructionPaths: [`${home}/.codex/AGENTS.md`, `${home}/.codex/config.toml`],
      skills: firstExisting([`${home}/.agents/skills`, `${home}/.codex/skills`]),
      skillsPaths: [`${home}/.agents/skills`, `${home}/.codex/skills`],
      agents: `${home}/.codex/agents`,
      mcp: `${home}/.codex/config.toml`,
      mcpPaths: [`${home}/.codex/config.toml`, `${home}/.codex/mcp.json`, `${home}/.codex/settings.json`],
      settings: `${home}/.codex/config.toml`
    }
  };
}

function projectPaths(root) {
  return {
    claude: {
      instructions: `${root}/CLAUDE.md`,
      instructionPaths: [`${root}/CLAUDE.md`, `${root}/.claude/settings.json`],
      skills: `${root}/.claude/skills`,
      skillsPaths: [`${root}/.claude/skills`],
      agents: `${root}/.claude/agents`,
      mcp: `${root}/.mcp.json`,
      mcpPaths: [`${root}/.mcp.json`, claudeProjectLocalMcpSpec(root)],
      settings: `${root}/.claude/settings.json`
    },
    codex: {
      instructions: `${root}/AGENTS.md`,
      instructionPaths: [`${root}/AGENTS.md`, `${root}/.codex/config.toml`],
      skills: firstExisting([`${root}/.agents/skills`, `${root}/.codex/skills`]),
      skillsPaths: [`${root}/.agents/skills`, `${root}/.codex/skills`],
      agents: `${root}/.codex/agents`,
      mcp: `${root}/.codex/config.toml`,
      mcpPaths: [`${root}/.codex/config.toml`, `${root}/.codex/mcp.json`, `${root}/.codex/settings.json`],
      settings: `${root}/.codex/config.toml`
    }
  };
}

function firstExisting(paths) {
  return paths.find((path) => existsSync(path)) ?? paths[0];
}

function existingPaths(paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return list.filter((path) => existsSync(claudeMcpSourceFile(path)));
}

function mcpSourceExists(paths) {
  return existingPaths(paths).length > 0;
}

// Claude MCP sources can be expressed as either a plain file path or a file with a
// `#projects:<absRoot>` suffix that points at `data.projects[absRoot].mcpServers`
// inside `~/.claude.json`. Encoding stays a plain string so existing string-based
// readers/writers continue to flow unchanged.
function claudeProjectLocalMcpSpec(root) {
  return `${home}/.claude.json#projects:${root}`;
}

function parseClaudeMcpSource(spec) {
  if (typeof spec !== "string") return { file: spec, projectKey: null };
  const marker = spec.indexOf("#projects:");
  if (marker === -1) return { file: spec, projectKey: null };
  return { file: spec.slice(0, marker), projectKey: spec.slice(marker + "#projects:".length) };
}

function claudeMcpSourceFile(spec) {
  return parseClaudeMcpSource(spec).file;
}

// Display helper: pick the MCP source whose underlying file actually contains
// servers. Falls back to the first existing source so status output never lies
// about which file we inspected.
function firstClaudeMcpDisplayPath(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return null;
  for (const spec of paths) {
    if (Object.keys(readClaudeMcpServers(spec)).length > 0) return formatClaudeMcpDisplayPath(spec);
  }
  return formatClaudeMcpDisplayPath(paths[0]);
}

function formatClaudeMcpDisplayPath(spec) {
  const { file, projectKey } = parseClaudeMcpSource(spec);
  return projectKey ? `${file} (projects.${projectKey})` : file;
}

function compareInstructions(entries, scope, claudePath, codexPath, claudePaths = [claudePath], codexPaths = [codexPath]) {
  const claude = instructionState("claude", claudePaths);
  const codex = instructionState("codex", codexPaths);

  if (!claude.exists && !codex.exists) return;
  if (instructionsEquivalent(claude.content, codex.content)) return;

  if (claude.hash !== codex.hash) {
    entries.push({
      scope,
      area: "instructions",
      risk: "safe",
      summary: "Instructions differ",
      claudePath,
      codexPath,
      claudeInstructionPaths: claude.paths,
      codexInstructionPaths: codex.paths,
      claudeInstructionCheckedPaths: claude.checkedPaths,
      codexInstructionCheckedPaths: codex.checkedPaths,
      claudeInstructionContent: claude.content,
      codexInstructionContent: codex.content,
      claude: claude.summary,
      codex: codex.summary,
      mappingQuality: "equivalent"
    });
  }
}

function instructionsEquivalent(claudeContent, codexContent) {
  return transformTextForHost(claudeContent, "claude", "codex") === String(codexContent ?? "")
    || transformTextForHost(codexContent, "codex", "claude") === String(claudeContent ?? "");
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
      codex: codex.summary,
      mappingQuality: area === "instructions" ? "equivalent" : "unsupported"
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
      codex: codex.summary,
      mappingQuality: risk === "safe" ? "exact" : "unsupported"
  });
}

function compareSkillDirs(entries, scope, claudeDir, codexDir, claudeDirs = [claudeDir], codexDirs = [codexDir], ignoreRules = []) {
  const claudeIndex = enumerateSkillIndex(claudeDirs);
  const codexIndex = enumerateSkillIndex(codexDirs);
  const symlinkNames = uniqueStrings([
    ...enumerateSkillSymlinkIndex(claudeDirs).keys(),
    ...enumerateSkillSymlinkIndex(codexDirs).keys()
  ]);
  const claude = [...claudeIndex.keys()].filter((name) => !symlinkNames.includes(name)).sort();
  const codex = [...codexIndex.keys()].filter((name) => !symlinkNames.includes(name)).sort();
  const missingInCodex = claude.filter((name) => !codexIndex.has(name));
  const missingInClaude = codex.filter((name) => !claudeIndex.has(name));
  const skillsCompareEntry = { scope, area: "skills", claudePath: claudeDir, codexPath: codexDir };
  const conflicts = claude
    .filter((name) => codexIndex.has(name))
    .filter((name) => !skillDirsEquivalent(join(claudeIndex.get(name), name), join(codexIndex.get(name), name), skillsCompareEntry, name, ignoreRules));

  const claudeSkillIndex = Object.fromEntries(claudeIndex);
  const codexSkillIndex = Object.fromEntries(codexIndex);

  if (symlinkNames.length > 0) {
    entries.push({
      scope,
      area: "skills",
      risk: "manual",
      summary: "skill symlink unsupported",
      statusOnly: true,
      claudePath: claudeDir,
      codexPath: codexDir,
      claudeSkillIndex,
      codexSkillIndex,
      claude: `${claude.length} skill(s)`,
      codex: `${codex.length} skill(s)`,
      unsupported: symlinkNames,
      itemQualities: Object.fromEntries(symlinkNames.map((name) => [name, "unsupported"]))
    });
  }

  if (missingInCodex.length > 0 || missingInClaude.length > 0) {
    entries.push({
      scope,
      area: "skills",
      risk: "safe",
      summary: "skills missing in one host",
      claudePath: claudeDir,
      codexPath: codexDir,
      claudeSkillIndex,
      codexSkillIndex,
      claude: `${claude.length} skill(s)`,
      codex: `${codex.length} skill(s)`,
      missingInCodex,
      missingInClaude,
      itemQualities: itemQualities("skills", [...missingInCodex, ...missingInClaude])
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
      claudeSkillIndex,
      codexSkillIndex,
      claude: `${claude.length} skill(s)`,
      codex: `${codex.length} skill(s)`,
      conflicts,
      itemQualities: Object.fromEntries(conflicts.map((name) => [name, "unsupported"]))
    });
  }
}

function compareAgents(entries, scope, claudeDir, codexDir, ignoreRules = []) {
  const claudeAgents = enumerateClaudeAgents(claudeDir);
  const codexAgents = enumerateCodexAgents(codexDir);
  const claudeNames = claudeAgents.map((agent) => agent.name).sort();
  const codexNames = codexAgents.map((agent) => agent.name).sort();
  const claudeIndex = new Map(claudeAgents.map((agent) => [agent.name, agent]));
  const codexIndex = new Map(codexAgents.map((agent) => [agent.name, agent]));

  const missingInCodex = claudeNames.filter((name) => !codexIndex.has(name));
  const missingInClaude = codexNames.filter((name) => !claudeIndex.has(name));
  const agentsCompareEntry = { scope, area: "agents", claudePath: claudeDir, codexPath: codexDir };
  const conflicts = claudeNames
    .filter((name) => codexIndex.has(name))
    .filter((name) => !agentsEquivalent(claudeIndex.get(name), codexIndex.get(name), agentsCompareEntry, name, ignoreRules));

  // Per-name path lookup for downstream preview/apply. Required because Claude agents
  // can live one folder deep (e.g. .claude/agents/code-writer/code-writer-logic.md);
  // a flat baseDir + ${name}.md guess misses them after canonical-name matching.
  const claudeAgentPaths = Object.fromEntries(claudeAgents.map((agent) => [agent.name, agent.path]));
  const codexAgentPaths = Object.fromEntries(codexAgents.map((agent) => [agent.name, agent.path]));

  if (missingInCodex.length > 0 || missingInClaude.length > 0) {
    entries.push({
      scope,
      area: "agents",
      risk: "safe",
      summary: "agents missing in one host",
      claudePath: claudeDir,
      codexPath: codexDir,
      claudeAgentPaths,
      codexAgentPaths,
      claude: `${claudeNames.length} agent(s)`,
      codex: `${codexNames.length} agent(s)`,
      missingInCodex,
      missingInClaude,
      itemQualities: itemQualities("agents", [...missingInCodex, ...missingInClaude])
    });
  }

  if (conflicts.length > 0) {
    entries.push({
      scope,
      area: "agents",
      risk: "manual",
      summary: "agents conflict",
      claudePath: claudeDir,
      codexPath: codexDir,
      claudeAgentPaths,
      codexAgentPaths,
      claude: `${claudeNames.length} agent(s)`,
      codex: `${codexNames.length} agent(s)`,
      conflicts,
      itemQualities: Object.fromEntries(conflicts.map((name) => [name, "unsupported"]))
    });
  }
}

function enumerateClaudeAgents(dir) {
  if (!dir || !existsSync(dir)) return [];
  const agents = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const path = join(dir, entry.name);
      const stem = entry.name.slice(0, -3);
      agents.push({ name: canonicalAgentName(parseClaudeAgentFile(path).frontmatter?.name, stem), path, group: null });
    } else if (entry.isDirectory()) {
      const groupDir = join(dir, entry.name);
      for (const child of readdirSync(groupDir, { withFileTypes: true })) {
        if (!child.isFile() || !child.name.endsWith(".md")) continue;
        const path = join(groupDir, child.name);
        const stem = child.name.slice(0, -3);
        agents.push({ name: canonicalAgentName(parseClaudeAgentFile(path).frontmatter?.name, stem), path, group: entry.name });
      }
    }
  }
  return agents;
}

function enumerateCodexAgents(dir) {
  if (!dir || !existsSync(dir)) return [];
  const agents = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
    const path = join(dir, entry.name);
    const stem = entry.name.slice(0, -5);
    agents.push({ name: canonicalAgentName(parseCodexAgentFile(path).name, stem), path });
  }
  return agents;
}

function canonicalAgentName(rawName, fallbackStem) {
  const candidate = typeof rawName === "string" ? rawName.trim() : "";
  const source = candidate || fallbackStem || "";
  return source.replace(/\//g, "-");
}

function agentsEquivalent(claudeAgent, codexAgent, entry, item, rules) {
  if (!claudeAgent || !codexAgent) return false;
  const claude = parseClaudeAgentFile(claudeAgent.path);
  const codex = parseCodexAgentFile(codexAgent.path);
  const terms = entry
    ? uniqueStrings([
      ...applicableTermRules(rules ?? [], entry, item, "claude"),
      ...applicableTermRules(rules ?? [], entry, item, "codex")
    ])
    : [];
  return agentBodiesEqual(claude.body, codex.developer_instructions, terms);
}

function agentBodiesEqual(claudeBody, codexBody, terms) {
  const left = stripAgentMigrationPreamble(claudeBody ?? "");
  const right = stripAgentMigrationPreamble(codexBody ?? "");
  if (left === right) return true;
  if (transformTextForHost(left, "claude", "codex") === right) return true;
  if (transformTextForHost(right, "codex", "claude") === left) return true;

  if (terms && terms.length > 0) {
    const expandedTerms = expandTermsBothDirections(terms);
    const maskedLeft = maskLinesContaining(left, expandedTerms);
    const maskedRight = maskLinesContaining(right, expandedTerms);
    if (maskedLeft === maskedRight) return true;
    if (maskLinesContaining(transformTextForHost(left, "claude", "codex"), expandedTerms) === maskedRight) return true;
    if (maskedLeft === maskLinesContaining(transformTextForHost(right, "codex", "claude"), expandedTerms)) return true;
  }
  return false;
}

function stripAgentMigrationPreamble(text) {
  const pattern = agentMigrationPreamblePattern();
  return pattern ? String(text ?? "").replace(pattern, "") : String(text ?? "");
}

function agentMigrationPreamblePattern() {
  const source = agentsMapData().migration_preamble_pattern;
  if (typeof source !== "string" || !source) return null;
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

function parseClaudeAgentFile(path) {
  if (!existsSync(path)) return { frontmatter: {}, body: "" };
  const text = readFileSync(path, "utf8");
  return parseClaudeAgentText(text);
}

function parseClaudeAgentText(text) {
  if (!text.startsWith("---")) return { frontmatter: {}, body: text };
  const closing = text.indexOf("\n---", 3);
  if (closing === -1) return { frontmatter: {}, body: text };
  const header = text.slice(3, closing).replace(/^\r?\n/, "");
  const bodyStart = closing + 4;
  const body = text.slice(bodyStart).replace(/^\r?\n/, "");
  return { frontmatter: parseClaudeFrontmatter(header), body };
}

function parseClaudeFrontmatter(header) {
  const result = {};
  for (const rawLine of header.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    const rawValue = line.slice(separator + 1).trim();
    result[key] = parseFrontmatterScalar(rawValue);
  }
  return result;
}

function parseFrontmatterScalar(raw) {
  if (raw === "") return "";
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return parseJsonLike(raw, raw.slice(1, -1));
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

function serializeClaudeAgentFile(frontmatter, body) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${key}: ${serializeFrontmatterScalar(value)}`);
  }
  lines.push("---", "");
  const trailing = body.endsWith("\n") ? body : `${body}\n`;
  return `${lines.join("\n")}${trailing}`;
}

function serializeFrontmatterScalar(value) {
  const text = String(value);
  if (/[:#"\n]/.test(text)) return JSON.stringify(text);
  return text;
}

function parseCodexAgentFile(path) {
  if (!existsSync(path)) return { name: "", description: "", model: "", developer_instructions: "" };
  return parseCodexAgentText(readFileSync(path, "utf8"));
}

function parseCodexAgentText(text) {
  const fields = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!match) continue;
    fields[match[1]] = parseTomlScalar(match[2]);
  }
  return {
    name: fields.name ?? "",
    description: fields.description ?? "",
    model: fields.model ?? "",
    model_reasoning_effort: fields.model_reasoning_effort,
    developer_instructions: fields.developer_instructions ?? ""
  };
}

function serializeCodexAgentFile(fields) {
  const lines = [];
  for (const key of ["name", "description", "model", "model_reasoning_effort", "developer_instructions"]) {
    const value = fields[key];
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${key} = ${JSON.stringify(String(value))}`);
  }
  return `${lines.join("\n")}\n`;
}

function mapAgentToCodex(claude, options = {}) {
  const aliases = modelAliasMap("claude", "codex");
  const fm = claude.frontmatter ?? {};
  const rawBody = claude.body ?? "";
  const body = transformTextForHost(rawBody, "claude", "codex", { callArchive: options.callArchive });
  const fallbackName = (typeof options.fallbackName === "string" && options.fallbackName) || "";
  const name = (fm.name && String(fm.name).trim()) || fallbackName;
  const description = (fm.description && String(fm.description).trim()) || extractDescriptionFromBody(rawBody) || name;
  const codexFields = {
    name,
    description,
    model: aliases[fm.model] ?? fm.model ?? "",
    developer_instructions: body
  };
  if (options.preserveCodex?.model_reasoning_effort) {
    codexFields.model_reasoning_effort = options.preserveCodex.model_reasoning_effort;
  }
  return codexFields;
}

function extractDescriptionFromBody(body) {
  const text = String(body ?? "").replace(/\r\n/g, "\n");
  const paragraphs = text.split(/\n{2,}/);
  for (const paragraph of paragraphs) {
    const lines = paragraph.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    if (lines.length === 0) continue;
    const oneLine = lines.join(" ").replace(/\s+/g, " ").trim();
    if (!oneLine) continue;
    return oneLine.length > 200 ? `${oneLine.slice(0, 197).trimEnd()}...` : oneLine;
  }
  return "";
}

function mapAgentToClaude(codex, options = {}) {
  const aliases = modelAliasMap("codex", "claude");
  const body = transformTextForHost(stripAgentMigrationPreamble(codex.developer_instructions ?? ""), "codex", "claude", { callArchive: options.callArchive });
  const frontmatter = {
    name: codex.name ?? "",
    description: codex.description ?? "",
    model: aliases[codex.model] ?? codex.model ?? ""
  };
  const preserved = options.preserveClaude ?? {};
  for (const key of ["tools", "color", "memory"]) {
    if (preserved[key] !== undefined && preserved[key] !== "") frontmatter[key] = preserved[key];
  }
  return { frontmatter, body };
}

function modelTiers() {
  const tiers = agentsMapData().models?.tiers;
  return Array.isArray(tiers) ? tiers : [];
}

function modelAliasMap(from, to) {
  const aliases = {};
  for (const tier of modelTiers()) {
    const sourceAlias = tier?.[from]?.alias;
    const targetAlias = tier?.[to]?.alias;
    if (typeof sourceAlias === "string" && sourceAlias && typeof targetAlias === "string" && targetAlias) {
      aliases[sourceAlias] = targetAlias;
    }
  }
  return aliases;
}

function modelTerminologyRules() {
  return modelTiers()
    .map((tier) => ({
      id: tier?.id ?? "model-tier",
      claude: [tier?.claude?.alias, ...(Array.isArray(tier?.claude?.terms) ? tier.claude.terms : [])].filter((value) => typeof value === "string" && value),
      codex: [tier?.codex?.alias, ...(Array.isArray(tier?.codex?.terms) ? tier.codex.terms : [])].filter((value) => typeof value === "string" && value)
    }))
    .filter((rule) => rule.claude.length > 0 && rule.codex.length > 0);
}

function agentsMapData() {
  return agentsMapSource().data;
}

function agentsMapPath() {
  return agentsMapSource().path;
}

function agentsMapSource() {
  return loadLayeredRule(
    agentsMapCandidates(),
    { fields: [], models: { tiers: [] } },
    mergeAgentsMap
  );
}

function agentsMapCandidates() {
  return [
    join(resolve(process.cwd()), "rules/agents-map.json"),
    `${home}/.ai-config-sync-manager/rules/agents-map.json`,
    join(runtimeRoot, "rules/agents-map.json")
  ];
}

function agentTargetPath(name, baseDir, host, sourceAgent) {
  if (host === "codex") {
    const flatName = name.includes("/") ? name.split("/").pop() : name;
    return join(baseDir, `${flatName}.toml`);
  }

  if (sourceAgent?.group) {
    return join(baseDir, sourceAgent.group, `${sourceAgent.name.split("/").pop()}.md`);
  }
  if (name.includes("/")) {
    return join(baseDir, `${name}.md`);
  }
  return join(baseDir, `${name}.md`);
}

function compareMcpServers(entries, scope, claudePath, codexPath, claudePaths = [claudePath], codexPaths = [codexPath]) {
  const claudeServers = Object.keys(readClaudeMcpServers(claudePaths)).sort();
  const codexServers = Object.keys(readCodexMcpServers(codexPaths)).sort();
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
    claudeMcpPaths: existingPaths(claudePaths),
    codexMcpPaths: existingPaths(codexPaths),
    claude: `${claudeServers.length} server(s)`,
    codex: `${codexServers.length} server(s)`,
    missingInCodex,
    missingInClaude,
    itemQualities: itemQualities("mcp", [...missingInCodex, ...missingInClaude])
  });
}

function compareSettingsItems(entries, scope, area, claudePath, codexPath) {
  const claude = settingsItems("claude", area, claudePath);
  const codex = settingsItems("codex", area, codexPath);
  let missingInCodex = settingsItemsMissingFrom(area, claude, codex);
  let missingInClaude = settingsItemsMissingFrom(area, codex, claude);

  if (area === "permissions") {
    // Server-scope `allow:mcp__<server>` round-trips through Codex as a noop (Codex defaults
    // to allowing every tool on a configured MCP server). If the codex side has the server
    // table without an explicit `enabled_tools = []` deny, treat the claude permission as
    // satisfied even though codex emits no item-level entry to capability-match against.
    const codexUnrestrictedServers = codexUnrestrictedMcpServers(codexPath);
    missingInCodex = missingInCodex.filter((name) => !isServerScopeMcpAllowSatisfied(name, codexUnrestrictedServers));
  }

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
    missingInClaude,
    itemQualities: itemQualities(area, [...missingInCodex, ...missingInClaude])
  });
}

function settingsItemsMissingFrom(area, sourceItems, targetItems) {
  if (area !== "permissions") {
    return sourceItems.filter((name) => !targetItems.includes(name));
  }

  const targetCapabilities = new Set(targetItems.map(permissionCapability));
  return sourceItems.filter((name) => {
    if (itemMappingQuality(area, name) === "unsupported") return false;
    return !targetCapabilities.has(permissionCapability(name));
  });
}

function codexUnrestrictedMcpServers(codexPath) {
  const servers = new Set();
  if (!codexPath || !existsSync(codexPath) || !codexPath.endsWith(".toml")) return servers;
  const text = readFileSync(codexPath, "utf8");
  const tablePattern = /^\[mcp_servers\.([^\]]+)\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm;

  for (const match of text.matchAll(tablePattern)) {
    if (match[1].includes(".")) continue;
    const enabledDeclared = hasTomlKey(match[2], "enabled_tools");
    const enabled = parseTomlStringArray(match[2], "enabled_tools");
    if (enabledDeclared && enabled.length === 0) continue; // explicit deny-all
    servers.add(match[1].replaceAll("-", "_"));
  }

  return servers;
}

function isServerScopeMcpAllowSatisfied(itemName, codexUnrestrictedServers) {
  const { bucket, value } = parsePermissionItem(itemName);
  if (bucket !== "allow") return false;
  const mcp = parseMcpPermission(value);
  if (!mcp || !isMcpServerScopePermission(mcp)) return false;
  return codexUnrestrictedServers.has(mcp.server.replaceAll("-", "_"));
}

function permissionCapability(itemName) {
  const { bucket, value } = parsePermissionItem(itemName);

  if (["Write", "Edit", "MultiEdit"].includes(value)) {
    return `${bucket}:filesystem-write`;
  }

  const mcp = parseMcpPermission(value);
  if (mcp) {
    if (isMcpServerScopePermission(mcp)) {
      return `${bucket}:mcp-server:${mcp.server}`;
    }
    return `${bucket}:mcp-tool:${mcp.server}:${mcp.tool}`;
  }

  const rule = codexPrefixRuleForPermission(bucket, value);
  if (rule) {
    return `${bucket}:bash-prefix:${rule}`;
  }

  if (value === "WebSearch" || value === "WebFetch") {
    return `${bucket}:web-search`;
  }

  return `${bucket}:${value}`;
}

function itemQualities(area, items) {
  return Object.fromEntries(items.map((item) => [item, itemMappingQuality(area, item)]));
}

function itemMappingQuality(area, item) {
  if (area === "mcp" || area === "skills" || area === "agents") return "exact";
  if (area === "hooks") return "equivalent";
  if (area !== "permissions") return "unsupported";

  const { bucket, value } = parsePermissionItem(item);
  if (parseMcpPermission(value)) return "exact";
  if (isAgentPermission(value)) return "unsupported";

  const rule = codexPrefixRuleForPermission(bucket, value);
  if (rule) return "exact";
  if (["Write", "Edit", "MultiEdit"].includes(value)) return "equivalent";
  if (bucket === "allow" && value === "WebSearch") return "exact";
  if (bucket === "allow" && value === "WebFetch") return "approximate";
  // SendMessage has no codex equivalent; the earlier branches already cover
  // every other command-like value (mcp__*, Agent, Bash, Bash(...), WebFetch,
  // WebSearch), so the only fall-through here is SendMessage itself.
  if (value === "SendMessage") return "unsupported";
  if (isCommandLikePermission(value)) return "metadata-only";

  return "unsupported";
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
    .map((value) => `${prefix}:${value}`);
}

function codexSettingsItems(area, path) {
  const text = readFileSync(path, "utf8");
  const items = [];

  if (area === "permissions") {
    for (const item of codexWebSearchPermissionItems(text)) {
      items.push(item);
    }
    for (const item of codexSandboxPermissionItems(text)) {
      items.push(item);
    }
    for (const item of codexNetworkAccessPermissionItems(text)) {
      items.push(item);
    }
    for (const item of codexRulePermissionItems(codexRulesPath(path))) {
      items.push(item);
    }
    for (const item of codexMcpApprovalItems(text)) {
      items.push(item);
    }
    for (const item of codexMcpToolListItems(text)) {
      items.push(item);
    }
  }

  if (area === "hooks") {
    for (const match of text.matchAll(/^\s*\[\[hooks\.([A-Za-z0-9_-]+)\]\]/gm)) {
      items.push(match[1]);
    }
  }

  return uniqueStrings(items);
}

function codexWebSearchPermissionItems(text) {
  const match = text.match(/^\s*web_search\s*=\s*"([^"]+)"/m);
  if (!match || match[1] !== "live") return [];
  return ["allow:WebSearch"];
}

function codexSandboxPermissionItems(text) {
  const sandbox = text.match(/^\s*sandbox_mode\s*=\s*"([^"]+)"/m);
  if (sandbox?.[1] === "workspace-write") {
    return ["allow:Write", "allow:Edit", "allow:MultiEdit"];
  }

  return [];
}

function codexNetworkAccessPermissionItems(text) {
  const tablePattern = /^\[sandbox_workspace_write\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/m;
  const match = text.match(tablePattern);
  if (!match) return [];

  const network = match[1].match(/^\s*network_access\s*=\s*(true|false)\b/m);
  if (network?.[1] !== "true") return [];

  return ["allow:WebFetch"];
}

function codexRulePermissionItems(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const items = [];

  for (const match of text.matchAll(/prefix_rule\(pattern=(\[[^\)]*?\]),\s*decision="(allow|prompt|forbidden)"/g)) {
    const parts = parseJsonLike(match[1], []);
    if (!Array.isArray(parts) || parts.some((part) => typeof part !== "string")) continue;

    const bucket = match[2] === "forbidden" ? "deny" : match[2] === "prompt" ? "ask" : "allow";
    const isBareBash = parts.length === 0 || (parts.length === 1 && parts[0] === "bash");
    const value = isBareBash ? "Bash" : `Bash(${parts.join(" ")}:*)`;
    items.push(`${bucket}:${value}`);
  }

  return items;
}

function codexMcpApprovalItems(text) {
  const items = [];
  const tablePattern = /^\[mcp_servers\.([^\].]+)\.tools\.([^\]]+)\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm;

  for (const match of text.matchAll(tablePattern)) {
    const approval = match[3].match(/^approval_mode\s*=\s*"([^"]+)"/m);
    if (!approval) continue;

    const bucket = approval[1] === "deny" ? "deny" : approval[1] === "prompt" ? "ask" : "allow";
    items.push(`${bucket}:mcp__${match[1].replaceAll("-", "_")}__${match[2]}`);
  }

  return items;
}

function codexMcpToolListItems(text) {
  const items = [];
  const tablePattern = /^\[mcp_servers\.([^\]]+)\]\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm;

  for (const match of text.matchAll(tablePattern)) {
    if (match[1].includes(".")) continue; // skip nested tables like mcp_servers.<server>.tools.<tool>
    const server = match[1].replaceAll("-", "_");
    const enabled = parseTomlStringArray(match[2], "enabled_tools");
    const disabled = parseTomlStringArray(match[2], "disabled_tools");
    const enabledDeclared = hasTomlKey(match[2], "enabled_tools");

    for (const tool of enabled) {
      items.push(`allow:mcp__${server}__${tool}`);
    }
    for (const tool of disabled) {
      items.push(`deny:mcp__${server}__${tool}`);
    }

    // An explicit empty `enabled_tools = []` is a server-scope deny.
    if (enabledDeclared && enabled.length === 0) {
      items.push(`deny:mcp__${server}`);
    }
  }

  return items;
}

function hasTomlKey(text, key) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, "m");
  return pattern.test(text);
}

function parseTomlStringArray(text, key) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(\\[[^\\]]*\\])`, "m");
  const match = text.match(pattern);
  if (!match) return [];

  const values = parseJsonLike(match[1], []);
  return Array.isArray(values) ? values.filter((value) => typeof value === "string") : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function skillNames(dir) {
  if (!existsSync(dir)) return [];
  // The marker file pins Codex's vendored "system" skill bundle (.system/). When a
  // marker is present at the root we are scanning into, treat the dir as opaque so
  // its contents never enumerate as user skills.
  if (existsSync(join(dir, ".codex-system-skills.marker"))) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .sort();
}

function skillSymlinkNames(dir) {
  if (!existsSync(dir)) return [];
  if (existsSync(join(dir, ".codex-system-skills.marker"))) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("."))
    .sort();
}

// First-wins union: earlier dirs in the list take precedence for duplicate skill names.
function enumerateSkillIndex(dirs) {
  const list = Array.isArray(dirs) ? dirs : [dirs];
  const index = new Map();
  for (const dir of list) {
    if (!dir) continue;
    for (const name of skillNames(dir)) {
      if (!index.has(name)) index.set(name, dir);
    }
  }
  return index;
}

function enumerateSkillSymlinkIndex(dirs) {
  const list = Array.isArray(dirs) ? dirs : [dirs];
  const index = new Map();
  for (const dir of list) {
    if (!dir) continue;
    for (const name of skillSymlinkNames(dir)) {
      if (!index.has(name)) index.set(name, dir);
    }
  }
  return index;
}

// Skill manifest filename differs by host: Claude uses lowercase skill.md, Codex uses SKILL.md.
// Authors may have mixed-case skills on either side; helpers explicitly check both casings.
function skillManifestBasename(host) {
  return host === "claude" ? "skill.md" : "SKILL.md";
}

function skillManifestPath(skillDir, host) {
  return join(skillDir, skillManifestBasename(host));
}

function findSkillManifest(skillDir) {
  for (const name of ["SKILL.md", "skill.md"]) {
    const candidate = join(skillDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function isSkillManifestBasename(name) {
  return name === "SKILL.md" || name === "skill.md";
}

function fileState(path) {
  if (!path || !existsSync(path)) {
    return { exists: false, hash: "missing", summary: "missing" };
  }

  const content = readFileSync(path);
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return { exists: true, hash, summary: `${content.length} bytes sha256:${hash}` };
}

function instructionState(host, paths) {
  const checkedPaths = Array.isArray(paths) ? paths : [paths];
  const sources = instructionSources(host, paths);
  if (sources.length === 0) return { exists: false, hash: "missing", summary: "missing", paths: [], checkedPaths, content: "" };

  const content = sources
    .map((source) => source.content)
    .join("\n--- ai-config-sync instruction source ---\n");
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return {
    exists: true,
    hash,
    summary: `${sources.length} source(s) sha256:${hash}`,
    paths: sources.map((source) => source.path),
    checkedPaths,
    content
  };
}

function instructionSources(host, paths) {
  const list = Array.isArray(paths) ? paths : [paths];
  return list.flatMap((path) => instructionSource(host, path)).filter(Boolean);
}

function instructionSource(host, path) {
  if (!path || !existsSync(path)) return [];
  if (path.endsWith(".json")) return jsonInstructionSources(host, path);
  if (path.endsWith(".toml")) return tomlInstructionSources(path);
  return [{ path, content: readFileSync(path, "utf8") }];
}

function jsonInstructionSources(host, path) {
  const data = readJsonFile(path, {});
  const values = [];

  for (const key of ["instructions", "instruction", "systemPrompt", "system_prompt", "appendSystemPrompt", "append_system_prompt"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      values.push({ path: `${path}#${key}`, content: value });
    }
  }

  if (host === "codex") {
    for (const key of ["developer_instructions", "user_instructions"]) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) {
        values.push({ path: `${path}#${key}`, content: value });
      }
    }
  }

  return values;
}

function tomlInstructionSources(path) {
  const text = readFileSync(path, "utf8");
  const values = [];

  for (const key of ["instructions", "instruction", "developer_instructions", "user_instructions"]) {
    const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.+)$`, "m");
    const match = text.match(pattern);
    if (!match) continue;

    const value = parseTomlScalar(match[1]);
    if (typeof value === "string" && value.trim()) {
      values.push({ path: `${path}#${key}`, content: value });
    }
  }

  return values;
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

// Replace a skill manifest basename with a casing-neutral sentinel so two skills
// with identical content but differing manifest casing (skill.md vs SKILL.md)
// share a single normalized path.
function normalizeSkillPath(file) {
  const segments = file.split("/");
  const last = segments[segments.length - 1];
  if (!isSkillManifestBasename(last)) return file;
  return [...segments.slice(0, -1), "__skill_manifest__.md"].join("/");
}

// Pair each raw skill file path with its normalized form, then sort by the
// normalized path so claude (skill.md) and codex (SKILL.md) iterate the same
// logical files in the same order before hashing.
function sortedSkillFiles(path) {
  return directoryFiles(path)
    .map((raw) => ({ raw, normalized: normalizeSkillPath(raw) }))
    .sort((a, b) => (a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : 0));
}

// Read a skill file's bytes for hashing, canonicalizing YAML frontmatter when the
// file is a skill manifest (skill.md / SKILL.md). Claude's lenient YAML loader
// tolerates unquoted colon-containing scalars while Codex's strict 1.2 loader does
// not — our forward writer quotes them, so the same logical manifest can have
// byte-different forms on each side. Hashing the canonical form makes those
// quote-only diffs invisible to skillDirsEquivalent without mutating source files.
function readSkillFileForHash(path, raw) {
  const absolute = join(path, raw);
  const content = readFileSync(absolute);
  const basename = raw.split("/").pop();
  if (!isSkillManifestBasename(basename)) return content;
  return Buffer.from(normalizeYamlFrontmatter(content.toString("utf8")), "utf8");
}

// Like directoryHash but normalizes the skill manifest filename so that two skills
// with identical content but differing manifest casing (skill.md vs SKILL.md) hash equal.
function skillContentHash(path) {
  if (!existsSync(path)) return "missing";
  const hash = createHash("sha256");

  for (const { raw, normalized } of sortedSkillFiles(path)) {
    hash.update(normalized);
    hash.update(readSkillFileForHash(path, raw));
  }

  return hash.digest("hex").slice(0, 12);
}

function skillDirsEquivalent(claudePath, codexPath, entry, item, rules) {
  const claudeHash = skillContentHash(claudePath);
  const codexHash = skillContentHash(codexPath);
  if (claudeHash === codexHash) return true;
  if (transformedSkillContentHash(claudePath, "claude", "codex") === codexHash) return true;
  if (transformedSkillContentHash(codexPath, "codex", "claude") === claudeHash) return true;

  if (entry) {
    const terms = expandTermsBothDirections(uniqueStrings([
      ...applicableTermRules(rules ?? [], entry, item, "claude"),
      ...applicableTermRules(rules ?? [], entry, item, "codex")
    ]));
    if (terms.length > 0) {
      if (maskedSkillContentHash(claudePath, "claude", "codex", terms) === maskedSkillContentHash(codexPath, "codex", "codex", terms)) return true;
      if (maskedSkillContentHash(claudePath, "claude", "claude", terms) === maskedSkillContentHash(codexPath, "codex", "claude", terms)) return true;
    }
  }
  return false;
}

function transformedSkillContentHash(path, from, to) {
  if (!existsSync(path)) return "missing";
  const hash = createHash("sha256");

  for (const { raw, normalized } of sortedSkillFiles(path)) {
    const absolute = join(path, raw);
    const canonical = readSkillFileForHash(path, raw);
    const content = isTextMappingFile(absolute)
      ? transformTextForHost(canonical.toString("utf8"), from, to)
      : canonical;
    hash.update(normalized);
    hash.update(content);
  }

  return hash.digest("hex").slice(0, 12);
}

function maskedSkillContentHash(path, sourceHost, targetHost, terms) {
  if (!existsSync(path)) return "missing";
  const hash = createHash("sha256");

  for (const { raw, normalized } of sortedSkillFiles(path)) {
    const absolute = join(path, raw);
    const canonical = readSkillFileForHash(path, raw);
    let content;
    if (isTextMappingFile(absolute)) {
      const text = sourceHost === targetHost
        ? canonical.toString("utf8")
        : transformTextForHost(canonical.toString("utf8"), sourceHost, targetHost);
      content = Buffer.from(maskLinesContaining(text, terms), "utf8");
    } else {
      content = canonical;
    }
    hash.update(normalized);
    hash.update(content);
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
  console.log(`Config root: ${formatPathState(nextState.configRoot)}`);
  console.log(`Status ignore: ${formatPathState(nextState.statusIgnore)}`);
  console.log(`Claude plugin: ${nextState.claudePlugin ? formatPathState(nextState.claudePlugin) : "missing"}`);
  console.log(`Codex plugin: ${formatPathState(nextState.codexPlugin)}`);
  console.log(`Codex marketplace: ${formatPathState(nextState.codexMarketplace)}`);

  for (const result of results) {
    console.log(`${result.status}: ${result.message}`);
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
    configRoot: `${home}/.ai-config-sync-manager`,
    statusIgnore: `${home}/.ai-config-sync-manager/rules/status-ignore.json`,
    claudePlugin: findClaudePlugin(),
    claudePluginTarget: `${home}/.claude/plugins/config-manager@ai-config-sync-manager`,
    codexPlugin,
    codexMarketplace: `${home}/.agents/plugins/marketplace.json`
  };
}

function registerMissingIntegrations(state) {
  const results = [];

  tryConnectAction(results, "initialized config root", () => {
    ensureDirectoryRoot(state.configRoot);
  });

  tryConnectAction(results, "initialized status ignore", () => {
    writeDefaultStatusIgnore(state.statusIgnore);
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

function ensureDirectoryRoot(path) {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error(`${path} is a symlink; remove it before using this path as the user config root`);
  }

  mkdirSync(path, { recursive: true });
}

function writeDefaultStatusIgnore(path) {
  if (existsSync(path)) {
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ version: 1, exclude: [] }, null, 2)}\n`);
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
  const direction = defaultSyncDirection();
  let from = direction.from;
  let to = direction.to;
  let routeExplicit = false;
  let dryRun = false;
  let apply = false;
  let planJson = false;
  let scope = null;
  const selectors = emptySelectors();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      dryRun = true;
    } else if (token === "--apply") {
      apply = true;
    } else if (token === "--plan-json") {
      planJson = true;
    } else if (token === "--from" || token === "--to") {
      const value = argv[index + 1];
      if (!hosts.has(value)) throw new Error(`Missing or invalid value for ${token}`);
      routeExplicit = true;
      if (token === "--from") from = value;
      if (token === "--to") to = value;
      index += 1;
    } else if (token === "--scope") {
      scope = parseScopes(argv[index + 1], true);
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

  const scopes = scope ?? ["global", "project"];
  return { from, to, routeExplicit, apply, planJson, scope: scopes[0], scopes, selectors };
}

function parseScopes(value, allowAll) {
  if (allowAll && (!value || value === "all")) return ["global", "project"];
  if (value === "global" || value === "project") return [value];
  throw new Error(allowAll ? "Supported scopes are global, project, and all." : "Supported sync scopes are global and project.");
}

function noOptions(argv, command) {
  if (argv.length > 0) throw new Error(`${command} does not accept options.`);
}

function isHelp(argv) {
  return argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h");
}

function printHelp() {
  console.log(`Usage:
  ai-config-sync connect
  ai-config-sync connect --help
  ai-config-sync status
  ai-config-sync status --help
  ai-config-sync status --json
  ai-config-sync status --compact
  ai-config-sync status --tree
  ai-config-sync status --scope global|project|all
  ai-config-sync status --include skills:foo,mcp:notion --exclude permissions:Bash
  ai-config-sync sync --dry-run
  ai-config-sync sync --help
  ai-config-sync sync --plan-json
  ai-config-sync sync --scope global|project|all --dry-run
  ai-config-sync sync --scope global|project|all --apply
  ai-config-sync sync --include instructions,skills:foo,mcp:notion --exclude permissions:Bash --dry-run
  ai-config-sync sync --from claude --to codex
  ai-config-sync sync --from codex --to claude
  ai-config-sync reference
  ai-config-sync reference --help
  ai-config-sync reference --output ~/.ai-config-sync-manager/reference.md`);
}

function printConnectHelp() {
  console.log(`Usage:
  ai-config-sync connect

Checks Claude and Codex installation state, registers missing local host integrations when possible, and prints manual actions when writes are blocked.

Options:
  -h, --help  Show connect help`);
}

function printStatusHelp() {
  console.log(`Usage:
  ai-config-sync status [options]

Options:
  --json                         Print the full status report as JSON
  --compact                      Print one compact line per diff entry
  --tree                         Print scope/area/item tree output
  --scope global|project|all     Limit status scope
  --include area[:item][,...]    Include only selected areas or items
  --exclude area[:item][,...]    Exclude selected areas or items
  ignore file                    <project>/.ai-config-sync-manager/status-ignore.json, then ~/.ai-config-sync-manager/rules/status-ignore.json
  rule fields                    scope, area, item, host, path (file path/glob), term (line-level mask in compare)
  -h, --help                     Show status help

Examples:
  ai-config-sync status --scope project --tree
  ai-config-sync status --include skills:foo,mcp:notion --exclude permissions:Bash`);
}

function printSyncHelp() {
  console.log(`Usage:
  ai-config-sync sync [options]

Options:
  --dry-run                      Preview planned operations without writing files (default)
  --apply                        Apply planned operations with backups
  --plan-json                    Print the sync plan as JSON
  --from claude|codex            Source host (overrides AI_CONFIG_SYNC_HOST)
  --to claude|codex              Target host (overrides AI_CONFIG_SYNC_HOST)
  --scope global|project|all     Limit sync scope
  --include area[:item][,...]    Include only selected areas or items
  --exclude area[:item][,...]    Exclude selected areas or items
  ignore file                    <project>/.ai-config-sync-manager/status-ignore.json, then ~/.ai-config-sync-manager/rules/status-ignore.json
  rule fields                    scope, area, item, host, path (file path/glob), term (line-level mask in compare)
  -h, --help                     Show sync help

Defaults:
  sync without --scope            Uses global and project scopes
  sync without --from/--to        AI_CONFIG_SYNC_HOST=codex sets codex -> claude; otherwise claude -> codex

Examples:
  ai-config-sync sync --scope project --include mcp:notion --dry-run
  ai-config-sync sync --scope project --include mcp:notion --apply
  ai-config-sync sync --from codex --to claude --include permissions:Bash --plan-json`);
}

function parseReference(argv) {
  let output = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --output");
      output = value;
      index += 1;
    } else {
      throw new Error(`Unknown option for reference: ${token}`);
    }
  }

  return { output };
}

function printReferenceHelp() {
  console.log(`Usage:
  ai-config-sync reference [options]

Prints a markdown reference of every command, area, risk level, mapping quality, sync action verb, terminology layer, hidden marker, and known file location.

Options:
  --output <path>   Write the reference markdown to <path> (parent directories are created)
  -h, --help        Show reference help

Examples:
  ai-config-sync reference
  ai-config-sync reference --output ~/.ai-config-sync-manager/reference.md`);
}

function generateReferenceMarkdown() {
  return [
    "# AI Config Sync Manager Reference",
    "",
    "Generated reference for every command, area, risk level, mapping quality, sync action verb, terminology layer, hidden marker, and known file location.",
    "",
    referenceCommandsSection(),
    referenceAreasSection(),
    referenceRiskLevelsSection(),
    referenceMappingQualitiesSection(),
    referenceSyncActionsSection(),
    referenceTerminologyLayersSection(),
    referenceHiddenMarkersSection(),
    referenceDefaultDirectionSection(),
    referenceFileLocationsSection()
  ].join("\n");
}

function referenceCommandsSection() {
  return [
    "## Commands",
    "",
    "### `connect`",
    "",
    "Checks Claude and Codex installation state, registers missing local host integrations when possible, and prints manual actions when writes are blocked.",
    "",
    "- `-h, --help` — Show connect help",
    "",
    "### `status`",
    "",
    "Print diff status between Claude and Codex configuration.",
    "",
    "- `--json` — Print the full status report as JSON",
    "- `--compact` — Print one compact line per diff entry",
    "- `--tree` — Print scope/area/item tree output",
    "- `--scope global|project|all` — Limit status scope",
    "- `--include area[:item][,...]` — Include only selected areas or items",
    "- `--exclude area[:item][,...]` — Exclude selected areas or items",
    "- `-h, --help` — Show status help",
    "",
    "### `sync`",
    "",
    "Plan or apply synchronization between Claude and Codex configuration.",
    "",
    "- `--dry-run` — Preview planned operations without writing files (default)",
    "- `--apply` — Apply planned operations with backups",
    "- `--plan-json` — Print the sync plan as JSON",
    "- `--from claude|codex` — Source host (overrides AI_CONFIG_SYNC_HOST)",
    "- `--to claude|codex` — Target host (overrides AI_CONFIG_SYNC_HOST)",
    "- `--scope global|project|all` — Limit sync scope",
    "- `--include area[:item][,...]` — Include only selected areas or items",
    "- `--exclude area[:item][,...]` — Exclude selected areas or items",
    "- `-h, --help` — Show sync help",
    "",
    "### `reference`",
    "",
    "Print this markdown reference document.",
    "",
    "- `--output <path>` — Write the reference markdown to `<path>` (parent directories are created)",
    "- `-h, --help` — Show reference help",
    ""
  ].join("\n");
}

function referenceAreasSection() {
  return [
    "## Areas",
    "",
    "Areas are the canonical buckets diffed and synced between hosts.",
    "",
    "- `instructions` — Top-level instruction file (`CLAUDE.md` ↔ `AGENTS.md`).",
    "- `skills` — Skill directories under `.claude/skills` and `.codex/skills` (one folder per skill).",
    "- `agents` — Subagent definitions: Claude markdown frontmatter under `.claude/agents` ↔ Codex TOML under `.codex/agents`.",
    "- `mcp` — MCP server registrations (`.mcp.json`, `.claude.json`, `settings.json` ↔ `config.toml [mcp_servers.*]`).",
    "- `permissions` — Tool/bash/web permission rules (`settings.json` permissions ↔ Codex `[approvals]` / `default.rules`).",
    "- `hooks` — Lifecycle hook configuration (`settings.json` hooks ↔ Codex `[[hooks.Event]]` blocks).",
    ""
  ].join("\n");
}

function referenceRiskLevelsSection() {
  return [
    "## Risk levels",
    "",
    "- `safe` — Apply automatically; the source meaning is fully preserved on the target.",
    "- `manual` — Hold for explicit review; mapping is lossy or the source file is missing. Apply will skip operations marked `approvalRequired: true` until rerun explicitly.",
    ""
  ].join("\n");
}

function referenceMappingQualitiesSection() {
  return [
    "## Mapping qualities",
    "",
    "Per-item indicator of how well one host's meaning is preserved on the other side.",
    "",
    "- `exact` — Same value, same semantics on both hosts.",
    "- `equivalent` — Different shape, identical effect (for example `CLAUDE.md` ↔ `AGENTS.md` instructions).",
    "- `approximate` — Closest-fit mapping; behavior is similar but not identical (broad approval policies, prefix rules).",
    "- `metadata-only` — The wrapper is preserved but inner behavior cannot be enforced on the target host.",
    "- `unsupported` — No mapping exists; the item is left for manual review.",
    ""
  ].join("\n");
}

function referenceSyncActionsSection() {
  return [
    "## Sync action verbs",
    "",
    "Plan operations carry an `action` field that `applySyncPlan` dispatches on.",
    "",
    "- `copy-file` — Copy a single file from source host to target host.",
    "- `write-instructions` — Write transformed instruction content (after term/template/call rewrites) to the target instruction file.",
    "- `copy-missing-skills` — Copy skill directories that are missing on the target, overwriting any conflicting skill bodies.",
    "- `merge-agents` — Translate Claude agent frontmatter ↔ Codex agent TOML and write per-agent files.",
    "- `merge-settings-items` — Merge permission or hook items into the target settings file.",
    "- `merge-mcp-servers` — Merge MCP server entries into the target host's MCP config.",
    "- `delete-items` — Delete items from the target that the baseline shows were removed on the source.",
    "- `source-missing` — Source path does not exist; flagged manual and skipped on apply.",
    "- `manual-review` — Area has no automatic mapping; surfaced for the user to handle.",
    "",
    "### Status output symbols",
    "",
    "- `+` — Item will be added on the target (copy from source).",
    "- `-` — Item will be removed on the target (baseline-tracked deletion).",
    "- `~` — Item exists on both hosts but content differs (will be overwritten on apply).",
    "- `!` — Conflict that requires manual review.",
    ""
  ].join("\n");
}

function referenceTerminologyLayersSection() {
  const layers = terminologyMapSource().data?.layers;
  const lines = [
    "## Terminology layers",
    "",
    "Terminology rules live in `rules/terminology-map.json` (override at `~/.ai-config-sync-manager/rules/terminology-map.json` or `<project>/rules/terminology-map.json`). Each layer groups rules that rewrite host-specific vocabulary when transforming text between Claude and Codex.",
    ""
  ];

  if (Array.isArray(layers) && layers.length > 0) {
    for (const layer of layers) {
      const layerId = typeof layer?.id === "string" ? layer.id : "(unnamed layer)";
      const description = typeof layer?.description === "string" ? layer.description : "";
      lines.push(`### \`${layerId}\``);
      lines.push("");
      if (description) {
        lines.push(description);
        lines.push("");
      }
      const rules = Array.isArray(layer?.rules) ? layer.rules : [];
      if (rules.length === 0) {
        lines.push("- (no rules)");
      } else {
        for (const rule of rules) {
          const id = typeof rule?.id === "string" ? rule.id : "(unnamed rule)";
          const isRegex = Boolean(rule?.regex);
          lines.push(`- \`${id}\`${isRegex ? " — regex rule" : ""}`);
        }
      }
      lines.push("");
    }
  } else {
    lines.push("- (terminology map unavailable)");
    lines.push("");
  }

  lines.push("### `model` (from `rules/agents-map.json`)");
  lines.push("");
  lines.push("Model alias rules come from `rules/agents-map.json` `models.tiers` rather than the terminology map.");
  lines.push("");
  const tiers = Array.isArray(agentsMapData()?.models?.tiers) ? agentsMapData().models.tiers : [];
  if (tiers.length === 0) {
    lines.push("- (no model tiers)");
  } else {
    for (const tier of tiers) {
      const id = typeof tier?.id === "string" ? tier.id : "(unnamed tier)";
      const claudeAlias = typeof tier?.claude?.alias === "string" ? tier.claude.alias : "?";
      const codexAlias = typeof tier?.codex?.alias === "string" ? tier.codex.alias : "?";
      lines.push(`- \`${id}\` — \`${claudeAlias}\` ↔ \`${codexAlias}\``);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function referenceHiddenMarkersSection() {
  return [
    "## Hidden markers",
    "",
    "HTML comment markers the call compiler emits inside transformed text. They round-trip on a reverse sync and are not user-visible during normal use.",
    "",
    "- `ai-config-sync:agent-call` — Supported call transformed (Claude `Agent({...})` ↔ Codex prose `spawn_agent`).",
    "- `ai-config-sync:stripped` — Unsupported call removed (`TaskCreate`, `TaskUpdate`, `TeamCreate`); original archived under the backup root.",
    "- `ai-config-sync:manual-review` — Call left intact because it could not be parsed; needs manual translation.",
    ""
  ].join("\n");
}

function referenceDefaultDirectionSection() {
  return [
    "## Default direction precedence",
    "",
    "1. Explicit `--from <host>` / `--to <host>` flags on `sync`.",
    "2. `AI_CONFIG_SYNC_HOST=codex` environment variable — sets default direction to `codex -> claude`.",
    "3. Otherwise the default is `claude -> codex`.",
    "",
    "`status` follows the same default direction so that `+/-/~` symbols and `details` text describe the apply that would run with no override.",
    "",
    "## Environment variables",
    "",
    "- `AI_CONFIG_SYNC_HOST=codex` — Set default sync direction to `codex -> claude`.",
    "- `AI_CONFIG_SYNC_HOME=<path>` — Override the home directory used for global config and state (primarily for tests).",
    "- `AI_CONFIG_SYNC_STRIP_SECRETS=1` — Opt in to defensively stripping MCP env values whose keys look like secrets (`TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `CREDENTIAL`, `AUTH`). Default behavior copies them because the source already stores the secret in plaintext under the same user's home; enable this if your source config is exposed beyond that trust boundary (e.g. dotfiles committed to git that include `.codex/config.toml`).",
    ""
  ].join("\n");
}

function referenceFileLocationsSection() {
  return [
    "## File locations",
    "",
    "### User-writable",
    "",
    "- `~/.ai-config-sync-manager/state/<scope>.json` — Sync state baseline (one file per scope; project scope hashes the project root).",
    "- `~/.ai-config-sync-manager/backups/<timestamp>/...` — Backup root for each apply run.",
    "- `~/.ai-config-sync-manager/backups/<timestamp>/unsupported-calls.json` — Archive of stripped or manual-review calls (when applicable).",
    "- `~/.ai-config-sync-manager/status-details/<timestamp>.txt` — Full diff detail when status is collapsed.",
    "- `~/.ai-config-sync-manager/rules/agents-map.json` — Agent field and model alias rules (user customization point).",
    "- `~/.ai-config-sync-manager/rules/status-ignore.json` — Persistent ignore rules used by `status` and `sync`. Template at `<repo>/docs/status-ignore.example.json`.",
    "",
    "### Bundled defaults (under the runtime root)",
    "",
    "- `<repo>/rules/terminology-map.json` — Bundled terminology defaults (override at home or project).",
    "- `<repo>/rules/host-target-templates.json` — Bundled target templates.",
    "- `<repo>/rules/call-templates.json` — Bundled SDK call transform templates.",
    "",
    "Override precedence for any rule file: `<project>/rules/<name>.json` → `~/.ai-config-sync-manager/rules/<name>.json` → `<repo>/rules/<name>.json`. Layers are merged by id (rule.id, template.id, areas key, fields claude+codex pair, models.tiers id) — partial overlays only need to declare the entries they want to add or change.",
    ""
  ].join("\n");
}
