# 롤링 벤치마크 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `benchmark_all.ts`를 고정분할에서 롤링 확장윈도우로 바꾸고 walkforward의 시장 깊은 진단·챔피언 대결을 흡수한 뒤 walkforward를 삭제한다.

**Architecture:** 560줄 단일 스크립트를 `src/engine/eval/` 모듈군으로 분리(행동 불변) → 모델 타입 통합 채점(`scoreHorse`) → 롤링 루프 → 시장 진단 → 챔피언 로딩 순으로 쌓는다. 데이터는 DuckDB 로컬 미러만 사용(Supabase REST 0호출). 챔피언 가중치/계수는 DuckDB의 `model_versions`에서 읽는다.

**Tech Stack:** TypeScript, tsx, vitest, @duckdb/node-api (로컬 미러), 순수 TS 모델(logistic/gbdt/plackettLuce).

**선행 완료(이번 브랜치):** `unwrapDuck`(jsonb→객체) 수정, `benchmark_all.ts` import 가드. 둘 다 이 플랜의 전제.

**스펙:** `docs/superpowers/specs/2026-06-14-rolling-benchmark-integration-design.md`

---

## File Structure

신규 모듈 (`src/engine/eval/`):

| 파일 | 책임 |
|---|---|
| `types.ts` | `RaceRecord`·`HorseRecord` 등 공유 타입 |
| `collect.ts` | `collectRaces` (DuckDB → RaceRecord[]) |
| `gates.ts` | `runGateA`/`printGateA`/`runGateB`/`printGateB` (피처 스크리닝) |
| `models.ts` | `learnSpearman`·`trainAllModels`·`TrainedModels` |
| `score.ts` | ★신규 `scoreHorse(model, horse)` — 모델 타입별 채점 dispatch |
| `rolling.ts` | ★신규 분기 확장윈도우 루프 + 집계 |
| `market.ts` | ★신규(walkforward 이식) 불일치·순위별·상위3묶음 진단 |
| `champion.ts` | ★신규 `model_versions` 로드 + 챔피언 채점 어댑터 |
| `report.ts` | ASCII 리포트 출력 |

오케스트레이터: `scripts/benchmark_all.ts` (얇게 — 인자 파싱 → eval 모듈 호출).

삭제: `scripts/walkforward_eval.ts`, `package.json`의 `walkforward` 스크립트.

---

## 공유 타입 계약 (모든 Task가 따른다)

```typescript
// src/engine/eval/types.ts
import type { Feature } from '../features/types.js';

export interface HorseRecord {
  hrName: string;
  pthrNo: number;
  ord: number;
  winOdds: number | null;
  rawScores: Record<string, number>;  // ScoreItem id → rawScore (Spearman/ρ용)
  features: Feature[];                 // buildFeatures 결과 (logistic/gbdt/pl용)
}

export interface RaceRecord {
  raceDate: number;  // YYYYMMDD
  meet: number;
  rcNo: number;
  horses: HorseRecord[];
}
```

```typescript
// 모델 채점 통합 인터페이스 (score.ts에서 정의)
export type ScorableModel =
  | { kind: 'weights'; weights: Record<string, number> }              // ρ / rho-legacy
  | { kind: 'logistic'; model: import('../models/logistic.js').LogisticModel }
  | { kind: 'gbdt'; model: ReturnType<typeof import('../models/gbdt.js').fitGBDT>; schema: string[] }
  | { kind: 'pl'; model: ReturnType<typeof import('../models/plackettLuce.js').fitPL>; schema: string[] };
```

---

## Task 1: 순수 모듈 추출 (행동 불변 리팩터)

**목적:** `benchmark_all.ts`의 검증된 로직을 `src/engine/eval/`로 이동. 출력·동작 동일.

**Files:**
- Create: `src/engine/eval/types.ts`, `collect.ts`, `gates.ts`, `models.ts`, `report.ts`
- Modify: `scripts/benchmark_all.ts` (이동한 코드를 import로 대체)

- [ ] **Step 1: 추출 전 기준 출력 캡처**

Run: `npx tsx scripts/benchmark_all.ts > /tmp/bench_before.txt 2>&1`
Expected: 정상 종료(exit 0), 연승율 표 + Gate B 표 포함. 이 파일이 회귀 기준.

- [ ] **Step 2: `types.ts` 생성**

위 "공유 타입 계약"의 `HorseRecord`·`RaceRecord`를 `src/engine/eval/types.ts`에 작성.

- [ ] **Step 3: `collect.ts` 생성**

`benchmark_all.ts`의 `collectRaces`(현재 파일 L46-108)를 `src/engine/eval/collect.ts`로 이동. import 조정:
```typescript
import type { ReadClient } from '../../db/localDb.js';
import { gatherRaceInputs } from '../scorePredictor.js';
import { ScoreEngine } from '../index.js';
import { buildFeatures } from '../features/buildFeatures.js';
import type { RaceRecord, HorseRecord } from './types.js';
export { /* collectRaces */ };
```
함수 본문은 기존과 동일. `RaceRecord`/`HorseRecord`는 `types.js`에서 import.

- [ ] **Step 4: `gates.ts` 생성**

`benchmark_all.ts`의 `pearson`·`GateAWarning`·`runGateA`·`printGateA`·`GateBResult`·`runGateB`·`printGateB`(L110-282)를 `src/engine/eval/gates.ts`로 이동. import:
```typescript
import { featureToItem } from '../features/featureItemMap.js';
import { buildSchema, toVector } from '../features/alignFeatures.js';
import { fitLogistic, predictLogit } from '../models/logistic.js';
import type { RaceRecord } from './types.js';
```
`runGateB` 내부 상수 `GATE_B_HOLDOUT_START=20251001`·`GATE_B_HOLDOUT_END=20251231` 유지.

- [ ] **Step 5: `models.ts` 생성**

`spearmanRho`·`learnSpearman`·`TrainedModels`·`trainAllModels`(L286-395)를 `src/engine/eval/models.ts`로 이동. import:
```typescript
import { buildSchema, toVector } from '../features/alignFeatures.js';
import { featureToItem } from '../features/featureItemMap.js';
import { fitLogistic } from '../models/logistic.js';
import { fitGBDT } from '../models/gbdt.js';
import { fitPL } from '../models/plackettLuce.js';
import type { RaceRecord } from './types.js';
```

- [ ] **Step 6: `report.ts` 생성**

`RaceResult`·`MethodTally`·`emptyTally`·`quarterOf`·`METHOD_KEYS`·`MethodKey`·`evaluateRace`·`evaluate`·`METHOD_LABELS`·`pct`·`printReport`(L397-542)를 `src/engine/eval/report.ts`로 이동. import:
```typescript
import { toVector } from '../features/alignFeatures.js';
import { predictLogit } from '../models/logistic.js';
import { predictGBDT } from '../models/gbdt.js';
import { predictPL } from '../models/plackettLuce.js';
import type { RaceRecord, HorseRecord } from './types.js';
import type { TrainedModels } from './models.js';
import type { GateBResult } from './gates.js';
```

- [ ] **Step 7: `benchmark_all.ts`를 얇게 — 이동분 import로 대체**

`scripts/benchmark_all.ts`에서 이동한 모든 정의를 삭제하고 상단을 다음으로 교체(main()과 import 가드는 유지):
```typescript
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { runGateA, printGateA, runGateB, printGateB } from '../src/engine/eval/gates.js';
import { trainAllModels } from '../src/engine/eval/models.js';
import { evaluate, printReport } from '../src/engine/eval/report.js';
```
`main()` 본문(L546-576)은 그대로 둔다.

- [ ] **Step 8: 타입체크**

Run: `npm run build`
Expected: 에러 없음.

- [ ] **Step 9: 출력 동일성 회귀 확인**

Run: `npx tsx scripts/benchmark_all.ts > /tmp/bench_after.txt 2>&1 && diff /tmp/bench_before.txt /tmp/bench_after.txt`
Expected: diff 출력 없음(완전 동일). 차이 있으면 추출 중 깨진 것 → 수정.

- [ ] **Step 10: 기존 테스트 통과 확인**

Run: `npm run test:run`
Expected: 전부 통과(305 내외, 회귀 0).

- [ ] **Step 11: Commit**

```bash
git add src/engine/eval/ scripts/benchmark_all.ts
git commit -m "refactor(eval): benchmark_all → src/engine/eval/ 모듈 분리 (행동 불변)"
```

---

## Task 2: 통합 모델 채점 `scoreHorse`

**목적:** ρ가중치·logistic·gbdt·pl을 한 함수로 채점 → 롤링·시장·챔피언이 공유.

**Files:**
- Create: `src/engine/eval/score.ts`, `src/engine/eval/score.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/engine/eval/score.test.ts
import { describe, it, expect } from 'vitest';
import { scoreHorse, rankHorses } from './score.js';
import type { HorseRecord } from './types.js';

const h = (over: Partial<HorseRecord>): HorseRecord => ({
  hrName: 'x', pthrNo: 1, ord: 1, winOdds: null,
  rawScores: {}, features: [], ...over,
});

describe('scoreHorse', () => {
  it('weights 모델: rawScores·weights 내적', () => {
    const horse = h({ rawScores: { a: 2, b: 3 } });
    const s = scoreHorse({ kind: 'weights', weights: { a: 1, b: 10 } }, horse);
    expect(s).toBe(2 * 1 + 3 * 10);
  });

  it('logistic 모델: model.features 스키마로 predictLogit', () => {
    const model = {
      type: 'logistic' as const, features: ['f1'], means: [0], stds: [1],
      coef: { f1: 2 }, intercept: 0,
    };
    const horse = h({ features: [{ name: 'f1', value: 3 }] as any });
    const s = scoreHorse({ kind: 'logistic', model }, horse);
    expect(s).toBeCloseTo(6); // 0 + 2 * ((3-0)/1)
  });

  it('rankHorses: 점수 내림차순 정렬', () => {
    const a = h({ hrName: 'a', rawScores: { s: 1 } });
    const b = h({ hrName: 'b', rawScores: { s: 5 } });
    const ranked = rankHorses({ kind: 'weights', weights: { s: 1 } }, [a, b]);
    expect(ranked.map((x) => x.hrName)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/score.test.ts`
Expected: FAIL ("Cannot find module './score.js'").

- [ ] **Step 3: 구현**

```typescript
// src/engine/eval/score.ts
import { toVector } from '../features/alignFeatures.js';
import { predictLogit, type LogisticModel } from '../models/logistic.js';
import { predictGBDT, fitGBDT } from '../models/gbdt.js';
import { predictPL, fitPL } from '../models/plackettLuce.js';
import type { HorseRecord } from './types.js';

export type ScorableModel =
  | { kind: 'weights'; weights: Record<string, number> }
  | { kind: 'logistic'; model: LogisticModel }
  | { kind: 'gbdt'; model: ReturnType<typeof fitGBDT>; schema: string[] }
  | { kind: 'pl'; model: ReturnType<typeof fitPL>; schema: string[] };

/** 한 마리 종합점수 (높을수록 1순위). 정렬 비교용 — 절대 스케일 의미 없음. */
export function scoreHorse(m: ScorableModel, h: HorseRecord): number {
  switch (m.kind) {
    case 'weights': {
      let s = 0;
      for (const [id, w] of Object.entries(m.weights)) s += (h.rawScores[id] ?? 0) * w;
      return s;
    }
    case 'logistic':
      // predictLogit은 model.features 순서의 벡터를 기대
      return predictLogit(m.model, toVector(h.features, m.model.features));
    case 'gbdt':
      return predictGBDT(m.model, toVector(h.features, m.schema));
    case 'pl':
      return predictPL(m.model, toVector(h.features, m.schema));
  }
}

/** 종합점수 내림차순 정렬 (원본 불변). */
export function rankHorses(m: ScorableModel, horses: HorseRecord[]): HorseRecord[] {
  return [...horses].sort((a, b) => scoreHorse(m, b) - scoreHorse(m, a));
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/score.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/score.ts src/engine/eval/score.test.ts
git commit -m "feat(eval): 모델 타입 통합 채점 scoreHorse/rankHorses"
```

---

## Task 3: 롤링 확장윈도우

**목적:** 고정 train/test 대신 분기마다 그 시점까지 데이터로 9모델 재학습 → 해당 분기 평가. look-ahead 누수 차단.

**Files:**
- Create: `src/engine/eval/rolling.ts`, `src/engine/eval/rolling.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (look-ahead 누수 차단 검증)**

```typescript
// src/engine/eval/rolling.test.ts
import { describe, it, expect } from 'vitest';
import { quarterKey, splitByQuarter, rollingBlocks } from './rolling.js';
import type { RaceRecord } from './types.js';

const race = (raceDate: number): RaceRecord => ({
  raceDate, meet: 1, rcNo: 1,
  horses: [
    { hrName: 'a', pthrNo: 1, ord: 1, winOdds: 2, rawScores: {}, features: [] },
    { hrName: 'b', pthrNo: 2, ord: 2, winOdds: 3, rawScores: {}, features: [] },
    { hrName: 'c', pthrNo: 3, ord: 3, winOdds: 5, rawScores: {}, features: [] },
  ],
});

describe('quarterKey', () => {
  it('YYYYMMDD → YYYY-Qn', () => {
    expect(quarterKey(20250105)).toBe('2025-Q1');
    expect(quarterKey(20250715)).toBe('2025-Q3');
    expect(quarterKey(20251231)).toBe('2025-Q4');
  });
});

describe('rollingBlocks', () => {
  it('각 테스트 분기의 train은 그 분기 시작 이전만 (누수 없음)', () => {
    const races = [race(20240601), race(20250105), race(20250705)];
    const blocks = rollingBlocks(races, { year: 2025, q: 1 });
    // 2025-Q1 블록: train은 raceDate < 20250101 (2024-06만), test는 2025-Q1
    const q1 = blocks.find((b) => b.key === '2025-Q1')!;
    expect(q1.train.every((r) => r.raceDate < 20250101)).toBe(true);
    expect(q1.test.every((r) => quarterKey(r.raceDate) === '2025-Q1')).toBe(true);
    // 2025-Q3 블록: train에 2025-Q1 포함(확장), test는 2025-Q3
    const q3 = blocks.find((b) => b.key === '2025-Q3')!;
    expect(q3.train.some((r) => r.raceDate === 20250105)).toBe(true);
    expect(q3.train.every((r) => r.raceDate < 20250701)).toBe(true);
  });

  it('첫 테스트 분기 이전(부트스트랩) 분기는 test 블록으로 안 만든다', () => {
    const races = [race(20240601), race(20250105)];
    const blocks = rollingBlocks(races, { year: 2025, q: 1 });
    expect(blocks.find((b) => b.key === '2024-Q2')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/rolling.test.ts`
Expected: FAIL ("Cannot find module './rolling.js'").

- [ ] **Step 3: 구현**

```typescript
// src/engine/eval/rolling.ts
import type { RaceRecord } from './types.js';

export interface YearQuarter { year: number; q: number; }
export interface RollingBlock { key: string; blockStart: number; train: RaceRecord[]; test: RaceRecord[]; }

export function quarterKey(raceDate: number): string {
  const y = Math.floor(raceDate / 10000);
  const m = Math.floor((raceDate % 10000) / 100);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/** YYYY-Qn의 시작 YYYYMMDD (포함 경계) */
export function quarterStart(year: number, q: number): number {
  return year * 10000 + ((q - 1) * 3 + 1) * 100 + 1;
}

export function splitByQuarter(races: RaceRecord[]): Map<string, RaceRecord[]> {
  const m = new Map<string, RaceRecord[]>();
  for (const r of races) {
    const k = quarterKey(r.raceDate);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  return m;
}

/**
 * 확장윈도우 블록 목록. firstTest 이상인 분기마다:
 *   train = raceDate < 분기시작 인 모든 경주 (확장)
 *   test  = 해당 분기 경주
 * firstTest 이전 분기는 부트스트랩(학습에만 쓰임, test 블록 없음).
 */
export function rollingBlocks(races: RaceRecord[], firstTest: YearQuarter): RollingBlock[] {
  const byQ = splitByQuarter(races);
  const firstStart = quarterStart(firstTest.year, firstTest.q);
  const blocks: RollingBlock[] = [];
  for (const key of [...byQ.keys()].sort()) {
    const [yStr, qStr] = key.split('-Q');
    const blockStart = quarterStart(Number(yStr), Number(qStr));
    if (blockStart < firstStart) continue; // 부트스트랩 분기 skip
    blocks.push({
      key, blockStart,
      train: races.filter((r) => r.raceDate < blockStart),
      test: byQ.get(key)!,
    });
  }
  return blocks;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/rolling.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/rolling.ts src/engine/eval/rolling.test.ts
git commit -m "feat(eval): 롤링 확장윈도우 블록 분할 (look-ahead 차단)"
```

---

## Task 4: 시장 깊은 진단 (walkforward 이식)

**목적:** 불일치 구간·순위별 연승·상위3 묶음 교집합을 `HorseRecord` + `ScorableModel` 기반으로 재구현.

**Files:**
- Create: `src/engine/eval/market.ts`, `src/engine/eval/market.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/engine/eval/market.test.ts
import { describe, it, expect } from 'vitest';
import { rankByOdds, marketDiagnostics } from './market.js';
import type { RaceRecord, HorseRecord } from './types.js';
import type { ScorableModel } from './score.js';

const H = (n: string, ord: number, odds: number | null, s: number): HorseRecord =>
  ({ hrName: n, pthrNo: 0, ord, winOdds: odds, rawScores: { s }, features: [] });

// 모델이 점수 s로 정렬되도록
const model: ScorableModel = { kind: 'weights', weights: { s: 1 } };

describe('rankByOdds', () => {
  it('win_odds 오름차순, 무효 배당 제외', () => {
    const hs = [H('a', 1, 5, 0), H('b', 2, 2, 0), H('c', 3, null, 0)];
    expect(rankByOdds(hs).map((h) => h.hrName)).toEqual(['b', 'a']);
  });
});

describe('marketDiagnostics', () => {
  it('순위별 연승: 1순위 픽이 3착내인 비율', () => {
    // race1: 모델 1순위(s=9, 실제 1착) → 적중 / race2: 모델 1순위(s=9, 실제 5착) → 실패
    const r1: RaceRecord = { raceDate: 20250101, meet: 1, rcNo: 1,
      horses: [H('a', 1, 2, 9), H('b', 2, 3, 5), H('c', 3, 5, 1)] };
    const r2: RaceRecord = { raceDate: 20250101, meet: 1, rcNo: 2,
      horses: [H('a', 5, 2, 9), H('b', 1, 3, 5), H('c', 2, 5, 1)] };
    const d = marketDiagnostics([r1, r2], model);
    expect(d.rankModel[0].n).toBe(2);
    expect(d.rankModel[0].hit).toBe(1); // r1만 적중
  });

  it('불일치: 모델 1순위 ≠ 인기1위인 경주만 집계', () => {
    // 모델 1순위=a(s=9), 인기1위=b(odds 최저) → 불일치
    const r: RaceRecord = { raceDate: 20250101, meet: 1, rcNo: 1,
      horses: [H('a', 1, 5, 9), H('b', 2, 2, 1)] };
    const d = marketDiagnostics([r], model);
    expect(d.disModel.n).toBe(1);
    expect(d.disModel.show).toBe(1); // 모델픽 a가 1착=3착내
    expect(d.disFav.show).toBe(0);   // 인기픽 b는 2착이지만 show=ord≤3 → 실제 1.. 주의
  });
});
```

참고: `disFav.show`는 ord≤3이면 1. 위 b는 ord=2라 show=1이 맞다. 테스트 기대값을 실제 규칙(show=ord≤3)에 맞춰 작성:
```typescript
    expect(d.disFav.show).toBe(1);   // b는 2착 → 3착내
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/market.test.ts`
Expected: FAIL ("Cannot find module './market.js'").

- [ ] **Step 3: 구현**

```typescript
// src/engine/eval/market.ts
import type { RaceRecord, HorseRecord } from './types.js';
import { rankHorses, type ScorableModel } from './score.js';

export interface Tally { win: number; place: number; show: number; n: number; }
const empty = (): Tally => ({ win: 0, place: 0, show: 0, n: 0 });
function add(t: Tally, ord: number | null) {
  if (ord === null || ord > 50) return;
  t.n++;
  if (ord === 1) t.win++;
  if (ord <= 2) t.place++;
  if (ord <= 3) t.show++;
}
const isShow = (ord: number | null | undefined) => ord != null && ord >= 1 && ord <= 3;

/** win_odds 오름차순(인기순), 유효 배당만. */
export function rankByOdds(horses: HorseRecord[]): HorseRecord[] {
  return horses
    .filter((h) => h.winOdds != null && h.winOdds > 0)
    .sort((a, b) => (a.winOdds as number) - (b.winOdds as number));
}

export interface MarketDiag {
  model: Tally;            // 모델 1순위 픽
  market: Tally;           // 인기1위 픽
  disModel: Tally;         // 불일치 구간 모델픽
  disFav: Tally;           // 불일치 구간 인기픽
  rankModel: { hit: number; n: number }[]; // 1·2·3순위 픽의 연승
  rankMkt: { hit: number; n: number }[];
  setModelSum: number; setMktSum: number; setN: number; // 상위3 묶음 교집합
}

/** 한 경주 집합에 대해 모델 vs 시장 깊은 진단. model로 채점, win_odds로 시장순위. */
export function marketDiagnostics(races: RaceRecord[], model: ScorableModel): MarketDiag {
  const d: MarketDiag = {
    model: empty(), market: empty(), disModel: empty(), disFav: empty(),
    rankModel: [0, 0, 0].map(() => ({ hit: 0, n: 0 })),
    rankMkt: [0, 0, 0].map(() => ({ hit: 0, n: 0 })),
    setModelSum: 0, setMktSum: 0, setN: 0,
  };
  for (const race of races) {
    const modelOrder = rankHorses(model, race.horses);
    const mktOrder = rankByOdds(race.horses);
    const mPick = modelOrder[0] ?? null;
    const fPick = mktOrder[0] ?? null;
    add(d.model, mPick?.ord ?? null);
    add(d.market, fPick?.ord ?? null);
    if (mPick && fPick && mPick.hrName !== fPick.hrName) {
      add(d.disModel, mPick.ord);
      add(d.disFav, fPick.ord);
    }
    for (let k = 0; k < 3; k++) {
      const mh = modelOrder[k];
      if (mh) { d.rankModel[k]!.n++; if (isShow(mh.ord)) d.rankModel[k]!.hit++; }
      const fh = mktOrder[k];
      if (fh) { d.rankMkt[k]!.n++; if (isShow(fh.ord)) d.rankMkt[k]!.hit++; }
    }
    const actualTop3 = new Set(race.horses.filter((h) => isShow(h.ord)).map((h) => h.hrName));
    if (actualTop3.size > 0) {
      d.setN++;
      d.setModelSum += modelOrder.slice(0, 3).filter((h) => actualTop3.has(h.hrName)).length;
      d.setMktSum += mktOrder.slice(0, 3).filter((h) => actualTop3.has(h.hrName)).length;
    }
  }
  return d;
}

export function printMarketDiag(d: MarketDiag): void {
  const pct = (a: number, n: number) => (n ? ((a / n) * 100).toFixed(1) : '-');
  console.log('-'.repeat(76));
  console.log(`[시장] 인기1위 — 연승 ${pct(d.market.show, d.market.n)} / 단승 ${pct(d.market.win, d.market.n)}  (n=${d.market.n})`);
  if (d.model.n && d.market.n) {
    const diff = ((d.model.show / d.model.n) - (d.market.show / d.market.n)) * 100;
    console.log(`  → 모델 연승 − 시장 연승 = ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p`);
  }
  console.log(`[불일치] 모델1순위≠인기1위: ${d.disModel.n}건`);
  if (d.disModel.n) {
    console.log(`  모델픽 연승 ${pct(d.disModel.show, d.disModel.n)} / 인기픽 연승 ${pct(d.disFav.show, d.disFav.n)}`);
    const edge = ((d.disModel.show / d.disModel.n) - (d.disFav.show / d.disFav.n)) * 100;
    console.log(`  → 엇갈릴 때 우위 ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%p ${edge >= 0 ? '(부가가치 O)' : '(부가가치 X)'}`);
  }
  console.log('[순위별 연승] 1·2·3순위 픽이 3착내 비율');
  console.log(`  모델 | ${d.rankModel.map((r) => pct(r.hit, r.n).padStart(5)).join(' | ')}`);
  console.log(`  시장 | ${d.rankMkt.map((r) => pct(r.hit, r.n).padStart(5)).join(' | ')}`);
  if (d.setN) {
    console.log(`[상위3 묶음] 모델 ${(d.setModelSum / d.setN).toFixed(2)}마리 / 시장 ${(d.setMktSum / d.setN).toFixed(2)}마리`);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/market.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/market.ts src/engine/eval/market.test.ts
git commit -m "feat(eval): 시장 깊은 진단(불일치·순위별·묶음) HorseRecord 기반 이식"
```

---

## Task 5: 챔피언 로딩 (`model_versions` from DuckDB)

**목적:** 활성/지정 버전을 DuckDB에서 읽어 `ScorableModel`로 변환. logistic이면 artifact, 아니면 weights. artifact 비면 weights로 폴백(점진 이행).

**Files:**
- Create: `src/engine/eval/champion.ts`, `src/engine/eval/champion.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/engine/eval/champion.test.ts
import { describe, it, expect } from 'vitest';
import { toScorableModel } from './champion.js';

describe('toScorableModel', () => {
  it('logistic + 유효 artifact → kind=logistic', () => {
    const row = {
      id: 6, label: 'v6', model_type: 'logistic',
      weights: { a: 1 },
      artifact: { type: 'logistic', features: ['f1'], means: [0], stds: [1], coef: { f1: 2 }, intercept: 0 },
    };
    const m = toScorableModel(row);
    expect(m.kind).toBe('logistic');
  });

  it('logistic이지만 artifact 비면 weights 폴백 + 경고', () => {
    const row = { id: 5, label: 'v5', model_type: 'logistic', weights: { a: 1 }, artifact: null };
    const m = toScorableModel(row);
    expect(m).toEqual({ kind: 'weights', weights: { a: 1 } });
  });

  it('rho-legacy → weights', () => {
    const row = { id: 1, label: 'v1', model_type: 'rho-legacy', weights: { a: 1 }, artifact: null };
    expect(toScorableModel(row)).toEqual({ kind: 'weights', weights: { a: 1 } });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/champion.test.ts`
Expected: FAIL ("Cannot find module './champion.js'").

- [ ] **Step 3: 구현**

```typescript
// src/engine/eval/champion.ts
import type { ReadClient } from '../../db/localDb.js';
import type { LogisticModel } from '../models/logistic.js';
import type { ScorableModel } from './score.js';

export interface VersionRow {
  id: number; label: string; model_type: string;
  weights: Record<string, number> | null;
  artifact: LogisticModel | null;
}

/** model_versions 한 행 → ScorableModel. logistic+artifact면 logistic, 아니면 weights 폴백. */
export function toScorableModel(row: VersionRow): ScorableModel {
  const a = row.artifact;
  if (row.model_type === 'logistic' && a && Array.isArray(a.features) && a.features.length > 0) {
    return { kind: 'logistic', model: a };
  }
  if (row.model_type === 'logistic') {
    console.warn(`  ⚠️  버전 ${row.id}(${row.label}) logistic이나 artifact 없음 → weights 폴백`);
  }
  return { kind: 'weights', weights: row.weights ?? {} };
}

/** 활성(is_active) 또는 id 지정 버전을 DuckDB에서 로드. */
export async function loadVersion(
  db: ReadClient, by: { id?: number } = {}
): Promise<{ row: VersionRow; model: ScorableModel } | null> {
  let q = db.from('model_versions').select('id, label, model_type, weights, artifact');
  q = by.id !== undefined ? q.eq('id', by.id) : q.eq('is_active', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as VersionRow;
  return { row, model: toScorableModel(row) };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/champion.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 실제 DuckDB 스모크 (선택, 로컬 미러 있을 때)**

Run: 임시 스크립트로 `loadVersion(db)` 호출 → `model.kind === 'logistic'`, 활성 id=6 확인.
Expected: id=6, kind=logistic. (data/local.duckdb 없으면 skip)

- [ ] **Step 6: Commit**

```bash
git add src/engine/eval/champion.ts src/engine/eval/champion.test.ts
git commit -m "feat(eval): model_versions 챔피언 로딩 + ScorableModel 변환(artifact 폴백)"
```

---

## Task 6: `main()` 롤링 통합 배선 + CLI

**목적:** Gate A/B(1회) → 롤링 9모델 + 챔피언 + 시장 진단을 한 실행으로. CLI 플래그.

**Files:**
- Modify: `scripts/benchmark_all.ts` (main 재작성)
- Modify: `src/engine/eval/report.ts` (분기별 롤링 표 출력 함수 추가)

- [ ] **Step 1: `report.ts`에 롤링 표 출력 추가**

```typescript
// src/engine/eval/report.ts 에 추가
import type { MethodKey, MethodTally } from './report.js'; // (동일 파일 내 기존 타입 재사용)

export interface RollingRow { method: string; byQuarter: Map<string, MethodTally>; overall: MethodTally; }

export function printRollingTable(rows: RollingRow[], quarters: string[]): void {
  const pct = (n: number, d: number) => (d ? `${(n / d * 100).toFixed(1)}%` : '-');
  console.log('\n=== 롤링 연승율 (분기별, 1순위 픽 3착내) ===\n');
  const header = '방법'.padEnd(20) + '│' + quarters.map((q) => ` ${q} `).join('│') + '│ 전체';
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const r of rows) {
    const cells = quarters.map((q) => {
      const t = r.byQuarter.get(q);
      return ` ${(t ? pct(t.show, t.n) : '-').padStart(6)} `;
    }).join('│');
    console.log(r.method.padEnd(20) + '│' + cells + '│ ' + pct(r.overall.show, r.overall.n));
  }
}
```
주의: `MethodTally`에 `show` 필드가 없다면(현재 `win/place/quinella`) `report.ts`의 집계를 `show=place(ord≤3)` 의미로 통일하거나 롤링 전용 `Tally`(market.ts의 것)를 재사용한다. **롤링·시장은 `market.ts`의 `Tally`(win/place/show/n)를 공통 사용**하도록 맞춘다.

- [ ] **Step 2: `main()` 재작성**

```typescript
// scripts/benchmark_all.ts (main 교체)
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { runGateA, printGateA, runGateB, printGateB } from '../src/engine/eval/gates.js';
import { trainAllModels } from '../src/engine/eval/models.js';
import { rollingBlocks, quarterKey } from '../src/engine/eval/rolling.js';
import { marketDiagnostics, printMarketDiag, type Tally } from '../src/engine/eval/market.js';
import { rankHorses, type ScorableModel } from '../src/engine/eval/score.js';
import { loadVersion } from '../src/engine/eval/champion.js';
import { printRollingTable, type RollingRow } from '../src/engine/eval/report.js';
import { pathToFileURL } from 'node:url';

const FIRST_TEST = { year: 2025, q: 1 };

function emptyTally(): Tally { return { win: 0, place: 0, show: 0, n: 0 }; }
function addTally(t: Tally, ord: number | null) {
  if (ord === null || ord > 50) return;
  t.n++; if (ord === 1) t.win++; if (ord <= 2) t.place++; if (ord <= 3) t.show++;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const gateOnly = args.includes('--gate-only');
  const noGate = args.includes('--no-gate');
  const champIdx = args.indexOf('--champion');
  const championId = champIdx >= 0 ? Number(args[champIdx + 1]) : undefined;

  const db = await getLocalDb();
  console.log('📊 Rolling Benchmark 시작\n데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);

  // Gate A/B (1회) — 고정 holdout
  let approved: Set<string>;
  if (noGate) {
    approved = new Set(races.flatMap((r) => r.horses.flatMap((h) => Object.keys(h.rawScores))));
  } else {
    console.log('\n[게이트 A]'); printGateA(runGateA(races));
    console.log('\n[게이트 B]');
    const gb = runGateB(races); printGateB(gb);
    approved = new Set(gb.filter((g) => g.include).map((g) => g.itemId));
  }
  if (gateOnly) return;

  // 챔피언 로드 (DuckDB)
  const champ = await loadVersion(db, championId !== undefined ? { id: championId } : {});
  if (!champ) throw new Error('챔피언 버전 없음');
  console.log(`\n챔피언: ${champ.row.label} (id=${champ.row.id}, kind=${champ.model.kind})`);

  // 롤링: 분기마다 9모델 재학습 + 평가
  const blocks = rollingBlocks(races, FIRST_TEST);
  const quarters = blocks.map((b) => b.key);
  // 방법별 분기 tally
  const methods = ['시장', '챔피언', 'Spearman', 'Logistic(t2)', 'GBDT(t2)', 'PL'] as const;
  const tallies = new Map<string, Map<string, Tally>>(methods.map((m) => [m, new Map()]));
  const overall = new Map<string, Tally>(methods.map((m) => [m, emptyTally()]));

  // 시장 진단은 챔피언 모델 기준으로 전체 test 구간 누적
  const allTest = blocks.flatMap((b) => b.test);

  for (const block of blocks) {
    console.log(`  [${block.key}] train=${block.train.length} test=${block.test.length} 학습중...`);
    const tm = trainAllModels(block.train, approved);
    const scorers: Record<string, ScorableModel> = {
      '챔피언': champ.model,
      'Spearman': { kind: 'weights', weights: tm.spearmanWeights },
      'Logistic(t2)': { kind: 'logistic', model: tm.logisticTop2 },
      'GBDT(t2)': { kind: 'gbdt', model: tm.gbdtTop2, schema: tm.featureSchema },
      'PL': { kind: 'pl', model: tm.pl, schema: tm.featureSchema },
    };
    for (const race of block.test) {
      // 시장
      const favorite = [...race.horses].filter((h) => h.winOdds && h.winOdds > 0)
        .sort((a, b) => (a.winOdds as number) - (b.winOdds as number))[0] ?? null;
      for (const m of methods) {
        const t = tallies.get(m)!; if (!t.has(block.key)) t.set(block.key, emptyTally());
        let pickOrd: number | null;
        if (m === '시장') pickOrd = favorite?.ord ?? null;
        else pickOrd = rankHorses(scorers[m]!, race.horses)[0]?.ord ?? null;
        addTally(t.get(block.key)!, pickOrd);
        addTally(overall.get(m)!, pickOrd);
      }
    }
  }

  const rows: RollingRow[] = methods.map((m) => ({
    method: m, byQuarter: tallies.get(m)!, overall: overall.get(m)!,
  }));
  printRollingTable(rows, quarters);

  // 시장 깊은 진단 (챔피언 기준, 전체 test)
  console.log('\n=== 시장 깊은 진단 (챔피언 vs 시장) ===');
  printMarketDiag(marketDiagnostics(allTest, champ.model));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('💥', e); process.exit(1); });
}
```

- [ ] **Step 3: 타입체크**

Run: `npm run build`
Expected: 에러 없음. (RollingRow·Tally·MethodTally 타입 정합 확인 — 불일치 시 report.ts의 RollingRow가 market.ts Tally를 쓰도록 import 정리)

- [ ] **Step 4: 실제 실행 (로컬 미러)**

Run: `npx tsx scripts/benchmark_all.ts > /tmp/rolling.txt 2>&1; echo "exit=$?"`
Expected: exit=0. 출력에 분기별 표(2025-Q1~2026-Qn) + 챔피언 행 + 시장 깊은 진단 포함. 챔피언 연승이 Task 이전 benchmark의 Logistic(62.5%)과 같은 수준인지 눈으로 확인.

- [ ] **Step 5: 빠른 모드 확인**

Run: `npx tsx scripts/benchmark_all.ts --gate-only` / `--no-gate` / `--champion 1`
Expected: 각각 Gate만 / Gate 생략 후 롤링 / id=1 챔피언으로 비교.

- [ ] **Step 6: Commit**

```bash
git add scripts/benchmark_all.ts src/engine/eval/report.ts
git commit -m "feat(eval): main 롤링 통합 — 9모델 롤링 + 챔피언 대결 + 시장 진단 + CLI"
```

---

## Task 7: walkforward 삭제 + 문서 갱신

**목적:** 중복 도구 제거, 문서를 "통합 완료" 상태로.

**Files:**
- Delete: `scripts/walkforward_eval.ts`
- Modify: `package.json`, `docs/pipeline_guide.md`, `docs/accuracy_metrics.md`, `docs/data_flow.md`, `CLAUDE.md`

- [ ] **Step 1: walkforward 참조 전수 확인**

Run: `grep -rn "walkforward" scripts package.json docs CLAUDE.md`
Expected: 참조 목록. 모두 처리 대상.

- [ ] **Step 2: 스크립트·package.json 삭제**

```bash
git rm scripts/walkforward_eval.ts
```
`package.json`의 `"walkforward": "tsx scripts/walkforward_eval.ts"` 라인 제거.

- [ ] **Step 3: 문서 "예정" 표시 → "완료"로 갱신**

`docs/pipeline_guide.md`의 walkforward 섹션 삭제(또는 "benchmark에 통합됨"으로 1줄 대체). `docs/accuracy_metrics.md`·`docs/data_flow.md`의 "🔜 통합/삭제 예정" 박스를 "✅ 통합 완료(2026-06-14)"로 갱신하고 롤링/챔피언/시장 진단을 benchmark 기능으로 기술. `CLAUDE.md` 실행 상태의 "롤링 통합 스펙(미구현)"을 "구현 완료"로.

- [ ] **Step 4: 타입체크 + 테스트 + 빌드**

Run: `npm run build && npm run test:run`
Expected: 에러 0, 테스트 전부 통과. (walkforward import 잔재 없음 확인)

- [ ] **Step 5: 잔여 참조 재확인**

Run: `grep -rn "walkforward" scripts src package.json`
Expected: 출력 없음(문서 내 히스토리 언급은 허용).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(eval): walkforward 삭제 — benchmark 롤링 통합으로 대체 + 문서 갱신"
```

---

## Self-Review 노트

**스펙 커버리지:**
- §3-1 롤링 확장윈도우 → Task 3 + Task 6 ✅
- §3-2 Gate A/B 분리 1회 → Task 6 Step 2 (롤링 루프 밖) ✅
- §3-3 챔피언=저장 모델, 후보=재학습 → Task 5 + Task 6 ✅
- §3-4 단일 잣대 연승(ord≤3) → market.ts `show`, 롤링 tally `show` ✅
- §4 CLI(`--gate-only`/`--no-gate`/`--champion`) → Task 6 ✅
- §5 model_versions 스키마 → **읽기만 사용**(model_type/artifact 이미 존재). 쓰기(params 영구반영)는 본 플랜 범위 밖(6/23후 운영) — 스펙 §10 결정과 일치 ✅
- §6 코드 분리 → Task 1 ✅
- 시장 깊은 진단 → Task 4 ✅
- walkforward 삭제 → Task 7 ✅

**알려진 타입 정합 주의(실행 시 확인):**
- `report.ts`의 기존 `MethodTally`(win/place/quinella)와 롤링/시장의 `Tally`(win/place/show/n)는 의미가 다르다. **롤링·시장 경로는 `market.ts`의 `Tally`로 통일**한다(연승=show=ord≤3). 기존 `evaluate`/`printReport`(고정분할 9모델 복승 표)는 Task 1에서 보존하되 main에서 더 이상 호출하지 않으므로, Task 6에서 미사용 경고가 나면 `printReport`/`evaluate`를 삭제하거나 `--legacy` 플래그 뒤로 보낸다.

**미해결 가능성:** 롤링 9모델 재학습 시간. Task 6 Step 4에서 5분 초과 시 스펙 리스크2대로 핵심 3개(챔피언·Logistic·시장)만 롤링으로 축소.
