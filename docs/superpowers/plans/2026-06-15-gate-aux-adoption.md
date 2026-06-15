# 게이트 보조면 채택 실험 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 연승(place) 자로는 약해도 fade/복승 자로 센 ScoreItem을 롤링 학습 모델 피처에 편입하는 **비침습 실험 스위치**(`--gate-aux`)를 만들고, A/B로 현 챔피언을 넘는 후보 모델이 나오는지 검증한다.

**Architecture:** 보조면 자격 판정을 순수 함수(`auxQualified`)로 분리해 단위 테스트하고, `benchmark_all.ts`가 `--gate-aux` 플래그가 켜졌을 때만 `approved` 집합에 합집합으로 더한다. 기존 게이트B `include` 로직·챔피언 로드·기본 동작은 무변경(플래그 미지정 시 비트 단위 동일).

**Tech Stack:** Node + TypeScript, vitest. 기존 `src/engine/eval/gates.ts`(`GateBResult`)·`scripts/benchmark_all.ts`.

**스펙:** `docs/superpowers/specs/2026-06-15-gate-aux-adoption-design.md`

---

## File Structure

- **Create** `src/engine/eval/gateAux.ts` — `AuxConfig` 타입 + `DEFAULT_AUX_CONFIG` 상수 + `auxQualified` 순수 함수. 책임: "이 항목이 보조면 자격으로 채택될 자격이 있는가" 판정만.
- **Create** `src/engine/eval/gateAux.test.ts` — `auxQualified` 단위 테스트.
- **Modify** `scripts/benchmark_all.ts` — `--gate-aux` 플래그 파싱 + on일 때 `approved`에 합집합 + 추가 항목 로그.

> `GateBResult`(itemId·include·delta·withRate·withoutRate·fadeDelta·quinDelta)는 이미 `src/engine/eval/gates.ts:85`에 정의·export됨. 게이트 재실행·산식 변경 없음.

---

## Task 0 (Phase 0): 분포 확인 → 컷오프 확정 (실행·판독, 사용자 위임)

> 코드 없음. 이 Task 결과로 Task 1의 `DEFAULT_AUX_CONFIG` 값을 확정한다. KRA 무관(로컬 데이터) — 쿼터 영향 없음.

- [ ] **Step 1: 기존 `--gate-only`로 전 항목 3면 분포 확보**

Run (사용자 실행): `npm run benchmark -- --gate-only`
Expected: `printGateB`가 항목별 `연승 / fade / 복승` 3열 표를 출력 (`scripts/benchmark_all.ts:46`).

- [ ] **Step 2: 보조면 후보군 식별 (Claude 판독)**

표에서 **`연승(delta) ≤ 0`(현재 탈락)이면서 `fade` 또는 `복승` delta가 뚜렷이 양수**인 항목을 골라낸다.
- 후보가 0개면 → treatment == baseline이 되어 실험은 깔끔한 null 결과. 그 사실을 Task 4 기록에 남기고 코드는 그대로 둔다(스위치는 무해).
- 후보가 있으면 → fade/복승 delta 분포(예: 상위 몇 개의 값)를 보고 컷오프 `fadeThreshold`/`quinThreshold`를 **데이터로** 정한다. 노이즈(±0.5%p 수준)와 신호를 가르는 선.

- [ ] **Step 3: 확정된 컷오프 기록**

판독 결과(후보 목록 + 선택한 τ_f/τ_q + 근거 한 줄)를 이 Task 메모로 남긴다. 이 값이 Task 1 `DEFAULT_AUX_CONFIG`에 들어간다.

> 커밋 없음(분석 단계). 후속 Task가 값을 코드에 반영하며 커밋한다.

---

## Task 1: `auxQualified` 순수 함수 + 테스트 (TDD)

**Files:**
- Create: `src/engine/eval/gateAux.ts`
- Test: `src/engine/eval/gateAux.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/engine/eval/gateAux.test.ts
import { describe, it, expect } from 'vitest';
import { auxQualified, type AuxConfig } from './gateAux.js';
import type { GateBResult } from './gates.js';

// 테스트는 명시적 config 사용 (DEFAULT_AUX_CONFIG와 독립 — Phase 0가 기본값을 바꿔도 안 깨짐)
const cfg: AuxConfig = { fadeThreshold: 0.02, quinThreshold: 0.02, placeFloor: 0 };

const make = (over: Partial<GateBResult>): GateBResult => ({
  itemId: 'x', include: false, delta: 0, withRate: 0, withoutRate: 0,
  fadeDelta: 0, quinDelta: 0, ...over,
});

describe('auxQualified', () => {
  it('연승으로 이미 채택된 항목(delta>placeFloor)은 fade가 커도 자격 없음', () => {
    expect(auxQualified(make({ delta: 0.018, fadeDelta: 0.05 }), cfg)).toBe(false);
  });

  it('탈락 항목(delta<=0)이 fade>=임계면 자격 있음', () => {
    expect(auxQualified(make({ delta: -0.003, fadeDelta: 0.025 }), cfg)).toBe(true);
  });

  it('탈락 항목이 복승>=임계면 자격 있음', () => {
    expect(auxQualified(make({ delta: 0, quinDelta: 0.03 }), cfg)).toBe(true);
  });

  it('탈락 항목이 fade·복승 둘 다 임계 미만이면 자격 없음', () => {
    expect(auxQualified(make({ delta: -0.01, fadeDelta: 0.01, quinDelta: 0.005 }), cfg)).toBe(false);
  });

  it('임계는 경계 포함(>=)', () => {
    expect(auxQualified(make({ delta: 0, fadeDelta: 0.02 }), cfg)).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/engine/eval/gateAux.test.ts`
Expected: FAIL ("Cannot find module './gateAux.js'")

- [ ] **Step 3: 구현**

```ts
// src/engine/eval/gateAux.ts
import type { GateBResult } from './gates.js';

/** 보조면(fade/복승) 채택 자격 기준. delta·fadeDelta·quinDelta는 분수(%p/100, 예: +2.0%p=0.02). */
export interface AuxConfig {
  /** 이 값 이하의 연승 delta를 가진 '탈락' 항목만 보조면 대상. 기본 0 (place 규칙이 거른 항목). */
  placeFloor: number;
  /** fade delta가 이 값 이상이면 자격. */
  fadeThreshold: number;
  /** 복승 delta가 이 값 이상이면 자격. */
  quinThreshold: number;
}

/**
 * Phase 0(분포 확인)에서 확정한 시작값. fade/복승 +2.0%p를 노이즈와 신호의 잠정 경계로 둔다.
 * `npm run benchmark -- --gate-only` 분포 판독 후 이 상수를 조정한다.
 */
export const DEFAULT_AUX_CONFIG: AuxConfig = {
  placeFloor: 0,
  fadeThreshold: 0.02,
  quinThreshold: 0.02,
};

/**
 * 연승 자로는 탈락(delta<=placeFloor)했지만 fade 또는 복승 자로 임계 이상인 항목인가.
 * 연승으로 이미 채택된 항목(delta>placeFloor)은 false (합집합에서 중복·무의미).
 */
export function auxQualified(r: GateBResult, cfg: AuxConfig): boolean {
  if (r.delta > cfg.placeFloor) return false;
  return r.fadeDelta >= cfg.fadeThreshold || r.quinDelta >= cfg.quinThreshold;
}
```

> Phase 0(Task 0)에서 다른 τ를 골랐다면 `DEFAULT_AUX_CONFIG`의 `fadeThreshold`/`quinThreshold` 값을 그 값으로 바꾼다. 테스트는 명시적 `cfg`를 쓰므로 영향 없음.

- [ ] **Step 4: 테스트 통과 + 타입체크**

Run: `npm run build && npx vitest run src/engine/eval/gateAux.test.ts`
Expected: PASS (전부)

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/gateAux.ts src/engine/eval/gateAux.test.ts
git commit -m "feat(gate-aux): 보조면 채택 자격 순수 함수 auxQualified + 테스트"
```

---

## Task 2: benchmark에 `--gate-aux` 플래그 배선

**Files:**
- Modify: `scripts/benchmark_all.ts` (플래그 파싱 line 30-31 근처, approved 산출 line 40-48)

- [ ] **Step 1: import 추가**

`scripts/benchmark_all.ts` 상단, `import { runGateA, printGateA, runGateB, printGateB } from '../src/engine/eval/gates.js';` (line 9) **다음 줄**에 추가:

```ts
import { auxQualified, DEFAULT_AUX_CONFIG } from '../src/engine/eval/gateAux.js';
```

- [ ] **Step 2: 플래그 파싱 추가**

`const noGate = args.includes('--no-gate');` (line 31) **다음 줄**에 추가:

```ts
  const gateAux = args.includes('--gate-aux');
```

- [ ] **Step 3: approved 합집합 + 로그**

`approved = new Set(gb.filter((g) => g.include).map((g) => g.itemId));` (line 47) **다음 줄**에 추가:

```ts
    if (gateAux) {
      const added = gb.filter((g) => !approved.has(g.itemId) && auxQualified(g, DEFAULT_AUX_CONFIG));
      for (const g of added) approved.add(g.itemId);
      const fmt = (d: number) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}`;
      console.log(
        `\n  [--gate-aux] 보조면 추가 ${added.length}개: `
        + (added.map((g) => `${g.itemId}(fade${fmt(g.fadeDelta)}/복${fmt(g.quinDelta)})`).join(', ') || '없음')
      );
    }
```

> 이 블록은 `if (gateOnly) return;` (line 49) **앞**에 위치하므로 `--gate-only --gate-aux`로 빠르게 추가 항목만 확인 가능.

- [ ] **Step 4: 타입체크 + 기존 테스트 회귀 없음**

Run: `npm run build && npm run test:run`
Expected: PASS (기존 테스트 그대로)

- [ ] **Step 5: 플래그 동작 스모크 (사용자 실행 권장 — 게이트 재학습 포함)**

Run: `npm run benchmark -- --gate-only --gate-aux`
Expected: 게이트B 3열 표 뒤에 `[--gate-aux] 보조면 추가 N개: ...` 줄 출력 후 종료. 플래그 없이 `npm run benchmark -- --gate-only` 돌리면 그 줄이 안 나옴(기본 동작 불변 확인).

- [ ] **Step 6: Commit**

```bash
git add scripts/benchmark_all.ts
git commit -m "feat(gate-aux): benchmark --gate-aux 플래그 — 보조면 항목 approved 합집합"
```

---

## Task 3 (Phase 2-3): A/B 검증 → 판정 → 기록 (실행·문서, 사용자 위임)

> 코드 없음. KRA 무관(로컬). 사용자가 두 번 실행 → Claude 판독·기록.

- [ ] **Step 1: baseline 실행**

Run (사용자): `npm run benchmark`
Expected: 롤링 ASCII 리포트(분기별 + overall 연승/단승/시장격차, 9모델 + 챔피언).

- [ ] **Step 2: treatment 실행**

Run (사용자): `npm run benchmark -- --gate-aux`
Expected: 동일 리포트. 상단에 `[--gate-aux] 보조면 추가 N개` 로그.

- [ ] **Step 3: 비교·판정 (Claude 판독)**

baseline vs treatment를 비교:
- 학습 모델(Logistic/GBDT/PL 각 top1/2/3) 중 **overall 연승 또는 시장격차가 baseline 대비 일관 개선**(분기 다수 같은 방향)인 모델이 있는가.
- 특히 **현 챔피언(연승 61.4% / 시장 68.8%, −7.4%p)을 넘는 후보**가 나오는가.
- 개선이 단일 분기 우연 수준이면 음성으로 본다(스펙 §7 노이즈 밴드).

- [ ] **Step 4: 결과 기록 (양성·음성 모두)**

- `docs/score_roadmap.md`: 보조면 채택 실험 결과(편입 항목·게이트 판정).
- 메모리 `project_gate_multimetric.md` + `project_feature_gate_findings.md`: 보조면 A/B 결과(채택/기각) 한 줄.
- 양성이면: `DEFAULT_AUX_CONFIG`를 확정값으로 고정 + 새 챔피언 후보 승격 검토(별도 작업).
- 음성이면: place-only 유지, `--gate-aux`는 진단 스위치로 존속.
- `CLAUDE.md` 현재 실행 상태: 한 줄 갱신.

- [ ] **Step 5: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs(gate-aux): 보조면 채택 A/B 검증 결과 기록"
```

---

## Self-Review 메모

- **스펙 커버리지:** Phase 0 분포·컷오프(Task 0) · 비침습 스위치(Task 1·2) · A/B(Task 3 Step1-2) · 판정 노이즈 밴드(Task 3 Step3) · 양성/음성 기록(Task 3 Step4) · 무변경 보장(Task 2 플래그 가드 + 기존 테스트) 모두 매핑. 챔피언 무관 해석(스펙 §3)은 Task 3 Step3 판정 기준에 반영.
- **타입 일관성:** `AuxConfig{placeFloor,fadeThreshold,quinThreshold}` — Task 1 정의, Task 2에서 `DEFAULT_AUX_CONFIG`로 사용. `auxQualified(r: GateBResult, cfg: AuxConfig)` 시그니처 테스트·구현·호출부 일치. `GateBResult` 필드명(delta/fadeDelta/quinDelta)은 기존 `gates.ts` 정의와 일치.
- **미확정(의도적):** `DEFAULT_AUX_CONFIG`의 fade/quin 임계 시작값 0.02는 Task 0 분포 판독으로 확정·조정. 테스트는 명시적 cfg를 써서 기본값 변경에 무관.
- **순서 의존성:** Task 0(분포)→Task 1(τ 반영). 단 Task 1 코드는 파라미터화돼 있어 Task 0 없이도 시작값으로 구현 가능 — Task 0은 시작값 검증·조정 역할.
