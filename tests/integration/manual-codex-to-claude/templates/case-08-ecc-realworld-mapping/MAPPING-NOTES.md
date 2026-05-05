# case-08 mapping & paraphrase reference

수정/조정이 필요할 때 어디를 건드릴지 빠르게 찾기 위한 인덱스.
경로는 `templates/case-08-ecc-realworld-mapping/` 기준 상대.

## Terminology mapping (instructions: `.codex/AGENTS.md` → `.claude/CLAUDE.md`)

| line | source token (codex)              | target token (claude)              |
| ---- | --------------------------------- | ---------------------------------- |
| 1    | `Codex CLI`                       | `Claude Code`                      |
| 3    | `AGENTS.md`                       | `CLAUDE.md`                        |
| 17   | `SKILL.md`                        | `skill.md`                         |
| 36   | `.codex/config.toml`              | `~/.claude/settings.json`          |
| 36   | `~/.codex/config.toml`            | `~/.claude/settings.json`          |
| 50   | `.codex/config.toml`              | `~/.claude/settings.json`          |
| 52   | `.codex/agents/`                  | `.claude/agents/`                  |
| 53   | `Codex CLI`                       | `Claude Code`                      |
| 56   | `.codex/agents/explorer.toml`     | `.claude/agents/explorer.md`       |
| 57   | `.codex/agents/reviewer.toml`     | `.claude/agents/reviewer.md`       |
| 58   | `.codex/agents/docs-researcher.toml` | `.claude/agents/docs-researcher.md` |
| 62   | `Codex CLI` (table cell)          | `Claude Code` (over-translation)   |
| 65   | `AGENTS.md` ×2 (table cell)       | `CLAUDE.md` ×2 (over-translation)  |

수정 시작점: `.codex/AGENTS.md` 위 라인. 기대 결과: `expected/.../claude-home/.claude/CLAUDE.md`.

## Skill body mapping (`.agents/skills/verification-loop/SKILL.md` → `.claude/skills/verification-loop/skill.md`)

| line | change                                                      |
| ---- | ----------------------------------------------------------- |
| 3    | frontmatter `description` quoting: `"..."` → `...` (unquoted) |

본문은 그대로 (`Claude Code`, `PostToolUse hooks`, `/verify` 모두 paraphrase 트리거 안 됨).

## Permissions mapping (`.codex/config.toml` → `.claude/settings.json` `permissions.allow[]`)

| source                            | line | derived items in `permissions.allow` | quality   |
| --------------------------------- | ---- | ------------------------------------- | --------- |
| `sandbox_mode = "workspace-write"` | 2    | `Edit`, `MultiEdit`, `Write`          | equivalent |
| `web_search = "live"`              | 3    | `WebSearch`                           | exact     |

수정 시작점: `.codex/config.toml` 라인 2~3. 기대 결과: `expected/.../claude-home/.claude/settings.json`.

## MCP server mapping (`.codex/config.toml [mcp_servers.X]` → `.claude.json mcpServers.X`)

| section line | id                  | transport       | claude `type` |
| ------------ | ------------------- | --------------- | ------------- |
| 7            | `manual_github`     | stdio (command) | `stdio`       |
| 12           | `context7`          | stdio (command) | `stdio`       |
| 17           | `manual_exa`        | streamable_http | `http`        |
| 22           | `memory`            | stdio (command) | `stdio`       |
| 27           | `playwright`        | stdio (command) | `stdio`       |
| 32           | `sequential-thinking` | stdio (command) | `stdio`       |

수정 시작점: `.codex/config.toml` 해당 섹션. 기대 결과: `expected/.../claude-home/.claude.json` `mcpServers`.

## Paraphrase (vocab mismatch — 자동 fix 없음, manual review)

| file (codex side)                                       | line | token   | classification                  | 권장 조치                              |
| ------------------------------------------------------- | ---- | ------- | ------------------------------- | ----------------------------------- |
| `.agents/skills/verification-loop/SKILL.md`             | 6    | `Skill` | `claude-only; not callable on codex` | 그대로 두거나 `paraphrase --apply --map "Skill=verification routine"` 류로 override 등록 |

수정 시작점: SKILL.md L6 (`# Verification Loop Skill`). paraphrase override를 등록하면 `~/.ai-config-sync-manager/rules/paraphrase-overrides.json` (lab 안 sandboxed)에 active entry로 남음.

## 의도하지 않은 over-translation (현재 fixture에 박제됨)

골든 결과로 캡처된 부분 — mapping 룰의 한계 노출용:

- `.claude/CLAUDE.md` L62: 표 헤더 `| Claude Code | Claude Code |` (원래는 `Codex CLI` 가 우측에 와야 의미가 살아있음)
- `.claude/CLAUDE.md` L65: `CLAUDE.md + CLAUDE.md` (원래는 `CLAUDE.md + AGENTS.md`)

향후 paraphrase override 또는 status-ignore 룰 후보. 지금은 expected에 그대로 박제되어 있어 다음 sync에서도 동일하게 재현된다 (regression guard).

## status-ignore / paraphrase override / paraphrase map 등록 케이스

`case-09-ecc-rules-pre-registered/` 가 같은 source에 룰 파일을 미리 등록한
변형 케이스다. 위 over-translation 라인을 `status-ignore`로 마스킹하고,
`Skill` vocab mismatch는 `paraphrase-overrides`로 active 처리한다. 룰 파일
형식·placeholder 치환 흐름은 해당 케이스 `README.md` 참조.
