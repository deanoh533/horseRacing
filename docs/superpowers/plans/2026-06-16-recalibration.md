# 확률 재보정 (Platt/isotonic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모델 확률의 체계적 편향(본명 과소확신·롱샷 과대확신)을 Platt·Isotonic 단조 변환으로 교정했을 때 OOS에서 정직성(ECE/Brier/log-loss)이 개선되는지 측정한다.

**Architecture:** 순수 함수 4개(`fitPlatt`/`applyPlatt`/`fitIsotonic`/`applyIsotonic`)를 기존 `src/engine/eval/calibration.ts`에 추가(단위테스트 대상). 보정자는 롤링 블록의 **train fold에서만 학습** → test fold에 적용해 누수 0. 신규 스크립트 `scripts/recalibration_report.ts`가 기존 `calibration_report.ts` 패턴을 그대로 따라 원본 vs Platt vs Isotonic 표를 출력한다. 라이브 경로·DB·모델 학습 불변.

**Tech Stack:** TypeScript, tsx, vitest, 기존 `calibration.ts`/`collect.ts`/`rolling.ts`/`logistic.ts` 모듈.

**Spec:** `docs/superpowers/specs/2026-06-16-recalibration-design.md`

---

## 파일 구조

- **수정** `src/engine/eval/calibration.ts` — 기존 순수 지표 모듈에 보정자 4함수 + `IsotonicModel` 타입 추가. (같은 책임=확률 보정 측정, 함께 변경되므로 같은 파일.)
- **수정** `src/engine/eval/calibration.test.ts` — 보정자 단위테스트 추가.
- **생성** `scripts/recalibration_report.ts` — OOS 추출→보정자 학습/적용→표 출력 CLI. `calibration_report.ts` 형제.
- **수정** `package.json` — `"calib:recal"` 스크립트 1줄 추가.

---

### Task 1: Platt scaling (fitPlatt + applyPlatt)

Platt = 모델 확률 p의 logit에 1차원 로지스틱 `sigmoid(a·logit(p)+b)`를 적합. 매끈한 S자 편향 교정용.

**Files:**
- Modify: `src/engine/eval/calibration.ts` (기존 `sigmoid`/`Pair` 아래에 추가)
- Test: `src/engine/eval/calibration.test.ts` (파일 끝에 추가)

- [ ] **Step 1: 실패 테스트 작성** — `calibration.test.ts` 상단 import에 `fitPlatt, applyPlatt` 추가하고 파일 끝에:

```ts
describe('applyPlatt', () => {
  it('a=1,b=0이면 항등(입력≈출력)', () => {
    expect(applyPlatt({ a: 1, b: 0 }, 0.3)).toBeCloseTo(0.3, 6);
    expect(applyPlatt({ a: 1, b: 0 }, 0.7)).toBeCloseTo(0.7, 6);
  });
  it('단조 증가 + (0,1) 범위', () => {
    const cal = { a: 1.5, b: 0.2 };
    const lo = applyPlatt(cal, 0.2);
    const hi = applyPlatt(cal, 0.8);
    expect(hi).toBeGreaterThan(lo);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThan(1);
  });
});

describe('fitPlatt', () => {
  // 결정적 합성데이터: 각 p에 정확한 기대 승수로 0/1 채워 알려진 계수 복원
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  const logit = (p: number) => Math.log(p / (1 - p));
  const synth = (a0: number, b0: number, N: number): { p: number; y: number }[] => {
    const out: { p: number; y: number }[] = [];
    for (let k = 1; k <= 19; k++) {
      const p = k / 20;
      const ones = Math.round(sig(a0 * logit(p) + b0) * N);
      for (let i = 0; i < N; i++) out.push({ p, y: i < ones ? 1 : 0 });
    }
    return out;
  };

  it('알려진 계수 방향·크기 복원 (a0=2, b0=0.5)', () => {
    const { a, b } = fitPlatt(synth(2, 0.5, 1000));
    expect(a).toBeGreaterThan(1.5);
    expect(a).toBeLessThan(2.5);
    expect(b).toBeGreaterThan(0.2);
    expect(b).toBeLessThan(0.8);
  });
  it('빈 입력 → 항등 계수', () => {
    expect(fitPlatt([])).toEqual({ a: 1, b: 0 });
  });
  it('과소확신 데이터 재보정 후 ECE 감소', () => {
    const pairs: { p: number; y: number }[] = [];
    for (let k = 1; k <= 18; k++) {
      const p = k / 20;
      const actual = Math.min(1, 1.4 * p); // 실제 승률이 모델보다 높음(과소확신)
      const N = 500;
      const ones = Math.round(actual * N);
      for (let i = 0; i < N; i++) pairs.push({ p, y: i < ones ? 1 : 0 });
    }
    const before = ece(reliabilityBins(pairs, 10));
    const cal = fitPlatt(pairs);
    const after = ece(reliabilityBins(pairs.map((pr) => ({ p: applyPlatt(cal, pr.p), y: pr.y })), 10));
    expect(after).toBeLessThan(before);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- calibration`
Expected: FAIL — `fitPlatt is not defined` / `applyPlatt is not defined`.

- [ ] **Step 3: 최소 구현** — `calibration.ts`의 `logLoss` 함수 아래(타입 `CalibrationReport` 위)에 추가:

```ts
/** 확률을 [1e−9, 1−1e−9]로 클립 후 logit. Platt 입출력 공용. */
function clipLogit(p: number): number {
  const c = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(c / (1 - c));
}

/** Platt 보정자: sigmoid(a·logit(p)+b)를 실제결과에 경사하강 적합. 빈 입력→항등. */
export function fitPlatt(
  pairs: Pair[],
  opts: { iters?: number; lr?: number } = {},
): { a: number; b: number } {
  const iters = opts.iters ?? 2000;
  const lr = opts.lr ?? 0.3;
  const n = pairs.length;
  if (n === 0) return { a: 1, b: 0 };
  const xs = pairs.map((pr) => clipLogit(pr.p));
  const ys = pairs.map((pr) => pr.y);
  let a = 1;
  let b = 0;
  for (let it = 0; it < iters; it++) {
    let ga = 0;
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const pred = 1 / (1 + Math.exp(-(a * xs[i]! + b)));
      const err = pred - ys[i]!;
      ga += err * xs[i]!;
      gb += err;
    }
    a -= (lr * ga) / n;
    b -= (lr * gb) / n;
  }
  return { a, b };
}

/** Platt 적용: sigmoid(a·logit(p)+b). 단조 증가, (0,1). */
export function applyPlatt(cal: { a: number; b: number }, p: number): number {
  return 1 / (1 + Math.exp(-(cal.a * clipLogit(p) + cal.b)));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- calibration`
Expected: PASS (Platt 테스트 + 기존 테스트 전부).

- [ ] **Step 5: 커밋**

```bash
git add src/engine/eval/calibration.ts src/engine/eval/calibration.test.ts
git commit -m "feat(recal): Platt scaling — fitPlatt·applyPlatt (단조 보정자)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Isotonic regression (fitIsotonic + applyIsotonic)

Isotonic = PAV(pool-adjacent-violators)로 단조 비감소 계단을 적합. 비선형 편향까지 흡수.

**Files:**
- Modify: `src/engine/eval/calibration.ts`
- Test: `src/engine/eval/calibration.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — import에 `fitIsotonic, applyIsotonic, type IsotonicModel` 추가하고 파일 끝에:

```ts
describe('fitIsotonic — PAV 단조회귀', () => {
  it('역전 입력도 출력 y 단조 비감소', () => {
    const pairs = [
      { p: 0.1, y: 1 }, { p: 0.2, y: 0 }, { p: 0.3, y: 1 },
      { p: 0.4, y: 0 }, { p: 0.5, y: 1 },
    ];
    const m = fitIsotonic(pairs);
    for (let i = 1; i < m.y.length; i++) {
      expect(m.y[i]!).toBeGreaterThanOrEqual(m.y[i - 1]!);
    }
  });
  it('이미 단조면 그룹 평균 유지 (저=0, 고=1)', () => {
    const m = fitIsotonic([
      { p: 0.1, y: 0 }, { p: 0.2, y: 0 }, { p: 0.8, y: 1 }, { p: 0.9, y: 1 },
    ]);
    expect(m.y[0]!).toBeCloseTo(0, 6);
    expect(m.y[m.y.length - 1]!).toBeCloseTo(1, 6);
  });
  it('빈 입력 → 빈 모델', () => {
    expect(fitIsotonic([])).toEqual({ x: [], y: [] });
  });
});

describe('applyIsotonic', () => {
  it('보간 + 경계 클램프', () => {
    const cal: IsotonicModel = { x: [0.2, 0.8], y: [0.1, 0.9] };
    expect(applyIsotonic(cal, 0.05)).toBeCloseTo(0.1, 6); // 경계 아래 클램프
    expect(applyIsotonic(cal, 0.95)).toBeCloseTo(0.9, 6); // 경계 위 클램프
    expect(applyIsotonic(cal, 0.5)).toBeCloseTo(0.5, 6);  // 중간 선형보간
  });
  it('빈 모델 → 입력 그대로', () => {
    expect(applyIsotonic({ x: [], y: [] }, 0.4)).toBe(0.4);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- calibration`
Expected: FAIL — `fitIsotonic is not defined`.

- [ ] **Step 3: 최소 구현** — `calibration.ts`의 `applyPlatt` 아래에 추가:

```ts
/** Isotonic 보정자: 분기점 x(블록 평균예측)·값 y(블록 실제비율), 단조 비감소. */
export interface IsotonicModel { x: number[]; y: number[]; }

/** PAV 단조회귀. p 오름차순 정렬 후 인접 위반 블록을 병합(가중평균). */
export function fitIsotonic(pairs: Pair[]): IsotonicModel {
  if (pairs.length === 0) return { x: [], y: [] };
  const sorted = [...pairs].sort((a, b) => a.p - b.p);
  const blocks: { sumY: number; sumX: number; n: number }[] = [];
  for (const pr of sorted) {
    blocks.push({ sumY: pr.y, sumX: pr.p, n: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!;
      const prev = blocks[blocks.length - 2]!;
      if (prev.sumY / prev.n <= last.sumY / last.n) break;
      prev.sumY += last.sumY;
      prev.sumX += last.sumX;
      prev.n += last.n;
      blocks.pop();
    }
  }
  return {
    x: blocks.map((b) => b.sumX / b.n),
    y: blocks.map((b) => b.sumY / b.n),
  };
}

/** Isotonic 적용: 분기점 사이 선형보간, 경계는 끝값 클램프. 빈 모델→입력 그대로. */
export function applyIsotonic(cal: IsotonicModel, p: number): number {
  const { x, y } = cal;
  if (x.length === 0) return p;
  if (p <= x[0]!) return y[0]!;
  if (p >= x[x.length - 1]!) return y[y.length - 1]!;
  let i = 1;
  while (i < x.length && x[i]! < p) i++;
  const x0 = x[i - 1]!;
  const x1 = x[i]!;
  const y0 = y[i - 1]!;
  const y1 = y[i]!;
  if (x1 === x0) return y0;
  return y0 + ((p - x0) / (x1 - x0)) * (y1 - y0);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- calibration`
Expected: PASS (Isotonic + Platt + 기존 전부).

- [ ] **Step 5: 커밋**

```bash
git add src/engine/eval/calibration.ts src/engine/eval/calibration.test.ts
git commit -m "feat(recal): Isotonic 회귀 — fitIsotonic·applyIsotonic (PAV 단조)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 재보정 리포트 스크립트 (recalibration_report.ts)

OOS 롤링에서 train fold로 보정자 학습 → test fold에서 원본 vs Platt vs Isotonic(±재정규화) 측정·출력.

**Files:**
- Create: `scripts/recalibration_report.ts`
- Modify: `package.json`

- [ ] **Step 1: package.json에 스크립트 추가** — `"calib": "tsx scripts/calibration_report.ts",` 바로 아래 줄에:

```json
    "calib:recal": "tsx scripts/recalibration_report.ts",
```

- [ ] **Step 2: 스크립트 작성** — `scripts/recalibration_report.ts` 생성:

```ts
/**
 * 확률 재보정 효과 측정 — 원본 vs Platt vs Isotonic (롤링 OOS, 누수 0).
 * 보정자는 train fold로만 학습 → test fold에서 평가.
 * 사용: npm run calib:recal
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { rollingBlocks } from '../src/engine/eval/rolling.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import {
  normalizeProbs, reliabilityBins, ece, brier, logLoss, sigmoid,
  fitPlatt, applyPlatt, fitIsotonic, applyIsotonic,
  type Pair,
} from '../src/engine/eval/calibration.js';

type Bucket = Record<string, Pair[]>;
const push = (b: Bucket, key: string, pair: Pair): void => {
  (b[key] ??= []).push(pair);
};

function metricsRow(label: string, pairs: Pair[]): string {
  const f3 = (x: number) => x.toFixed(3);
  const e = ece(reliabilityBins(pairs, 10));
  return `${label.padEnd(20)} ${f3(e).padStart(7)} ${f3(brier(pairs)).padStart(7)} ${f3(logLoss(pairs)).padStart(8)}`;
}

async function main(): Promise<void> {
  const db = await getLocalDb();
  console.log('📊 확률 재보정 효과 (Platt/Isotonic, 롤링 OOS)\n데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);

  const blocks = rollingBlocks(races, { year: 2025, q: 1 });
  const win: Bucket = {};   // P(1착) 방법별
  const top3: Bucket = {};  // P(3착내) 방법별
  const market: Pair[] = [];
  const cfg = { l2: 0.02, iters: 800, lr: 0.2 };

  for (const block of blocks) {
    const schema = buildSchema(block.train.flatMap((r) => r.horses.map((h) => h.features)))
      .filter((n) => !n.endsWith('__missing'));
    const X = block.train.flatMap((r) => r.horses.map((h) => toVector(h.features, schema)));
    const y1 = block.train.flatMap((r) => r.horses.map((h) => (h.ord === 1 ? 1 : 0)));
    const y3 = block.train.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));
    const p1 = fitLogistic(X, y1, schema, cfg);
    const p3 = fitLogistic(X, y3, schema, cfg);

    // 보정자 학습 — train fold로만 (P1=경주내 정규화, P3=정규화 안 함)
    const trainP1: Pair[] = [];
    for (const r of block.train) {
      const norm = normalizeProbs(r.horses.map((h) => sigmoid(predictLogit(p1, toVector(h.features, schema)))));
      r.horses.forEach((h, i) => trainP1.push({ p: norm[i]!, y: h.ord === 1 ? 1 : 0 }));
    }
    const trainP3: Pair[] = block.train.flatMap((r) =>
      r.horses.map((h) => ({ p: sigmoid(predictLogit(p3, toVector(h.features, schema))), y: h.ord <= 3 ? 1 : 0 })));
    const calP1Platt = fitPlatt(trainP1);
    const calP1Iso = fitIsotonic(trainP1);
    const calP3Platt = fitPlatt(trainP3);
    const calP3Iso = fitIsotonic(trainP3);

    // test fold 평가 — 안 본 데이터
    for (const race of block.test) {
      const hs = race.horses;
      const normWin = normalizeProbs(hs.map((h) => sigmoid(predictLogit(p1, toVector(h.features, schema)))));
      const plattVals = normWin.map((p) => applyPlatt(calP1Platt, p));
      const isoVals = normWin.map((p) => applyIsotonic(calP1Iso, p));
      const plattRe = normalizeProbs(plattVals);
      const isoRe = normalizeProbs(isoVals);
      hs.forEach((h, i) => {
        const y = h.ord === 1 ? 1 : 0;
        push(win, '원본', { p: normWin[i]!, y });
        push(win, 'Platt', { p: plattVals[i]!, y });
        push(win, 'Isotonic', { p: isoVals[i]!, y });
        push(win, 'Platt(+재정규화)', { p: plattRe[i]!, y });
        push(win, 'Isotonic(+재정규화)', { p: isoRe[i]!, y });
      });
      hs.forEach((h) => {
        const raw = sigmoid(predictLogit(p3, toVector(h.features, schema)));
        const y = h.ord <= 3 ? 1 : 0;
        push(top3, '원본', { p: raw, y });
        push(top3, 'Platt', { p: applyPlatt(calP3Platt, raw), y });
        push(top3, 'Isotonic', { p: applyIsotonic(calP3Iso, raw), y });
      });
      const withOdds = hs.filter((h) => h.winOdds != null && h.winOdds > 0);
      const normMkt = normalizeProbs(withOdds.map((h) => 1 / (h.winOdds as number)));
      withOdds.forEach((h, i) => market.push({ p: normMkt[i]!, y: h.ord === 1 ? 1 : 0 }));
    }
  }

  console.log(`\nOOS 분기: ${blocks.map((b) => b.key).join(', ')}`);
  console.log(`표본: P1 ${win['원본']!.length}말 / 시장 ${market.length}말\n`);

  const header = `${'방법'.padEnd(20)} ${'ECE'.padStart(7)} ${'Brier'.padStart(7)} ${'log-loss'.padStart(8)}`;
  console.log('=== 재보정 효과: P(1착) (롤링 OOS) ===');
  console.log(header);
  for (const k of ['원본', 'Platt', 'Isotonic', 'Platt(+재정규화)', 'Isotonic(+재정규화)']) {
    console.log(metricsRow(k, win[k]!));
  }
  console.log(metricsRow('시장(참고)', market));

  console.log('\n=== 재보정 효과: P(3착내) ===');
  console.log(header);
  for (const k of ['원본', 'Platt', 'Isotonic']) console.log(metricsRow(k, top3[k]!));
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 3: 타입체크**

Run: `npm run build`
Expected: tsc 통과(에러 0). 실패 시 import 경로·타입 확인 후 수정.

- [ ] **Step 4: 실행해 결과 확인**

Run: `npm run calib:recal`
Expected: "재보정 효과: P(1착)" 표 출력 — 원본/Platt/Isotonic/±재정규화/시장 행 + P(3착내) 표. 원본 ECE는 §C7의 0.017 부근이어야 함(정상성 확인). 실값은 실행 후 §6 트리거로 판정.

- [ ] **Step 5: 커밋**

```bash
git add scripts/recalibration_report.ts package.json
git commit -m "feat(recal): calib:recal — 원본 vs Platt vs Isotonic OOS 측정 스크립트

train fold로만 보정자 학습→test 평가(누수0). P1(±재정규화)·P3·시장 참고선.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 결과 판정 + 기록

`npm run calib:recal` 실값을 §6 트리거로 판정하고 결과를 문서·메모리에 보존.

- [ ] **Step 1: 판정** — 채택 후보 = OOS ECE 의미있게 하락(예 0.017→0.010대) AND Brier·log-loss 비악화 AND 재정규화 후 유지. Platt≈Isotonic이면 Platt 선택.

- [ ] **Step 2: 전략문서에 §C8 추가** — `docs/strategy/2026-06-16-market-edge-and-korean-winning-conditions.md` §C7 아래에 재보정 실측 표(원본/Platt/Isotonic/±재정규화/시장)와 판정(채택 후보 여/부, 라이브 연결 여부) 기록.

- [ ] **Step 3: 메모리·인수인계 갱신** — `[[project_market_edge_strategy]]` 메모리와 `CLAUDE.md` 다음 단계 §2 후보 ①을 결과로 갱신(완료/음성 표시).

- [ ] **Step 4: 커밋**

```bash
git add docs/strategy/2026-06-16-market-edge-and-korean-winning-conditions.md CLAUDE.md
git commit -m "docs(recal): 재보정 실측 결과 기록 + 판정(§C8)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec 커버리지:**
- §2 측정 먼저 → Task 3 측정 전용 스크립트, 라이브 불변 ✅
- §2 Platt+Isotonic 둘 다 → Task 1·2 ✅
- §2 P1착+P3착내 → Task 3 두 표 ✅
- §2 누수 방어(train fold만 fit) → Task 3 보정자 학습 블록 ✅
- §2 정규화(±재정규화 둘 다 출력) → Task 3 plattRe/isoRe ✅
- §4 fitPlatt/applyPlatt/fitIsotonic/applyIsotonic + IsotonicModel → Task 1·2 ✅
- §6 결정 규칙 판정 → Task 4 ✅
- §7 테스트(계수복원·단조성·보간·개선 스모크) → Task 1·2 테스트 ✅
- §9 calib:recal 출력 → Task 3 ✅

**플레이스홀더 스캔:** 없음. 표의 실측값은 Task 3 Step 4 실행에서 산출(코드 아닌 결과값이라 정상).

**타입 일관성:** `Pair`(기존), `IsotonicModel { x:number[]; y:number[] }` Task 2 정의 → Task 3에서 동일 사용. `fitPlatt(pairs, opts?)` 시그니처 Task 1 정의 → Task 3에서 `fitPlatt(trainP1)` 기본인자 호출 ✅. `applyPlatt({a,b}, p)`·`applyIsotonic(model, p)` 일관 ✅.
