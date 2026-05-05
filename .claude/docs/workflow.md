# Workflow

> 현재 단계: **실행/검증 단계** (publish 전). plugin/CLI 동작 자체를 두 host에서 직접 install·실행해 검증한다. npm publish, scoped name 확정, 자동 PATH version 가드 활성화 등은 후속.
> 배포 설계 전체는 [`.claude/docs/distribution-workflow.md`](./distribution-workflow.md) 참고.
> 설치/실행 흐름도(로컬 ↔ 프로덕션 매핑, 처음 설치부터 명령 실행까지)는 [`.claude/docs/install-flow.md`](./install-flow.md).

---

## 0. 전체 데이터 흐름

```mermaid
flowchart TD
    subgraph SRC["소스 코드"]
        CORE["packages/core<br/>타입 + 공유 로직<br/>(Host, ConfigArea, CanonicalConfigSnapshot)"]
        CLI["packages/cli<br/>CLI 파싱 계층<br/>(connect/status/sync 명령어)"]
        BIN["bin/ai-config-sync.mjs<br/>실제 실행 진입점 (3,300+ LOC)"]
    end

    subgraph SCHEMA["스펙/참조 레이어"]
        SCH["schemas/<br/>canonical-config.schema.json<br/>내부 CanonicalConfigSnapshot JSON Schema"]
        SNAP["snapshots/<br/>claude/settings-schema.json<br/>codex/config-schema.json<br/>외부 도구 스키마 + releases 캐시"]
    end

    subgraph DIST["배포 산출물 (build:dist)"]
        CM["dist/claude-marketplace/<br/>Claude 플러그인 번들<br/>(marketplace.json + commands/*.md + skills/)"]
        CP["dist/codex-plugin/<br/>Codex 플러그인 번들<br/>(skills/config-manager-*/SKILL.md)"]
    end

    CORE -->|타입/함수 export| CLI
    CLI -.->|미연결 (mjs가 진실원)| BIN
    SCH -.->|spec 발행용, 런타임 미사용| BIN
    SNAP -->|매핑 비교 baseline| BIN
    BIN -->|scripts/build-dist.mjs| CM
    BIN -->|scripts/build-dist.mjs| CP
```

> 점선은 현재 미연결 경로다. `packages/{cli,core}` scaffold는 `private: true` 상태이며, 실행 진입점은 `bin/ai-config-sync.mjs` 단일 파일. `schemas/`는 외부에 발행하는 스펙 문서이고 AJV 등 런타임 검증기는 도입돼 있지 않다 (TS 타입 체크 + 구문별 try/catch만 동작).

---

## 1. 설치 (두 진입 방향 모두 지원)

### 방향 1 · Claude marketplace 먼저
```text
/plugin install ai-config-sync-manager@...
/config-manager:connect
```
첫 호출 시 launcher가 PATH 또는 `AI_CONFIG_SYNC_ROOT`로 본체를 찾아 호출. connect가 Codex 쪽에도 plugin shim을 자동 등록한다.

### 방향 2 · Codex plugin 먼저
```text
Codex plugin install (local marketplace 또는 OSS publish 후)
config-manager-connect
```
connect가 Claude 쪽에도 plugin shim을 자동 등록한다.

### Dev/Local
이 레포에서 직접 작업할 때:
```bash
export AI_CONFIG_SYNC_ROOT=$(pwd)
node bin/ai-config-sync.mjs status
```

---

## 2. 명령 흐름

### Connect
```text
1. 현재 host 감지.
2. Claude/Codex 설치 상태 확인.
3. 누락된 host integration을 자동 등록 (filesystem write 가능 시).
4. 차단된 경우 수동 install 절차를 정확한 명령으로 출력.
5. 설치 후 status 검증을 다시 실행.
```

설치 시 plugin target은 managed directory로 취급:
- target path가 expected pattern인지 검증 (`~/.claude/plugins/config-manager@ai-config-sync-manager`, `~/plugins/ai-config-sync-manager`).
- 검증 통과 시 기존 디렉터리를 깨끗이 제거 후 shim 재설치 (stale 파일 잔존 방지).

### Status
`/config-manager:status` → 번들된 `ai-config-sync status` 호출 → risk-classified diff 출력.

기본은 global + project 모두 검사. `--scope global` / `--scope project`로 좁힐 수 있다.

`status-ignore.json`(`exclude: [{area, term}]`)이 있으면 사용자가 의도적으로 무시하기로 한 라인은 diff에서 마스킹된다.

### Sync
`/config-manager:sync` → 기본 `sync --dry-run`. apply 모드는 backup 생성 + `--confirm` yes-gate 필수. manual 표시 항목은 dry-run에 노출되며, MVP에서 `sync --apply`는 plan된 writable 항목을 일괄 적용하되 위험한 permission은 review note + patch preview 후 작성한다.

전체 매핑 흐름: [`.claude/docs/maximal-one-to-one-mapping.md`](./maximal-one-to-one-mapping.md)

### Paraphrase
`paraphrase --apply --map "Skill=verification routine"` 형태로 호출.
- 매칭된 라인의 토큰을 직접 rewrite하고 `paraphrase-overrides.json`에 매칭 좌표(`claude_path`/`codex_path`/`*_line`)를 등록.
- `paraphrase-map.json`은 토큰 사전 (`claude_only` / `codex_only`)으로, override가 없는 항목도 dictionary library로 보관.
- 두 파일 분리 의도: **map = lookup library, override = matched-line registry**.

---

## 3. 배포 워크플로우 (요약)

설계 결정: **글로벌 npm install + thin launcher plugin** (안 C). 본체는 npm registry 단일 패키지, plugin은 launcher만 들고 있다. 두 진입 방향 모두 지원.

Launcher resolution order:
```text
1. AI_CONFIG_SYNC_ROOT 환경변수 (dev override)
2. PATH의 ai-config-sync (npm install -g 케이스, recursion 방지 + version 비교)
3. npm exec --yes --package=ai-config-sync-manager@<pinned> -- ai-config-sync (네트워크 fallback)
4. 안내 메시지 후 exit 1
```

Drift 가드: version pin 자동 주입 / PATH binary 일치 검사 / state `schemaVersion` / `--version` self-check.

상세: [`.claude/docs/distribution-workflow.md`](./distribution-workflow.md)

---

## 4. 완료된 베이스라인

1. 깊은 구현 전 워크플로우 문서 정비.
2. global·project diff에 settings 기반 영역 포함.
3. Claude `Bash(...)` 권한 → Codex `rules/*.rules`의 `prefix_rule()` 매핑.
4. Claude MCP tool 권한 → Codex per-tool MCP approval 매핑.
5. MCP server 정의 → Codex `[mcp_servers.*]` 블록 구조 병합.
6. Claude command hook → 가능 이벤트/핸들러 한정 Codex native hook TOML 매핑.
7. unsupported 필드는 managed metadata로 보존하고 `status`에서 가시화.
8. `status`, 좁힌 `sync --dry-run`, temp-home `sync --apply`, `build:dist` 검증 완료.
9. package manager 셋업 + `npm run check` repo-local 검증.
10. selector 파싱, native 매핑, MCP merge 안정성, hook, apply backup을 다루는 `node:test` 기반 fixture 테스트.
11. MCP sync 출력에 서버별 patch preview 포함, secret 패턴의 MCP env key는 metadata-only review로 노출.
12. skills 정책 정의, 동일 이름 content drift는 manual conflict로 보고. standalone agent와 command 변환은 manual-review / MVP 외.
13. `connect`가 isolated home에서 누락된 local Claude·Codex integration을 등록하고 결과 install 상태를 다시 출력.
14. Codex→Claude 역매핑: `prefix_rule()`, MCP tool approval, native command hook.
15. schema-aware Codex write가 native 권한·hook의 exact 매핑에서 managed comment block을 생략. managed metadata는 unsupported / non-exact 필드에만 남음.
16. status UX의 compact/tree renderer, sync의 `--plan-json`, 각 명령의 `--help`.
17. status·sync plan에 항목별 매핑 품질 라벨 (`exact`, `equivalent`, `approximate`, `metadata-only`, `unsupported`).
18. `sync --confirm`이 plan을 보여준 뒤 명시적 `yes`만 수락, 이후 backup 흐름으로 apply.
19. 권한 sync plan에 brood interpreter, shell wrapper, destructive/network 명령, unsupported 매핑, approximate Codex approval-policy 매핑에 대한 review note.
20. settings sync plan에 permission·hook 항목별 patch preview (MCP patch preview에 더해서).
21. 기본 sync가 last-synced baseline state로 한쪽 host의 변경(추가·삭제)을 양방향 전파. baseline 부재 시 현재 diff 기반 추가만 fallback. 양방향 drift detection 안정화 완료 (`fix: stabilize bidirectional sync drift detection`).
22. `paraphrase` 명령 도입 — `--apply`(rewrite + register) / `--register`(register only) / line-level override archive. `paraphrase-overrides.json` + `paraphrase-map.json` 양쪽을 별도 책임으로 분리.
23. `status-ignore.json` 룰 — `exclude: [{area, term}]`로 over-translated 항목 마스킹.
24. manual-codex-to-claude integration harness — 9 cases × 13 columns 자동 검증 (status / dry-run / apply / claude diff / claude.json / mcp.json / codex / agents / claude-cli / codex-cli / codex-project-cli / lab-rules). 실제 GitHub 레포 (ECC) 기반 fixture 포함, post-sync `setup.sh` 훅으로 paraphrase / status-ignore 등록 흐름까지 검증.
25. lab의 `.ai-config-sync-manager/rules/*.json`을 `__LAB_HOME__` / `__REGISTERED_AT__` placeholder로 reverse-substitute해 cross-machine deterministic diff.
26. ESLint flat config + Prettier 셋업 (`lint`, `lint:fix`, `format`, `format:check` scripts) — 기존 소스 미변경, configs only.

---

## 5. 현재 상태

- `connect`: install 상태 감지, 누락된 local Claude·Codex integration 등록 (write 가능 시), 차단 시 수동 절차 안내, `connect --help` 지원.
- `status`: global/project scope, 기본/grouped 출력, `--compact`, `--tree`, 항목별 매핑 품질 라벨, `--include`/`--exclude` selector. status-ignore 룰 반영.
- `sync`: dry-run/apply, `--confirm`, `--plan-json`, command help, 항목별 매핑 품질 라벨, backup, selector, skill missing-copy, permission item merge, hook item merge, MCP server merge, Bash/MCP/hook 대상 Codex native 매핑, baseline 기반 기본 방향 결정.
- `paraphrase`: `--apply` / `--register` / `--map` 인자, line-level override archive, override + map 두 파일 분리 책임. `--non-interactive` flag로 자동화 가능.
- `permissions`: Claude→Codex native 매핑 (Bash prefix, MCP tool approval, workspace-write sandbox hint). exact Bash/MCP 매핑은 더 이상 중복 managed comment를 남기지 않음.
- `permissions reverse`: Codex `prefix_rule()`과 MCP tool approval을 가역 가능한 범위에서 Claude permission bucket으로 역변환.
- `hooks`: command hook이 Claude settings ↔ Codex native hook TOML 양방향 변환. unsupported handler는 managed metadata로 잔존.
- `mcp`: 서버 단위 merge + `mcp:notion` / `mcp:playwright` 같은 selector. 서버별 patch preview, secret 패턴 env는 metadata-only로 skip.
- `skills`: 누락 skill 디렉터리 복사. 동일 이름 content drift는 manual conflict. delete/overwrite는 MVP 외.
- `agents`: AGENTS/CLAUDE 지시문 비교. standalone agent 파일 동기화는 Codex agent schema 확정 전까지 MVP 외.
- `commands`: slash command 변환은 partial/manual-review 전용, 자동 write 안 함.
- `tests/unit`: selector 파싱, Bash prefix 변환, MCP tool approval 변환, MCP server merge, hook 변환, baseline 기반 기본 sync 방향, backup/apply 동작에 대한 repo 소유 `node:test` fixture (228+ tests).
- `tests/integration/manual-codex-to-claude`: 9 case × 13 column harness. ECC 실레포 mapping fixture, paraphrase override + map split, status-ignore, post-sync setup.sh 훅까지 자동 검증.
- `package check`: npm lockfile 셋업으로 repo-local `npm run check` 통과.
- `lint/format`: ESLint flat config + Prettier 셋업 완료 (configs only, 기존 소스 미변경).
- `dist`: 로컬 Claude marketplace + Codex plugin dist build 성공.

---

## 6. 실행 순서

```text
변경 → npm run check → npm test → npm run build:dist → manual harness (필요 시) → 커밋.
```

각 milestone은 §8.5 검증 절차 통과를 전제로 한다.

---

## 7. MVP 규칙

권한 마이그레이션 중 broad·destructive 명령을 자동 허용하지 않는다. 안전 매핑 불가 시 metadata로 보존하고 `status`에 그대로 노출한다.

---

## 8. 남은 핵심 작업

### 8.1 Distribution C안 — 실행 단계 (현재 진행)

`.claude/docs/distribution-workflow.md` §8 구현 변경 포인트 중 publish-independent한 항목.

- [ ] `scripts/build-dist.mjs`: `sharedDirs`에서 `bin`/`packages`/`schemas`/`rules` 제거. integrations만 plugin에 복사.
- [ ] launcher 템플릿을 `scripts/lib/host-launcher.mjs`로 분리 (build-dist + connect 양쪽이 공유).
- [ ] launcher 새 resolution order 적용 (AI_CONFIG_SYNC_ROOT → PATH → npm exec → fail). PATH 발견 시 자기-자신 recursion 방지.
- [ ] `bin/ai-config-sync.mjs`의 `copyPluginRoot` 축소 — plugin shim만 복사. 설치 직전 target path 검증 후 `rmSync` (stale 정리).
- [ ] hardcoded `version: "0.1.0"` 3곳 자동 주입 (`installed_plugins.json`, Codex `marketplace.json`, Claude marketplace `marketplace.json`).
- [ ] `integrations/{claude,codex}-plugin/skills/**/SKILL.md`의 고정 cache path (`$HOME/.codex/plugins/cache/local-plugins/.../0.1.0/...`) 제거 → launcher 호출 형태로 통일.
- [ ] `package.json`의 `bin` entry를 `./bin/ai-config-sync.mjs`로 변경 (mjs 직접). dev wrapper는 `scripts/dev-launcher`로 이동.
- [ ] state `schemaVersion: 1` 도입 (`bin/ai-config-sync.mjs:2432-2470`). 미일치 시 abort + 안내.
- [ ] `tests/cli-fixtures.test.mjs` 보강: thin dist 산출물, launcher resolution 분기, connect의 stale 정리, version 자동 주입.

### 8.2 모노레포 전환 (publish 전 검토)

현재 `bin/ai-config-sync.mjs` 단일 파일에 3,300+ LOC가 집중. `packages/{cli,core}`는 `private: true` + 빈 stub 상태. publish 시점에 사용자 환경에 노출되므로, **publish 직전** 모노레포 전환 여부를 결정해 첫 배포 후 구조 변경(파일 경로/import 위치/dist 포맷 동시 변경)을 막는다.

- [ ] **결정 시점 트리거**: §8.1 실행 단계 안정화 직후, §8.3 publish 진입 전.
- [ ] **옵션 A — 분할**: `bin/ai-config-sync.mjs`를 `packages/core` (host-adapter / sync-engine / mapping rules) + `packages/cli` (CLI parsing / command dispatch)로 분리. workspaces 활성화, 각 패키지에 `tsc -b` 빌드 + `dist/` 산출물.
- [ ] **옵션 B — 단일 진실원 못박기**: `packages/{cli,core}` scaffold 제거. `bin/ai-config-sync.mjs`를 정식 진입점으로 확정, `package.json`의 `workspaces` 필드도 제거.
- [ ] **결정 기준**: (1) 외부 contributor 기여 빈도 예상 (높으면 A), (2) 향후 `core`를 별도 npm 패키지로 publish할 의도가 있는가 (있으면 A), (3) 단일 파일의 검색/수정 비용이 임계점에 도달했는가.
- [ ] **A 채택 시 후속 작업**: `host-adapter` (Claude/Codex specific I/O) ↔ `sync-engine` (canonical → plan → patch) ↔ `cli` (arg parse / output renderer) 3계층으로 분할. `schemas/canonical-config.schema.json`을 `core`에서 import 가능하도록 정합. 분할 후 모든 unit + integration test 그린 유지.
- [ ] **B 채택 시 후속 작업**: `packages/` 디렉터리 제거, `package.json`에서 `workspaces` 삭제, mermaid 다이어그램 §0 갱신 (점선 SCH→BIN 구간 정리).

### 8.3 Publish 단계 (실행 단계 + 모노레포 결정 후)

- [ ] **npm 패키지 이름 확정**: `ai-config-sync-manager` 그대로 vs `@ai-config-sync-manager/cli` (scoped). 결정 시 launcher pin / installed key / marketplace name까지 동시 변경.
- [ ] `package.json`의 `files` 필드 추가 — `bin`, `packages`, `schemas`, `rules`, `README.md`, `LICENSE`만 포함.
- [ ] `publishConfig` 검토 (scoped 채택 시 `access: "public"`).
- [ ] `npm publish` dry-run으로 artifact 점검.
- [ ] launcher의 `npm exec` fallback 활성화 검증 (사용자가 npm install 안 한 상태).
- [ ] PATH version 차이 정책 확정 — 기본안: patch 무시 / minor 경고 / major abort.
- [ ] README의 install 안내 (방향 1, 2 둘 다 + first-run의 npm exec가 원격 코드 fetch라는 명시).
- [ ] GitHub repo remote + Claude marketplace 등록 + Codex plugin local/OSS install 흐름 문서화.

### 8.4 후속 (별도 작업 단위)

- [ ] **Skill symlink 지원**: 현재 symlink skill은 `unsupported` status-only로 노출하고 sync에서는 제외. 후속에서 link 자체 보존 vs target content materialize 정책을 확정.
- [ ] **Cursor/Windsurf 등 추가 host 동기화 지원**: launcher 패턴은 동일 적용 가능. 각 host의 plugin/extension spec과 설정 저장소를 조사 후 `integrations/<host>-plugin/` 신설.
- [ ] **Memory / context sync 검토**: 현재는 `memory`, implicit context, agent runtime state를 Deferred로 유지. 후속 RFC에서 저장소 위치·스키마·redaction·conflict policy를 먼저 확정하고, 1단계는 read-only discovery/status만 지원한다. apply는 명시적 opt-in selector(`--include memories:<name>` 등)와 백업/preview 정책이 준비된 뒤 별도 구현.
- [ ] **`rules/*.json` 의 실제 import**: 현재 mapping rule이 mjs에 인라인. `permissions-map.json` / `bash-prefix-map.json` / `mcp-map.json` / `hooks-map.json`로 데이터화 (`.claude/docs/maximal-one-to-one-mapping.md:114-146` 제안).
- [ ] **TOML 파서 교체**: 현재 정규식 mini-editor. inline env 객체 등 가정이 깨지는 케이스 도래 전 `@iarna/toml` 또는 자체 구조체 기반 에디터로 교체.
- [ ] **CI 도입**: GitHub Actions 1개로 `npm run check` + `npm test` + `npm run build:dist` + `npm run lint` + `npm run format:check`.
- [ ] **schemas 런타임 검증**: 사용자 편집 가능한 `paraphrase-overrides.json` / `paraphrase-map.json` / `status-ignore.json` 손상 시 친절한 에러 메시지가 필요하면 AJV 도입 검토. 현재는 try/catch + 수동 가드로 충분.

### 8.5 Milestone 검증 절차

각 milestone 완료 후:
1. `npm run check` + `npm test`.
2. `npm run build:dist`.
3. `tests/integration/manual-codex-to-claude/scripts/run-cases.sh` (9 cases × 13 columns 모두 0).
4. Claude plugin install/update.
5. Codex command 실행 + Claude command 실행.
6. 두 host가 동일한 `status`를 보고하는지 확인.
