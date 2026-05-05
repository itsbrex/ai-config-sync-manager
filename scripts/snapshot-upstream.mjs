#!/usr/bin/env node

// Layer 1 of upstream-compat-plan.md: passive snapshot diff.
// Fetches Claude/Codex schemas, releases, and changelogs into snapshots/
// in a deterministic, byte-stable form. Idempotent — re-runs produce no
// diff unless upstream actually changed.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UA = "ai-config-sync-manager-snapshot/1.0";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP = join(ROOT, "snapshots");
const TOKEN = process.env.GITHUB_TOKEN;

const SOURCES = [
  {
    out: "claude/settings-schema.json",
    url: "https://json.schemastore.org/claude-code-settings.json",
    kind: "schema",
    accept: "application/json",
  },
  {
    out: "claude/releases.json",
    url: "https://api.github.com/repos/anthropics/claude-code/releases",
    kind: "releases",
    accept: "application/vnd.github+json",
  },
  {
    out: "claude/changelog.md",
    url: "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md",
    kind: "text",
    accept: "text/plain",
  },
  {
    out: "codex/config-schema.json",
    url: "https://developers.openai.com/codex/config-schema.json",
    kind: "schema",
    accept: "application/json",
  },
  {
    out: "codex/releases.json",
    url: "https://api.github.com/repos/openai/codex/releases",
    kind: "releases",
    accept: "application/vnd.github+json",
  },
  {
    out: "codex/changelog.md",
    url: "https://raw.githubusercontent.com/openai/codex/main/CHANGELOG.md",
    kind: "text",
    accept: "text/plain",
    fallback: {
      url: "https://api.github.com/repos/openai/codex/releases",
      accept: "application/vnd.github+json",
      kind: "releases-as-changelog",
    },
  },
];

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function buildHeaders(accept) {
  const h = { "User-Agent": UA, Accept: accept };
  if (TOKEN && accept.includes("github")) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function fetchSource(url, accept) {
  const res = await fetch(url, { headers: buildHeaders(accept) });
  if (!res.ok) {
    return { ok: false, status: res.status, url };
  }
  const text = await res.text();
  return { ok: true, text, url };
}

function shapeReleases(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const slim = parsed
    .slice(0, 5)
    .map((r) => ({
      tag_name: r?.tag_name ?? null,
      published_at: r?.published_at ?? null,
      body: r?.body ?? "",
    }))
    .sort((a, b) => {
      const ta = a.published_at ? Date.parse(a.published_at) : 0;
      const tb = b.published_at ? Date.parse(b.published_at) : 0;
      return tb - ta;
    });
  return slim;
}

function releasesAsChangelog(raw) {
  const slim = shapeReleases(raw);
  if (slim.length === 0) return "# Changelog\n\n_No release data available._\n";
  const parts = ["# Changelog (synthesized from GitHub releases)\n"];
  for (const r of slim) {
    const tag = r.tag_name ?? "unknown";
    const date = r.published_at ? r.published_at.slice(0, 10) : "unknown";
    parts.push(`## ${tag} — ${date}\n`);
    parts.push(`${(r.body || "").trim()}\n`);
  }
  return `${parts.join("\n")}\n`;
}

async function readPriorSnapshot(relPath) {
  try {
    return await readFile(join(SNAP, relPath), "utf8");
  } catch {
    return null;
  }
}

function isStubText(text) {
  if (!text) return false;
  try {
    const obj = JSON.parse(text);
    return (
      obj &&
      typeof obj === "object" &&
      typeof obj._error === "string" &&
      typeof obj._url === "string"
    );
  } catch {
    return false;
  }
}

async function buildStubError(relPath, url, status) {
  // Preserve existing _at if the prior snapshot is already a stub for the
  // same _error + _url — keeps the script idempotent across transient errors.
  const prior = await readPriorSnapshot(relPath);
  let at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  if (prior) {
    try {
      const obj = JSON.parse(prior);
      if (
        obj &&
        typeof obj === "object" &&
        obj._error === String(status) &&
        obj._url === url &&
        typeof obj._at === "string"
      ) {
        at = obj._at;
      }
    } catch {
      // Fall through with fresh _at.
    }
  }
  return stableJson({ _at: at, _error: String(status), _url: url });
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

async function writeOut(relPath, body, isJson) {
  const target = join(SNAP, relPath);
  await mkdir(dirname(target), { recursive: true });
  let payload = body;
  if (!isJson && !payload.endsWith("\n")) payload += "\n";
  await writeFile(target, payload, "utf8");
  return Buffer.byteLength(payload, "utf8");
}

async function processSource(src) {
  const primary = await fetchSource(src.url, src.accept);
  if (primary.ok) {
    if (src.kind === "schema") {
      let parsed;
      try {
        parsed = JSON.parse(primary.text);
      } catch {
        return await failureWrite(src, "invalid-json");
      }
      const bytes = await writeOut(src.out, stableJson(parsed), true);
      return { ok: true, path: src.out, bytes };
    }
    if (src.kind === "releases") {
      const slim = shapeReleases(primary.text);
      const bytes = await writeOut(src.out, stableJson(slim), true);
      return { ok: true, path: src.out, bytes };
    }
    if (src.kind === "text") {
      const bytes = await writeOut(src.out, primary.text, false);
      return { ok: true, path: src.out, bytes };
    }
  }

  if (src.fallback) {
    const fb = await fetchSource(src.fallback.url, src.fallback.accept);
    if (fb.ok && src.fallback.kind === "releases-as-changelog") {
      const bytes = await writeOut(src.out, releasesAsChangelog(fb.text), false);
      return { ok: true, path: src.out, bytes, fallback: true, status: primary.status };
    }
  }

  return await failureWrite(src, primary.status ?? "fetch-failed");
}

// On fetch failure: write a stub UNLESS the prior snapshot is a real (non-stub)
// payload — in that case we keep the last-known-good copy and report partial.
// This trades transient upstream outages for noisy CI alerts.
async function failureWrite(src, status) {
  const prior = await readPriorSnapshot(src.out);
  if (prior && !isStubText(prior)) {
    const bytes = Buffer.byteLength(prior, "utf8");
    return { ok: false, status, path: src.out, bytes, kept: true };
  }
  const stub = await buildStubError(src.out, src.url, status);
  const bytes = await writeOut(src.out, stub, true);
  return { ok: false, status, path: src.out, bytes };
}

async function main() {
  await mkdir(SNAP, { recursive: true });
  const results = [];
  for (const src of SOURCES) {
    try {
      results.push(await processSource(src));
    } catch (err) {
      results.push(await failureWrite(src, `exception:${err?.message ?? "unknown"}`));
    }
  }

  let total = 0;
  let failed = 0;
  for (const r of results) {
    const rel = `snapshots/${r.path}`;
    total += r.bytes;
    if (r.ok) {
      const note = r.fallback ? ` (fallback: primary ${r.status})` : "";
      console.log(`OK  ${rel} (${formatBytes(r.bytes)})${note}`);
    } else {
      failed += 1;
      const note = r.kept ? " (kept last-known-good)" : "";
      console.log(`ERR ${rel} -- ${r.status}${note}`);
    }
  }
  console.log(`\nTotal: ${formatBytes(total)} across ${results.length} files (${failed} failed)`);
  // Always exit 0 — CI surfaces drift via diff, not exit code.
}

main().catch((err) => {
  console.error(`snapshot-upstream: fatal: ${err?.stack ?? err}`);
  process.exit(1);
});
