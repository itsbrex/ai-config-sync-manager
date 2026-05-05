// Flat ESLint config. Base recommended rules for all JS/TS; typescript-eslint
// recommended scoped to .ts files only (no duplicate @typescript-eslint rules
// on .mjs). eslint-config-prettier last so style rules don't fight prettier.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "snapshots/**",
      "tests/integration/manual-codex-to-claude/**",
      "tests/integration/fixtures/**",
      "packages/*/dist/**",
      "packages/*/build/**",
      ".claude/docs/repo-analysis/**",
      ".codex/docs/repo-analysis/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["bin/**/*.mjs", "scripts/**/*.mjs", "tests/**/*.mjs", "packages/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        global: "readonly",
        globalThis: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  prettier
);
