# Stage 2 Phase 1 — value 베팅 백테스트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 0이 찾은 엣지(중배당 × 모델 상위터셀)에 연승 베팅했을 때 ROI가 양수인지 검증하는 읽기 전용 백테스트를 만든다.

**Architecture:** 순수 집계 헬퍼(`valueBacktest.ts`, 단위 테스트)와 얇은 실행 스크립트(`backtest_value_betting.ts`)로 분리. 스크립트는 기존 학습행렬(`training_matrix.jsonl`) + Stage-1 로지스틱(`fitLogistic`/`predictLogit`)으로 P(top3) 점수를 내고, `race_entries.plc_odds`를 `hr_name`으로 조인해 정산한다. 베팅 선정 컷오프는 **train 데이터**로 정해 look-ahead를 피한다.

**Tech Stack:** Node.js + TypeScript (ESM, `.js` import 확장자), tsx 실행, vitest 테스트, Supabase admin 클라이언트.

**스펙:** `docs/superpowers/specs/2026-06-04-stage2-phase1-value-betting-design.md`

---

## File Structure

- **Create** `src/engine/analysis/valueBacktest.ts` — 순수 함수: 배당구간 컷오프, 베팅 선정, ROI·집계. (DB·IO 없음, 테스트 대상)
- **Create** `src/engine/analysis/valueBacktest.test.ts` — 위 함수 단위 테스트.
- **Create** `scripts/backtest_value_betting.ts` — 실행 스크립트: 행렬 로드 → 로지스틱 학습 → plc_odds 조인 → 베팅 백테스트 → 구간별/분기별 ROI 출력. (얇은 wiring, `probe_market_edge.ts`와 동형)
- **Modify** `package.json` — `scripts`에 `"backtest:value"` 추가.

기존 재사용(수정 없음): `src/engine/models/logistic.ts`(`fitLogistic`,`predictLogit`), `src/engine/features/alignFeatures.ts`(`buildSchema`,`toVector`), `src/engine/analysis/edgeProbe.ts`(`oddsBand`), `src/db/supabase.ts`(`getSupabaseAdmin`).

---

## Task 1: 배당구간 컷오프 헬퍼

**Files:**
- Create: `src/engine/analysis/valueBacktest.ts`
- Test: `src/engine/analysis/valueBacktest.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/engine/analysis/valueBacktest.test.ts
import { describe, it, expect } from 'vitest';
import { quantileCutoff, topTercileCutoffs, isBet } from './valueBacktest.js';

describe('quantileCutoff', () => {
  it('2/3 분위 = 상위 1/3 경계 (terciles 정의와 일치)', () => {
    // floor(2/3 * 6) = 4 → 오름차순 [10,20,30,40,50,60]의 index 4 = 50
    expect(quantileCutoff([10, 20, 30, 40, 50, 60], 2 / 3)).toBe(50);
  });
  it('정렬 순서 무관', () => {
    expect(quantileCutoff([60, 10, 40, 20, 50, 30], 2 / 3)).toBe(50);
  });
  it('빈 배열은 Infinity (아무도 컷 통과 못함)', () => {
    expect(quantileCutoff([], 2 / 3)).toBe(Infinity);
  });
});

describe('topTercileCutoffs', () => {
  it('배당구간별 상위 1/3 점수 컷오프', () => {
    const recs = [
      { odds: 5, score: 0.1 }, { odds: 5, score: 0.2 }, { odds: 5, score: 0.3 },
      { odds: 5, score: 0.4 }, { odds: 5, score: 0.5 }, { odds: 5, score: 0.6 },
    ];
    // 4-7 구간: floor(2/3*6)=4 → index4 = 0.5
    expect(topTercileCutoffs(recs)['4-7']).toBeCloseTo(0.5, 5);
  });
  it('na 배당(0 이하)은 무시', () => {
    const recs = [{ odds: 0, score: 0.9 }, { odds: 5, score: 0.5 }];
    const out = topTercileCutoffs(recs);
    expect(out['na']).toBeUndefined();
    expect(out['4-7']).toBeDefined();
  });
});

describe('isBet', () => {
  it('구간 컷오프 이상이면 베팅', () => {
    const cut = { '4-7': 0.5 };
    expect(isBet(5, 0.6, cut)).toBe(true);
    expect(isBet(5, 0.5, cut)).toBe(true);
    expect(isBet(5, 0.49, cut)).toBe(false);
  });
  it('컷오프 없는 구간은 베팅 안 함', () => {
    expect(isBet(1.5, 0.99, { '4-7': 0.5 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/analysis/valueBacktest.test.ts`
Expected: FAIL — "Failed to resolve import './valueBacktest.js'" (모듈 미존재).

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/engine/analysis/valueBacktest.ts
/**
 * Stage 2 Phase 1 — value 베팅 백테스트 순수 헬퍼.
 * 베팅 선정(배당구간 train 컷오프)·정산(plc_odds)·ROI 집계. DB/IO 없음.
 * 스펙: docs/superpowers/specs/2026-06-04-stage2-phase1-value-betting-design.md
 */
import { oddsBand } from './edgeProbe.js';

/** 오름차순 정렬 후 q 분위의 값(하한 인덱스). q=2/3 → 상위 1/3 경계. */
export function quantileCutoff(scores: number[], q: number): number {
  if (scores.length === 0) return Infinity;
  const sorted = [...scores].sort((a, b) => a - b);
  const idx = Math.min(Math.floor(q * sorted.length), sorted.length - 1);
  return sorted[idx]!;
}

/** 각 배당구간에서 말 점수의 상위 1/3 경계 컷오프(2/3 분위). na 배당 무시. */
export function topTercileCutoffs(recs: { odds: number; score: number }[]): Record<string, number> {
  const byBand = new Map<string, number[]>();
  for (const r of recs) {
    const b = oddsBand(r.odds);
    if (b === 'na') continue;
    if (!byBand.has(b)) byBand.set(b, []);
    byBand.get(b)!.push(r.score);
  }
  const out: Record<string, number> = {};
  for (const [b, scores] of byBand) out[b] = quantileCutoff(scores, 2 / 3);
  return out;
}

/** 베팅 여부: 점수가 해당 배당구간 컷오프 이상이면 true. */
export function isBet(odds: number, score: number, cutoffs: Record<string, number>): boolean {
  const b = oddsBand(odds);
  if (b === 'na') return false;
  const c = cutoffs[b];
  return c != null && score >= c;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/analysis/valueBacktest.test.ts`
Expected: PASS (quantileCutoff·topTercileCutoffs·isBet 전부 통과).

- [ ] **Step 5: Commit**

```bash
git add src/engine/analysis/valueBacktest.ts src/engine/analysis/valueBacktest.test.ts
git commit -m "feat(analysis): value 베팅 배당구간 컷오프 헬퍼 (train 기준 상위터셀)"
```

---

## Task 2: ROI·집계 헬퍼

**Files:**
- Modify: `src/engine/analysis/valueBacktest.ts`
- Test: `src/engine/analysis/valueBacktest.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```typescript
// valueBacktest.test.ts 끝에 추가
import { roi, summarize, type Bet } from './valueBacktest.js';

describe('roi', () => {
  it('정액 베팅 ROI = Σ입상배당/nBets − 1 (입상=plcOdds!=null)', () => {
    // 1픽 배당 3.0 1회 적중, 3베팅 → (3+0+0)/3 - 1 = 0 (본전)
    const bets: Bet[] = [
      { band: '4-7', plcOdds: 3 }, { band: '4-7', plcOdds: null }, { band: '4-7', plcOdds: null },
    ];
    expect(roi(bets)).toBeCloseTo(0, 5);
  });
  it('양의 ROI', () => {
    const bets: Bet[] = [{ band: '4-7', plcOdds: 2 }, { band: '4-7', plcOdds: 2 }, { band: '4-7', plcOdds: null }];
    expect(roi(bets)).toBeCloseTo(4 / 3 - 1, 5); // 0.333
  });
  it('빈 베팅은 0', () => {
    expect(roi([])).toBe(0);
  });
});

describe('summarize', () => {
  it('배당구간별 베팅수·적중수·적중율·평균배당·ROI', () => {
    const bets: Bet[] = [
      { band: '4-7', plcOdds: 2.5 }, { band: '4-7', plcOdds: null },
      { band: '7-15', plcOdds: 5 }, { band: '7-15', plcOdds: null }, { band: '7-15', plcOdds: null },
    ];
    const out = summarize(bets);
    const b47 = out.find((b) => b.band === '4-7')!;
    expect(b47.nBets).toBe(2);
    expect(b47.nHits).toBe(1);
    expect(b47.hitRate).toBeCloseTo(0.5, 5);
    expect(b47.avgOdds).toBeCloseTo(2.5, 5);
    expect(b47.roi).toBeCloseTo(2.5 / 2 - 1, 5); // 0.25
    const b715 = out.find((b) => b.band === '7-15')!;
    expect(b715.roi).toBeCloseTo(5 / 3 - 1, 5); // 0.667
  });
  it('배당구간 순서대로 정렬, 빈 구간 제외', () => {
    const bets: Bet[] = [{ band: '7-15', plcOdds: 4 }, { band: '4-7', plcOdds: 2 }];
    expect(summarize(bets).map((b) => b.band)).toEqual(['4-7', '7-15']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/analysis/valueBacktest.test.ts`
Expected: FAIL — `roi`/`summarize`/`Bet` export 미존재.

- [ ] **Step 3: Write minimal implementation (append to valueBacktest.ts)**

```typescript
// valueBacktest.ts 끝에 추가

export interface Bet { band: string; plcOdds: number | null }
export interface BandSummary {
  band: string; nBets: number; nHits: number; hitRate: number; avgOdds: number; roi: number;
}

/** 정액 베팅 ROI. 입상(plcOdds!=null) 시 회수=plcOdds, 미입상 0. ROI=Σ회수/nBets−1. */
export function roi(bets: Bet[]): number {
  if (bets.length === 0) return 0;
  const ret = bets.reduce((s, b) => s + (b.plcOdds != null ? b.plcOdds : 0), 0);
  return ret / bets.length - 1;
}

const BAND_ORDER = ['<2', '2-4', '4-7', '7-15', '15-30', '30+'];

/** 배당구간별 집계(고정 순서, 빈 구간 제외). */
export function summarize(bets: Bet[]): BandSummary[] {
  const byBand = new Map<string, Bet[]>();
  for (const b of bets) {
    if (!byBand.has(b.band)) byBand.set(b.band, []);
    byBand.get(b.band)!.push(b);
  }
  const out: BandSummary[] = [];
  for (const band of BAND_ORDER) {
    const rows = byBand.get(band);
    if (!rows || rows.length === 0) continue;
    const hits = rows.filter((r) => r.plcOdds != null);
    const avgOdds = hits.length ? hits.reduce((s, r) => s + (r.plcOdds as number), 0) / hits.length : 0;
    out.push({ band, nBets: rows.length, nHits: hits.length, hitRate: hits.length / rows.length, avgOdds, roi: roi(rows) });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/analysis/valueBacktest.test.ts`
Expected: PASS (전체 describe 통과).

- [ ] **Step 5: Commit**

```bash
git add src/engine/analysis/valueBacktest.ts src/engine/analysis/valueBacktest.test.ts
git commit -m "feat(analysis): value 베팅 ROI·배당구간 집계 헬퍼"
```

---

## Task 3: 백테스트 실행 스크립트

**Files:**
- Create: `scripts/backtest_value_betting.ts`
- Modify: `package.json` (scripts에 `backtest:value` 추가)

- [ ] **Step 1: Write the script**

```typescript
// scripts/backtest_value_betting.ts
/**
 * Stage 2 Phase 1 — value 베팅 백테스트 (읽기전용).
 * 중배당 × 모델 상위터셀(train 컷오프)에 연승 베팅 → plc_odds로 정산 → 구간별/분기별 ROI.
 * 스펙: docs/superpowers/specs/2026-06-04-stage2-phase1-value-betting-design.md
 * 사용: npm run backtest:value -- --matrix data/training_matrix.jsonl --split 20250101
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { oddsBand } from '../src/engine/analysis/edgeProbe.js';
import { topTercileCutoffs, isBet, summarize, roi, type Bet } from '../src/engine/analysis/valueBacktest.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number | null; win_odds: number | null; top3: number; features: Feature[]; }
const TARGET = ['4-7', '7-15']; // 주 타깃 중배당 (출력은 전 구간)
const quarter = (d: number) => `${Math.floor(d / 10000)}-Q${Math.floor((Math.floor((d % 10000) / 100) - 1) / 3) + 1}`;

function load(path: string): Row[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function printSummary(title: string, rows: ReturnType<typeof summarize>) {
  console.log(`\n### ${title}`);
  console.log('배당구간 | 베팅수 | 적중 | 적중율 | 평균배당 | ROI');
  console.log('-'.repeat(58));
  for (const r of rows) {
    const roiPct = (r.roi * 100);
    console.log(
      `${r.band.padEnd(8)} | ${String(r.nBets).padStart(6)} | ${String(r.nHits).padStart(4)} | ` +
      `${(r.hitRate * 100).toFixed(0).padStart(5)}% | ${r.avgOdds.toFixed(2).padStart(7)} | ` +
      `${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}%`
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const split = Number(arg('--split', '20250101'));

  const all = load(matrixPath);
  const train = all.filter((r) => r.race_date < split);
  const test = all.filter((r) => r.race_date >= split);

  // 1) Stage-1 로지스틱 학습 (Phase 0과 동일 하이퍼파라미터)
  const schema = buildSchema(train.map((r) => r.features));
  const model = fitLogistic(
    train.map((r) => toVector(r.features, schema)),
    train.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 },
  );

  // 2) train 점수로 배당구간 상위터셀 컷오프 (look-ahead 회피)
  const trainScored = train
    .filter((r) => r.win_odds && r.win_odds > 0)
    .map((r) => ({ odds: r.win_odds as number, score: predictLogit(model, toVector(r.features, schema)) }));
  const cutoffs = topTercileCutoffs(trainScored);
  console.log('배당구간 컷오프(train 상위1/3 logit):',
    Object.fromEntries(Object.entries(cutoffs).map(([k, v]) => [k, v.toFixed(3)])));

  // 3) plc_odds 조인 맵: (race_date,meet,rc_no,hr_name) → plc_odds (입상마만 non-null)
  const sb = getSupabaseAdmin();
  const plcMap = new Map<string, number | null>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_no, hr_name, plc_odds')
      .gte('race_date', split)
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number; hr_name: string; plc_odds: number | null }[]) {
      plcMap.set(`${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`, r.plc_odds);
    }
    if (data.length < PAGE) break;
  }

  // 4) test 말별 베팅 선정·정산
  interface QBet extends Bet { quarter: string }
  const bets: QBet[] = [];      // 전략: 컷오프 통과(상위터셀)
  const baseline: QBet[] = [];  // 베이스라인: 같은 구간 전 마필 무조건 베팅
  for (const r of test) {
    if (!(r.win_odds && r.win_odds > 0)) continue;
    if (oddsBand(r.win_odds) === 'na') continue;
    const score = predictLogit(model, toVector(r.features, schema));
    const plc = plcMap.get(`${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`) ?? null;
    const band = oddsBand(r.win_odds);
    const q = quarter(r.race_date);
    baseline.push({ band, plcOdds: plc, quarter: q });
    if (isBet(r.win_odds, score, cutoffs)) bets.push({ band, plcOdds: plc, quarter: q });
  }

  console.log(`\n테스트 ${test.length}행 / 유효배당 베팅후보 ${baseline.length} / 전략 베팅 ${bets.length}`);

  printSummary('전략: 중배당 × 모델 상위터셀 (구간별 ROI)', summarize(bets));
  printSummary('베이스라인: 구간 전 마필 무조건 연승 (시장 takeout 손실 기준선)', summarize(baseline));

  // 5) 주 타깃 구간 분기별 일관성
  console.log('\n========== 주 타깃(4-15) 분기별 ROI ==========');
  const quarters = [...new Set(bets.map((b) => b.quarter))].sort();
  console.log('구간    | ' + quarters.map((q) => q.padStart(9)).join(' | '));
  for (const band of TARGET) {
    const cells = quarters.map((q) => {
      const sub = bets.filter((b) => b.band === band && b.quarter === q);
      if (sub.length === 0) return '   -    ';
      const rp = roi(sub) * 100;
      return `${rp >= 0 ? '+' : ''}${rp.toFixed(0)}%(${sub.length})`.padStart(9);
    });
    console.log(`${band.padEnd(7)} | ${cells.join(' | ')}`);
  }

  console.log('\n판정: 주 타깃 구간이 ROI>0 + 다분기 일관(≈5/6↑ 양수) + 베팅수 충분이면 → Phase 2(calibration+Kelly).');
  console.log('정직성: plc_odds·win_odds는 사후 확정값 → ROI는 낙관적 상한. 단일분기 큰 ROI=노이즈.');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

`package.json`의 `scripts`에서 `"probe:edge"` 줄 아래에 추가:

```json
    "backtest:value": "tsx scripts/backtest_value_betting.ts",
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: PASS — tsc 에러 없음 (특히 `backtest_value_betting.ts`·`valueBacktest.ts` import·타입).

- [ ] **Step 4: Smoke run (DB·matrix 필요)**

전제: `.env`에 Supabase 키 설정됨, `data/training_matrix.jsonl` 존재(없으면 `npm run extract:matrix` 먼저).
Run: `npm run backtest:value -- --split 20250101`
Expected: 컷오프 출력 + 전략/베이스라인 구간별 ROI 표 + 분기별 표. 에러 없이 종료(exit 0).

> 결과 해석은 사람 판단(게이트). 스크립트는 판정을 강제하지 않고 표만 출력한다.

- [ ] **Step 5: Commit**

```bash
git add scripts/backtest_value_betting.ts package.json
git commit -m "feat(scripts): value 베팅 백테스트 — 중배당×상위터셀 연승 ROI(구간·분기)"
```

---

## Self-Review (작성자 체크 완료)

- **Spec coverage:** §2 베팅 규칙(중배당·상위터셀·flat·plc_odds 정산)=Task1+3 / §2 터셀 train 컷오프=Task1 / §3 데이터·조인(hr_name)=Task3 / §4 출력·구간별·분기별=Task3 / §4 베이스라인 비교=Task3 / §5 정직성(낙관적 상한·확정배당 주석)=Task3 출력문. 누락 없음.
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝에 실제 코드 포함.
- **Type consistency:** `Bet{band,plcOdds}` 정의(Task2)와 스크립트 사용 일치. `summarize`/`roi`/`isBet`/`topTercileCutoffs`/`quantileCutoff` 시그니처가 테스트·스크립트에서 동일. `oddsBand` 반환 라벨(`edgeProbe.ts`)과 `TARGET`·`BAND_ORDER` 일치.
- **정직성 가정 명시:** train 컷오프(look-ahead 회피), plc_odds 사후 확정값(낙관적 상한) — 스펙·스크립트 출력 모두 반영.
