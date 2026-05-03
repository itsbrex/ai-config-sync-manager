import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../../../bin/ai-config-sync.mjs", import.meta.url));

const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SHELL",
  "NODE_PATH",
  "NODE_OPTIONS",
  "LANG",
  "LC_ALL",
  "LC_CTYPE"
];

function buildEnv(home, extra) {
  const base = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) base[key] = value;
  }
  return { ...base, AI_CONFIG_SYNC_HOME: home, ...extra };
}

function invoke(subcommand, { home, projectRoot, args = [], env = {} }) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [cliPath, subcommand, ...args],
      { cwd: projectRoot, env: buildEnv(home, env), encoding: "utf8" }
    );
    return { stdout, stderr: "", status: 0, output: stdout };
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : (error.stdout?.toString?.("utf8") ?? "");
    const stderr = typeof error.stderr === "string" ? error.stderr : (error.stderr?.toString?.("utf8") ?? "");
    const status = typeof error.status === "number" ? error.status : 1;
    return { stdout, stderr, status, output: stderr || stdout };
  }
}

export function runSync(options) {
  return invoke("sync", options);
}

export function runStatus(options) {
  return invoke("status", options);
}

export function runPlanJson({ home, projectRoot, include = [], from = "codex", to = "claude", scope = "global" }) {
  const args = ["--scope", scope, "--from", from, "--to", to, "--dry-run", "--plan-json"];
  if (include.length > 0) {
    args.push("--include", include.join(","));
  }
  const result = invoke("sync", { home, projectRoot, args });
  if (result.status !== 0) {
    throw new Error(`sync --dry-run --plan-json failed (status ${result.status}): ${result.output}`);
  }
  if (result.stderr.trim().length > 0) {
    throw new Error(`sync --dry-run --plan-json stderr not empty: ${result.stderr}`);
  }
  const extracted = extractFirstJson(result.stdout);
  if (extracted === null) {
    throw new Error(`sync --dry-run --plan-json produced no parseable JSON: ${result.stdout}`);
  }
  const trailing = result.stdout.slice(extracted.end);
  if (trailing.trim().length > 0) {
    throw new Error(`sync --dry-run --plan-json produced trailing content after JSON: ${trailing}`);
  }
  return extracted.value;
}

function extractFirstJson(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    return { value: JSON.parse(trimmed), end: text.length };
  } catch {}
  const start = text.indexOf("{");
  const arrStart = text.indexOf("[");
  const candidates = [start, arrStart].filter((i) => i >= 0).sort((a, b) => a - b);
  for (const begin of candidates) {
    const open = text[begin];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = begin; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          const slice = text.slice(begin, i + 1);
          try { return { value: JSON.parse(slice), end: i + 1 }; } catch { break; }
        }
      }
    }
  }
  return null;
}

export function extractBackupRoot(stdout) {
  return backupRootFromOutput(stdout);
}

function backupRootFromOutput(stdout) {
  if (typeof stdout !== "string") return null;
  const match = stdout.match(/^Backup root: (.+)$/m);
  return match ? match[1] : null;
}
