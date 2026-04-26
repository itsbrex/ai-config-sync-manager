# Maximal Claude/Codex 1:1 Mapping Strategy

AI Config Sync Manager의 목표는 Claude와 Codex 설정을 단순 복사하지 않고, 가능한 경우 각 런타임의 native 설정으로 변환해 최대한 1:1에 가까운 동기화를 제공하는 것이다.

## Sources

- Claude Code permissions: https://code.claude.com/docs/en/permissions
- Claude Code settings: https://code.claude.com/docs/en/configuration
- Claude Code plugins: https://code.claude.com/docs/en/plugins
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Codex config: https://github.com/openai/codex/blob/main/docs/config.md
- Codex rules: https://developers.openai.com/codex/rules
- Codex hooks: https://developers.openai.com/codex/hooks

## Mapping Levels

- `exact`: 파일 또는 항목 의미가 거의 동일하다.
- `equivalent`: 저장 형식은 다르지만 native 기능으로 의미를 유지할 수 있다.
- `approximate`: 일부 의미만 유지된다.
- `metadata-only`: 원본을 주석/관리 블록으로 보존하지만 런타임 적용은 안 된다.
- `unsupported`: 자동 변환하지 않는다.

## Core Matrix

| Area | Claude | Codex | Level | Strategy |
| --- | --- | --- | --- | --- |
| Instructions | `CLAUDE.md`, user/project instructions | `AGENTS.md`, global/project instructions | `equivalent` | 문서 본문을 유지하되 대상 파일명과 precedence를 맞춘다. |
| Skills | `skills/<name>/SKILL.md` | `skills/<name>/SKILL.md` | `exact` | 디렉터리 단위 copy/merge. 충돌은 item diff로 표시한다. |
| Agents | `agents/*.md` | Codex agent/subagent 정의 | `equivalent` | Markdown frontmatter/body를 Codex agent schema로 변환한다. 스키마 미확인 필드는 metadata로 보존한다. |
| MCP | `.mcp.json`, plugin `.mcp.json`, settings MCP | `[mcp_servers.*]` in `config.toml` | `equivalent` | 서버 단위 JSON/TOML 구조 변환. command/env/args/approval mode를 item 단위로 merge한다. |
| Permissions | `permissions.allow/ask/deny` | `rules/*.rules`, `config.toml`, MCP tool approvals | `equivalent` | 도구별 native target을 우선 사용한다. 불명확한 항목은 managed comment로 보존한다. |
| Hooks | `hooks` in `settings.json` or plugin `hooks/hooks.json` | Codex hooks in `config.toml`/rules layer | `equivalent` | event/matcher/handler를 구조 변환한다. 지원 안 되는 handler type은 metadata-only. |
| Commands | `commands/*.md` or plugin command | Codex skill/plugin command entry | `approximate` | command name/body를 skill 또는 plugin command로 변환. slash namespace 차이는 보존 불가. |
| Plugins | Claude marketplace/plugin root | Codex plugin root/marketplace | `equivalent` | manifest, skills, agents, hooks, MCP, bin을 플랫폼별 dist로 생성한다. |
| Environment | `env`, hook env, MCP env | `shell_environment_policy`, MCP env, plugin env | `approximate` | secrets는 복사하지 않는다. allowlist된 key만 이동한다. |
| Status line | `statusLine` | no confirmed native equivalent | `metadata-only` | 원본 설정만 보존하고 status에서 manual item으로 표시한다. |

## Permissions Mapping

Claude permissions는 하나의 배열처럼 보이지만 Codex에서는 목적별로 나뉜다. 따라서 `approval_policy` 하나로 뭉개면 1:1 매핑이 깨진다.

| Claude Permission | Codex Target | Level | Notes |
| --- | --- | --- | --- |
| `Read`, `Glob`, `Grep`, `LS` | no-op or read tool default | `approximate` | Codex read-only 도구는 일반적으로 승인 없이 동작한다. deny path는 별도 policy가 필요하다. |
| `Write`, `Edit`, `MultiEdit` | `sandbox_mode = "workspace-write"` and writable roots | `approximate` | Claude tool 단위 allow와 Codex sandbox 범위는 완전 동일하지 않다. |
| `Bash(<pattern>)` allow | `rules/*.rules` `prefix_rule(..., "allow")` | `equivalent` | command prefix를 최대한 토큰 배열로 변환한다. |
| `Bash(<pattern>)` ask | `prefix_rule(..., "prompt")` | `equivalent` | 실행마다 승인 요청. |
| `Bash(<pattern>)` deny | `prefix_rule(..., "forbidden")` | `equivalent` | destructive command는 자동 allow 금지. |
| `WebFetch`, `WebSearch` | web/search feature or managed metadata | `approximate` | Codex의 웹 도구 노출 방식은 클라이언트/세션별 차이가 있어 검증 필요. |
| `mcp__server__tool` | `[mcp_servers.<server>.tools.<tool>] approval_mode` | `equivalent` | Codex config는 MCP 서버 기본 승인과 tool별 override를 지원한다. |
| `Agent`, `Task`, `SendMessage` | Codex subagent/delegation config or metadata | `approximate` | agent 실행 권한 모델이 동일하지 않다. |

## Bash Prefix Rules

Claude `Bash(...)`는 Codex `prefix_rule()`로 변환한다. Claude 문서상 Bash wildcard는 glob 성격이고, Codex는 shell command를 segment로 나눈 뒤 prefix list를 평가한다. 변환기는 command prefix를 가능한 좁게 만들어야 한다.

```json
{
  "claude": "Bash(git:*)",
  "codex": {
    "rules": [
      {
        "pattern": ["git"],
        "decision": "allow",
        "justification": "Migrated from Claude permission Bash(git:*)."
      }
    ]
  },
  "level": "equivalent"
}
```

Recommended examples:

| Claude | Codex |
| --- | --- |
| `Bash(git:*)` | `prefix_rule(pattern = ["git"], decision = "allow")` |
| `Bash(git status:*)` | `prefix_rule(pattern = ["git", "status"], decision = "allow")` |
| `Bash(npm run:*)` | `prefix_rule(pattern = ["npm", "run"], decision = "allow")` |
| `Bash(gh pr:*)` | `prefix_rule(pattern = ["gh", "pr"], decision = "allow")` |
| `Bash(rg:*)` | `prefix_rule(pattern = ["rg"], decision = "allow")` |
| `Bash(git push:*)` in deny | `prefix_rule(pattern = ["git", "push"], decision = "forbidden")` |

Broad or risky examples:

| Claude | Codex Handling |
| --- | --- |
| `Bash(python:*)`, `Bash(python3:*)`, `Bash(node:*)` | default `prompt`; do not auto-allow because arbitrary scripts are possible. |
| `Bash(sh:*)`, `Bash(bash:*)`, `Bash(zsh:*)` | default `prompt` or `forbidden`; shell wrappers erase useful prefix safety. |
| `Bash(rm:*)`, `Bash(sudo:*)`, `Bash(chmod:*)`, `Bash(chown:*)` | default `forbidden` or manual review. |
| `Bash(curl:*)`, `Bash(wget:*)` | default `prompt`; network/write behavior depends on flags. |

## MCP Mapping

Codex config supports MCP servers under `[mcp_servers.*]` and per-tool approval overrides. Claude MCP entries should be merged server-by-server:

- `command`, `args`, `env`: structured conversion.
- `disabled`: preserve as disabled server metadata if Codex lacks identical field.
- Claude `mcp__server__tool` permissions: map to `mcp_servers.<server>.tools.<tool>.approval_mode`.
- Unknown server fields: preserve under managed comments and show as `metadata-only`.

## Hooks Mapping

Claude and Codex both support `SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, and `Stop` style lifecycle hooks, but handler schemas are not always identical.

| Claude Handler | Codex Target | Level |
| --- | --- | --- |
| `type: "command"` | Codex command hook | `equivalent` |
| `type: "http"` | Codex hook if supported by active schema, otherwise wrapper command | `approximate` |
| `type: "prompt"` | Codex hook context/message if supported, otherwise metadata | `approximate` |
| `type: "agent"` | Codex subagent hook if supported, otherwise metadata | `approximate` |
| `type: "mcp_tool"` | MCP tool hook if supported, otherwise metadata | `approximate` |

## Proposed Mapping Files

Keep mapping rules data-driven instead of hard-coding every case in sync logic:

```text
rules/
  permissions-map.json
  bash-prefix-map.json
  mcp-map.json
  hooks-map.json
  agents-map.json
```

Minimum `permissions-map.json` shape:

```json
{
  "claudeToCodex": [
    {
      "match": "Bash(git:*)",
      "codex": {
        "rules": [
          {
            "pattern": ["git"],
            "decision": "allow"
          }
        ]
      },
      "level": "equivalent"
    }
  ]
}
```

## Implementation Order

1. Generate Codex `rules/default.rules` blocks from Claude `Bash(...)` allow/ask/deny.
2. Add MCP JSON/TOML structured conversion with server and tool item selectors.
3. Convert Claude agent Markdown to Codex agent definitions with metadata fallback.
4. Convert hooks by event/matcher/handler type, starting with command hooks.
5. Update `status` to show each item as `exact`, `equivalent`, `approximate`, or `metadata-only`.
6. Add manual review warnings for broad prefixes, secrets, destructive commands, and unsupported hook handlers.

## MVP Guardrails

- Never copy `.env` values or likely secrets from settings/env blocks.
- Never auto-allow broad interpreters or shell wrappers.
- Never auto-allow destructive commands from migrated Bash rules.
- Preserve unknown fields as metadata and surface them in `status`.
- Keep `--apply` item-scoped: `--include permissions:Bash(git:*)`, `--exclude mcp:github`.
