# Distribution Workflow — Hybrid Plugin × npm

> **결정**: 글로벌 npm install 방식. plugin은 thin launcher만 들고 있고, 본체 binary는 npm registry의 단일 패키지에서 받는다. 두 진입 방향(host plugin 먼저 / npm 먼저)을 모두 지원한다.
>
> **현재 단계**: 실행/검증 단계 (publish 전). publish-independent 변경(launcher resolution, build-dist 축소, connect stale 정리, hardcoded version 제거 등)부터 구현. publish 관련 항목(패키지 이름 확정, `files` 필드, npm exec fallback 활성화)은 안정화 후.

대상 호스트: Claude Code, Codex CLI (현재). Cursor 등 향후 추가 가능.
이 문서는 maintainer 관점의 distribution 설계 + 구현 변경 포인트를 다룬다. 사용자 install 안내는 `README.md`에 1줄 요약 + 본 문서 링크. 실행 진척과 milestone 검증은 [`.claude/docs/workflow.md`](./workflow.md) §8 참조.
설치/실행 흐름도(로컬 ↔ 프로덕션 매핑)는 [`.claude/docs/install-flow.md`](./install-flow.md) 참조.

---

## 1. 결정의 배경

### 1.1 비교한 안

| 안 | 본체 위치 | 장점 | 단점 |
|---|---|---|---|
| A. Self-contained plugin (현재) | 각 host plugin 안에 통째 복사 | host marketplace 그대로 | 코드 중복 ×2, version drift 가능, hybrid binary misfit |
| B. Git + symlink (gstack 방식) | git repo, host들이 symlink | 단일 commit 보장, dev iteration 즉시 | marketplace discovery 손실, 사용자 진입 비용 큼 |
| **C. Hybrid (채택)** | npm registry 단일 패키지, plugin은 launcher만 | 단일 진실원, drift 0, marketplace 유지 | npm 의존, schema guard 필요 |

### 1.2 채택 사유

1. **본체 = hybrid CLI tool** (binary + `~/.ai-config-sync-manager/state/` 외부 상태 + native config write). plugin spec(declarative skills/commands/hooks)과 카테고리 misfit.
2. **두 host에 본체를 복제**하는 현재 방식은 사용자가 한쪽만 update했을 때 동일 state.json을 다른 버전이 해석하는 위험을 낳는다.
3. **Marketplace discovery**는 포기 못 함 — 그래서 (B)가 아닌 (C).
4. 본체가 이미 zero-dep Node ESM, 루트 `package.json`도 publish-ready (`bin`, `private: false`) → (C) 채택 비용이 낮다.

---

## 2. 토폴로지

```
                npm registry
         ┌──────────────────────────┐
         │  ai-config-sync-manager  │  ← 단일 진실원 (bin/ai-config-sync.mjs 등)
         │  @x.y.z                  │
         └────────────┬─────────────┘
                      │ npx --package=ai-config-sync-manager@x.y.z ai-config-sync
                      │ or PATH lookup (npm i -g 시)
       ┌──────────────┼──────────────┐
       │              │              │
   Claude plugin   Codex plugin   Cursor ext (future)
   (skills+launcher) (skills+launcher)
```

- plugin 안에는 host별 shim(skills/commands)과 `bin/ai-config-sync` launcher 한 줄만 들어간다.
- 본체 코드는 plugin 안에 복사되지 않는다.
- 모든 host가 같은 npm 패키지를 호출하므로 host 간 version drift는 launcher가 같은 version pin을 보는 한 발생하지 않는다.

---

## 3. 두 진입 방향 (둘 다 지원)

### 방향 1: Plugin 먼저 (marketplace UX)

```
1) 사용자: Claude marketplace에서 config-manager 설치
2) 첫 명령 호출 시 plugin launcher가 PATH에서 ai-config-sync 탐색
   - 있으면 직접 호출
   - 없으면 npx로 npm 패키지 즉석 fetch (캐시)
3) /config-manager:connect 호출
   → connect가 Codex 쪽에도 plugin shim 자동 등록
4) 끝
```

### 방향 2: npm 먼저 (한 줄 install)

```
1) 사용자: npm install -g ai-config-sync-manager
2) 사용자: ai-config-sync connect
   → Claude·Codex 양쪽에 plugin shim(launcher만) 자동 등록
3) 끝
```

두 방향 모두 결과는 동일: 두 host에 launcher가 등록되고, 본체는 npm 패키지에서 호출된다.

---

## 4. Launcher 동작 (resolution order)

plugin 안의 `bin/ai-config-sync` launcher는 다음 순서로 본체를 찾는다:

```bash
1. AI_CONFIG_SYNC_ROOT 환경변수 (dev/local override)
   → $ROOT/bin/ai-config-sync.mjs 존재 검증 후 직접 호출. 미존재면 명시 에러.
2. PATH에서 ai-config-sync 탐색 (npm install -g 케이스)
   → 단, realpath가 자기 자신(plugin launcher)이면 제외 (recursion 방지)
   → 발견된 binary의 version을 `--version`으로 조회 후 launcher pin과 비교
     ㆍ 일치: 호출
     ㆍ minor 이내 차이: 경고 후 호출
     ㆍ major 차이 또는 schema mismatch: abort + 안내 (`npm update -g …`)
3. npm exec fallback (네트워크)
   → `npm exec --yes --package=ai-config-sync-manager@<pinned> -- ai-config-sync "$@"`
   → `npx`는 prompt/proxy/cache 동작이 환경마다 달라 `npm exec --yes`로 명시
4. 모두 실패 → 친절한 안내 메시지 후 exit 1
   (Node/npm 미설치, registry 차단, AI_CONFIG_SYNC_ROOT 잘못 지정 등)
```

- pinned version은 build-dist + connect 시점에 root `package.json`의 `version`에서 자동 주입.
- 2번 자기-자신 검사는 `[ "$(realpath "$0")" != "$(realpath "$found")" ]` 형태.
- 1번은 dev iteration용 (이 레포에서 직접 작업할 때).
- 2번이 일상 케이스 (방향 1 또는 2).
- 3번은 사용자가 npm install 안 한 채 plugin만 설치한 경우의 first-run 자동화. **이 시점에 원격 코드를 fetch하므로 README에 명시**.

---

## 5. 업데이트 플로우

| 변경 종류 | 사용자 동작 | 횟수 |
|---|---|---|
| 일상 (기능/버그fix, 본체 변경) | `npm update -g ai-config-sync-manager` | 1회로 두 host 동시 적용 |
| Launcher 자체 스펙 변경 (드묾) | host plugin update + `connect` 재실행 | host별 1회 |
| Breaking change (state schema 등) | npm major bump → 사용자에게 명시 안내 | 1회 |

**핵심**: 일상 99%는 `npm update -g` 한 번으로 끝. plugin update는 launcher 프로토콜 자체가 바뀔 때만 필요.

---

## 6. Drift 방지 가드

(C) 채택의 전제 조건. 이 가드들이 없으면 자유 floating 시 drift가 발생할 수 있다.

### 6.1 Version pin 자동 주입
- `scripts/build-dist.mjs`와 `bin/ai-config-sync.mjs`(connect)가 root `package.json`의 `version`을 읽어 다음 위치에 모두 박는다:
  - launcher의 `npm exec --package=...@x.y.z`
  - `~/.claude/plugins/installed_plugins.json`의 `version`
  - `~/.agents/plugins/marketplace.json`의 `version`
  - Claude marketplace `marketplace.json`의 plugin entry version
- launcher가 `@latest`를 사용하지 않는다.

### 6.2 PATH binary 일치 검사 (핵심)
- launcher resolution 2번에서 PATH 발견 시 `--version` 조회 후 launcher pin과 비교.
- patch 차이: 무시. minor 차이: stderr 경고 1줄. major 또는 state schemaVersion mismatch: abort.
- 정책 분기는 launcher 셸 스크립트 안에 단순한 비교로 구현(외부 의존 없음).

### 6.3 State schema version
- `~/.ai-config-sync-manager/state/<scope>.json`에 `schemaVersion` 필드 도입 (`bin/ai-config-sync.mjs:2432-2470`).
- CLI가 시작 시 검증. 미일치면 명시적 migration 또는 abort.
- 현재 baseline 파일은 schema 필드 없음 → 첫 마이그레이션 시 `schemaVersion: 1`로 백필.

### 6.4 Launcher self-check
- `ai-config-sync --version`이 본체 version + launcher pinned version + state schemaVersion 3개를 모두 출력.
- drift 의심 시 사용자가 한 줄로 진단 가능.

---

## 7. 실패 모드 & 대응

| 실패 | 사용자 영향 | 대응 |
|---|---|---|
| npm registry 다운 | 첫 호출 시 npx fallback 실패 | 사용자에게 `npm i -g` 안내, `AI_CONFIG_SYNC_ROOT` env로 로컬 git checkout fallback |
| Node/npm 미설치 | launcher가 npx 못 부름 | launcher가 친절한 에러 메시지 + 설치 가이드 링크 |
| Corporate proxy로 npx 차단 | first-run 실패 | 사전 `npm install -g` 안내 (방향 2 권장) |
| Launcher pin과 npm latest 불일치 | 사용자가 의도적으로 옛 버전 사용 가능 | 정상 동작. `--version`으로 확인 |
| State schema mismatch | CLI가 abort | migration 명령 또는 backup 후 reset 안내 |

---

## 8. 구현 변경 포인트 (구체)

### 8.1 `scripts/build-dist.mjs`
- **현재**: `sharedDirs = ["bin", "packages", "schemas", "rules", "integrations"]`를 두 dist에 통째 복사 (`scripts/build-dist.mjs:12, 24-32`).
- **변경 후**:
  - `sharedDirs`에서 `bin`, `packages`, `schemas`, `rules` 제거 → integrations만 남김.
  - `package.json`/`tsconfig.json`도 plugin에 복사하지 않음.
  - `writeHostLauncher`를 §4 resolution order대로 재작성, PATH 비교 + npm exec fallback 포함.
  - root `package.json`의 `version`을 읽어 launcher pin과 marketplace metadata 양쪽에 주입.

### 8.2 `bin/ai-config-sync.mjs` (connect 동작)
- **현재**: `copyPluginRoot`(5510-5520)가 plugin shim + bin/packages/schemas/rules 통째 복사. `cpSync(..., recursive)`는 기존 파일을 지우지 않아 stale 잔존 가능.
- **변경 후**:
  - 설치 직전 target path가 expected plugin path 패턴(`~/.claude/plugins/config-manager@ai-config-sync-manager` / `~/plugins/ai-config-sync-manager`)인지 검증 후 `rmSync(target, {recursive: true, force: true})` (managed dir로 취급).
  - `copyPluginRoot`를 plugin shim만 복사하도록 축소.
  - launcher 작성은 build-dist와 동일한 헬퍼로 통일.
  - hardcoded `version: "0.1.0"`(5495, 5530) 두 군데를 root `package.json`에서 읽도록 교체.
  - host별 install 함수는 그대로 유지 (`installClaudePlugin`, `installCodexPlugin`).

### 8.3 Launcher 템플릿 분리
- 현재 `writeHostLauncher`가 build-dist 안에 인라인.
- launcher가 build-dist + connect 양쪽에서 쓰이므로 `scripts/lib/host-launcher.mjs`로 분리. 한 함수가 양쪽에서 호출. (mjs는 zero-dep import 가능)

### 8.4 Integration 문서/skills 수정
- **현재**: `integrations/claude-plugin/skills/config-manager/SKILL.md`, `integrations/codex-plugin/skills/config-manager-connect/SKILL.md` 등이 "bundled CLI"와 고정 cache path(`$HOME/.codex/plugins/cache/local-plugins/ai-config-sync-manager/0.1.0/bin/ai-config-sync`)를 전제.
- **변경 후**: 모든 skill/command가 launcher 호출(`ai-config-sync ...` 또는 `${CLAUDE_PLUGIN_ROOT}/bin/ai-config-sync ...`)만 사용하도록 일괄 수정. 고정 cache path/version 제거.

### 8.5 `package.json` bin entry 재검토 — 결정 (a)
- **현재**: `bin: { "ai-config-sync": "./bin/ai-config-sync" }` (shell wrapper) → wrapper가 `packages/cli/dist`를 mjs보다 먼저 봄. publish 시 stub dist가 들어가면 사용자 환경에서 깨질 수 있음.
- **변경 후**: `bin: { "ai-config-sync": "./bin/ai-config-sync.mjs" }` (mjs 직접).
  - 이미 mjs에 `#!/usr/bin/env node` shebang 존재 → 그대로 동작.
  - Windows의 npm shim이 `.mjs`를 직접 실행 (bash wrapper 의존 제거).
  - stub dist 위험 원천 차단.
- dev wrapper는 `scripts/dev-launcher` 경로로 이동 (publish artifact에서 제외, dev iteration용).

### 8.6 npm publish 준비 — publish 단계로 이동
- 루트 `package.json` 이미 `private: false`.
- `files` 필드 추가 — **`bin`, `packages`, `schemas`, `rules`, `README.md`, `LICENSE`** 포함. `tests`, `dist`, `integrations`, `snapshots`, `scripts`, `.claude`, `docs` 제외.
- `rules/`는 user override fallback chain의 마지막 단계라 publish 필수.
- `publishConfig` 검토 (scoped name 채택 시 `access: "public"`).
- **현 단계에선 보류**. 실행 단계 안정화 (8.1~8.5, 8.7, 8.8) 후 진행.

### 8.7 State schema guard
- `bin/ai-config-sync.mjs:2432-2470` baseline state read/write에 `schemaVersion: 1` 필드 도입.
- 읽기 시 미일치면 명시적 에러 + 안내. 자동 migration은 별도 결정.

### 8.8 Tests
- `tests/cli-fixtures.test.mjs`에 다음 테스트 추가:
  - `build-dist` 산출물이 thin (bin/packages 미포함) 확인.
  - launcher의 resolution order별 분기 (AI_CONFIG_SYNC_ROOT, PATH stub, npm exec fallback skip-network).
  - connect가 stale plugin dir을 정리한 뒤 재설치하는 동작.
  - hardcoded version이 사라지고 root package.json에서 주입됨.

---

## 9. 결정 사항 / 보류 사항

### 9.1 결정 완료
- **§8.5 bin entry**: (a) `./bin/ai-config-sync.mjs` 직접 채택. dev wrapper는 `scripts/dev-launcher`로 이동.
- **packages/{cli,core} 처리**: 후속 작업으로 분리. 현재 distribution 변경에서는 건드리지 않음. 사유: 변경 scope 분리 (외부 표면 vs 내부 모듈), 첫 publish 직후 사용자 환경에 동시 노출 방지. 후속 항목은 `.claude/docs/workflow.md` §8.3 참조.

### 9.2 publish 단계로 이월
- **npm 패키지 이름**: `ai-config-sync-manager` (현재 루트 name) vs scoped(`@ai-config-sync-manager/cli`). scoped 채택 시 launcher pin, marketplace `source`, `installed_plugins.json` key, marketplace.json plugin name이 동시에 바뀐다.
- **PATH 일치 검사 정책**: 기본안 — patch 무시 / minor 경고 / major abort. 사용자 환경 데이터 누적 후 임계값 조정 가능.
- **Cursor 지원 시점**: launcher 패턴은 그대로 적용 가능. publish 안정화 + Cursor plugin spec 조사 후 진행.

---

## 10. 마이그레이션 영향

- 기존 사용자(현재 self-contained plugin 설치자)는 plugin update 시점에 launcher가 교체되고, 첫 호출에서 PATH 또는 `npm exec`로 본체를 받게 된다.
- **stale 파일 처리**: 기존 plugin 안의 bin/packages/schemas/rules는 새 plugin에서 사라지므로 plugin reinstall 시 stale 잔존 가능. `cpSync(..., recursive)`는 기존 파일을 지우지 않는다. → connect가 plugin target을 managed dir로 보고 (1) target path가 expected pattern인지 검증, (2) `rmSync(target, {recursive: true, force: true})`, (3) shim 재설치 순으로 보강 (§8.2).
- `~/.ai-config-sync-manager/state/`는 그대로 유지. `schemaVersion: 1` 백필 필요 (§6.3).
- **Skills/commands 호출 경로 변경**: integration 문서가 고정 cache path를 전제로 작성되어 있음(`$HOME/.codex/plugins/cache/local-plugins/.../0.1.0/bin/ai-config-sync`). launcher 호출 형태로 일괄 수정 (§8.4). 기존 사용자가 skills 캐시를 가지고 있으면 다음 호출 시 새 path 적용.

---

## 11. 참고

- 현재 코드 위치: `scripts/build-dist.mjs:12, 72-104`, `bin/ai-config-sync.mjs:5388, 5486-5520`.
- 관련 분석: `.claude/docs/repo-analysis/02-architecture.md`, `.claude/docs/repo-analysis/00-overview.md` §2.5.
- 외부 사용자용 install 안내: `README.md` (본 문서로 link).
