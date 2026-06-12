# Multi-Model Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run benchmark` 한 번으로 2단계 게이트(상관계수·연승률 개선량) 통해 항목 포함 여부 결정 후 Spearman·Logistic·GBDT·PL·시장 배당 비교표를 DuckDB 로컬 미러에서 직접 출력.

**Architecture:** `gatherRaceInputs`의 DB 타입을 `ReadClient` 인터페이스로 추상화해 DuckDB와 Supabase 모두 지원. `scripts/benchmark_all.ts` 단일 스크립트가 피처 추출 → 게이트 A/B → 9개 모델 학습 → 2026 테스트 → ASCII 리포트를 순서대로 실행. 모든 핵심 모델 코드(`fitLogistic`, `fitGBDT`, `fitPL`, Spearman ρ)는 기존 모듈 재활용.

**Tech Stack:** TypeScript + tsx, DuckDB (`@duckdb/node-api`), `src/db/localDb.ts` ReadClient, `src/engine/` 기존 모델 모듈

---

## 파일 구조

| 파일 | 역할 | 신규/수정 |
|------|------|---------|
| `src/engine/scorePredictor.ts` | `gatherRaceInputs` DB 타입 → `ReadClient` | 수정 |
| `scripts/benchmark_all.ts` | 전체 파이프라인 오케스트레이터 | 신규 |
| `package.json` | `benchmark` 스크립트 추가 | 수정 |

---

## Task 1: gatherRaceInputs ReadClient 추상화

**Files:**
- Modify: `src/engine/scorePredictor.ts:1-15` (import + 시그니처)

### 배경

현재 `gatherRaceInputs(sb: SupabaseClient, ...)`. DuckDB `ReadClient`도 동일한 `.from().select().eq()...` 인터페이스를 구현하므로 타입만 교체하면 동작함. 기존 Supabase 호출부는 `as unknown as ReadClient` 캐스팅으로 호환 유지.

- [ ] **Step 1: import 변경 및 시그니처 수정**

`src/engine/scorePredictor.ts` 상단에서:

```typescript
// 변경 전 (2번째 줄)
import type { SupabaseClient } from '@supabase/supabase-js';

// 변경 후
import type { ReadClient } from '../db/localDb.js';
```

`gatherRaceInputs` 함수 시그니처:

```typescript
// 변경 전 (57번째 줄)
export async function gatherRaceInputs(
  sb: SupabaseClient,
  rcDate: number,

// 변경 후
export async function gatherRaceInputs(
  sb: ReadClient,
  rcDate: number,
```

`predictRace` 함수 시그니처도 동일하게:

```typescript
// 변경 전 (223번째 줄)
export async function predictRace(
  sb: SupabaseClient,

// 변경 후
export async function predictRace(
  sb: ReadClient,
```

- [ ] **Step 2: 기존 호출 파일 캐스팅 추가**

`src/sync/raceCardSync.ts`, `src/sync/dailySync.ts`, `scripts/backfill_predictions.ts`, `scripts/extract_training_matrix.ts`, `scripts/refresh_logistic.ts`, `scripts/verify_logistic.ts` 각각에서 Supabase 클라이언트를 넘기는 부분에 캐스팅 추가:

```typescript
// 각 파일에서 gatherRaceInputs / predictRace 호출부
// 변경 전
await predictRace(sb, rcDate, meet, rcNo)
// 변경 후
await predictRace(sb as unknown as ReadClient, rcDate, meet, rcNo)
```

(import도 추가: `import type { ReadClient } from '../db/localDb.js';`)

- [ ] **Step 3: 타입 체크**

```bash
npm run build
```

Expected: 타입 에러 없음. `src/engine/scorePredictor.ts` 관련 에러가 있으면 해당 호출부에 캐스팅 추가.

- [ ] **Step 4: 커밋**

```bash
git add src/engine/scorePredictor.ts src/sync/raceCardSync.ts src/sync/dailySync.ts scripts/backfill_predictions.ts scripts/extract_training_matrix.ts scripts/refresh_logistic.ts scripts/verify_logistic.ts
git commit -m "refactor(scorePredictor): gatherRaceInputs DB 타입 → ReadClient 추상화"
```

---

## Task 2: 전 경주 수집 함수 (benchmark_all.ts 골격)

**Files:**
- Create: `scripts/benchmark_all.ts`

### 배경

`races` 테이블에서 날짜 범위의 확정경주(actual_ord 있는 경주) 목록을 뽑고, 각 경주에 대해 `gatherRaceInputs`를 호출해 `ScoreEngineInput`을 얻는다.

- [ ] **Step 1: benchmark_all.ts 파일 생성 (데이터 수집 골격)**

```typescript
/**
 * Multi-Model Benchmark
 * TRAIN: 2024-01-01 ~ 2025-12-31  TEST: 2026-01-01 ~ 현재
 * 사용: npm run benchmark
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { gatherRaceInputs, type RaceInputRow } from '../src/engine/scorePredictor.js';
import { ScoreEngine } from '../src/engine/index.js';
import { buildFeatures } from '../src/engine/features/buildFeatures.js';
import { featureToItem } from '../src/engine/features/featureItemMap.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { fitGBDT, predictGBDT } from '../src/engine/models/gbdt.js';
import { fitPL, predictPL, type PLRace } from '../src/engine/models/plackettLuce.js';
import { computeOptimalWeights } from '../src/engine/weightLearner.js';
import type { ReadClient } from '../src/db/localDb.js';
import type { ScoreEngineInput } from '../src/engine/index.js';
import type { Feature } from '../src/engine/features/types.js';

// ── 타입 ──────────────────────────────────────────────────────────
interface RaceRecord {
  raceDate: number;
  meet: number;
  rcNo: number;
  horses: HorseRecord[];
}

interface HorseRecord {
  hrName: string;
  pthrNo: number;
  ord: number;           // actual_ord (1~50, 이미 필터링됨)
  winOdds: number | null;
  rawScores: Record<string, number>;   // ScoreEngine item rawScore
  features: Feature[];                  // buildFeatures 출력
}

// ── 전 확정경주 수집 ───────────────────────────────────────────────
export async function collectRaces(
  db: ReadClient,
  fromDate: number,
  toDate: number
): Promise<RaceRecord[]> {
  // races 테이블에서 날짜 범위 경주 목록
  const { data: raceList, error } = await db
    .from('races')
    .select('race_date, meet, rc_no')
    .gte('race_date', fromDate)
    .lte('race_date', toDate)
    .order('race_date')
    .order('meet')
    .order('rc_no');
  if (error) throw error;
  if (!raceList || raceList.length === 0) return [];

  const races: RaceRecord[] = [];
  const engine = new ScoreEngine({});  // weights 없이 rawScore만 추출

  for (const r of raceList as { race_date: number; meet: number; rc_no: number }[]) {
    const rows = await gatherRaceInputs(db, r.race_date, r.meet, r.rc_no);
    // 결과 있고, 전원 ord 있으면(확정경주) 포함
    if (rows.length === 0) continue;
    const withOrd = rows.filter((row) => row.ord !== null && row.ord <= 50);
    if (withOrd.length < 3) continue;  // 유효 두수 부족

    // win_odds 조회 (시장 벤치마크용)
    const { data: entries } = await db
      .from('race_entries')
      .select('pthr_no, win_odds')
      .eq('race_date', r.race_date)
      .eq('meet', r.meet)
      .eq('rc_no', r.rc_no);
    const oddsMap = new Map<number, number | null>();
    for (const e of (entries ?? []) as { pthr_no: number; win_odds: number | null }[]) {
      oddsMap.set(e.pthr_no, e.win_odds);
    }

    const horses: HorseRecord[] = withOrd.map((row) => {
      const scored = engine.calculateScores(row.input);
      const rawScores: Record<string, number> = {};
      for (const [id, item] of Object.entries(scored.items)) {
        rawScores[id] = (item as { rawScore?: number }).rawScore ?? 0;
      }
      return {
        hrName: row.hr_name,
        pthrNo: row.pthr_no,
        ord: row.ord as number,
        winOdds: oddsMap.get(row.pthr_no) ?? null,
        rawScores,
        features: buildFeatures(row.input),
      };
    });

    races.push({ raceDate: r.race_date, meet: r.meet, rcNo: r.rc_no, horses });
  }
  return races;
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit scripts/benchmark_all.ts 2>&1 | head -30
```

Expected: `RaceRecord`, `HorseRecord` 타입 관련 에러 없음. `gatherRaceInputs` 관련 에러가 있으면 Task 1 캐스팅 확인.

- [ ] **Step 3: 커밋**

```bash
git add scripts/benchmark_all.ts
git commit -m "feat(benchmark): 전 확정경주 수집 함수 collectRaces"
```

---

## Task 3: 게이트 A — Pearson 상관계수 경고

**Files:**
- Modify: `scripts/benchmark_all.ts` (함수 추가)

### 배경

새 ScoreItem의 buildFeatures 피처가 기존 피처와 Pearson |r|>0.5면 경고 출력. 자동 탈락 없음. 최종 판단은 게이트 B.

- [ ] **Step 1: runGateA 함수 추가**

`scripts/benchmark_all.ts`에 추가:

```typescript
// ── 게이트 A: 피처 상관계수 ───────────────────────────────────────
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return Math.sqrt(dx * dy) === 0 ? 0 : num / Math.sqrt(dx * dy);
}

interface GateAWarning {
  newFeat: string;
  existingFeat: string;
  r: number;
}

export function runGateA(races: RaceRecord[]): GateAWarning[] {
  // 모든 피처 × 전체 말 행렬
  const allFeats = new Set<string>();
  for (const race of races)
    for (const h of race.horses)
      for (const f of h.features) allFeats.add(f.name);

  const featNames = [...allFeats].sort();
  // 피처별 값 벡터 (말 단위)
  const vectors = new Map<string, number[]>();
  for (const name of featNames) vectors.set(name, []);
  for (const race of races)
    for (const h of race.horses) {
      const present = new Map(h.features.map((f) => [f.name, f.value]));
      for (const name of featNames)
        vectors.get(name)!.push(present.get(name) ?? 0);
    }

  const warnings: GateAWarning[] = [];
  const THRESHOLD = 0.5;
  // featureItemMap에서 각 항목별 피처 목록 가져오기
  // 새 피처: featureItemMap에서 특정 항목에 매핑된 것들
  // 기존과 비교: 모든 피처쌍 검사
  const names = featNames.filter((n) => !n.endsWith('__missing'));
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!, b = names[j]!;
      // 같은 항목끼리는 비교 생략 (설계상 당연히 관련)
      if (featureToItem(a) === featureToItem(b)) continue;
      const r = pearson(vectors.get(a)!, vectors.get(b)!);
      if (Math.abs(r) > THRESHOLD) {
        warnings.push({ newFeat: a, existingFeat: b, r });
      }
    }
  }
  return warnings;
}

function printGateA(warnings: GateAWarning[]): void {
  if (warnings.length === 0) {
    console.log('  ✅ 게이트 A: 이상 없음');
    return;
  }
  console.log(`  ⚠️  게이트 A: ${warnings.length}개 상관 경고 (|r|>0.5)`);
  for (const w of warnings.slice(0, 10)) {
    console.log(
      `     [${w.newFeat}] ↔ [${w.existingFeat}] r=${w.r.toFixed(2)}`
      + `\n       → 상관이 높아도 독립 정보 가능. 포함 여부는 게이트 B 판단.`
    );
  }
  if (warnings.length > 10) console.log(`     ... 외 ${warnings.length - 10}개`);
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit scripts/benchmark_all.ts 2>&1 | head -20
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add scripts/benchmark_all.ts
git commit -m "feat(benchmark): 게이트 A — Pearson 상관계수 경고"
```

---

## Task 4: 게이트 B — 연승률 개선량으로 항목 포함 결정

**Files:**
- Modify: `scripts/benchmark_all.ts` (함수 추가)

### 배경

holdout = 2025-Q4 (20251001~20251231). 학습 = 2024-01~2025-09.
각 ScoreItem별로 "해당 항목 피처 포함 logistic" vs "제외 logistic" 학습 후 holdout 연승률 비교.
개선량 > 0이면 approved, 아니면 Spearman에만 포함.

- [ ] **Step 1: runGateB 함수 추가**

```typescript
// ── 게이트 B: 연승률 개선량 ───────────────────────────────────────
const GATE_B_HOLDOUT_START = 20251001;
const GATE_B_HOLDOUT_END   = 20251231;

interface GateBResult {
  itemId: string;
  include: boolean;   // true면 logistic/GBDT/PL에 포함
  delta: number;      // 연승률 개선량 (+이면 good)
  withRate: number;
  withoutRate: number;
}

export function runGateB(races: RaceRecord[]): GateBResult[] {
  const gateTrain = races.filter(
    (r) => r.raceDate < GATE_B_HOLDOUT_START
  );
  const gateHoldout = races.filter(
    (r) => r.raceDate >= GATE_B_HOLDOUT_START && r.raceDate <= GATE_B_HOLDOUT_END
  );
  if (gateHoldout.length < 50) {
    console.warn('  ⚠️  게이트 B holdout 경주 수 부족 (<50). 결과 신뢰도 낮음.');
  }

  // featureItemMap의 ScoreItem ID 목록
  const itemIds = [...new Set(
    races.flatMap((r) => r.horses.flatMap((h) => h.features.map((f) => featureToItem(f.name))))
  )].filter((id) => id !== 'context').sort();

  // 전 피처 스키마
  const allFeatures = buildSchema(gateTrain.flatMap((r) => r.horses.map((h) => h.features)));

  // 학습 행렬 (포함)
  const trainX = gateTrain.flatMap((r) =>
    r.horses.map((h) => toVector(h.features, allFeatures))
  );
  const trainY = gateTrain.flatMap((r) =>
    r.horses.map((h) => (h.ord <= 3 ? 1 : 0))
  );

  // holdout 평가 헬퍼
  function placeRate(model: ReturnType<typeof fitLogistic>, holdout: RaceRecord[], schema: string[]): number {
    let hit = 0, n = 0;
    for (const race of holdout) {
      const scored = race.horses.map((h) => ({
        h,
        score: predictLogit(model, toVector(h.features, schema)),
      }));
      const top = scored.sort((a, b) => b.score - a.score)[0];
      if (!top) continue;
      n++;
      if (top.h.ord <= 3) hit++;
    }
    return n ? hit / n : 0;
  }

  // 전체 모델(with all features) — 기준선
  const modelAll = fitLogistic(trainX, trainY, allFeatures);
  const baseRate = placeRate(modelAll, gateHoldout, allFeatures);

  const results: GateBResult[] = [];
  for (const itemId of itemIds) {
    // 해당 항목 피처 제외한 스키마
    const reducedFeatures = allFeatures.filter(
      (name) => featureToItem(name) !== itemId && !name.endsWith('__missing')
    );
    // 제외 피처가 없으면 (항목이 기여하는 피처 없음) → 스피어만에만
    const itemFeats = allFeatures.filter((n) => featureToItem(n) === itemId);
    if (itemFeats.length === 0) {
      results.push({ itemId, include: false, delta: 0, withRate: baseRate, withoutRate: baseRate });
      continue;
    }

    const withoutX = gateTrain.flatMap((r) =>
      r.horses.map((h) => toVector(h.features, reducedFeatures))
    );
    const modelWithout = fitLogistic(withoutX, trainY, reducedFeatures);
    const withoutRate = placeRate(modelWithout, gateHoldout, reducedFeatures);
    const delta = baseRate - withoutRate;  // 항목 제거 시 연승률 하락 = 항목 기여

    results.push({
      itemId,
      include: delta > 0,
      delta,
      withRate: baseRate,
      withoutRate,
    });
  }
  return results;
}

function printGateB(results: GateBResult[]): void {
  console.log('\n=== 항목 포함 현황 ===\n');
  console.log(
    '항목                   │ Logistic/GBDT/PL │ 게이트B 개선량'
  );
  console.log('─'.repeat(60));
  for (const r of results.sort((a, b) => b.delta - a.delta)) {
    const mark = r.include ? '✅ 포함' : '⚠️  제외';
    const sign = r.delta >= 0 ? '+' : '';
    console.log(
      `${r.itemId.padEnd(23)}│ ${mark.padEnd(16)}│ ${sign}${(r.delta * 100).toFixed(1)}%p`
    );
  }
}
```

- [ ] **Step 2: 타입 체크**

```bash
npx tsc --noEmit scripts/benchmark_all.ts 2>&1 | head -20
```

Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add scripts/benchmark_all.ts
git commit -m "feat(benchmark): 게이트 B — 연승률 개선량으로 항목 포함 결정"
```

---

## Task 5: 9개 모델 학습

**Files:**
- Modify: `scripts/benchmark_all.ts` (함수 추가)

- [ ] **Step 1: Spearman weights 학습 함수**

```typescript
// ── Spearman weights 학습 ─────────────────────────────────────────
import { ITEM_WEIGHTS } from '../src/types/index.js';

function learnSpearman(races: RaceRecord[]): Record<string, number> {
  const ALL_ITEMS = Object.keys(ITEM_WEIGHTS);
  const sumRho: Record<string, number> = {};
  const count: Record<string, number> = {};

  for (const race of races) {
    const horses = race.horses;
    if (horses.length < 3) continue;
    for (const itemId of ALL_ITEMS) {
      const xs = horses.map((h) => h.rawScores[itemId] ?? 0);
      const ys = horses.map((h) => -h.ord);  // 낮은 ord = 좋음 → 부호 반전
      const rho = spearmanRho(xs, ys);
      if (Number.isFinite(rho)) {
        sumRho[itemId] = (sumRho[itemId] ?? 0) + rho;
        count[itemId] = (count[itemId] ?? 0) + 1;
      }
    }
  }
  const corr: Record<string, number> = {};
  for (const id of ALL_ITEMS) corr[id] = count[id] ? sumRho[id]! / count[id]! : 0;
  return computeOptimalWeights(corr as any);
}

function spearmanRho(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return NaN;
  const rank = (arr: number[]) => {
    const sorted = arr.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array(arr.length).fill(0);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j+1]![0] === sorted[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[sorted[k]![1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys), n = xs.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n;
  const my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i]! - mx, b = ry[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return Math.sqrt(dx * dy) === 0 ? 0 : num / Math.sqrt(dx * dy);
}
```

- [ ] **Step 2: 9개 모델 학습 함수**

```typescript
// ── 9개 모델 학습 ─────────────────────────────────────────────────
interface TrainedModels {
  spearmanWeights: Record<string, number>;
  logisticTop1: ReturnType<typeof fitLogistic>;
  logisticTop2: ReturnType<typeof fitLogistic>;
  logisticTop3: ReturnType<typeof fitLogistic>;
  gbdtTop1: ReturnType<typeof fitGBDT>;
  gbdtTop2: ReturnType<typeof fitGBDT>;
  gbdtTop3: ReturnType<typeof fitGBDT>;
  pl: ReturnType<typeof fitPL>;
  featureSchema: string[];
}

function trainAllModels(
  races: RaceRecord[],
  approvedItems: Set<string>
): TrainedModels {
  console.log('\n학습 중...');

  // 승인된 항목의 피처만 포함한 스키마
  const allRaceFeatures = races.flatMap((r) => r.horses.map((h) => h.features));
  const fullSchema = buildSchema(allRaceFeatures);
  const featureSchema = fullSchema.filter(
    (name) => approvedItems.has(featureToItem(name)) && !name.endsWith('__missing')
  );

  const X = races.flatMap((r) =>
    r.horses.map((h) => toVector(h.features, featureSchema))
  );
  const yTop1 = races.flatMap((r) => r.horses.map((h) => (h.ord === 1 ? 1 : 0)));
  const yTop2 = races.flatMap((r) => r.horses.map((h) => (h.ord <= 2 ? 1 : 0)));
  const yTop3 = races.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));

  const plRaces: PLRace[] = races.map((r) => ({
    horses: r.horses.map((h) => ({ x: toVector(h.features, featureSchema), ord: h.ord })),
  }));

  return {
    spearmanWeights: learnSpearman(races),
    logisticTop1: fitLogistic(X, yTop1, featureSchema, { l2: 0.02, iters: 800, lr: 0.2 }),
    logisticTop2: fitLogistic(X, yTop2, featureSchema, { l2: 0.02, iters: 800, lr: 0.2 }),
    logisticTop3: fitLogistic(X, yTop3, featureSchema, { l2: 0.02, iters: 800, lr: 0.2 }),
    gbdtTop1: fitGBDT(X, yTop1, featureSchema),
    gbdtTop2: fitGBDT(X, yTop2, featureSchema),
    gbdtTop3: fitGBDT(X, yTop3, featureSchema),
    pl: fitPL(plRaces, featureSchema),
    featureSchema,
  };
}
```

- [ ] **Step 3: 타입 체크**

```bash
npx tsc --noEmit scripts/benchmark_all.ts 2>&1 | head -20
```

Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add scripts/benchmark_all.ts
git commit -m "feat(benchmark): Spearman + 9개 모델 학습 함수"
```

---

## Task 6: 테스트 평가 + ASCII 리포트

**Files:**
- Modify: `scripts/benchmark_all.ts` (함수 추가)

- [ ] **Step 1: 평가 함수**

```typescript
// ── 평가 ──────────────────────────────────────────────────────────
interface RaceResult {
  win: boolean;   // 1순위 예측마가 1착
  place: boolean; // 1순위 예측마가 3착이내
  quinella: boolean; // 상위 2마리가 실제 1·2착
}

interface MethodTally {
  win: number; place: number; quinella: number; n: number;
}

const emptyTally = (): MethodTally => ({ win: 0, place: 0, quinella: 0, n: 0 });

function quarterOf(raceDate: number): string {
  const y = Math.floor(raceDate / 10000);
  const m = Math.floor((raceDate % 10000) / 100);
  return `${y}-Q${Math.ceil(m / 3)}`;
}

function evaluateRace(
  race: RaceRecord,
  models: TrainedModels
): Record<string, RaceResult> {
  const { horses } = race;

  const scoreHorses = (scorer: (h: HorseRecord) => number) => {
    const sorted = [...horses].sort((a, b) => scorer(b) - scorer(a));
    const top1 = sorted[0];
    const top2Set = new Set([sorted[0]?.pthrNo, sorted[1]?.pthrNo]);
    const win = top1 ? top1.ord === 1 : false;
    const place = top1 ? top1.ord <= 3 : false;
    const actual12 = horses.filter((h) => h.ord <= 2).map((h) => h.pthrNo);
    const quinella = actual12.length === 2
      && actual12.every((p) => top2Set.has(p));
    return { win, place, quinella };
  };

  const schema = models.featureSchema;

  return {
    market: (() => {
      const validH = horses.filter((h) => h.winOdds != null && h.winOdds > 0);
      if (validH.length === 0) return { win: false, place: false, quinella: false };
      return scoreHorses((h) => (h.winOdds != null && h.winOdds > 0) ? -h.winOdds! : -Infinity);
    })(),
    spearman: scoreHorses((h) => {
      let s = 0;
      for (const [id, w] of Object.entries(models.spearmanWeights))
        s += (h.rawScores[id] ?? 0) * w;
      return s;
    }),
    logisticTop1: scoreHorses((h) => predictLogit(models.logisticTop1, toVector(h.features, schema))),
    logisticTop2: scoreHorses((h) => predictLogit(models.logisticTop2, toVector(h.features, schema))),
    logisticTop3: scoreHorses((h) => predictLogit(models.logisticTop3, toVector(h.features, schema))),
    gbdtTop1: scoreHorses((h) => predictGBDT(models.gbdtTop1, toVector(h.features, schema))),
    gbdtTop2: scoreHorses((h) => predictGBDT(models.gbdtTop2, toVector(h.features, schema))),
    gbdtTop3: scoreHorses((h) => predictGBDT(models.gbdtTop3, toVector(h.features, schema))),
    pl:        scoreHorses((h) => predictPL(models.pl, toVector(h.features, schema))),
  };
}

function evaluate(
  races: RaceRecord[],
  models: TrainedModels
): { overall: Record<string, MethodTally>; byQuarter: Map<string, Record<string, MethodTally>> } {
  const overall: Record<string, MethodTally> = {};
  const byQuarter = new Map<string, Record<string, MethodTally>>();
  const METHOD_KEYS = [
    'market','spearman',
    'logisticTop1','logisticTop2','logisticTop3',
    'gbdtTop1','gbdtTop2','gbdtTop3','pl',
  ];
  for (const k of METHOD_KEYS) overall[k] = emptyTally();

  for (const race of races) {
    const q = quarterOf(race.raceDate);
    if (!byQuarter.has(q)) {
      const m: Record<string, MethodTally> = {};
      for (const k of METHOD_KEYS) m[k] = emptyTally();
      byQuarter.set(q, m);
    }
    const results = evaluateRace(race, models);
    for (const [key, res] of Object.entries(results)) {
      const t = overall[key]!;
      t.n++; if (res.win) t.win++; if (res.place) t.place++; if (res.quinella) t.quinella++;
      const qt = byQuarter.get(q)![key]!;
      qt.n++; if (res.win) qt.win++; if (res.place) qt.place++; if (res.quinella) qt.quinella++;
    }
  }
  return { overall, byQuarter };
}
```

- [ ] **Step 2: ASCII 리포트 함수**

```typescript
// ── 리포트 출력 ───────────────────────────────────────────────────
const METHOD_LABELS: Record<string, string> = {
  market:       '시장 배당',
  spearman:     'Spearman',
  logisticTop1: 'Logistic (top1)',
  logisticTop2: 'Logistic (top2)',
  logisticTop3: 'Logistic (top3)',
  gbdtTop1:     'GBDT     (top1)',
  gbdtTop2:     'GBDT     (top2)',
  gbdtTop3:     'GBDT     (top3)',
  pl:           'Plackett-Luce',
};

function pct(n: number, d: number) { return d ? `${(n / d * 100).toFixed(1)}%` : '-'; }

function printReport(
  evalResult: ReturnType<typeof evaluate>,
  gateBResults: GateBResult[]
): void {
  const { overall, byQuarter } = evalResult;
  const quarters = [...byQuarter.keys()].sort();
  const KEYS = Object.keys(METHOD_LABELS);

  // 분기별 연승률
  console.log('\n=== 연승률 (1순위 예측마가 3착이내) ===\n');
  const header = '방법'.padEnd(22) + '│' + quarters.map((q) => ` ${q} `).join('│') + '│ 전체';
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const k of KEYS) {
    const row = METHOD_LABELS[k]!.padEnd(22) + '│'
      + quarters.map((q) => {
          const t = byQuarter.get(q)![k]!;
          return ` ${pct(t.place, t.n).padStart(6)} `;
        }).join('│')
      + '│ ' + pct(overall[k]!.place, overall[k]!.n);
    console.log(row);
  }

  // 전체 요약표
  console.log('\n=== 전체 요약 (2026년) ===\n');
  console.log('방법'.padEnd(22) + '│ 단승율 │ 연승율 │ 복승율 │ n경주');
  console.log('─'.repeat(65));
  for (const k of KEYS) {
    const t = overall[k]!;
    console.log(
      METHOD_LABELS[k]!.padEnd(22) + '│'
      + ` ${pct(t.win, t.n).padStart(6)} │`
      + ` ${pct(t.place, t.n).padStart(6)} │`
      + ` ${pct(t.quinella, t.n).padStart(6)} │`
      + ` ${String(t.n).padStart(5)}`
    );
  }
}
```

- [ ] **Step 3: main 함수 연결**

`scripts/benchmark_all.ts` 끝에 추가:

```typescript
// ── main ──────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const TRAIN_FROM = 20240101, TRAIN_TO = 20251231;
  const TEST_FROM  = 20260101, TEST_TO   = 99991231;

  const db = await getLocalDb();

  console.log('📊 Multi-Model Benchmark 시작\n');
  console.log(`데이터 수집 중 (TRAIN: ${TRAIN_FROM}~${TRAIN_TO})...`);
  const allRaces = await collectRaces(db, TRAIN_FROM, TEST_TO);
  const trainRaces = allRaces.filter((r) => r.raceDate <= TRAIN_TO);
  const testRaces  = allRaces.filter((r) => r.raceDate >= TEST_FROM);
  console.log(`  TRAIN: ${trainRaces.length}경주 / TEST: ${testRaces.length}경주`);

  // 게이트 A
  console.log('\n[게이트 A] 상관계수 점검...');
  const gateAWarnings = runGateA(trainRaces);
  printGateA(gateAWarnings);

  // 게이트 B
  console.log('\n[게이트 B] 연승률 개선량 계산 중...');
  const gateBResults = runGateB(trainRaces);
  printGateB(gateBResults);

  // 승인된 항목 집합
  const approvedItems = new Set(
    gateBResults.filter((r) => r.include).map((r) => r.itemId)
  );
  console.log(`\n  → ${approvedItems.size}개 항목 승인됨`);

  // 9개 모델 학습
  const models = trainAllModels(trainRaces, approvedItems);
  console.log('  ✅ 학습 완료');

  // 2026 테스트
  console.log('\n[테스트] 2026년 평가 중...');
  const evalResult = evaluate(testRaces, models);

  // 리포트 출력
  printReport(evalResult, gateBResults);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 4: 타입 체크**

```bash
npx tsc --noEmit scripts/benchmark_all.ts 2>&1 | head -30
```

Expected: 에러 없음.

- [ ] **Step 5: 커밋**

```bash
git add scripts/benchmark_all.ts
git commit -m "feat(benchmark): 평가 + ASCII 리포트 + main 연결"
```

---

## Task 7: package.json 등록 + 통합 실행 확인

**Files:**
- Modify: `package.json`

- [ ] **Step 1: package.json에 benchmark 스크립트 추가**

`package.json`의 `"scripts"` 섹션에 추가:

```json
"benchmark": "tsx scripts/benchmark_all.ts"
```

- [ ] **Step 2: DuckDB 파일 존재 확인**

```bash
ls data/local.duckdb
```

없으면: `npm run db:pull` 실행 (Supabase egress 허용 시점에).

- [ ] **Step 3: dry-run (타입체크)**

```bash
npm run build
```

Expected: 타입 에러 없음.

- [ ] **Step 4: 최종 커밋**

```bash
git add package.json
git commit -m "feat(benchmark): npm run benchmark 스크립트 등록"
```

---

## 스펙 커버리지 자체 점검

| 스펙 요구사항 | 구현 태스크 |
|---|---|
| DuckDB 직접, 파일 불필요 | Task 2 `collectRaces` |
| ReadClient 추상화 | Task 1 |
| 게이트 A 상관계수 경고 (자동탈락 X) | Task 3 `runGateA` |
| 게이트 B 연승률 개선량 | Task 4 `runGateB` |
| 미통과 시 에러 없이 Spearman에만 | Task 4 `approvedItems` 로직 |
| 포함/미포함 목록 출력 | Task 4 `printGateB` |
| Spearman rawScore 피처 공간 | Task 5 `learnSpearman` |
| Logistic/GBDT/PL buildFeatures 피처 공간 | Task 5 `trainAllModels` |
| 9개 모델 학습 | Task 5 |
| TRAIN 2024~2025 / TEST 2026 | Task 6 main |
| 단승/연승/복승 분기별+전체 표 | Task 6 `printReport` |
| `npm run benchmark` | Task 7 |
