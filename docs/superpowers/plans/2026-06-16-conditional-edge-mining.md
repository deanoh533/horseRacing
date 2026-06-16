# 조건부 엣지 마이닝 도구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경주를 조건 구간(배당대·두수·거리·불일치강도, 단일+2차조합)으로 쪼개 모델top1 vs 인기top1 정면대결 우위를 측정하고, 분기 안정성 가드로 거짓발견을 거르는 읽기전용 진단 CLI를 만든다.

**Architecture:** 순수 로직은 `src/engine/eval/edgeMining.ts`(Conditioner/EdgeRecorder/StabilityAggregator/Reporter), I/O·실행은 `scripts/mine_conditional_edge.ts`. 기존 `collectRaces`·`loadVersion`·`rankHorses`·`rankByOdds`·`quarterKey` 재사용. 모델·DB·라이브 경로 불변.

**Tech Stack:** TypeScript, Node.js, DuckDB(@duckdb/node-api, 로컬 미러), vitest, tsx.

---

## 파일 구조

- Create: `src/engine/eval/edgeMining.ts` — 순수 로직 4부품 + 타입
- Create: `src/engine/eval/edgeMining.test.ts` — 단위 테스트
- Create: `scripts/mine_conditional_edge.ts` — CLI(I/O)
- Modify: `src/engine/eval/types.ts` — `RaceRecord`에 `rcDist?: number` 추가(additive·비파괴)
- Modify: `src/engine/eval/collect.ts` — `races` select에 `rc_dist` 포함 + race에 채움
- Modify: `package.json` — `"mine:edge"` 스크립트

스펙: `docs/superpowers/specs/2026-06-16-conditional-edge-mining-design.md`

---

## Task 1: 분포 probe로 버킷 임계값 확정 ✅ 완료(2026-06-16)

**결과:** 인기1위 배당 분위수 p25=1.8·p50=2.3·p75=2.9·p90=3.4(최대 23.6) → 배당대 `≤1.8/1.8-2.3/2.3-2.9/>2.9`로 확정(Task 3 반영 완료). 두수 분포 8~12 집중 → `≤9/10-11/≥12` 유지. 아래는 재현용 절차(이미 수행됨, 재실행 불필요).

**목적:** 잠정 버킷을 실제 분포로 검증·조정. (작업방식: 임계값은 직관 아닌 데이터로.)

**Files:**
- Create(임시): `scripts/_probe_edge_buckets.mts` (실행 후 삭제)

- [ ] **Step 1: probe 스크립트 작성**

```ts
import { DuckDBInstance } from '@duckdb/node-api';
const inst = await DuckDBInstance.create('data/local.duckdb');
const conn = await inst.connect();
async function q(sql: string): Promise<any[]> { const r = await conn.run(sql); return await r.getRowObjects(); }
// 인기1위(경주별 최저 win_odds) 배당 분포 — 분위수
const fav = await q(`
WITH f AS (
  SELECT race_date, meet, rc_no, min(win_odds) AS fav_odds
  FROM race_entries WHERE ord IS NOT NULL AND win_odds>0
  GROUP BY 1,2,3
)
SELECT
  quantile_cont(fav_odds, 0.25) p25, quantile_cont(fav_odds, 0.5) p50,
  quantile_cont(fav_odds, 0.75) p75, quantile_cont(fav_odds, 0.9) p90 FROM f`);
console.log('인기1위 배당 분위수:', fav[0]);
// 출전두수 분포
const fs = await q(`
WITH r AS (SELECT race_date,meet,rc_no, count(*) f FROM race_entries WHERE ord IS NOT NULL GROUP BY 1,2,3)
SELECT f, count(*) races FROM r GROUP BY 1 ORDER BY 1`);
console.log('두수 분포:', fs.map((r:any)=>`${r.f}두:${r.races}`).join(' '));
```

- [ ] **Step 2: 실행**

Run: `npx tsx scripts/_probe_edge_buckets.mts`
Expected: 배당 분위수(예 p25≈1.8, p50≈2.8, p75≈4.5, p90≈7)와 두수 분포 출력.

- [ ] **Step 3: 임계값 결정 + 정리**

분위수가 잠정값(2.0/3.5/6.0)과 크게 다르면 Task 2의 `conditionRace` 경계와 그 테스트 기대값을 일치하게 조정. 비슷하면 잠정값 유지.
Run: `rm -f scripts/_probe_edge_buckets.mts`

- [ ] **Step 4: Commit**

```bash
git add -A docs/superpowers/plans/2026-06-16-conditional-edge-mining.md
git commit -m "chore(edge): 버킷 임계값 probe 확정 (배당/두수 분포)"
```

---

## Task 2: RaceRecord에 거리 추가

**Files:**
- Modify: `src/engine/eval/types.ts`
- Modify: `src/engine/eval/collect.ts`

- [ ] **Step 1: 타입에 rcDist 추가 (additive)**

`src/engine/eval/types.ts`의 `RaceRecord`에 필드 추가:

```ts
export interface RaceRecord {
  raceDate: number;
  meet: number;
  rcNo: number;
  rcDist?: number;   // 경주 거리(m). 조건부 엣지 마이닝용 (additive).
  horses: HorseRecord[];
}
```

- [ ] **Step 2: collect.ts에서 거리 채우기**

`src/engine/eval/collect.ts:19` select 문에 `rc_dist` 추가:

```ts
    .select('race_date, meet, rc_no, rc_dist')
```

`collect.ts:32` 타입 캐스트와 `:71` push를 거리 포함하게 수정:

```ts
  for (const r of raceList as { race_date: number; meet: number; rc_no: number; rc_dist: number | null }[]) {
```

```ts
    races.push({ raceDate: r.race_date, meet: r.meet, rcNo: r.rc_no, rcDist: r.rc_dist ?? undefined, horses });
```

- [ ] **Step 3: 타입체크**

Run: `npm run build`
Expected: 에러 없음(통과). 기존 RaceRecord 리터럴은 rcDist 선택적이라 영향 없음.

- [ ] **Step 4: Commit**

```bash
git add src/engine/eval/types.ts src/engine/eval/collect.ts
git commit -m "feat(eval): RaceRecord에 rcDist 추가 — 조건부 엣지 마이닝용"
```

---

## Task 3: Conditioner (conditionRace)

**Files:**
- Create: `src/engine/eval/edgeMining.ts`
- Create: `src/engine/eval/edgeMining.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/engine/eval/edgeMining.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { conditionRace } from './edgeMining.js';

describe('conditionRace — 버킷 경계', () => {
  it('배당대(분위수 기반): 1.8 이하 강한본명 / 2.9 초과 혼전', () => {
    expect(conditionRace({ favWinOdds: 1.8, fieldSize: 10, rcDist: 1200, favModelRank: 2 }).favOddsBand).toBe('fav<=1.8');
    expect(conditionRace({ favWinOdds: 3.0, fieldSize: 10, rcDist: 1200, favModelRank: 2 }).favOddsBand).toBe('fav>2.9');
  });
  it('두수: 9 이하 / 10~11 / 12 이상', () => {
    expect(conditionRace({ favWinOdds: 3, fieldSize: 9, rcDist: 1200, favModelRank: 2 }).fieldBand).toBe('field<=9');
    expect(conditionRace({ favWinOdds: 3, fieldSize: 12, rcDist: 1200, favModelRank: 2 }).fieldBand).toBe('field>=12');
  });
  it('거리: 1400 이하 단 / 1700 초과 장', () => {
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1400, favModelRank: 2 }).distBand).toBe('dist<=1400');
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1800, favModelRank: 2 }).distBand).toBe('dist>1700');
  });
  it('불일치 강도: 인기1위가 모델 2등=약 / 4등 이상=강', () => {
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1200, favModelRank: 2 }).disagreeStrength).toBe('dis2');
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1200, favModelRank: 5 }).disagreeStrength).toBe('dis>=4');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/edgeMining.test.ts`
Expected: FAIL — `conditionRace` 미정의.

- [ ] **Step 3: 최소 구현**

`src/engine/eval/edgeMining.ts`:

```ts
export interface SegmentLabels {
  favOddsBand: string;
  fieldBand: string;
  distBand: string;
  disagreeStrength: string;
}

/** 한 경주의 조건 라벨. 임계값은 2026-06-16 probe로 확정(스펙 §4.1). */
export function conditionRace(p: {
  favWinOdds: number;
  fieldSize: number;
  rcDist: number;
  favModelRank: number; // 1-based: 인기1위가 모델 순위에서 몇 등인가
}): SegmentLabels {
  // 배당대 경계 = 인기1위 win_odds 분위수(2026-06-16 probe: p25=1.8·p50=2.3·p75=2.9).
  const favOddsBand =
    p.favWinOdds <= 1.8 ? 'fav<=1.8'
    : p.favWinOdds <= 2.3 ? 'fav1.8-2.3'
    : p.favWinOdds <= 2.9 ? 'fav2.3-2.9'
    : 'fav>2.9';
  const fieldBand =
    p.fieldSize <= 9 ? 'field<=9'
    : p.fieldSize <= 11 ? 'field10-11'
    : 'field>=12';
  const distBand =
    p.rcDist <= 1400 ? 'dist<=1400'
    : p.rcDist <= 1700 ? 'dist1401-1700'
    : 'dist>1700';
  const disagreeStrength =
    p.favModelRank <= 2 ? 'dis2'
    : p.favModelRank === 3 ? 'dis3'
    : 'dis>=4';
  return { favOddsBand, fieldBand, distBand, disagreeStrength };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/edgeMining.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/edgeMining.ts src/engine/eval/edgeMining.test.ts
git commit -m "feat(edge): Conditioner — 경주→조건 라벨 (배당/두수/거리/불일치강도)"
```

---

## Task 4: EdgeRecorder (recordEdges)

**Files:**
- Modify: `src/engine/eval/edgeMining.ts`
- Modify: `src/engine/eval/edgeMining.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`edgeMining.test.ts`에 추가:

```ts
import { recordEdges } from './edgeMining.js';
import type { RaceRecord } from './types.js';
import type { ScorableModel } from './score.js';

describe('recordEdges — 불일치 경주만 기록', () => {
  const model: ScorableModel = { kind: 'weights', weights: { r: 1 } };
  const hr = (name: string, r: number, winOdds: number, ord: number) =>
    ({ hrName: name, pthrNo: 0, ord, winOdds, rawScores: { r }, features: [] });

  it('모델top1≠인기top1이면 1행, 착순·라벨·분기 기록', () => {
    const race: RaceRecord = {
      raceDate: 20250115, meet: 1, rcNo: 1, rcDist: 1200,
      horses: [
        hr('A', 0.9, 5.0, 4),  // 모델 1등(점수 최고), 배당 3순위
        hr('B', 0.8, 1.5, 1),  // 인기 1등(최저배당), 모델 2등
        hr('C', 0.5, 3.0, 2),
        hr('D', 0.2, 8.0, 5),
      ],
    };
    const rows = recordEdges([race], model);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.modelPickOrd).toBe(4); // A 착순
    expect(rows[0]!.favPickOrd).toBe(1);   // B 착순
    expect(rows[0]!.quarterKey).toBe('2025-Q1');
    expect(rows[0]!.labels.favOddsBand).toBe('fav<=1.8');
    expect(rows[0]!.labels.fieldBand).toBe('field<=9');
    expect(rows[0]!.labels.disagreeStrength).toBe('dis2'); // B는 모델 2등
  });

  it('모델top1=인기top1(일치)이면 제외', () => {
    const race: RaceRecord = {
      raceDate: 20250115, meet: 1, rcNo: 2, rcDist: 1200,
      horses: [hr('A', 0.9, 1.5, 1), hr('B', 0.5, 3.0, 2), hr('C', 0.2, 8.0, 3)],
    };
    expect(recordEdges([race], model)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/edgeMining.test.ts`
Expected: FAIL — `recordEdges` 미정의.

- [ ] **Step 3: 구현 추가**

`edgeMining.ts` 상단 import 추가:

```ts
import { rankHorses, type ScorableModel } from './score.js';
import { rankByOdds } from './market.js';
import { quarterKey } from './rolling.js';
import type { RaceRecord } from './types.js';
```

파일 끝에 추가:

```ts
export interface EdgeRow {
  quarterKey: string;
  labels: SegmentLabels;
  modelPickOrd: number;
  favPickOrd: number;
}

/** 모델top1 ≠ 인기top1 인 경주만 1행으로 기록. */
export function recordEdges(races: RaceRecord[], model: ScorableModel): EdgeRow[] {
  const rows: EdgeRow[] = [];
  for (const race of races) {
    const modelOrder = rankHorses(model, race.horses);
    const mktOrder = rankByOdds(race.horses); // win_odds 오름차순, 유효 배당만
    const mPick = modelOrder[0];
    const fPick = mktOrder[0];
    if (!mPick || !fPick) continue;
    if (mPick.hrName === fPick.hrName) continue;       // 일치 → 불일치 아님
    if (mPick.ord == null || fPick.ord == null) continue;
    const favModelRank = modelOrder.findIndex((h) => h.hrName === fPick.hrName) + 1;
    const labels = conditionRace({
      favWinOdds: fPick.winOdds as number,
      fieldSize: race.horses.length,
      rcDist: race.rcDist ?? 0,
      favModelRank,
    });
    rows.push({
      quarterKey: quarterKey(race.raceDate),
      labels,
      modelPickOrd: mPick.ord,
      favPickOrd: fPick.ord,
    });
  }
  return rows;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/edgeMining.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/edgeMining.ts src/engine/eval/edgeMining.test.ts
git commit -m "feat(edge): EdgeRecorder — 불일치 경주 정면대결 착순 기록"
```

---

## Task 5: StabilityAggregator (aggregate) — 핵심

**Files:**
- Modify: `src/engine/eval/edgeMining.ts`
- Modify: `src/engine/eval/edgeMining.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`edgeMining.test.ts`에 추가:

```ts
import { aggregate, type EdgeRow } from './edgeMining.js';

describe('aggregate — 분기 안정성 가드', () => {
  const labels = { favOddsBand: 'fav>6', fieldBand: 'field>=12', distBand: 'dist<=1400', disagreeStrength: 'dis>=4' };
  // 한 분기에 동일 결과의 행 n개 생성. win=true면 모델픽 ord1·인기픽 ord5(엣지+), false면 반대.
  const quarterRows = (qk: string, n: number, modelWins: boolean): EdgeRow[] =>
    Array.from({ length: n }, () => ({
      quarterKey: qk, labels,
      modelPickOrd: modelWins ? 1 : 5,
      favPickOrd: modelWins ? 5 : 1,
    }));

  it('유효분기 충분 + 다수 양수 → 채택후보', () => {
    const rows = [
      ...quarterRows('2025-Q1', 12, true), ...quarterRows('2025-Q2', 12, true),
      ...quarterRows('2025-Q3', 12, true), ...quarterRows('2025-Q4', 12, true),
      ...quarterRows('2026-Q1', 12, false), // 1개 음수
    ];
    const stats = aggregate(rows, { minCellN: 10, minQuarters: 4, positiveRatio: 0.6, combos: false });
    const seg = stats.find((s) => s.segment === 'favOddsBand=fav>6')!;
    expect(seg.qualifyingQuarters).toBe(5);
    expect(seg.positiveQuarters).toBe(4);
    expect(seg.verdict).toBe('채택후보'); // 4/5=0.8 ≥ 0.6
    expect(seg.pooledPlaceEdge).toBeGreaterThan(0);
  });

  it('유효분기 부족 → 보류', () => {
    const rows = [...quarterRows('2025-Q1', 12, true), ...quarterRows('2025-Q2', 12, true)];
    const stats = aggregate(rows, { minCellN: 10, minQuarters: 4, positiveRatio: 0.6, combos: false });
    const seg = stats.find((s) => s.segment === 'favOddsBand=fav>6')!;
    expect(seg.verdict).toBe('보류'); // 유효분기 2 < 4
  });

  it('표본 부족 분기는 유효분기서 제외', () => {
    const rows = [
      ...quarterRows('2025-Q1', 12, true), ...quarterRows('2025-Q2', 12, true),
      ...quarterRows('2025-Q3', 12, true), ...quarterRows('2025-Q4', 12, true),
      ...quarterRows('2026-Q1', 5, false), // n<10 → 제외
    ];
    const stats = aggregate(rows, { minCellN: 10, minQuarters: 4, positiveRatio: 0.6, combos: false });
    const seg = stats.find((s) => s.segment === 'favOddsBand=fav>6')!;
    expect(seg.qualifyingQuarters).toBe(4);
    expect(seg.positiveQuarters).toBe(4);
  });

  it('combos=true면 2차 조합 구간도 생성', () => {
    const rows = quarterRows('2025-Q1', 12, true);
    const stats = aggregate(rows, { minCellN: 10, minQuarters: 1, positiveRatio: 0.6, combos: true });
    expect(stats.some((s) => s.segment === 'favOddsBand=fav>6 ∩ fieldBand=field>=12')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/edgeMining.test.ts`
Expected: FAIL — `aggregate` 미정의.

- [ ] **Step 3: 구현 추가**

`edgeMining.ts` 파일 끝에 추가:

```ts
export interface QuarterCell { key: string; n: number; placeEdge: number; }
export interface SegmentStat {
  segment: string;
  totalN: number;
  quarters: QuarterCell[];
  qualifyingQuarters: number;
  positiveQuarters: number;
  pooledWinEdge: number;
  pooledTop2Edge: number;
  pooledPlaceEdge: number;
  verdict: '채택후보' | '혼조' | '보류';
}
export interface AggOptions { minCellN: number; minQuarters: number; positiveRatio: number; combos: boolean; }

const DIMS = ['favOddsBand', 'fieldBand', 'distBand', 'disagreeStrength'] as const;

/** 한 행이 속한 모든 구간 키(단일 4개 + combos면 2차 6개). */
function segmentKeysFor(labels: SegmentLabels, combos: boolean): string[] {
  const singles = DIMS.map((d) => `${d}=${labels[d]}`);
  if (!combos) return singles;
  const pairs: string[] = [];
  for (let i = 0; i < DIMS.length; i++)
    for (let j = i + 1; j < DIMS.length; j++)
      pairs.push(`${DIMS[i]}=${labels[DIMS[i]!]} ∩ ${DIMS[j]}=${labels[DIMS[j]!]}`);
  return [...singles, ...pairs];
}

/** 픽 착순 ≤ thr 비율의 모델−인기 차이. */
function edge(rows: EdgeRow[], thr: number): number {
  const n = rows.length;
  if (n === 0) return 0;
  const m = rows.filter((r) => r.modelPickOrd <= thr).length / n;
  const f = rows.filter((r) => r.favPickOrd <= thr).length / n;
  return m - f;
}

export function aggregate(rows: EdgeRow[], opts: AggOptions): SegmentStat[] {
  const bySeg = new Map<string, EdgeRow[]>();
  for (const row of rows)
    for (const seg of segmentKeysFor(row.labels, opts.combos)) {
      if (!bySeg.has(seg)) bySeg.set(seg, []);
      bySeg.get(seg)!.push(row);
    }

  const stats: SegmentStat[] = [];
  for (const [segment, segRows] of bySeg) {
    const byQ = new Map<string, EdgeRow[]>();
    for (const r of segRows) {
      if (!byQ.has(r.quarterKey)) byQ.set(r.quarterKey, []);
      byQ.get(r.quarterKey)!.push(r);
    }
    const quarters: QuarterCell[] = [...byQ.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, qr]) => ({ key, n: qr.length, placeEdge: edge(qr, 3) }));
    const qualifying = quarters.filter((q) => q.n >= opts.minCellN);
    const positive = qualifying.filter((q) => q.placeEdge > 0);
    const verdict: SegmentStat['verdict'] =
      qualifying.length < opts.minQuarters ? '보류'
      : positive.length / qualifying.length >= opts.positiveRatio ? '채택후보'
      : '혼조';
    stats.push({
      segment,
      totalN: segRows.length,
      quarters,
      qualifyingQuarters: qualifying.length,
      positiveQuarters: positive.length,
      pooledWinEdge: edge(segRows, 1),
      pooledTop2Edge: edge(segRows, 2),
      pooledPlaceEdge: edge(segRows, 3),
      verdict,
    });
  }
  return stats;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/edgeMining.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/edgeMining.ts src/engine/eval/edgeMining.test.ts
git commit -m "feat(edge): StabilityAggregator — 구간×분기 엣지 + 분기안정성 판정"
```

---

## Task 6: Reporter (formatReport, sparkline)

**Files:**
- Modify: `src/engine/eval/edgeMining.ts`
- Modify: `src/engine/eval/edgeMining.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`edgeMining.test.ts`에 추가:

```ts
import { formatReport, sparkline } from './edgeMining.js';

describe('Reporter', () => {
  it('sparkline: 표본부족=· / 양수=+ / 음수=−', () => {
    const quarters = [
      { key: '2025-Q1', n: 12, placeEdge: 0.1 },
      { key: '2025-Q2', n: 5, placeEdge: -0.2 },
      { key: '2025-Q3', n: 12, placeEdge: -0.05 },
    ];
    expect(sparkline(quarters, 10)).toBe('+ · −');
  });
  it('formatReport: 채택후보가 보류보다 먼저', () => {
    const stats = [
      { segment: 'X', totalN: 10, quarters: [], qualifyingQuarters: 1, positiveQuarters: 0, pooledWinEdge: 0, pooledTop2Edge: 0, pooledPlaceEdge: -0.1, verdict: '보류' as const },
      { segment: 'Y', totalN: 50, quarters: [], qualifyingQuarters: 6, positiveQuarters: 5, pooledWinEdge: 0.02, pooledTop2Edge: 0.03, pooledPlaceEdge: 0.04, verdict: '채택후보' as const },
    ];
    const out = formatReport(stats, 10);
    expect(out.indexOf('Y')).toBeLessThan(out.indexOf('X'));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/edgeMining.test.ts`
Expected: FAIL — `formatReport`/`sparkline` 미정의.

- [ ] **Step 3: 구현 추가**

`edgeMining.ts` 파일 끝에 추가:

```ts
/** 분기별 +/− 한눈 표시. 표본부족(n<minCellN)은 · */
export function sparkline(quarters: QuarterCell[], minCellN: number): string {
  return quarters.map((q) => (q.n < minCellN ? '·' : q.placeEdge > 0 ? '+' : '−')).join(' ');
}

export function formatReport(stats: SegmentStat[], minCellN: number): string {
  const order: Record<SegmentStat['verdict'], number> = { '채택후보': 0, '혼조': 1, '보류': 2 };
  const sorted = [...stats].sort((a, b) =>
    order[a.verdict] - order[b.verdict] || b.pooledPlaceEdge - a.pooledPlaceEdge);
  const pct = (d: number) => `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%p`.padStart(7);
  const lines: string[] = [];
  lines.push('구간                                          │ 총n │ +/유효 │  연승 │  단승 │   2착 │ 판정');
  lines.push('─'.repeat(108));
  for (const s of sorted) {
    lines.push(
      `${s.segment.padEnd(44).slice(0, 44)} │ ${String(s.totalN).padStart(3)} │ ${String(s.positiveQuarters).padStart(2)}/${String(s.qualifyingQuarters).padEnd(3)}│ ${pct(s.pooledPlaceEdge)} │ ${pct(s.pooledWinEdge)} │ ${pct(s.pooledTop2Edge)} │ ${s.verdict}`
    );
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/edgeMining.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/edgeMining.ts src/engine/eval/edgeMining.test.ts
git commit -m "feat(edge): Reporter — 안정성 정렬 ASCII 표 + 분기 스파크라인"
```

---

## Task 7: CLI 스크립트 + 첫 실행 해석

**Files:**
- Create: `scripts/mine_conditional_edge.ts`
- Modify: `package.json`

- [ ] **Step 1: CLI 작성**

`scripts/mine_conditional_edge.ts`:

```ts
/**
 * 조건부 엣지 마이닝 — 모델top1 vs 인기top1 정면대결을 조건 구간별로.
 * 사용: npm run mine:edge [-- --champion <id> --min-n <N> --no-combos]
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { loadVersion } from '../src/engine/eval/champion.js';
import { recordEdges, aggregate, formatReport, sparkline } from '../src/engine/eval/edgeMining.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const champIdx = args.indexOf('--champion');
  const championId = champIdx >= 0 ? Number(args[champIdx + 1]) : undefined;
  const minNIdx = args.indexOf('--min-n');
  const minCellN = minNIdx >= 0 ? Number(args[minNIdx + 1]) : 20;
  const combos = !args.includes('--no-combos');

  const db = await getLocalDb();
  console.log('📊 조건부 엣지 마이닝\n데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);

  const champ = await loadVersion(db, championId !== undefined ? { id: championId } : {});
  if (!champ) throw new Error('챔피언 버전 없음');
  console.log(`챔피언: ${champ.row.label} (id=${champ.row.id})`);

  const rows = recordEdges(races, champ.model);
  console.log(`불일치 경주(모델1순위≠인기1순위): ${rows.length}건  (minCellN=${minCellN}, combos=${combos})\n`);

  const stats = aggregate(rows, { minCellN, minQuarters: 6, positiveRatio: 0.6, combos });
  console.log(formatReport(stats, minCellN));

  const cands = stats.filter((s) => s.verdict === '채택후보');
  console.log(`\n채택후보 ${cands.length}건`);
  for (const s of cands) console.log(`  ${s.segment}\n    ${sparkline(s.quarters, minCellN)}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: package.json 스크립트 추가**

`package.json` scripts에 `"benchmark"` 줄 아래 추가:

```json
    "mine:edge": "tsx scripts/mine_conditional_edge.ts",
```

- [ ] **Step 3: 타입체크**

Run: `npm run build`
Expected: 에러 없음.

- [ ] **Step 4: 첫 실행**

Run: `npm run mine:edge`
Expected: 경주 수·불일치 건수 출력 후 구간 표. minQuarters=6(완전분기 8개 기준), 기본 minCellN=20. 표본 부족 단일 구간은 minCellN을 낮춰 재실행 가능(`npm run mine:edge -- --min-n 12`).

- [ ] **Step 5: 결과 해석 + 문서화**

표를 보고:
- 채택후보가 있으면 → 그 조건분포를 `docs/feature_hypotheses.md`에 신규 후보로 등록(N1 양식). 이후 별도 brainstorm/게이트.
- 채택후보 0이면 → 흡수/집계 천장 재확인. `docs/strategy/2026-06-16-*`에 음성 결과 1줄 기록(정직한 음성도 메타패턴).

`docs/strategy/2026-06-16-market-edge-and-korean-winning-conditions.md` C3 표의 "조건부 엣지" 행을 결과로 갱신.

- [ ] **Step 6: 전체 테스트 + Commit**

Run: `npm run test:run`
Expected: 전체 통과(기존 + edgeMining 12).

```bash
git add scripts/mine_conditional_edge.ts package.json docs/
git commit -m "feat(edge): mine:edge CLI + 첫 실행 결과 문서화"
```

---

## Self-Review 체크 (작성자 확인 완료)

- **스펙 커버리지:** §4.1 Conditioner=Task3 / §4.2 EdgeRecorder=Task4 / §4.3 Aggregator=Task5 / §4.4 Reporter=Task6 / §5 CLI=Task7 / §3 데이터 거리=Task2 / §4.1 임계값 probe=Task1. 전부 매핑됨.
- **플레이스홀더:** 없음(모든 step에 실코드·실명령·기대출력).
- **타입 일관성:** `SegmentLabels`/`EdgeRow`/`SegmentStat`/`AggOptions`/`QuarterCell` 전 태스크 일치. `conditionRace`·`recordEdges`·`aggregate`·`formatReport`·`sparkline` 시그니처 호출부와 일치. `ScorableModel`(weights 변형) 테스트 사용 정확.
- **범위:** 단일 도구·읽기전용. 말단위·EV·자동채택은 스펙 §7대로 제외.
