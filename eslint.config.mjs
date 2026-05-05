// Flat ESLint config. Base recommended rules + typescript-eslint recommended for
// .ts files in packages/. eslint-config-prettier last so style rules don't fight
// prettier. Existing source is incrementally formatted/linted in follow-up commits,
// so this config is intentionally permissive (warn-only on whitespace-y rules).

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default [
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
  ...tseslint.configs.recommended,
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
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["packages/**/*.ts"],
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
  prettier,
];
