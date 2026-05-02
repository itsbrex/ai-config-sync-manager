# 설치 및 실행 흐름도

> 로컬 테스트 모드 ↔ 프로덕션 모드를 1:1 매핑. 처음 설치부터 명령 실행까지 화살표 흐름.
> 배포 설계 전체: [`distribution-workflow.md`](./distribution-workflow.md)

---

## 1. 두 layer 구분 (먼저 이해할 것)

```
┌─────────────────────────────────────────────────────────────┐
│ Layer A: CLI 본체 (mjs)                                     │
│   bin/ai-config-sync.mjs                                    │
│   ─ package.json bin 진입점                                 │
│   ─ npm install 시 PATH에 등록 (Windows도 npm shim이 처리)  │
│   ─ bash 의존 ❌                                            │
└─────────────────────────────────────────────────────────────┘
                            ↑ 호출
┌─────────────────────────────────────────────────────────────┐
│ Layer B: Plugin launcher (bash)                             │
│   plugin/bin/ai-config-sync                                 │
│   ─ scripts/lib/host-launcher.mjs가 생성                    │
│   ─ host(Claude/Codex)가 plugin bin을 invoke할 때 실행      │
│   ─ bash 의존 ⚠️ (Windows = Git Bash/WSL 필요)              │
│   ─ 역할: AI_CONFIG_SYNC_ROOT → PATH → npm exec 순으로      │
│           Layer A(본체 mjs)를 찾아 실행                     │
└─────────────────────────────────────────────────────────────┘
```

**핵심**: Layer A는 mjs 직접(bash-free). Layer B는 bash launcher(현재). Windows 100% 지원이 필요하면 후속에서 Layer B도 mjs/cmd 분기 launcher로 전환.

---

## 2. 로컬 테스트 모드 흐름

```
┌──────────────────────────────────────────────────────────────────┐
│ STEP 1 · 본체 빌드/캐시 동기화                                   │
│                                                                  │
│   $ npm run build:dist                                           │
│        │                                                         │
│        ├─→ dist/claude-marketplace/plugins/config-manager/       │
│        │     thin: bin/ commands/ skills/                        │
│        │                                                         │
│        ├─→ dist/codex-plugin/                                    │
│        │     thin: bin/ skills/                                  │
│        │                                                         │
│        └─→ sync-plugin-cache.mjs (wipe-then-copy)                │
│              ├─→ ~/.claude/plugins/cache/                        │
│              │      ai-config-sync-manager/config-manager/0.1.0/ │
│              └─→ ~/.codex/plugins/cache/                         │
│                     local-plugins/ai-config-sync-manager/0.1.0/  │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 2 · 본체 mjs를 PATH에 노출 (npm link)                       │
│                                                                  │
│   $ npm run dev:setup    # = npm link + npm run build:dist       │
│        └─→ ~/.npm-global/bin/ai-config-sync                      │
│              symlink → 레포의 bin/ai-config-sync.mjs             │
│              (publish 후와 동일한 PATH resolution 경로 검증      │
│               + 코드 수정 즉시 반영, rebuild 불필요)             │
│                                                                  │
│   해제: npm run dev:teardown                                     │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 3 · Plugin 설치 (둘 중 택1)                                 │
│                                                                  │
│   ① ai-config-sync connect                                       │
│        ├─→ ensureManagedPluginTarget (target path 검증)          │
│        ├─→ rmSync (stale 정리)                                   │
│        ├─→ thin shim 복사                                        │
│        │     ├─ ~/.claude/plugins/                               │
│        │     │     config-manager@ai-config-sync-manager/        │
│        │     └─ ~/plugins/ai-config-sync-manager/                │
│        └─→ bash launcher 작성 (host-launcher.mjs)                │
│                                                                  │
│   ② Claude marketplace UI에서 install                            │
│        └─→ 로컬 marketplace 등록 시 위와 유사한 경로             │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 4 · 명령 호출 → 본체 실행                                   │
│                                                                  │
│   사용자: /config-manager:status (Claude) 또는                   │
│           config-manager-status (Codex)                          │
│        ↓                                                         │
│   host가 plugin의 bin/ai-config-sync 실행 (bash)                 │
│        ↓                                                         │
│   Layer B (launcher) resolution                                  │
│        ├─ ① AI_CONFIG_SYNC_ROOT 있음?                            │
│        │    YES → exec node $ROOT/bin/ai-config-sync.mjs status  │
│        │                                                         │
│        ├─ ② PATH에 ai-config-sync 있음?                          │
│        │    YES → realpath self-exclude → version 비교           │
│        │           → exec ai-config-sync status                  │
│        │                                                         │
│        ├─ ③ npm exec --yes --package=...@0.1.0 ...              │
│        │    (publish 전이라 실패)                                │
│        │                                                         │
│        └─ ④ exit 1 + 안내                                        │
│        ↓                                                         │
│   node가 본체 mjs 실행 → status diff 출력                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 프로덕션 모드 흐름 (publish 후)

```
┌──────────────────────────────────────────────────────────────────┐
│ STEP 1 · 본체 install (사용자 한 번)                             │
│                                                                  │
│   $ npm install -g ai-config-sync-manager                        │
│        ↓                                                         │
│   npm registry → 다운로드                                        │
│        ↓                                                         │
│   ~/.npm-global/lib/node_modules/ai-config-sync-manager/         │
│   ~/.npm-global/bin/ai-config-sync (PATH 등록)                   │
│        symlink → bin/ai-config-sync.mjs                          │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 2 · Plugin 설치 (둘 중 택1)                                 │
│                                                                  │
│   ① ai-config-sync connect                                       │
│        └─→ Claude + Codex 양쪽에 thin plugin 자동 등록           │
│              (로컬 모드의 connect와 동일 흐름)                   │
│                                                                  │
│   ② Claude marketplace UI                                        │
│        /plugin install ai-config-sync-manager@0.1.0              │
│        ↓                                                         │
│   marketplace → dist/claude-marketplace의 thin plugin 다운로드   │
│   ~/.claude/plugins/config-manager@ai-config-sync-manager/       │
│        bin/ + commands/ + skills/                                │
│   (Codex도 별도 install 필요. 또는 connect 1번으로 양쪽 자동)    │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 3 · 명령 호출 → 본체 실행                                   │
│                                                                  │
│   사용자: /config-manager:status                                 │
│        ↓                                                         │
│   host가 plugin의 bin/ai-config-sync 실행 (bash)                 │
│        ↓                                                         │
│   Layer B (launcher) resolution                                  │
│        ├─ ① AI_CONFIG_SYNC_ROOT? (보통 NO)                       │
│        ├─ ② PATH에 ai-config-sync? (YES — STEP 1로 등록)         │
│        │    → realpath self-exclude → version 비교               │
│        │      ├─ patch 차이: silent                              │
│        │      ├─ minor 차이: stderr 경고                         │
│        │      └─ major 차이: abort + npm update 안내             │
│        │    → exec ai-config-sync status                         │
│        ↓                                                         │
│   node가 본체 mjs 실행 → status diff                             │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ STEP 4 · 업데이트 (사용자 한 줄)                                 │
│                                                                  │
│   $ npm update -g ai-config-sync-manager                         │
│        └─→ Layer A 갱신 → 다음 호출부터 Claude·Codex 동시 적용   │
│        (plugin은 손 안 댐)                                       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. 로컬 ↔ 프로덕션 1:1 매핑

| 단계 | 로컬 테스트 | 프로덕션 |
|---|---|---|
| **Step 1: 본체 위치** | 레포 자체 (`bin/ai-config-sync.mjs`) | npm registry → `~/.npm-global/lib/node_modules/.../` |
| **Step 1: PATH 등록 방법** | `npm run dev:setup` (= `npm link` + `build:dist`, 코드 수정 즉시 반영) | `npm install -g ai-config-sync-manager` |
| **Step 2: Plugin 출처** | `dist/` → `sync-plugin-cache.mjs`로 캐시 직접 복사 | `dist/` → marketplace upload → 사용자 install |
| **Step 2: Plugin 설치 위치** | `~/.claude/plugins/config-manager@.../` (connect) 또는 cache | `~/.claude/plugins/config-manager@.../` |
| **Step 3: Launcher resolution** | ② PATH (npm link symlink) | ② PATH (npm install -g) |
| **Step 3: Launcher 자체** | **동일 코드** (`scripts/lib/host-launcher.mjs`) | **동일 코드** |
| **Step 4: 업데이트** | `git pull && npm run build:dist` | `npm update -g ai-config-sync-manager` |

### 핵심 동일점
- **Layer B(launcher) 코드는 publish 전후 동일** — resolution order만 어느 단계에서 hit하는지가 다름
- **본체 mjs는 항상 한 곳** — 두 host가 같은 mjs를 호출하므로 drift 0

### 핵심 차이점
- **로컬**: `npm link` symlink로 PATH 등록 → 코드 수정 즉시 반영 (rebuild 불필요, build:dist는 plugin shim/skill 변경 시만)
- **프로덕션**: 본체가 npm registry → 사용자 글로벌 install (스냅샷)

---

## 5. 환경별 호환성 노트

| 환경 | Layer A (mjs 본체) | Layer B (plugin bash launcher) |
|---|---|---|
| macOS | ✅ | ✅ |
| Linux | ✅ | ✅ |
| Windows + Git Bash | ✅ (npm shim이 .cmd 자동 생성) | ✅ (Git Bash 셸 안에서) |
| Windows 순수 cmd | ✅ (npm shim) | ⚠️ bash 없으면 launcher 동작 X |

### Windows 순수 cmd 지원이 필요해지면 (후속)
- 옵션 1: Layer B를 mjs로 — `scripts/lib/host-launcher.mjs`가 `.mjs` launcher 생성, host가 node로 직접 실행. host(Claude/Codex)가 plugin bin을 `bash -c`로 wrap하지 않고 직접 exec하는지 확인 필요.
- 옵션 2: OS별 분기 — `.sh`(Unix) + `.cmd`(Windows) 둘 다 생성, plugin manifest가 OS별 entry 분기.

현재 Claude/Codex plugin spec은 *nix 가정이 강해 bash launcher가 표준. publish 단계에서 Windows 사용자 비율 보고 결정.

---

## 6. 빠른 참고

```
로컬 dev 셋업 (한 번만):
  npm run dev:setup && ai-config-sync connect
    # = npm link + build:dist + 두 host에 plugin shim 등록
    # 이후 코드 수정은 즉시 반영 (rebuild 불필요)

로컬 plugin shim/skill 변경 시 캐시 갱신:
  npm run build:dist
    # 본체 mjs 수정만이면 이 명령 불필요

로컬 dev 해제:
  npm run dev:teardown    # npm unlink -g

프로덕션 사용자 한 줄 셋업 (publish 후):
  npm install -g ai-config-sync-manager && ai-config-sync connect

프로덕션 업데이트:
  npm update -g ai-config-sync-manager
```
