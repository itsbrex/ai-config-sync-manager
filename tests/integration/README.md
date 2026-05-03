# Integration Tests

Codex → Claude 단방향 sync 통합 스위트. 실제 CLI(`bin/ai-config-sync.mjs`)를 임시 HOME에서 실행해 6개 area(`instructions`, `skills`, `agents`, `mcp`, `permissions`, `hooks`)의 동작을 골든 트리/리더 헬퍼로 검증한다.

## 폴더 구조

```
tests/integration/
  helpers/                 # fixture/run-cli/snapshot/golden/readers/invariants
  codex-to-claude/         # area 별 .test.mjs + sync-all.test.mjs
  fixtures/areas/<area>/<variant>/
    codex-home/            # 입력: AI_CONFIG_SYNC_HOME 으로 적용
    pre-claude/            # (선택) apply 직전 미리 깔아둘 host 상태
    expected-claude/       # 골든: assertGolden 비교 대상
```

## 실행

```bash
node --test tests/integration/codex-to-claude/*.test.mjs   # 전체
node --test tests/integration/codex-to-claude/mcp.test.mjs # 단일 area
KEEP_FIXTURE=1 node --test tests/integration/codex-to-claude/mcp.test.mjs  # 실패 디버그용 (tmpdir 보존)
```

## 신규 fixture 추가

1. `fixtures/areas/<area>/<variant>/codex-home/` 에 입력 트리.
2. `expected-claude/` 에 apply 후 기대 트리(골든).
3. 필요 시 `pre-claude/` 로 사전 host 상태.
4. 해당 area 의 test 에 케이스 추가, `layCodexHome` / `layExpectedClaude` 호출.

variant 매트릭스(현행):
- `instructions`: happy, multi-section, empty-source
- `skills`: happy, symlink-unsupported, manual-overwrite
- `agents`: happy, manual-overwrite
- `mcp`: happy, secret-env, manual-conflict
- `permissions`: manual-allow
- `hooks`: manual-pre-tool-use

후속(미커버): 양방향(claude→codex), `commands` area, deletion 시나리오.

## Fixture 작성 제약

- **Frontmatter (SKILL.md / agents)**: `key: value` 단일 라인만. multi-line literal(`|`) / folded scalar(`>`) / nested object 미지원 (`helpers/readers.mjs` 의 `parseFrontmatter` 가 단순 파서).
- **Symlink**: `cpSync({ verbatimSymlinks: true })` 로 relative target 보존 — fixture 도 relative 로 작성. raw `readlinkSync()` 비교만 수행, canonicalize 안 함.
- **Secret-like 값**: `secret-env` 류 fixture 에는 `secret-token-value` 같은 합성 placeholder 만 사용. `KEEP_FIXTURE=1` 디버그 시 `/tmp/...` 가 보존되므로 실 토큰을 fixture 에 넣으면 leak 위험.
