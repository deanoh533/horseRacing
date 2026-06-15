# 게이트 3면화 (연승·fade·복승) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 게이트B가 피처군마다 holdout **연승·fade·복승 3지표 개선량**을 함께 내도록 확장한다(모델·채택 무변경, 진단 전용).

**Architecture:** 같은 ablation(modelAll/modelWithout)의 holdout을 한 번 재점수해 3지표를 센다. 지표 계산은 순수 함수 모듈 `gateMetrics.ts`로 분리(TDD). `gates.ts`는 그걸 호출해 `GateBResult`에 fade/복승 delta를 추가, `report.ts`는 3열 표.

**Tech Stack:** Node + TypeScript, vitest. 기존 `fitLogistic`/`predictLogit`(logistic.ts), `toVector`(alignFeatures.ts), `RaceRecord`/`HorseRecord`(eval/types.ts).

**스펙:** `docs/superpowers/specs/2026-06-15-gate-multimetric-design.md`

---

## File Structure

- **Create** `src/engine/eval/gateMetrics.ts` — 순수 함수: `scoreHoldout` + `placeHitRate`/`fadeHitRate`/`quinellaHitRate`.
- **Create** `src/engine/eval/gateMetrics.test.ts` — 합성 데이터 단위 테스트.
- **Modify** `src/engine/eval/gates.ts` — `GateBResult`에 `fadeDelta`/`quinDelta` 추가, `runGateB`가 `gateMetrics` 사용.
- **Modify** `src/engine/eval/report.ts` — `printGateB` 3열.

기존 타입(참고, 변경 금지):
- `LogisticModel`, `fitLogistic`, `predictLogit(model, rawRow: number[]): number` — `src/engine/models/logistic.ts`
- `toVector(features, schema): number[]` — `src/engine/features/alignFeatures.ts`
- `HorseRecord { ord: number; winOdds: number | null; features: Feature[]; ... }`, `RaceRecord { horses: HorseRecord[]; ... }` — `src/engine/eval/types.ts`

---

## Task 1: gateMetrics.ts — 순수 지표 함수 (핵심)

**Files:**
- Create: `src/engine/eval/gateMetrics.ts`
- Test: `src/engine/eval/gateMetrics.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/engine/eval/gateMetrics.test.ts
import { describe, it, expect } from 'vitest';
import { placeHitRate, fadeHitRate, quinellaHitRate, type ScoredRace } from './gateMetrics.js';

// score 높을수록 모델 상위. winOdds 낮을수록 인기.
describe('placeHitRate', () => {
  it('모델 1순위(최고점)가 3착내면 성공', () => {
    const races: ScoredRace[] = [
      [{ ord: 1, winOdds: 3, score: 0.9 }, { ord: 5, winOdds: 2, score: 0.1 }],   // top=ord1 → hit
      [{ ord: 7, winOdds: 4, score: 0.8 }, { ord: 2, winOdds: 2, score: 0.2 }],   // top=ord7 → miss
    ];
    expect(placeHitRate(races)).toBeCloseTo(0.5);
  });
  it('빈 입력은 0', () => { expect(placeHitRate([])).toBe(0); });
});

describe('fadeHitRate', () => {
  it('인기1~3 중 모델 최저점 말이 3착 밖이면 성공', () => {
    const races: ScoredRace[] = [
      // 인기 상위3 = odds 2,3,4. 그중 최저점 = score 0.1(ord 6) → 3착밖 → hit
      [
        { ord: 6, winOdds: 2, score: 0.1 },
        { ord: 1, winOdds: 3, score: 0.7 },
        { ord: 2, winOdds: 4, score: 0.6 },
        { ord: 8, winOdds: 20, score: 0.05 }, // 비인기 — 후보 아님
      ],
      // 인기 상위3 최저점 = score 0.2(ord 3) → 3착내 → miss
      [
        { ord: 3, winOdds: 2, score: 0.2 },
        { ord: 1, winOdds: 3, score: 0.9 },
        { ord: 5, winOdds: 4, score: 0.8 },
      ],
    ];
    expect(fadeHitRate(races)).toBeCloseTo(0.5);
  });
  it('winOdds 인기 후보 2두 미만 경주는 분모 제외', () => {
    const races: ScoredRace[] = [
      [{ ord: 1, winOdds: null, score: 0.9 }, { ord: 2, winOdds: null, score: 0.1 }], // 후보 0 → 제외
      [{ ord: 6, winOdds: 2, score: 0.1 }, { ord: 1, winOdds: 3, score: 0.9 }],        // 후보2, 최저점 ord6 → hit
    ];
    expect(fadeHitRate(races)).toBeCloseTo(1.0); // n=1, hit=1
  });
});

describe('quinellaHitRate', () => {
  it('모델 top2가 실제 1·2위 둘 다 포함하면 성공', () => {
    const races: ScoredRace[] = [
      // 모델 top2(점수 0.9,0.8) = ord1,ord2 → hit
      [{ ord: 1, winOdds: 2, score: 0.9 }, { ord: 2, winOdds: 3, score: 0.8 }, { ord: 3, winOdds: 4, score: 0.1 }],
      // 모델 top2 = ord1, ord4 → miss(ord2 누락)
      [{ ord: 1, winOdds: 2, score: 0.9 }, { ord: 4, winOdds: 3, score: 0.8 }, { ord: 2, winOdds: 4, score: 0.1 }],
    ];
    expect(quinellaHitRate(races)).toBeCloseTo(0.5);
  });
  it('실제 1·2위 없는 경주는 제외', () => {
    const races: ScoredRace[] = [
      [{ ord: 1, winOdds: 2, score: 0.9 }, { ord: 5, winOdds: 3, score: 0.1 }], // ord2 없음 → 제외
    ];
    expect(quinellaHitRate(races)).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/gateMetrics.test.ts`
Expected: FAIL ("Cannot find module './gateMetrics.js'")

- [ ] **Step 3: 구현**

```ts
// src/engine/eval/gateMetrics.ts
import type { LogisticModel } from '../models/logistic.js';
import { predictLogit } from '../models/logistic.js';
import { toVector } from '../features/alignFeatures.js';
import type { RaceRecord } from './types.js';

export interface ScoredHorse { ord: number; winOdds: number | null; score: number; }
export type ScoredRace = ScoredHorse[];

/** 모델로 holdout 각 경주 말을 점수화. 정렬은 각 지표가 수행. */
export function scoreHoldout(
  model: LogisticModel,
  holdout: RaceRecord[],
  schema: string[]
): ScoredRace[] {
  return holdout.map((race) =>
    race.horses.map((h) => ({
      ord: h.ord,
      winOdds: h.winOdds,
      score: predictLogit(model, toVector(h.features, schema)),
    }))
  );
}

/** 연승: 모델 최고점 말이 3착내(ord 1~3). 분모=말 있는 경주. */
export function placeHitRate(races: ScoredRace[]): number {
  let hit = 0, n = 0;
  for (const race of races) {
    const top = [...race].sort((a, b) => b.score - a.score)[0];
    if (!top) continue;
    n++;
    if (top.ord >= 1 && top.ord <= 3) hit++;
  }
  return n ? hit / n : 0;
}

/** fade: 인기(winOdds 오름차순) 상위3 중 모델 최저점 말이 3착 밖(ord>3). 분모=인기후보≥2 경주. */
export function fadeHitRate(races: ScoredRace[]): number {
  let hit = 0, n = 0;
  for (const race of races) {
    const favs = race
      .filter((h) => h.winOdds != null && h.winOdds > 0)
      .sort((a, b) => a.winOdds! - b.winOdds!)
      .slice(0, 3);
    if (favs.length < 2) continue;
    const suspect = [...favs].sort((a, b) => a.score - b.score)[0]!;
    n++;
    if (suspect.ord > 3) hit++; // 3착 밖(취소·DNF 포함)
  }
  return n ? hit / n : 0;
}

/** 복승: 모델 상위2 집합이 실제 ord 1·2 둘 다 포함. 분모=실제 1·2위 둘 다 있는 경주. */
export function quinellaHitRate(races: ScoredRace[]): number {
  let hit = 0, n = 0;
  for (const race of races) {
    const has1 = race.some((h) => h.ord === 1);
    const has2 = race.some((h) => h.ord === 2);
    if (!has1 || !has2) continue;
    const top2 = [...race].sort((a, b) => b.score - a.score).slice(0, 2);
    if (top2.length < 2) continue;
    n++;
    const ords = new Set(top2.map((h) => h.ord));
    if (ords.has(1) && ords.has(2)) hit++;
  }
  return n ? hit / n : 0;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/gateMetrics.test.ts`
Expected: PASS (전부)

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/gateMetrics.ts src/engine/eval/gateMetrics.test.ts
git commit -m "feat(gate): holdout 3지표(연승·fade·복승) 순수 함수 + 테스트"
```

---

## Task 2: gates.ts — runGateB가 3지표 반환

**Files:**
- Modify: `src/engine/eval/gates.ts`

- [ ] **Step 1: import 추가**

`src/engine/eval/gates.ts` 상단 import 블록(`import type { RaceRecord } from './types.js';` 아래)에 추가:

```ts
import { scoreHoldout, placeHitRate, fadeHitRate, quinellaHitRate } from './gateMetrics.js';
```

- [ ] **Step 2: GateBResult에 필드 추가**

```ts
export interface GateBResult {
  itemId: string;
  include: boolean;
  delta: number;       // = placeDelta (하위호환·채택기준)
  withRate: number;
  withoutRate: number;
  fadeDelta: number;   // fade 개선량
  quinDelta: number;   // 복승 개선량
}
```

- [ ] **Step 3: runGateB 본문 — placeRate 클로저 제거, 3지표로 교체**

`runGateB` 안에서 기존 `placeRate` 내부 함수 정의(`function placeRate(...) { ... }` 블록 전체)를 **삭제**하고, 기준선·루프를 아래로 교체한다.

기존:
```ts
  // 기준선: 전체 피처 모델
  const modelAll = fitLogistic(trainX, trainY, allFeatures);
  const baseRate = placeRate(modelAll, gateHoldout, allFeatures);

  const results: GateBResult[] = [];
  for (const itemId of itemIds) {
    const itemFeats = allFeatures.filter((n) => featureToItem(n) === itemId);
    if (itemFeats.length === 0) {
      results.push({ itemId, include: false, delta: 0, withRate: baseRate, withoutRate: baseRate });
      continue;
    }

    // 해당 항목 제거한 스키마
    const reducedFeatures = allFeatures.filter((n) => featureToItem(n) !== itemId);

    const withoutX = gateTrain.flatMap((r) =>
      r.horses.map((h) => toVector(h.features, reducedFeatures))
    );
    const modelWithout = fitLogistic(withoutX, trainY, reducedFeatures);
    const withoutRate = placeRate(modelWithout, gateHoldout, reducedFeatures);
    const delta = baseRate - withoutRate;

    results.push({ itemId, include: delta > 0, delta, withRate: baseRate, withoutRate });
  }
  return results;
```

교체:
```ts
  // 기준선: 전체 피처 모델 → holdout 3지표
  const modelAll = fitLogistic(trainX, trainY, allFeatures);
  const baseScored = scoreHoldout(modelAll, gateHoldout, allFeatures);
  const basePlace = placeHitRate(baseScored);
  const baseFade = fadeHitRate(baseScored);
  const baseQuin = quinellaHitRate(baseScored);

  const results: GateBResult[] = [];
  for (const itemId of itemIds) {
    const itemFeats = allFeatures.filter((n) => featureToItem(n) === itemId);
    if (itemFeats.length === 0) {
      results.push({ itemId, include: false, delta: 0, withRate: basePlace, withoutRate: basePlace, fadeDelta: 0, quinDelta: 0 });
      continue;
    }

    // 해당 항목 제거한 스키마
    const reducedFeatures = allFeatures.filter((n) => featureToItem(n) !== itemId);

    const withoutX = gateTrain.flatMap((r) =>
      r.horses.map((h) => toVector(h.features, reducedFeatures))
    );
    const modelWithout = fitLogistic(withoutX, trainY, reducedFeatures);
    const woScored = scoreHoldout(modelWithout, gateHoldout, reducedFeatures);

    const placeDelta = basePlace - placeHitRate(woScored);
    const fadeDelta = baseFade - fadeHitRate(woScored);
    const quinDelta = baseQuin - quinellaHitRate(woScored);

    results.push({
      itemId,
      include: placeDelta > 0,
      delta: placeDelta,
      withRate: basePlace,
      withoutRate: basePlace - placeDelta,
      fadeDelta,
      quinDelta,
    });
  }
  return results;
```

> 참고: 삭제하는 `placeRate` 클로저는 `model`/`holdout`/`schema`를 받아 1순위 3착내율을 내던 함수다. `gateMetrics`의 `scoreHoldout`+`placeHitRate`가 동일 계산을 한다(연승 숫자 불변).

- [ ] **Step 4: 타입체크 + 기존 테스트**

Run: `npm run build && npm run test:run`
Expected: PASS (gates는 단위테스트 없음 — 빌드+기존 전체 통과로 확인)

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/gates.ts
git commit -m "feat(gate): runGateB가 fade·복승 delta 추가 반환 (연승 채택 기준 유지)"
```

---

## Task 3: report.ts — 3열 표

**Files:**
- Modify: `src/engine/eval/report.ts` (`printGateB`)

- [ ] **Step 1: printGateB 교체**

`src/engine/eval/report.ts`의 기존 `printGateB`:
```ts
export function printGateB(results: GateBResult[]): void {
  console.log('\n=== 항목 포함 현황 ===\n');
  console.log('항목                   │ Logistic/GBDT/PL │ 게이트B 개선량');
  console.log('─'.repeat(60));
  for (const r of [...results].sort((a, b) => b.delta - a.delta)) {
    const mark = r.include ? '✅ 포함  ' : '⚠️  제외  ';
    const sign = r.delta >= 0 ? '+' : '';
    console.log(
      `${r.itemId.padEnd(23)}│ ${mark.padEnd(16)}│ ${sign}${(r.delta * 100).toFixed(1)}%p`
    );
  }
}
```

교체:
```ts
export function printGateB(results: GateBResult[]): void {
  console.log('\n=== 항목 포함 현황 (연승 채택 / fade·복승 진단) ===\n');
  console.log('항목                   │ 채택      │   연승 │   fade │   복승');
  console.log('─'.repeat(66));
  const pct = (d: number) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%p`.padStart(7);
  for (const r of [...results].sort((a, b) => b.delta - a.delta)) {
    const mark = r.include ? '✅ 포함  ' : '⚠️  제외  ';
    console.log(
      `${r.itemId.padEnd(23)}│ ${mark.padEnd(9)}│ ${pct(r.delta)} │ ${pct(r.fadeDelta)} │ ${pct(r.quinDelta)}`
    );
  }
}
```

> `printGateB` import가 `GateBResult` 타입을 쓰면 이미 import돼 있다(기존 동작). 새 필드 접근만 추가됨.

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/engine/eval/report.ts
git commit -m "feat(gate): 게이트B 리포트 3열(연승·fade·복승)"
```

---

## Task 4: 통합 검증 (--gate-only)

**Files:** (실행·검증)

- [ ] **Step 1: 게이트만 빠르게 실행**

Run: `npm run benchmark -- --gate-only`
Expected: `=== 항목 포함 현황 ===` 표가 **연승·fade·복승 3열**로 출력. 각 피처군(med_bleed·med_fatigue·train_signal 포함)에 3개 %p가 찍힘.

- [ ] **Step 2: 연승 숫자 불변 확인**

이전 게이트B 표(예: `01_rating +3.0%p`)와 **연승 열이 동일**한지 대조. 동일해야 함(모델·계산 불변, 표시만 확장).
연승 열이 달라졌으면 `placeHitRate`가 기존 `placeRate`와 불일치 — Task 1 placeHitRate 로직 재점검.

- [ ] **Step 3: 의료 신호 재평가 기록**

med_bleed·med_fatigue의 fade·복승 delta를 확인. 의미 있는 양(+)이면 `docs/score_roadmap.md`·메모리 `project_medical_signals`에 "fade/복승 재평가 결과" 한 줄 추가. 모두 ~0이면 "3면 모두 기각" 확정 기록.

- [ ] **Step 4: Commit (문서 갱신 시)**

```bash
git add docs/
git commit -m "docs(gate): 3면 게이트로 의료 신호 재평가 결과 기록"
```

---

## Self-Review 메모

- **스펙 커버리지:** §3 정의(place/fade/quinella) → Task1 함수. §4 흐름(같은 ablation, holdout 재점수) → Task2. §5.1 gateMetrics → Task1. §5.2 gates → Task2. §5.3 report 3열 → Task3. §7 테스트 → Task1. §8 성공기준(3열·연승불변·의료재평가) → Task4. 모두 매핑됨.
- **타입 일관성:** `ScoredRace`/`ScoredHorse`(Task1) ↔ gates.ts 사용(Task2) 일치. `GateBResult` 새 필드 `fadeDelta`/`quinDelta`(Task2) ↔ report 접근(Task3) 일치. `LogisticModel`·`predictLogit`·`toVector`·`RaceRecord` 실제 export명 사용.
- **placeholder:** 없음. 모든 코드 단계 완전 코드 포함.
- **하위호환:** `GateBResult.delta`·`include` 유지 → `benchmark_all.ts` 무변경. 연승 채택 로직 불변.
