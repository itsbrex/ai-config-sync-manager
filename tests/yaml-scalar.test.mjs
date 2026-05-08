import test from "node:test";
import assert from "node:assert/strict";

import { yamlScalarRequiresQuoting, serializeYamlScalar } from "../bin/util/yaml-scalar.mjs";

test("yamlScalarRequiresQuoting returns true for every YAML 1.2 c-indicator first character", () => {
  const indicators = [
    "-",
    "?",
    ":",
    ",",
    "[",
    "]",
    "{",
    "}",
    "#",
    "&",
    "*",
    "!",
    "|",
    ">",
    "'",
    '"',
    "%",
    "@",
    "`",
  ];
  for (const ch of indicators) {
    assert.equal(
      yamlScalarRequiresQuoting(`${ch}foo`),
      true,
      `expected ${ch}foo to require quoting`
    );
  }

  // bare block-sequence dash and merge key are c-indicator adjacent forms
  assert.equal(yamlScalarRequiresQuoting("-"), true, "bare dash must quote (block-seq sentinel)");
  assert.equal(yamlScalarRequiresQuoting("<<"), true, "merge key << must quote");

  // `<` itself is NOT a YAML 1.2 c-indicator, so a plain `<other` stays unquoted
  assert.equal(yamlScalarRequiresQuoting("<other"), false, "< is not an indicator on its own");
});

test("yamlScalarRequiresQuoting returns true for whitespace and structural sentinels", () => {
  assert.equal(yamlScalarRequiresQuoting(""), true, "empty string must quote");
  assert.equal(yamlScalarRequiresQuoting(" foo"), true, "leading whitespace must quote");
  assert.equal(yamlScalarRequiresQuoting("foo "), true, "trailing whitespace must quote");
  assert.equal(yamlScalarRequiresQuoting("key: value"), true, "internal `: ` must quote");
  assert.equal(yamlScalarRequiresQuoting("trailing:"), true, "line-end `:` must quote");
  assert.equal(yamlScalarRequiresQuoting("text #comment"), true, "internal ` #` must quote");
  assert.equal(yamlScalarRequiresQuoting("line1\nline2"), true, "newline must quote");
  assert.equal(yamlScalarRequiresQuoting('has "quote"'), true, "embedded double quote must quote");
  assert.equal(yamlScalarRequiresQuoting("- item"), true, "block-seq `- item` must quote");
  assert.equal(yamlScalarRequiresQuoting("<<"), true, "merge key << must quote");
});

test("yamlScalarRequiresQuoting returns true for YAML bool, null, and single-letter coercion tokens", () => {
  const tokens = [
    "null",
    "Null",
    "NULL",
    "~",
    "true",
    "True",
    "TRUE",
    "false",
    "False",
    "FALSE",
    "yes",
    "Yes",
    "YES",
    "no",
    "No",
    "NO",
    "on",
    "On",
    "ON",
    "off",
    "Off",
    "OFF",
    "y",
    "Y",
    "n",
    "N",
  ];
  for (const t of tokens) {
    assert.equal(
      yamlScalarRequiresQuoting(t),
      true,
      `expected coercion token ${t} to require quoting`
    );
  }
});

test("yamlScalarRequiresQuoting returns true for numeric, hex, octal, binary, and special float forms", () => {
  const numeric = ["0", "123", "-1", "+42", "3.14", "-0.5", "1e10", "-1.5e-3"];
  for (const v of numeric) {
    assert.equal(yamlScalarRequiresQuoting(v), true, `numeric ${v} must quote`);
  }

  const hex = ["0xFF", "-0x1A"];
  for (const v of hex) {
    assert.equal(yamlScalarRequiresQuoting(v), true, `hex ${v} must quote`);
  }

  assert.equal(yamlScalarRequiresQuoting("0o755"), true, "octal 0o755 must quote");
  assert.equal(yamlScalarRequiresQuoting("0b101"), true, "binary 0b101 must quote");

  const specialFloat = [".inf", ".Inf", ".INF", "+.inf", "-.inf", ".nan", ".NaN", ".NAN"];
  for (const v of specialFloat) {
    assert.equal(yamlScalarRequiresQuoting(v), true, `special float ${v} must quote`);
  }
});

test("yamlScalarRequiresQuoting returns true for YAML 1.1 timestamp-like values", () => {
  const timestamps = [
    "2014-12-31",
    "1900-01-01",
    "2014-12-31T12:00:00Z",
    "2014-12-31t12:00:00-0530",
    "2014-12-31 12:00:00.123+09:00",
  ];
  for (const v of timestamps) {
    assert.equal(yamlScalarRequiresQuoting(v), true, `timestamp ${v} must quote`);
  }

  // Slash-separated and 2-digit-year forms do not match the YAML 1.1 timestamp shape
  assert.equal(
    yamlScalarRequiresQuoting("2014/12/31"),
    false,
    "slash-separated date is not a timestamp"
  );
  assert.equal(
    yamlScalarRequiresQuoting("14-12-31"),
    false,
    "2-digit year is not a YAML timestamp"
  );
});

test("yamlScalarRequiresQuoting returns false for plain ASCII identifiers and human-readable text", () => {
  const plain = [
    "code-review",
    "opus",
    "code-writer-logic",
    "kebab-case-thing",
    "Anthropic",
    "foo bar",
    "Hello World",
    "Review the code carefully.",
    "1.0.0",
    "v1.2.3",
    "https",
    // `:` is followed by `/`, not whitespace or line-end — plain-safe per YAML 1.2
    "https://x",
  ];
  for (const v of plain) {
    assert.equal(
      yamlScalarRequiresQuoting(v),
      false,
      `plain scalar ${JSON.stringify(v)} must not require quoting`
    );
  }
});

test("serializeYamlScalar wraps quoting-required values with double quotes and leaves plain values bare", () => {
  // plain identifier — no quotes
  assert.equal(serializeYamlScalar("code-review"), "code-review");

  // glob pattern starts with `*` indicator → must quote, JSON.stringify wraps with double quotes
  assert.equal(serializeYamlScalar("**/*.{js,ts}"), '"**/*.{js,ts}"');

  // numeric coercion: 123 → "123" → numeric regex hit → quoted
  assert.equal(serializeYamlScalar(123), '"123"');

  // boolean coercion: true → "true" → bool token hit → quoted
  assert.equal(serializeYamlScalar(true), '"true"');

  // null coercion: null → "null" → null token hit → quoted
  assert.equal(serializeYamlScalar(null), '"null"');

  // empty string → quoted empty
  assert.equal(serializeYamlScalar(""), '""');
});
