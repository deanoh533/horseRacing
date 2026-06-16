# 캘리브레이션 평가축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모델 확률(P1착·P3착내)의 정직성을 시장 배당 함의확률과 나란히 측정하는 읽기전용 CLI(`npm run calib`)를 만든다 — 신뢰도 곡선·ECE·Brier·log-loss, 롤링 OOS.

**Architecture:** 순수 지표는 `src/engine/eval/calibration.ts`(reliabilityBins/ece/brier/logLoss/normalizeProbs/formatCalibration), OOS 추출·실행은 `scripts/calibration_report.ts`. 기존 `collectRaces`·`rollingBlocks`·`fitLogistic`·`predictLogit`·`buildSchema`·`toVector` 재사용.

**Tech Stack:** TypeScript, Node.js, DuckDB(로컬 미러), vitest, tsx.

---

## 파일 구조

- Create: `src/engine/eval/calibration.ts` — 순수 지표 + 포맷 + 타입
- Create: `src/engine/eval/calibration.test.ts` — 단위 테스트
- Create: `scripts/calibration_report.ts` — CLI(OOS 추출)
- Modify: `package.json` — `"calib"` 스크립트

스펙: `docs/superpowers/specs/2026-06-16-calibration-axis-design.md`

ESM 규약: 상대 import에 `.js` 확장자. 커밋 메시지 한국어 + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: 순수 지표 (calibration.ts)

**Files:** Create `src/engine/eval/calibration.ts`, `src/engine/eval/calibration.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/engine/eval/calibration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reliabilityBins, ece, brier, logLoss, normalizeProbs } from './calibration.js';

describe('normalizeProbs', () => {
  it('합으로 나눠 합=1', () => {
    expect(normalizeProbs([1, 1, 2])).toEqual([0.25, 0.25, 0.5]);
  });
  it('합 0이면 전부 0 (방어)', () => {
    expect(normalizeProbs([0, 0])).toEqual([0, 0]);
  });
});

describe('reliabilityBins — 등개수 분위', () => {
  it('2 bin: 낮은 p 묶음 rate 0.1, 높은 p 묶음 rate 0.9', () => {
    const pairs = [
      ...Array.from({ length: 10 }, (_, i) => ({ p: 0.1, y: i === 0 ? 1 : 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ p: 0.9, y: i < 9 ? 1 : 0 })),
    ];
    const bins = reliabilityBins(pairs, 2);
    expect(bins).toHaveLength(2);
    expect(bins[0]!.avgPred).toBeCloseTo(0.1, 6);
    expect(bins[0]!.actualRate).toBeCloseTo(0.1, 6);
    expect(bins[0]!.n).toBe(10);
    expect(bins[1]!.avgPred).toBeCloseTo(0.9, 6);
    expect(bins[1]!.actualRate).toBeCloseTo(0.9, 6);
  });
  it('빈 입력 → 빈 배열', () => {
    expect(reliabilityBins([], 10)).toEqual([]);
  });
});

describe('ece', () => {
  it('가중 절대편차 합', () => {
    const bins = [
      { avgPred: 0.2, actualRate: 0.1, n: 10 },
      { avgPred: 0.6, actualRate: 0.7, n: 10 },
    ];
    expect(ece(bins)).toBeCloseTo(0.1, 6); // 0.5*0.1 + 0.5*0.1
  });
});

describe('brier', () => {
  it('평균제곱오차', () => {
    expect(brier([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }])).toBeCloseTo(0.25, 6);
  });
});

describe('logLoss', () => {
  it('p=0,y=1도 클립으로 유한값', () => {
    const v = logLoss([{ p: 0, y: 1 }]);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThan(15); // -ln(1e-9) ≈ 20.7
  });
  it('완벽예측이면 ~0', () => {
    expect(logLoss([{ p: 1, y: 1 }])).toBeCloseTo(0, 6);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/calibration.test.ts`
Expected: FAIL — 함수 미정의.

- [ ] **Step 3: 구현**

`src/engine/eval/calibration.ts`:

```ts
export interface Pair { p: number; y: number; }
export interface Bin { avgPred: number; actualRate: number; n: number; }

/** 값들을 합으로 나눠 합=1 분포로. 합이 0 이하면 전부 0(방어). */
export function normalizeProbs(values: number[]): number[] {
  const sum = values.reduce((s, v) => s + v, 0);
  if (sum <= 0) return values.map(() => 0);
  return values.map((v) => v / sum);
}

/** 예측확률 오름차순 등개수 분위 bin. 각 bin: 평균예측·실제비율·표본수. */
export function reliabilityBins(pairs: Pair[], nBins = 10): Bin[] {
  if (pairs.length === 0) return [];
  const sorted = [...pairs].sort((a, b) => a.p - b.p);
  const n = sorted.length;
  const bins: Bin[] = [];
  for (let i = 0; i < nBins; i++) {
    const start = Math.floor((i * n) / nBins);
    const end = Math.floor(((i + 1) * n) / nBins);
    const slice = sorted.slice(start, end);
    if (slice.length === 0) continue;
    const avgPred = slice.reduce((s, x) => s + x.p, 0) / slice.length;
    const actualRate = slice.reduce((s, x) => s + x.y, 0) / slice.length;
    bins.push({ avgPred, actualRate, n: slice.length });
  }
  return bins;
}

/** 기대 캘리브레이션 오차 = Σ (bin비중)·|평균예측−실제비율|. */
export function ece(bins: Bin[]): number {
  const total = bins.reduce((s, b) => s + b.n, 0);
  if (total === 0) return 0;
  return bins.reduce((s, b) => s + (b.n / total) * Math.abs(b.avgPred - b.actualRate), 0);
}

/** Brier = 평균((p−y)²). */
export function brier(pairs: Pair[]): number {
  if (pairs.length === 0) return 0;
  return pairs.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / pairs.length;
}

/** log-loss = −평균(y·ln p + (1−y)·ln(1−p)), p는 [1e−9, 1−1e−9] 클립. */
export function logLoss(pairs: Pair[]): number {
  if (pairs.length === 0) return 0;
  const clip = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));
  const sum = pairs.reduce((s, x) => {
    const p = clip(x.p);
    return s + (x.y * Math.log(p) + (1 - x.y) * Math.log(1 - p));
  }, 0);
  return -sum / pairs.length;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/calibration.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/calibration.ts src/engine/eval/calibration.test.ts
git commit -m "feat(calib): 순수 지표 — reliabilityBins·ece·brier·logLoss·normalizeProbs"
```

---

## Task 2: 리포트 포맷 (formatCalibration)

**Files:** Modify `src/engine/eval/calibration.ts`, `src/engine/eval/calibration.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`calibration.test.ts`에 추가:

```ts
import { formatCalibration, type CalibrationReport } from './calibration.js';

describe('formatCalibration — 스모크', () => {
  it('모델·시장·P3·분기 섹션 포함', () => {
    const mk = (n: number, p: number, y: number): { p: number; y: number }[] =>
      Array.from({ length: n }, () => ({ p, y }));
    const report: CalibrationReport = {
      modelWin: [...mk(50, 0.1, 0), ...mk(50, 0.3, 1)],
      marketWin: [...mk(50, 0.12, 0), ...mk(50, 0.28, 1)],
      modelTop3: [...mk(50, 0.2, 0), ...mk(50, 0.5, 1)],
      perQuarter: [{ key: '2025-Q1', modelEce: 0.05, marketEce: 0.04 }],
    };
    const out = formatCalibration(report);
    expect(out).toContain('P(1착)');
    expect(out).toContain('시장');
    expect(out).toContain('P(3착내)');
    expect(out).toContain('ECE');
    expect(out).toContain('2025-Q1');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/calibration.test.ts`
Expected: FAIL — `formatCalibration` 미정의.

- [ ] **Step 3: 구현 추가**

`calibration.ts` 파일 끝에 추가:

```ts
export interface CalibrationReport {
  modelWin: Pair[];
  marketWin: Pair[];
  modelTop3: Pair[];
  perQuarter: { key: string; modelEce: number; marketEce: number }[];
}

/** 신뢰도 표(P1착 모델 vs 시장 + P3착내 모델) + 요약수 + 분기별 ECE. ASCII. */
export function formatCalibration(r: CalibrationReport, nBins = 10): string {
  const f3 = (x: number) => x.toFixed(3);
  const lines: string[] = [];

  const mWin = reliabilityBins(r.modelWin, nBins);
  const kWin = reliabilityBins(r.marketWin, nBins);
  lines.push('=== P(1착) 신뢰도: 모델 vs 시장 (OOS 풀링) ===');
  lines.push('bin │ 모델예측 모델실제    n  │ 시장예측 시장실제    n');
  lines.push('─'.repeat(62));
  const cell = (b?: Bin) =>
    b ? `${f3(b.avgPred)}    ${f3(b.actualRate)}  ${String(b.n).padStart(4)}` : '   -        -       -';
  const nrows = Math.max(mWin.length, kWin.length);
  for (let i = 0; i < nrows; i++) {
    lines.push(`${String(i + 1).padStart(2)}  │ ${cell(mWin[i])} │ ${cell(kWin[i])}`);
  }
  lines.push('');
  lines.push('요약           모델       시장');
  lines.push(`ECE        ${f3(ece(mWin)).padStart(8)}  ${f3(ece(kWin)).padStart(8)}`);
  lines.push(`Brier      ${f3(brier(r.modelWin)).padStart(8)}  ${f3(brier(r.marketWin)).padStart(8)}`);
  lines.push(`log-loss   ${f3(logLoss(r.modelWin)).padStart(8)}  ${f3(logLoss(r.marketWin)).padStart(8)}`);
  lines.push('');

  const mT3 = reliabilityBins(r.modelTop3, nBins);
  lines.push('=== P(3착내) 신뢰도: 모델 단독 ===');
  lines.push('bin │ 모델예측 모델실제    n');
  for (let i = 0; i < mT3.length; i++) {
    const b = mT3[i]!;
    lines.push(`${String(i + 1).padStart(2)}  │ ${f3(b.avgPred)}    ${f3(b.actualRate)}  ${String(b.n).padStart(4)}`);
  }
  lines.push(`ECE=${f3(ece(mT3))}  Brier=${f3(brier(r.modelTop3))}  log-loss=${f3(logLoss(r.modelTop3))}`);
  lines.push('');

  lines.push('분기별 ECE(P1착)  [모델 / 시장]');
  for (const q of r.perQuarter) lines.push(`  ${q.key}: ${f3(q.modelEce)} / ${f3(q.marketEce)}`);

  return lines.join('\n');
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/calibration.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/calibration.ts src/engine/eval/calibration.test.ts
git commit -m "feat(calib): formatCalibration — 신뢰도 표(모델 vs 시장)+요약+분기 ECE"
```

---

## Task 3: CLI + 첫 실행 해석

**Files:** Create `scripts/calibration_report.ts`, Modify `package.json`

- [ ] **Step 1: CLI 작성**

`scripts/calibration_report.ts`:

```ts
/**
 * 캘리브레이션 평가축 — 모델 확률 정직성 vs 시장 (롤링 OOS).
 * 사용: npm run calib
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { rollingBlocks } from '../src/engine/eval/rolling.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import {
  normalizeProbs, reliabilityBins, ece, formatCalibration,
  type Pair, type CalibrationReport,
} from '../src/engine/eval/calibration.js';

async function main(): Promise<void> {
  const db = await getLocalDb();
  console.log('📊 캘리브레이션 평가축\n데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);

  const blocks = rollingBlocks(races, { year: 2025, q: 1 });
  const modelWin: Pair[] = [];
  const marketWin: Pair[] = [];
  const modelTop3: Pair[] = [];
  const perQ = new Map<string, { mw: Pair[]; kw: Pair[] }>();
  const cfg = { l2: 0.02, iters: 800, lr: 0.2 };

  for (const block of blocks) {
    const schema = buildSchema(block.train.flatMap((r) => r.horses.map((h) => h.features)))
      .filter((n) => !n.endsWith('__missing'));
    const X = block.train.flatMap((r) => r.horses.map((h) => toVector(h.features, schema)));
    const y1 = block.train.flatMap((r) => r.horses.map((h) => (h.ord === 1 ? 1 : 0)));
    const y3 = block.train.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));
    const p1 = fitLogistic(X, y1, schema, cfg);
    const p3 = fitLogistic(X, y3, schema, cfg);

    if (!perQ.has(block.key)) perQ.set(block.key, { mw: [], kw: [] });
    const q = perQ.get(block.key)!;

    for (const race of block.test) {
      const horses = race.horses;
      const rawWin = horses.map((h) => predictLogit(p1, toVector(h.features, schema)));
      const normWin = normalizeProbs(rawWin);
      horses.forEach((h, i) => {
        const pair: Pair = { p: normWin[i]!, y: h.ord === 1 ? 1 : 0 };
        modelWin.push(pair); q.mw.push(pair);
        modelTop3.push({ p: predictLogit(p3, toVector(h.features, schema)), y: h.ord <= 3 ? 1 : 0 });
      });
      const withOdds = horses.filter((h) => h.winOdds != null && h.winOdds > 0);
      const rawMkt = withOdds.map((h) => 1 / (h.winOdds as number));
      const normMkt = normalizeProbs(rawMkt);
      withOdds.forEach((h, i) => {
        const pair: Pair = { p: normMkt[i]!, y: h.ord === 1 ? 1 : 0 };
        marketWin.push(pair); q.kw.push(pair);
      });
    }
  }

  const eceOf = (pairs: Pair[]) => ece(reliabilityBins(pairs, 10));
  const perQuarter = [...perQ.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ key, modelEce: eceOf(v.mw), marketEce: eceOf(v.kw) }));

  const report: CalibrationReport = { modelWin, marketWin, modelTop3, perQuarter };
  console.log(`\nOOS 분기: ${blocks.map((b) => b.key).join(', ')}`);
  console.log(`표본: 모델 ${modelWin.length}말 / 시장 ${marketWin.length}말\n`);
  console.log(formatCalibration(report));
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: package.json 스크립트 추가**

`package.json` scripts의 `"mine:edge"` 줄 아래 추가:

```json
    "calib": "tsx scripts/calibration_report.ts",
```

- [ ] **Step 3: 타입체크**

Run: `npm run build`
Expected: 에러 없음.

- [ ] **Step 4: 첫 실행**

Run: `npm run calib`
Expected: 경주 수·OOS 분기·표본수 출력 후 P(1착) 모델 vs 시장 신뢰도 표, 요약수(ECE/Brier/logLoss), P(3착내) 표, 분기별 ECE. (수집·8분기 학습으로 1~2분 소요.)

- [ ] **Step 5: 결과 해석 + 문서화**

표를 읽고:
- 모델 ECE/Brier/logLoss가 시장과 비슷/낮으면 → "확률 정직성 경쟁력 有"(제품 차별점 근거). `docs/strategy/2026-06-16-*`에 결과 기록.
- 모델이 크게 높으면(과신/과소) → 재보정(Platt/isotonic) 후속 트리거로 기록.
- 신뢰도 표에서 특정 구간(예: 고확률 bin)만 어긋나면 그 패턴 메모.

`docs/strategy/2026-06-16-market-edge-and-korean-winning-conditions.md`에 §C7(캘리브레이션 결과) 추가, C3 표 갱신.

- [ ] **Step 6: 전체 테스트 + Commit**

Run: `npm run test:run`
Expected: 전체 통과(기존 + calibration 9).

```bash
git add scripts/calibration_report.ts package.json docs/
git commit -m "feat(calib): calib CLI + 첫 실행 결과 문서화"
```

---

## Self-Review 체크 (작성자 확인 완료)

- **스펙 커버리지:** §4 calibration.ts 지표=Task1 / formatCalibration=Task2 / §3 OOS 추출·정규화=Task3(normalizeProbs는 Task1) / §6 CLI=Task3 / §2 4지표=Task1. 전부 매핑.
- **플레이스홀더:** 없음(실코드·실명령·기대출력).
- **타입 일관성:** `Pair`/`Bin`/`CalibrationReport` 전 태스크 일치. `reliabilityBins`·`ece`·`brier`·`logLoss`·`normalizeProbs`·`formatCalibration` 시그니처 호출부와 일치. `fitLogistic`/`predictLogit`/`buildSchema`/`toVector`/`rollingBlocks` 기존 시그니처대로(models.ts 확인).
- **범위:** 측정만. 재보정·베팅EV 제외(스펙 §8).
