#!/usr/bin/env node

declare const console: {
  log(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
};

declare const process: {
  argv: string[];
  exitCode?: number;
};

import {
  createScaffoldStatus,
  createSyncPlan,
  getScaffoldNotice,
  isConfigScope,
  isHost,
  type ConfigScope,
  type Host
} from "@ai-config-sync-manager/core";

type CommandName = "connect" | "status" | "sync";

interface ParsedArgs {
  flags: Set<string>;
  values: Map<string, string>;
}

interface ParsedCommand {
  command: CommandName | "help";
  args: ParsedArgs;
}

interface SyncOptions {
  source: Host;
  target: Host;
  scope: ConfigScope;
  dryRun: boolean;
}

main();

function main(): void {
  try {
    const parsed = parseCommand(process.argv.slice(2));

    switch (parsed.command) {
      case "connect":
        runConnect(parsed.args);
        return;
      case "status":
        runStatus(parsed.args);
        return;
      case "sync":
        runSync(parsed.args);
        return;
      default:
        printHelp();
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : "Unknown CLI error");
  }
}

function parseCommand(argv: string[]): ParsedCommand {
  const [command = "help", ...rest] = argv;

  if (command !== "connect" && command !== "status" && command !== "sync") {
    return {
      command: "help",
      args: createParsedArgs([])
    };
  }

  return {
    command,
    args: createParsedArgs(rest)
  };
}

function createParsedArgs(argv: string[]): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    if (token === "--json" || token === "--dry-run" || token === "--apply") {
      flags.add(token);
      continue;
    }

    if (token === "--from" || token === "--to" || token === "--scope") {
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${token}`);
      }

      values.set(token, value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return { flags, values };
}

function runConnect(args: ParsedArgs): void {
  ensureNoOptions(args, "connect");
  console.log("AI Config Sync Manager connect");
  console.log("Status: scaffold install check only");
  console.log("Checks: default root, Claude plugin install, Codex plugin marketplace.");
  console.log("No files are modified by connect.");
}

function runStatus(args: ParsedArgs): void {
  ensureAllowedFlags(args, "status", ["--json"]);
  ensureAllowedValues(args, "status", ["--scope"]);
  const scopes = parseStatusScopes(args);

  const report = createScaffoldStatus("claude", "codex", scopes);

  if (args.flags.has("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("AI Config Sync Manager status");
  console.log(`Scopes: ${report.scopes.join(", ")}`);
  console.log(report.summary);
}

function runSync(args: ParsedArgs): void {
  ensureAllowedFlags(args, "sync", ["--dry-run", "--apply"]);
  ensureAllowedValues(args, "sync", ["--from", "--to", "--scope"]);
  const options = parseSyncOptions(args);
  const report = createScaffoldStatus(options.source, options.target, [options.scope]);
  const plan = createSyncPlan({
    source: options.source,
    target: options.target,
    scope: options.scope,
    dryRun: options.dryRun,
    entries: report.entries
  });

  console.log("AI Config Sync Manager sync");
  console.log(`Route: ${plan.source} -> ${plan.target}`);
  console.log(`Scope: ${plan.scope}`);
  console.log(`Mode: ${plan.mode}`);
  console.log(plan.summary);
  console.log(getScaffoldNotice(plan.mode));
}

function parseStatusScopes(args: ParsedArgs): ConfigScope[] {
  const value = args.values.get("--scope");

  if (!value) {
    return ["global", "project"];
  }

  if (value === "all") {
    return ["global", "project"];
  }

  if (!isConfigScope(value)) {
    throw new Error("Supported scopes are global, project, and all.");
  }

  return [value];
}

function parseSyncOptions(args: ParsedArgs): SyncOptions {
  if (args.flags.has("--dry-run") && args.flags.has("--apply")) {
    throw new Error("Choose either --dry-run or --apply, not both.");
  }

  const fromValue = args.values.get("--from");
  const toValue = args.values.get("--to");
  const scopeValue = args.values.get("--scope") ?? "project";

  if (!isConfigScope(scopeValue)) {
    throw new Error("Supported sync scopes are global and project.");
  }

  if (!fromValue && !toValue) {
    return {
      source: "claude",
      target: "codex",
      scope: scopeValue,
      dryRun: !args.flags.has("--apply")
    };
  }

  if (!fromValue || !toValue) {
    throw new Error("Both --from and --to must be provided together.");
  }

  if (!isHost(fromValue) || !isHost(toValue)) {
    throw new Error("Supported hosts are claude and codex.");
  }

  if (fromValue === toValue) {
    throw new Error("--from and --to must be different hosts.");
  }

  return {
    source: fromValue,
    target: toValue,
    scope: scopeValue,
    dryRun: !args.flags.has("--apply")
  };
}

function ensureNoOptions(args: ParsedArgs, command: CommandName): void {
  if (args.flags.size > 0 || args.values.size > 0) {
    throw new Error(`${command} does not accept options.`);
  }
}

function ensureAllowedFlags(args: ParsedArgs, command: CommandName, allowedFlags: string[]): void {
  for (const flag of args.flags) {
    if (!allowedFlags.includes(flag)) {
      throw new Error(`Unknown option for ${command}: ${flag}`);
    }
  }
}

function ensureAllowedValues(args: ParsedArgs, command: CommandName, allowedValues: string[]): void {
  for (const key of args.values.keys()) {
    if (!allowedValues.includes(key)) {
      throw new Error(`Unknown option for ${command}: ${key}`);
    }
  }
}

function printHelp(): void {
  console.log(`Usage:
  ai-config-sync connect
  ai-config-sync status
  ai-config-sync status --json
  ai-config-sync status --scope global|project|all
  ai-config-sync sync --dry-run
  ai-config-sync sync --scope global|project --dry-run
  ai-config-sync sync --from claude --to codex
  ai-config-sync sync --from codex --to claude`);
}
