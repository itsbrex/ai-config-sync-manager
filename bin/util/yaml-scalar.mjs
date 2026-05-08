// YAML 1.2 spec rule [22] c-indicator + YAML 1.1 coercion compat. Single source of truth for frontmatter scalar quoting in claude/codex sync.

const RESERVED_INDICATOR_PREFIX = /^[-?:,[\]{}#&*!|>'"%@`]/;
const SEQ_DASH = /^-(?:\s|$)/;
const LEADING_TRAILING_WS = /^\s|\s$/;
const COLON_INDICATOR = /:(?:\s|$)/;
const HASH_COMMENT = /\s#/;
const NEWLINE_OR_DQ = /[\n"]/;
const MERGE_KEY = /^<<$/;
const YAML_BOOL_NULL =
  /^(?:null|Null|NULL|~|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|y|Y|n|N)$/;
const YAML_NUMERIC = /^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const YAML_HEX = /^[+-]?0x[0-9A-Fa-f]+$/;
const YAML_OCTAL = /^[+-]?0o[0-7]+$/;
const YAML_BINARY = /^[+-]?0b[01]+$/;
const YAML_SPECIAL_FLOAT = /^[+-]?\.(?:nan|NaN|NAN|inf|Inf|INF)$/;
const YAML_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

export function yamlScalarRequiresQuoting(text) {
  if (text === "") return true;
  if (LEADING_TRAILING_WS.test(text)) return true;
  if (RESERVED_INDICATOR_PREFIX.test(text)) return true;
  if (SEQ_DASH.test(text)) return true;
  if (COLON_INDICATOR.test(text)) return true;
  if (HASH_COMMENT.test(text)) return true;
  if (NEWLINE_OR_DQ.test(text)) return true;
  if (MERGE_KEY.test(text)) return true;
  if (YAML_BOOL_NULL.test(text)) return true;
  if (YAML_SPECIAL_FLOAT.test(text)) return true;
  if (YAML_NUMERIC.test(text)) return true;
  if (YAML_HEX.test(text)) return true;
  if (YAML_OCTAL.test(text)) return true;
  if (YAML_BINARY.test(text)) return true;
  if (YAML_TIMESTAMP.test(text)) return true;
  return false;
}

export function serializeYamlScalar(value) {
  const text = String(value);
  return yamlScalarRequiresQuoting(text) ? JSON.stringify(text) : text;
}
