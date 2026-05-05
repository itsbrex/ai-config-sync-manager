export type Host = "claude" | "codex";

export type RiskLevel = "safe" | "partial" | "manual";

export type SyncMode = "dry-run" | "apply";

export type ConfigScope = "global" | "project";

export type ConfigArea = "instructions" | "skills" | "mcp" | "permissions" | "hooks" | "commands";

export const CONFIG_AREAS: ConfigArea[] = [
  "instructions",
  "skills",
  "mcp",
  "permissions",
  "hooks",
  "commands",
];

export interface HostPaths {
  root?: string;
  instructions?: string;
  skills?: string;
  mcp?: string;
  settings?: string;
  commands?: string;
}

export interface CanonicalConfigSnapshot {
  host: Host;
  scope: ConfigScope;
  paths: HostPaths;
  areas: Partial<Record<ConfigArea, unknown>>;
}

export interface ConfigDiffEntry {
  scope: ConfigScope;
  area: ConfigArea;
  risk: RiskLevel;
  summary: string;
  source: Host;
  target: Host;
}

export interface StatusReport {
  source: Host;
  target: Host;
  scopes: ConfigScope[];
  scaffold: true;
  entries: ConfigDiffEntry[];
  summary: string;
}

export interface SyncPlan {
  dryRun: boolean;
  mode: SyncMode;
  source: Host;
  target: Host;
  scope: ConfigScope;
  scaffold: true;
  canApply: false;
  entries: ConfigDiffEntry[];
  summary: string;
}

export interface CreateSyncPlanOptions {
  source: Host;
  target: Host;
  scope?: ConfigScope;
  dryRun?: boolean;
  entries?: ConfigDiffEntry[];
}

export function createEmptySnapshot(
  host: Host,
  scope: ConfigScope,
  paths: HostPaths = {}
): CanonicalConfigSnapshot {
  return {
    host,
    scope,
    paths,
    areas: {},
  };
}

export function classifyAreaRisk(area: ConfigArea): RiskLevel {
  if (area === "instructions" || area === "skills" || area === "mcp") {
    return "safe";
  }

  if (area === "permissions" || area === "hooks") {
    return "manual";
  }

  return "partial";
}

export function diffSnapshots(
  source: CanonicalConfigSnapshot,
  target: CanonicalConfigSnapshot
): ConfigDiffEntry[] {
  const entries: ConfigDiffEntry[] = [];

  for (const area of CONFIG_AREAS) {
    const sourceValue = JSON.stringify(source.areas[area] ?? null);
    const targetValue = JSON.stringify(target.areas[area] ?? null);

    if (sourceValue === targetValue) {
      continue;
    }

    entries.push({
      scope: source.scope,
      area,
      risk: classifyAreaRisk(area),
      summary: `${area} differs between ${source.host} and ${target.host}`,
      source: source.host,
      target: target.host,
    });
  }

  return entries;
}

export function isHost(value: string): value is Host {
  return value === "claude" || value === "codex";
}

export function isConfigScope(value: string): value is ConfigScope {
  return value === "global" || value === "project";
}

export function getOppositeHost(host: Host): Host {
  return host === "claude" ? "codex" : "claude";
}

export function createScaffoldStatus(
  source: Host,
  target: Host,
  scopes: ConfigScope[] = ["global", "project"]
): StatusReport {
  const entries = scopes.flatMap((scope) =>
    diffSnapshots(createEmptySnapshot(source, scope), createEmptySnapshot(target, scope))
  );

  return {
    source,
    target,
    scopes,
    scaffold: true,
    entries,
    summary:
      entries.length === 0
        ? `No diff detected in scaffold snapshots for ${scopes.join("+")} scope.`
        : `${entries.length} diff(s) detected between ${source} and ${target} for ${scopes.join("+")} scope.`,
  };
}

export function createSyncPlan(options: CreateSyncPlanOptions): SyncPlan {
  const dryRun = options.dryRun ?? true;
  const mode: SyncMode = dryRun ? "dry-run" : "apply";

  return {
    dryRun,
    mode,
    source: options.source,
    target: options.target,
    scope: options.scope ?? "project",
    scaffold: true,
    canApply: false,
    entries: options.entries ?? [],
    summary:
      mode === "dry-run"
        ? `Scaffold dry-run only: ${options.source} -> ${options.target} (${options.scope ?? "project"}).`
        : `Apply requested for ${options.source} -> ${options.target} (${options.scope ?? "project"}), but scaffold writes are disabled.`,
  };
}

export function getScaffoldNotice(mode: SyncMode): string {
  return mode === "dry-run"
    ? "No changes are applied by the scaffold implementation."
    : "Apply mode is accepted for CLI compatibility, but scaffold writes remain disabled.";
}
