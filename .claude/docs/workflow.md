# Workflow

> 현재 단계: **실행/검증 단계** (publish 전). plugin/CLI 동작 자체를 두 host에서 직접 install·실행해 검증한다. npm publish, scoped name 확정, 자동 PATH version 가드 활성화 등은 후속.
> 배포 설계 전체는 [`.claude/docs/distribution-workflow.md`](./distribution-workflow.md) 참고.
> 설치/실행 흐름도(로컬 ↔ 프로덕션 매핑, 처음 설치부터 명령 실행까지)는 [`.claude/docs/install-flow.md`](./install-flow.md).

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

### Sync
`/config-manager:sync` → 기본 `sync --dry-run`. apply 모드는 backup 생성 + `--confirm` yes-gate 필수. manual 표시 항목은 dry-run에 노출되며, MVP에서 `sync --apply`는 plan된 writable 항목을 일괄 적용하되 위험한 permission은 review note + patch preview 후 작성한다.

전체 매핑 흐름: [`.claude/docs/maximal-one-to-one-mapping.md`](./maximal-one-to-one-mapping.md)

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
21. 기본 sync가 last-synced baseline state로 한쪽 host의 변경(추가·삭제)을 양방향 전파. baseline 부재 시 현재 diff 기반 추가만 fallback.

---

## 5. 현재 상태

- `connect`: install 상태 감지, 누락된 local Claude·Codex integration 등록 (write 가능 시), 차단 시 수동 절차 안내, `connect --help` 지원.
- `status`: global/project scope, 기본/grouped 출력, `--compact`, `--tree`, 항목별 매핑 품질 라벨, `--include`/`--exclude` selector.
- `sync`: dry-run/apply, `--confirm`, `--plan-json`, command help, 항목별 매핑 품질 라벨, backup, selector, skill missing-copy, permission item merge, hook item merge, MCP server merge, Bash/MCP/hook 대상 Codex native 매핑, baseline 기반 기본 방향 결정.
- `permissions`: Claude→Codex native 매핑 (Bash prefix, MCP tool approval, workspace-write sandbox hint). exact Bash/MCP 매핑은 더 이상 중복 managed comment를 남기지 않음.
- `permissions reverse`: Codex `prefix_rule()`과 MCP tool approval을 가역 가능한 범위에서 Claude permission bucket으로 역변환.
- `hooks`: command hook이 Claude settings ↔ Codex native hook TOML 양방향 변환. unsupported handler는 managed metadata로 잔존.
- `mcp`: 서버 단위 merge + `mcp:notion` / `mcp:playwright` 같은 selector. 서버별 patch preview, secret 패턴 env는 metadata-only로 skip.
- `skills`: 누락 skill 디렉터리 복사. 동일 이름 content drift는 manual conflict. delete/overwrite는 MVP 외.
- `agents`: AGENTS/CLAUDE 지시문 비교. standalone agent 파일 동기화는 Codex agent schema 확정 전까지 MVP 외.
- `commands`: slash command 변환은 partial/manual-review 전용, 자동 write 안 함.
- `tests`: selector 파싱, Bash prefix 변환, MCP tool approval 변환, MCP server merge, hook 변환, baseline 기반 기본 sync 방향, backup/apply 동작에 대한 repo 소유 `node:test` fixture.
- `package check`: npm lockfile 셋업으로 repo-local `npm run check` 통과.
- `dist`: 로컬 Claude marketplace + Codex plugin dist build 성공.

---

## 6. 실행 순서

```text
1. workflow 문서 갱신.
2. native 매핑 구현 순서: permissions → MCP → hooks → project/global status.
3. status 실행으로 area/item diff 가시성 검증.
4. 좁힌 selector로 sync dry-run.
5. npm check + dist build.
6. 검증된 변경을 커밋.
```

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

### 8.2 Publish 단계 (실행 단계 안정화 후)

- [ ] **npm 패키지 이름 확정**: `ai-config-sync-manager` 그대로 vs `@ai-config-sync-manager/cli` (scoped). 결정 시 launcher pin / installed key / marketplace name까지 동시 변경.
- [ ] `package.json`의 `files` 필드 추가 — `bin`, `packages`, `schemas`, `rules`, `README.md`, `LICENSE`만 포함.
- [ ] `publishConfig` 검토 (scoped 채택 시 `access: "public"`).
- [ ] `npm publish` dry-run으로 artifact 점검.
- [ ] launcher의 `npm exec` fallback 활성화 검증 (사용자가 npm install 안 한 상태).
- [ ] PATH version 차이 정책 확정 — 기본안: patch 무시 / minor 경고 / major abort.
- [ ] README의 install 안내 (방향 1, 2 둘 다 + first-run의 npm exec가 원격 코드 fetch라는 명시).
- [ ] GitHub repo remote + Claude marketplace 등록 + Codex plugin local/OSS install 흐름 문서화.

### 8.3 후속 (별도 작업 단위)

- [ ] **`packages/{cli,core}` scaffold 정리**: 현재 `private: true` + `dist/` 빈 stub. `bin/ai-config-sync.mjs` (3,313줄)을 `host-adapter / sync-engine / cli` 3모듈로 분할 후 `packages/`에 흡수. 또는 scaffold를 제거하고 mjs 단일 진실원으로 못박기. distribution이 publish 단계 안정화된 후에 진행 (변경 scope 분리, 첫 publish 직후 사용자 환경에 동시 노출 방지).
- [ ] **Skill symlink 지원**: 현재 symlink skill은 `unsupported` status-only로 노출하고 sync에서는 제외. 후속에서 link 자체 보존 vs target content materialize 정책을 확정.
- [ ] **Cursor/Windsurf 등 추가 host 동기화 지원**: launcher 패턴은 동일 적용 가능. 각 host의 plugin/extension spec과 설정 저장소를 조사 후 `integrations/<host>-plugin/` 신설.
- [ ] **`rules/*.json` 의 실제 import**: 현재 mapping rule이 mjs에 인라인. `permissions-map.json` / `bash-prefix-map.json` / `mcp-map.json` / `hooks-map.json`로 데이터화 (`.claude/docs/maximal-one-to-one-mapping.md:114-146` 제안).
- [ ] **TOML 파서 교체**: 현재 정규식 mini-editor. inline env 객체 등 가정이 깨지는 케이스 도래 전 `@iarna/toml` 또는 자체 구조체 기반 에디터로 교체.
- [ ] **CI 도입**: GitHub Actions 1개로 `npm run check` + `npm test` + `npm run build:dist`.
- [ ] **Lint/Format**: ESLint + Prettier.

### 8.4 Milestone 검증 절차

각 milestone 완료 후:
1. `npm run build:dist`.
2. Claude plugin install/update.
3. Codex command 실행 + Claude command 실행.
4. 두 host가 동일한 `status`를 보고하는지 확인.
