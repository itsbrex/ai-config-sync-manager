import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const fixturesRoot = join(here, "..", "fixtures", "areas");

export function createIntegrationFixture({ scenario = "codex-to-claude" } = {}) {
  const root = mkdtempSync(join(tmpdir(), `ai-config-sync-int-${scenario}-`));
  const home = join(root, "home");
  const project = join(root, "project");
  const expectedHome = join(root, "expected-home");
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  mkdirSync(expectedHome, { recursive: true });
  return { root, home, project, expectedHome, scenario };
}

export function layCodexHome(home, areaSpecs) {
  for (const { area, variant } of areaSpecs) {
    const src = join(fixturesRoot, area, variant, "codex-home");
    if (!existsSync(src)) {
      throw new Error(`fixture missing: ${area}/${variant}/codex-home`);
    }
    cpSync(src, home, { recursive: true, dereference: false, verbatimSymlinks: true });
  }
}

export function layPreExistingClaude(home, areaSpecs) {
  for (const { area, variant } of areaSpecs) {
    const src = join(fixturesRoot, area, variant, "pre-claude");
    if (!existsSync(src)) continue;
    cpSync(src, home, { recursive: true });
  }
}

export function layExpectedClaude(expectedHome, areaSpecs) {
  for (const { area, variant } of areaSpecs) {
    const src = join(fixturesRoot, area, variant, "expected-claude");
    if (!existsSync(src)) continue;
    cpSync(src, expectedHome, { recursive: true });
  }
  return expectedHome;
}

export function mergeCodexConfigToml(home, areaSpecs) {
  const parts = [];
  for (const { area, variant } of areaSpecs) {
    const src = join(fixturesRoot, area, variant, "codex-home", ".codex", "config.toml");
    if (!existsSync(src)) {
      throw new Error(`config.toml missing for fixture: ${area}/${variant}`);
    }
    parts.push(readFileSync(src, "utf8").trimEnd());
  }
  const codexDir = join(home, ".codex");
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(join(codexDir, "config.toml"), parts.join("\n\n") + "\n");
}

export function cleanupFixture(fixture) {
  rmSync(fixture.root, { recursive: true, force: true });
}
