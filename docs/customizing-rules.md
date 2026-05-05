# Customizing Rules

이 도구는 Claude ↔ Codex 변환에 5개 매핑 룰 파일을 사용한다. 각 파일은 부분 override(partial overlay) 파일을 통해 번들 기본값을 건드리지 않고 본인 스타일로 덮어쓸 수 있다.

## Override Precedence

동일한 이름의 룰 파일이 여러 위치에 존재할 경우 아래 순서로 우선순위가 적용된다.

| 순위       | 위치                                          | 용도                |
| ---------- | --------------------------------------------- | ------------------- |
| 1 (최우선) | `<프로젝트루트>/rules/<name>.json`            | 프로젝트별 override |
| 2          | `~/.ai-config-sync-manager/rules/<name>.json` | 머신 전역 override  |
| 3 (기본값) | `<도구 설치 경로>/rules/<name>.json`          | 번들 기본값         |

프로젝트 override 파일이 있으면 그것이 머신 전역보다 우선한다. 번들 기본값은 override가 없는 항목에만 적용된다.

## Layered Merge 동작 방식

각 룰 파일은 **id 기반 deep merge**를 지원한다. override 파일에 기록한 항목만 bundle 위에 올려씌우고(overlay), 나머지는 번들 그대로 유지된다.

```
번들 기본값          사용자 overlay        최종 결과
─────────────        ──────────────        ──────────────
{ id: "A",        +  { id: "A",        →  { id: "A",
  foo: "base",         foo: "custom" }      foo: "custom",
  bar: "base" }                              bar: "base" }   ← 건드리지 않은 필드는 살아남음

{ id: "B",                              →  { id: "B",       ← id가 없으면 번들 항목 그대로
  foo: "base" }                              foo: "base" }

                       { id: "C",       →  { id: "C",       ← 번들에 없는 id는 append
                         foo: "new" }        foo: "new" }
```

**규칙 요약**

- 같은 id를 가진 overlay 항목은 base 항목 위에 **필드 단위 shallow merge**
- overlay에 없는 id의 번들 항목은 **그대로 유지**
- overlay에만 있는 id는 **배열 끝에 append**
- 배열 타입 필드(예: `claude`, `codex` terms 목록)는 overlay 값으로 **통째로 교체**됨에 주의

## Override 파일은 언제 만드는가

- 번들이 모르는 자연어 변형을 본문에서 쓸 때 (예: 사내 용어 "AI 어시스턴트" → Claude Code)
- 프로젝트에서만 쓰는 커스텀 delegation 패턴을 추가하고 싶을 때
- 특정 SDK 호출을 strip 대신 별도 마커로 보존하거나 반대로 변환하고 싶을 때
- `mcp`/`permissions`/`hooks` 정책을 번들과 다르게 사내 환경에 맞춰야 할 때
- 신규 모델 tier alias가 번들에 반영되기 전에 먼저 적용하고 싶을 때

---

## Per-File Recipes

### terminology-map.json

**merge 키:** `layer.id` + 레이어 내 `rule.id`

본문 prose에 등장하는 host-specific 표현을 양방향 변환한다. 사내 용어나 프로젝트 고유 표현을 추가할 때 `files` 또는 `host-surfaces` 레이어에 새 rule을 append하거나, 기존 rule의 terms 목록을 교체한다.

**사례: 사내 브랜드 용어 추가**

사내에서 "AI 코딩 어시스턴트"라고 부르는 표현을 Claude Code로 변환하고 싶을 때.

```json
// ~/.ai-config-sync-manager/rules/terminology-map.json
{
  "layers": [
    {
      "id": "files",
      "rules": [
        {
          "id": "agent-product",
          "claude": ["Claude Code", "AI 코딩 어시스턴트", "Claude"],
          "codex": ["Codex CLI", "코딩 CLI", "Codex"]
        }
      ]
    }
  ]
}
```

overlay 결과: `agent-product` rule의 `claude` 배열이 위 값으로 교체되고, 나머지 rule(`instruction-file`, `global-settings-file` 등)은 번들 그대로 유지된다.

**변환 예시**

```
# Before (CLAUDE.md 본문)
AI 코딩 어시스턴트 설정은 .claude/settings.json을 참조하세요.

# After sync → AGENTS.md 본문
코딩 CLI 설정은 .codex/config.toml을 참조하세요.
```

**사례: 새 레이어 추가**

번들에 없는 레이어(예: 사내 보안 정책 용어)를 추가할 수도 있다.

```json
{
  "layers": [
    {
      "id": "security-terms",
      "description": "사내 보안 정책 용어",
      "rules": [
        {
          "id": "review-gate",
          "claude": ["보안 검토 필요", "security review required"],
          "codex": ["approval-required", "manual-review gate"]
        }
      ]
    }
  ]
}
```

번들의 `files`, `host-surfaces`, `orchestration`, `permissions`, `hooks` 레이어는 그대로 유지되고 `security-terms`만 append된다.

---

### host-target-templates.json

**merge 키:** `template.id`

delegation/command/skill/hook surface의 alias와 정규화 target을 관리한다. 프로젝트에서 커스텀 delegation 패턴을 쓰거나, gstack 같은 workflow 도구의 command surface를 추가할 때 사용한다.

**사례: 프로젝트 고유 delegation surface alias 추가**

```json
// <project>/rules/host-target-templates.json
{
  "templates": [
    {
      "id": "delegation-surface",
      "aliases": {
        "claude": [
          "Task tool",
          "Task-tool delegation",
          "Claude subagent delegation",
          "gstack 위임"
        ],
        "codex": [
          "spawn_agent",
          "sub-agent delegation",
          "Codex worker/explorer delegation",
          "gstack worker"
        ]
      },
      "target": {
        "claude": "Claude Task-tool delegation",
        "codex": "Codex spawn_agent delegation"
      }
    }
  ]
}
```

`delegation-surface` 템플릿의 `aliases.claude` 배열이 통째로 교체되고, 번들의 `command-surface`, `skill-surface`, `hook-surface` 템플릿은 영향받지 않는다.

**사례: 새 surface 추가**

번들에 없는 surface(예: 파이프라인 트리거)를 추가할 수 있다.

```json
{
  "templates": [
    {
      "id": "pipeline-trigger",
      "aliases": {
        "claude": ["CI trigger", "파이프라인 실행"],
        "codex": ["codex pipeline run", "pipeline trigger"]
      },
      "target": {
        "claude": "CI trigger",
        "codex": "codex pipeline run"
      }
    }
  ]
}
```

---

### call-templates.json

**merge 키:** `id` (supported/unsupported 배열 각각)

Claude SDK 호출(예: `Agent(...)`, `TaskCreate(...)`)을 Codex prose로 변환하거나 strip하는 규칙이다. 번들에 없는 SDK 호출을 추가하거나, 기존 strip 동작을 커스텀 마커로 바꾸고 싶을 때 사용한다.

**사례: 새 unsupported 호출 추가 (strip)**

번들이 모르는 `ScheduleCreate` 호출을 Codex 변환 시 마커로 표시하고 싶을 때.

```json
// ~/.ai-config-sync-manager/rules/call-templates.json
{
  "unsupported": [
    {
      "id": "schedule-create",
      "claude_call": "ScheduleCreate",
      "codex_marker": "ai-config-sync:stripped",
      "reason": "Codex has no native schedule primitive"
    }
  ]
}
```

번들의 `task-create`, `task-update`, `team-create` strip 규칙은 그대로 유지된다.

**사례: 기존 unsupported를 supported로 전환**

번들에서 strip되던 호출을 특정 환경에서는 변환하고 싶을 때 supported 배열에 같은 `id`로 추가하면 된다.

```json
{
  "supported": [
    {
      "id": "task-create",
      "claude_call": "TaskCreate",
      "codex_marker": "ai-config-sync:task-call",
      "claude_template": "TaskCreate({{ARGS_JSON}})",
      "codex_template": "# Task\n{{title}}\n\n{{description}}\n",
      "field_aliases": {
        "claude_to_codex": { "title": "title", "description": "description" }
      }
    }
  ]
}
```

> 주의: 같은 `id`가 supported와 unsupported 양쪽에 모두 존재할 경우 supported가 우선 적용된다(엔진이 supported를 먼저 탐색). 이 동작은 bundle 내 순서와 무관하게 동작한다.

---

### claude-to-codex.json / codex-to-claude.json

**merge 키:** `areas` 객체의 키 이름 (instructions/skills/mcp/permissions/hooks/commands)

sync 방향별 area 정책을 정의한다. 번들의 `permissions`나 `hooks` 정책이 사내 환경과 맞지 않을 때 해당 area만 갈아끼운다.

**사례: permissions area risk를 safe로 낮추기**

```json
// <project>/rules/claude-to-codex.json
{
  "source": "claude",
  "target": "codex",
  "areas": {
    "permissions": {
      "risk": "safe",
      "mapping": "Claude permissions to Codex sandbox rules",
      "nativeTargets": {
        "Bash(<pattern>)": "rules/project.rules prefix_rule(pattern=[...], decision=allow)"
      }
    }
  }
}
```

`instructions`, `skills`, `mcp`, `hooks`, `commands` area는 번들 정책 그대로 유지된다.

**사례: 특정 area 비활성화 (codex → claude 방향)**

hooks area를 manual-review로 격상해 자동 적용을 막고 싶을 때.

```json
// ~/.ai-config-sync-manager/rules/codex-to-claude.json
{
  "source": "codex",
  "target": "claude",
  "areas": {
    "hooks": {
      "risk": "manual",
      "mapping": "Always hold for manual review regardless of hook type"
    }
  }
}
```

---

### agents-map.json

**merge 키:** `fields`는 `(claude, codex)` 페어 / `models.tiers`는 `id`

agent 필드 매핑과 모델 tier alias를 관리한다. 신규 모델이 번들에 반영되기 전에 먼저 tier를 추가하거나, 기존 tier에 사내 표현을 추가할 때 사용한다.

**사례: 기존 balanced-model tier에 alias 추가**

```json
// ~/.ai-config-sync-manager/rules/agents-map.json
{
  "models": {
    "tiers": [
      {
        "id": "balanced-model",
        "claude": {
          "alias": "sonnet",
          "terms": ["sonnet(latest)", "Claude Sonnet", "Sonnet", "표준 모델"]
        },
        "codex": {
          "alias": "gpt-5.4",
          "terms": ["GPT-5.4", "standard model"]
        }
      }
    ]
  }
}
```

`latest-frontier-model`, `small-fast-model` tier와 `fields` 배열은 번들 그대로 유지된다.

**사례: 새 모델 tier 추가**

번들에 없는 fine-tuned 모델을 tier로 등록할 때.

```json
{
  "models": {
    "tiers": [
      {
        "id": "custom-ft-model",
        "claude": {
          "alias": "claude-ft-v1",
          "terms": ["Claude FT v1", "사내 파인튜닝 모델"]
        },
        "codex": {
          "alias": "gpt-ft-v1",
          "terms": ["GPT FT v1", "in-house fine-tuned"]
        }
      }
    ]
  }
}
```

**사례: 신규 agent 필드 추가**

Codex에 새로 생긴 `max_turns` 필드를 Claude `max_iterations`와 매핑하고 싶을 때.

```json
{
  "fields": [
    {
      "claude": "max_iterations",
      "codex": "max_turns",
      "level": "approximate"
    }
  ]
}
```

번들의 기존 `fields` 항목(name, description, body ↔ developer_instructions, model, tools, color, memory 등)은 그대로 유지된다.

---

## Tips

- **변경하려는 항목만 partial 파일에 적는다.** id가 일치하면 base 위에 merge, 없으면 append된다. 전체 파일을 복사해서 수정하지 않아도 된다.
- **배열 필드는 통째로 교체된다.** `claude`, `codex` terms 목록, `aliases` 배열 등은 overlay 값 전체로 대체되므로 번들 항목을 남기고 싶다면 overlay에도 포함시켜야 한다.
- **번들이 업데이트돼도 사용자 overlay는 영향받지 않는다.** 번들에 새 id가 추가되면 merge 후 append되고, 기존 overlay와 충돌하지 않는 한 그대로 반영된다.
- **변환 결과가 의도와 다를 때는** `ai-config-sync status`로 diff를 확인한다. 어떤 룰이 본문을 어떻게 변환했는지 추적하기 어려울 경우 `--json` 플래그로 상세 출력을 확인한다.
- **프로젝트 override와 머신 전역 override는 동시에 사용 가능하다.** 프로젝트 파일이 있으면 그것이 먼저 적용되고, 없는 항목은 머신 전역 → 번들 순으로 fallback된다.

## status-ignore.json은 별개

`status-ignore.json`은 layered merge가 적용되지 않는다. 이 파일은 user-data 파일로, 세 위치 중 **가장 먼저 발견된 파일 하나만** 사용된다(first-match). 번들 기본값과 합쳐지지 않는다. 구조 참조는 `docs/status-ignore.example.json`을 확인한다.
