import { lstatSync } from "node:fs";

// prettier 3 hard-errors on symlink arguments and ignores .prettierignore for explicit
// paths, so filter symlinks (e.g. CLAUDE.md → AGENTS.md) before invoking lint-staged tasks.
const realFiles = (files) =>
  files.filter((file) => {
    try {
      return !lstatSync(file).isSymbolicLink();
    } catch {
      return true;
    }
  });

const quote = (file) => `'${file.replace(/'/g, "'\\''")}'`;

export default {
  "*.{js,mjs,json,md,yml,yaml}": (files) => {
    const targets = realFiles(files);
    return targets.length === 0
      ? []
      : [`prettier --list-different ${targets.map(quote).join(" ")}`];
  },
  "*.{js,mjs}": (files) => {
    const targets = realFiles(files);
    return targets.length === 0 ? [] : [`eslint ${targets.map(quote).join(" ")}`];
  },
};
