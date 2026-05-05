import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function safeReadJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function safeReadText(path) {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function readClaudeMcpFromHome(home) {
  const data = safeReadJson(join(home, ".claude.json"));
  if (!data || typeof data !== "object") return {};
  const servers = data.mcpServers ?? data.servers ?? {};
  return servers && typeof servers === "object" ? servers : {};
}

export function readClaudeSettings(home) {
  const data = safeReadJson(join(home, ".claude", "settings.json"));
  return data && typeof data === "object" ? data : {};
}

export function readClaudeInstructions(home) {
  return safeReadText(join(home, ".claude", "CLAUDE.md")) ?? "";
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: text };
  const fmRaw = match[1];
  const body = text.slice(match[0].length);
  const frontmatter = {};
  for (const line of fmRaw.split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function listDirs(parent) {
  if (!existsSync(parent)) return [];
  let info;
  try {
    info = statSync(parent);
  } catch {
    return [];
  }
  if (!info.isDirectory()) return [];
  return readdirSync(parent).filter((name) => {
    try {
      return statSync(join(parent, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

export function scanClaudeSkills(home) {
  const out = new Map();
  const skillsRoot = join(home, ".claude", "skills");
  for (const name of listDirs(skillsRoot)) {
    const candidates = [join(skillsRoot, name, "SKILL.md"), join(skillsRoot, name, "skill.md")];
    let hit = null;
    for (const c of candidates) {
      if (existsSync(c)) {
        hit = c;
        break;
      }
    }
    if (!hit) continue;
    const text = safeReadText(hit);
    if (text === null) continue;
    const { frontmatter, body } = parseFrontmatter(text);
    out.set(name, { path: hit, frontmatter, body });
  }
  return out;
}

export function scanClaudeAgents(home) {
  const out = new Map();
  const agentsRoot = join(home, ".claude", "agents");
  if (!existsSync(agentsRoot)) return out;
  let info;
  try {
    info = statSync(agentsRoot);
  } catch {
    return out;
  }
  if (!info.isDirectory()) return out;
  for (const name of readdirSync(agentsRoot)) {
    if (!name.endsWith(".md")) continue;
    const path = join(agentsRoot, name);
    let s;
    try {
      s = statSync(path);
    } catch {
      continue;
    }
    if (!s.isFile()) continue;
    const text = safeReadText(path);
    if (text === null) continue;
    const { frontmatter, body } = parseFrontmatter(text);
    const key = name.slice(0, -3);
    out.set(key, { path, frontmatter, body });
  }
  return out;
}

export function readSyncState(home, scope) {
  const path = join(home, ".ai-config-sync-manager", "state", `${scope}.json`);
  return safeReadJson(path);
}

export function readCallArchive(backupRootDir) {
  const data = safeReadJson(join(backupRootDir, "unsupported-calls.json"));
  return Array.isArray(data) ? data : [];
}
