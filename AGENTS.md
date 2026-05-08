# AGENTS.md — AI Config Sync Manager

Claude/Codex 개발자 설정을 비교·변환·동기화하는 zero-runtime-deps Node ESM CLI.
1차 진입점: `bin/ai-config-sync.mjs` (단일 파일 8,600+ 줄).

---

## 작업 전 참조 순서

1. `.claude/docs/repo-analysis/00-overview.md` — 전체 구조·리스크 한눈에 파악.
2. 나머지 `01-code` ~ `06-conventions` 은 필요한 영역만 선택해서 읽는다.
3. `README.md` — 사용자용 CLI 레퍼런스.
4. `package.json`, `scripts/build-dist.mjs` — scripts·files 정책 확인.
5. 소스 직접 읽기는 마지막 수단.

---

## YAML 직렬화 규칙 (가장 중요 — 꼭 거치도록)

**YAML scalar 를 직렬화하거나 quoting 여부를 판정할 때는 반드시 아래 util 을 사용한다.**

```js
import { serializeYamlScalar, yamlScalarRequiresQuoting } from "./util/yaml-scalar.mjs";
// 테스트에서:
import { yamlScalarRequiresQuoting } from "../bin/util/yaml-scalar.mjs";
```

- 자체 quote/escape 로직 작성 **금지**. 정규식으로 indicator 직접 판정 **금지**.
- `serializeFrontmatterScalar` 같은 wrapper 추가 **금지** (제거 사례 있음).
- 신규 quoting edge case 발견 시: `bin/util/yaml-scalar.mjs` 에 룰 추가 + `tests/yaml-scalar.test.mjs` 에 unit case 추가.
- 이유: Claude(lenient YAML) ↔ Codex(strict YAML 1.2) round-trip 보장. 한 곳이라도 자체 quoting 하면 strict 파서가 frontmatter 전체를 파싱 실패하고 `name` 같은 필드가 누락된다 (실제 발생 사례).

---

## 코드 컨벤션

- ESM 전용. import 경로에 `.mjs` 확장자 명시 필수.
- double quotes, semicolons, function declarations.
- **외부 runtime dependency 추가 금지** (zero-runtime-deps 정책; devDependency 는 허용).
- 주석은 WHY 한 줄만. WHAT·태스크 참조 금지.
- `bin/ai-config-sync.mjs` 분할 보류. cross-cutting helper 는 `bin/util/` 에 별도 `.mjs` 로 추출 가능 (`yaml-scalar.mjs` 선례).

---

## 테스트

- 프레임워크: `node:test` + `node:assert/strict`.
- 위치: `tests/*.test.mjs` (unit/fixture), `tests/integration/codex-to-claude/*.test.mjs` (통합).
- 전체 실행: `npm test`.
- 단일 실행: `node --test tests/<file>.test.mjs`.
- test 설명은 behavior sentence 형식 (`test("agents sync apply ...", ...)`).
- 신규 helper 추가 시 unit case + integration case 양쪽 모두 작성.

---

## 빌드 / 배포

- `npm run build:dist` → `dist/claude-marketplace`, `dist/codex-plugin` 생성.
- host-launcher(`scripts/lib/host-launcher.mjs`)만 wrapper; `bin/` 은 그대로 배포.
- `package.json` `files` 에 `bin/` 전체 포함 → `bin/util/*.mjs` 자동 publish.
- ESM relative import 로 직접 resolve. 번들 단계 없음.

---

## 커밋

- Conventional Commits: `fix:`, `feat:`, `test:`, `chore(...)`, `docs:`.
- 본문은 WHY 중심으로 작성.
- pre-commit hook(husky + lint-staged) 통과 필수.
