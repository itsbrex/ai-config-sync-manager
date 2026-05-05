# Upstream Compatibility Follow-up Plan

AI Config Sync Manager의 룰 파일들(`rules/terminology-map.json`, `rules/agents-map.json`, `rules/call-templates.json`, `rules/host-target-templates.json`)은 Claude Code와 Codex CLI 양쪽의 최신 동작을 반영해야 한다. 두 호스트 중 어느 쪽이든 새 기능을 추가·이름 변경·deprecate 하면 룰이 lag된다. 이 문서는 그 lag를 **자동으로 감지**하고 **수동 판단이 필요한 지점**을 격리하는 4-layer 팔로우업 전략을 기술한다.

## 목표

- 상위 CLI 변경을 가능한 한 빨리 인지(주간 단위 허용).
- 머신 비교 가능한 자료원(스키마, releases JSON)을 단일 진실원으로 사용.
- 의미론적 판단이 필요한 항목은 자동화하지 않고 GitHub Issue로 격리.
- 솔로 메인테이너 부담 0에 가깝게 운영(GitHub Actions 무료 한도 내).

## 자료원

| 호스트 | 종류        | URL                                                          |
| ------ | ----------- | ------------------------------------------------------------ |
| Claude | 설정 스키마 | https://json.schemastore.org/claude-code-settings.json       |
| Claude | Releases    | https://api.github.com/repos/anthropics/claude-code/releases |
| Claude | Changelog   | https://code.claude.com/docs/en/changelog                    |
| Codex  | 설정 스키마 | https://developers.openai.com/codex/config-schema.json       |
| Codex  | Releases    | https://api.github.com/repos/openai/codex/releases           |
| Codex  | Changelog   | https://developers.openai.com/codex/changelog                |

## Layer 1 — Passive Snapshot Diff (자동, 도입 우선)

주 2회(화·금 03:17 UTC) cron + `workflow_dispatch`로 위 자료원을 받아 `snapshots/{claude,codex}/` 에 결정적(deterministic) 형태로 저장한다. `git diff --exit-code` 가 비면 종료, 비지 않으면 GitHub Issue 자동 발행. 주 2회 일정은 미국 배포 요일(월·목 PT 오후)에 맞춰 lag을 최소화한다.

### 구성

```
snapshots/
├ claude/
│  ├ settings-schema.json    # jq -S 정렬
│  ├ releases.json           # top 5 release { tag_name, published_at, body }
│  └ changelog.md            # html 텍스트 추출
└ codex/
   ├ config-schema.json
   ├ releases.json
   └ changelog.md
.github/workflows/upstream-compat.yml
scripts/snapshot-upstream.mjs
```

### 자동 이슈 형식

- 라벨: `compatibility`
- 제목: `Upstream CLI compatibility drift detected (<date>)`
- 본문: `git diff` 출력 (코드블록 감싸기), 변경된 파일 목록, 우선순위 추정

### 도입 비용

1 PR 분량. 외부 의존성 없음(`curl`, `jq`, `gh` CLI는 GitHub Actions runner 기본 제공).

## Layer 2 — Priority Watchlist (수동 참고)

| 호스트 | 우선순위 | 항목                                                                                | 영향 룰                                              |
| ------ | -------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Codex  | 최상     | `config.toml` 스키마 (`AgentsToml`, `mcp_servers`, `approval_policy`, sandbox 모드) | terminology-map (permissions, hooks-mcp), agents-map |
| Codex  | 상       | `spawn_agent` 시그니처, 모델 별칭                                                   | call-templates, agents-map.models                    |
| Codex  | 중       | CLI 플래그, MCP 서버 설정 위치                                                      | terminology-map (files, hooks-mcp)                   |
| Claude | 최상     | `settings.json` 스키마 (permissions 키, hooks 이벤트 enum)                          | terminology-map (permissions, hooks-mcp)             |
| Claude | 상       | agent frontmatter 필드, `.claude/agents` 위치 규칙                                  | agents-map.fields                                    |
| Claude | 중       | CLI 플래그, MCP 위치, web 정책                                                      | terminology-map (hooks-mcp)                          |
| 양쪽   | 중       | sub-agent 호출 패턴 (`Agent({...})` ↔ `spawn_agent`)                                | call-templates                                       |

Layer 1 이슈를 받으면 위 우선순위로 영향 룰 파일을 검토.

## Layer 3 — Fixture Roundtrip (회귀 검증, 옵션)

스키마 만으로 못 잡는 _런타임 동작_ 변화를 검증한다. Layer 1이 false positive를 자주 띄우거나, 의미론적 변경이 의심될 때 도입.

### 구성

```
tests/upstream-compat/
├ claude-fixtures/
│  ├ settings.json
│  ├ agents/sample.md
│  └ skills/sample/skill.md
├ codex-fixtures/
│  ├ config.toml
│  ├ agents/sample.toml
│  └ skills/sample/SKILL.md
└ roundtrip.test.mjs
```

`roundtrip.test.mjs`는:

1. claude-fixtures → ai-config-sync → codex 변환 결과 검증
2. 결과 파일을 `codex config validate` (CLI가 제공하는 경우)에 통과
3. 다시 codex → claude 변환하여 idempotent 확인

CI에서는 `codex`/`claude` 바이너리를 설치해야 하므로 cron job 분리. 우선 도입 X, Layer 1 결과 보고 결정.

## Layer 4 — Manual Review (자동화 불가)

다음 판단은 자동화하지 않는다:

- **Deprecated alias의 런타임 수용 여부**: 스키마에서 빠졌어도 동작이 살아있을 수 있음.
- **권한·sandbox 보안 동등성**: 새 sandbox 모드가 추가되면 기존 매핑(`workspace-write` ↔ `Write/Edit/MultiEdit`)이 여전히 안전한지 사람이 판단.
- **권한 키 rename의 의미 변화**: `permissions.allow` → `permissions.allowList`가 단순 rename인지, 의미가 미묘하게 다른지.
- **새 호스트 vendor의 의도**: changelog 본문 자연어 해석.

Layer 1 Issue 본문에 "수동 판단 필요" 체크리스트를 포함해서 누락 방지.

## Roadmap

| 단계             | 산출물                                           | 트리거                                 |
| ---------------- | ------------------------------------------------ | -------------------------------------- |
| Phase 1 (즉시)   | Layer 1 cron + snapshot diff                     | 본 문서 승인 후 1 PR                   |
| Phase 2 (필요시) | Layer 3 roundtrip 테스트                         | Layer 1이 의미 변경을 놓치는 사례 발생 |
| Phase 3 (옵션)   | `bin/ai-config-sync compat` 로컬 진단 서브커맨드 | 사용자 요청                            |

## 참조

- [Plugin update detection (Claude Code issue #31462)](https://github.com/anthropics/claude-code/issues/31462)
- [marckrenn/claude-code-changelog](https://github.com/marckrenn/claude-code-changelog) — 커뮤니티 changelog 추적기
- [SchemaStore claude-code-settings.json](https://json.schemastore.org/claude-code-settings.json)
- [Codex config-schema.json](https://developers.openai.com/codex/config-schema.json)
- [Renovate docs](https://docs.renovatebot.com/getting-started/running/) — 패턴 차용
