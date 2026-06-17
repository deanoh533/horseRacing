# Benter 2단계 합성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경주별 시장확률과 모델확률을 `exp(a·ln시장 + b·ln모델)`로 합쳐 a·b를 우승 우도로 적합하고, OOS에서 합성이 시장 단독보다 우승을 더 잘 맞히나(b>0 + NLL↓)를 측정한다.

**Architecture:** 순수 수학 유닛 `benter.ts`(정규화·적합기·평가, 모델 무관 — `BenterRace` 배열만 받음) + 오케스트레이션 스크립트 `benter_twostage.ts`(collect→rolling→모델3종 학습→benter 적합→평가→ASCII 리포트). 기존 `collect`·`rolling`·`models`·`calibration`은 읽기 재사용·무변경.

**Tech Stack:** TypeScript, tsx, vitest. 기존 `src/engine/eval/` 패턴 따름. 조건부 로짓(경주 내 softmax) 2-파라미터 경사상승.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/engine/eval/benter.ts` (신규) | `BenterRace` 타입, `softmax`, `marketProbsFromOdds`, `fitBenter`, `combinedProbs`, `winNLL`, `pickStats` |
| `src/engine/eval/benter.test.ts` (신규) | 정규화·적합기 수렴·b=0 항등·NLL/pick 단위 검증 |
| `scripts/benter_twostage.ts` (신규) | 데이터 수집·롤링·모델 학습·benter 적합·평가·리포트 |
| `package.json` (수정) | `"benter"` 스크립트 추가 |

`benter.ts`는 **모델·DB를 모름** — `BenterRace { marketProb, modelProb, ords, winnerIdx }` 배열만 받는 순수 함수. 스크립트가 RaceRecord+모델 → BenterRace 변환을 담당.

---

### Task 1: benter.ts — 타입 + 정규화 헬퍼

**Files:**
- Create: `src/engine/eval/benter.ts`
- Test: `src/engine/eval/benter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/engine/eval/benter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { softmax, marketProbsFromOdds } from './benter.js';

describe('softmax', () => {
  it('합=1, 큰 점수에 큰 확률', () => {
    const p = softmax([0, 1, 2]);
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(p[2]).toBeGreaterThan(p[1]!);
    expect(p[1]).toBeGreaterThan(p[0]!);
  });
  it('큰 값 오버플로 방어(max 빼기)', () => {
    const p = softmax([1000, 1001]);
    expect(Number.isFinite(p[0]!)).toBe(true);
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
  });
});

describe('marketProbsFromOdds', () => {
  it('역수 정규화 — 합=1, 낮은 배당이 높은 확률', () => {
    const p = marketProbsFromOdds([2, 4, 8]); // 1/2,1/4,1/8 → 0.571,0.286,0.143
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(p[0]).toBeCloseTo(0.5714, 3);
    expect(p[0]).toBeGreaterThan(p[1]!);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/eval/benter.test.ts`
Expected: FAIL — `Cannot find module './benter.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/engine/eval/benter.ts`:

```typescript
import { normalizeProbs } from './calibration.js';

/** 한 경주의 합성 입력. 세 배열은 같은 말 순서·같은 길이. winnerIdx = ords에서 ord===1 위치. */
export interface BenterRace {
  marketProb: number[]; // 경주 내 합=1
  modelProb: number[];  // 경주 내 합=1
  ords: number[];       // 각 말 착순
  winnerIdx: number;    // 우승마 인덱스 (ords.indexOf(1))
}

/** 수치안정 softmax: max 빼기 후 exp 정규화. */
export function softmax(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const mx = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - mx));
  return normalizeProbs(exps);
}

/** 단승배당 역수의 경주 내 정규화(공제율 제거). 유효 배당만 들어온다고 가정. */
export function marketProbsFromOdds(odds: number[]): number[] {
  return normalizeProbs(odds.map((o) => 1 / o));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/eval/benter.test.ts`
Expected: PASS (5 assertions)

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/benter.ts src/engine/eval/benter.test.ts
git commit -m "feat(benter): BenterRace 타입 + softmax·marketProbsFromOdds 정규화"
```

---

### Task 2: benter.ts — 적합기 fitBenter + combinedProbs

**Files:**
- Modify: `src/engine/eval/benter.ts`
- Test: `src/engine/eval/benter.test.ts`

조건부 로짓: 경주 i에서 `combined_k = exp(a·ln시장_k + b·ln모델_k) / Σ`. 우승 로그우도 `Σ ln(combined_winner)`를 경사상승으로 최대화. 그래디언트:
`∂LL/∂a = Σ_races ( u_winner − Σ_k combined_k·u_k )`, `u_k = ln(시장_k)`. b는 `v_k = ln(모델_k)`로 동일.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/eval/benter.test.ts`:

```typescript
import { fitBenter, combinedProbs } from './benter.js';
import type { BenterRace } from './benter.js';

// 결정적 시드 RNG
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('combinedProbs', () => {
  it('b=0,a=1이면 시장확률과 동일(이미 정규화)', () => {
    const mkt = [0.5, 0.3, 0.2];
    const mod = [0.1, 0.6, 0.3];
    const c = combinedProbs(1, 0, mkt, mod);
    expect(c[0]).toBeCloseTo(0.5, 6);
    expect(c[1]).toBeCloseTo(0.3, 6);
    expect(c.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
  });
});

describe('fitBenter', () => {
  it('알려진 (a*,b*)에서 생성한 데이터를 근사 회수', () => {
    const rng = mulberry32(42);
    const A = 1.0, B = 0.8;
    const races: BenterRace[] = [];
    for (let r = 0; r < 4000; r++) {
      const n = 8;
      const mkt = normalizeRand(n, rng);
      const mod = normalizeRand(n, rng);
      const probs = combinedProbs(A, B, mkt, mod);
      // 누적분포로 우승마 샘플
      const u = rng();
      let acc = 0, winnerIdx = n - 1;
      for (let k = 0; k < n; k++) { acc += probs[k]!; if (u <= acc) { winnerIdx = k; break; } }
      const ords = Array.from({ length: n }, (_, k) => (k === winnerIdx ? 1 : 2));
      races.push({ marketProb: mkt, modelProb: mod, ords, winnerIdx });
    }
    const { a, b } = fitBenter(races, { iters: 3000, lr: 0.5 });
    expect(a).toBeCloseTo(A, 0); // |a-1.0| < 0.5
    expect(b).toBeCloseTo(B, 0); // |b-0.8| < 0.5
    expect(b).toBeGreaterThan(0.3);
  });
});

function normalizeRand(n: number, rng: () => number): number[] {
  const v = Array.from({ length: n }, () => rng() + 0.05);
  const s = v.reduce((a, b) => a + b, 0);
  return v.map((x) => x / s);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/eval/benter.test.ts`
Expected: FAIL — `fitBenter`/`combinedProbs` not exported

- [ ] **Step 3: Write minimal implementation**

Append to `src/engine/eval/benter.ts`:

```typescript
const LN = (p: number) => Math.log(Math.max(p, 1e-12));

/** 합성확률 = softmax(a·ln시장 + b·ln모델). 경주 내 합=1. */
export function combinedProbs(a: number, b: number, marketProb: number[], modelProb: number[]): number[] {
  const scores = marketProb.map((m, k) => a * LN(m) + b * LN(modelProb[k]!));
  return softmax(scores);
}

export interface BenterFit { a: number; b: number; }

/** 우승 로그우도 경사상승으로 a,b 적합. 초기 a=1,b=0(=시장 단독). */
export function fitBenter(races: BenterRace[], opts: { iters?: number; lr?: number } = {}): BenterFit {
  const iters = opts.iters ?? 3000;
  const lr = opts.lr ?? 0.5;
  const n = races.length;
  if (n === 0) return { a: 1, b: 0 };
  let a = 1, b = 0;
  for (let it = 0; it < iters; it++) {
    let ga = 0, gb = 0;
    for (const r of races) {
      const u = r.marketProb.map(LN);
      const v = r.modelProb.map(LN);
      const probs = combinedProbs(a, b, r.marketProb, r.modelProb);
      let ea = 0, eb = 0;
      for (let k = 0; k < probs.length; k++) { ea += probs[k]! * u[k]!; eb += probs[k]! * v[k]!; }
      ga += u[r.winnerIdx]! - ea;
      gb += v[r.winnerIdx]! - eb;
    }
    a += (lr * ga) / n;
    b += (lr * gb) / n;
  }
  return { a, b };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/eval/benter.test.ts`
Expected: PASS (모든 assertion). 회수 테스트가 흔들리면 lr/iters를 0.4/4000으로 조정.

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/benter.ts src/engine/eval/benter.test.ts
git commit -m "feat(benter): fitBenter(조건부 로짓 경사상승) + combinedProbs"
```

---

### Task 3: benter.ts — 평가 헬퍼 winNLL + pickStats

**Files:**
- Modify: `src/engine/eval/benter.ts`
- Test: `src/engine/eval/benter.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/engine/eval/benter.test.ts`:

```typescript
import { winNLL, pickStats } from './benter.js';

describe('winNLL', () => {
  it('우승마 확률이 높을수록 NLL 낮음', () => {
    const good: BenterRace[] = [{ marketProb: [0.8, 0.2], modelProb: [0.8, 0.2], ords: [1, 2], winnerIdx: 0 }];
    const bad: BenterRace[] = [{ marketProb: [0.2, 0.8], modelProb: [0.2, 0.8], ords: [1, 2], winnerIdx: 0 }];
    const sel = (r: BenterRace) => r.marketProb;
    expect(winNLL(good, sel)).toBeLessThan(winNLL(bad, sel));
    expect(winNLL(good, sel)).toBeCloseTo(-Math.log(0.8), 6);
  });
});

describe('pickStats', () => {
  it('argmax 픽의 단승·연승 집계', () => {
    const races: BenterRace[] = [
      { marketProb: [0.6, 0.4], modelProb: [0.6, 0.4], ords: [1, 2], winnerIdx: 0 }, // 픽=0, ord1 → 단·연 적중
      { marketProb: [0.7, 0.3], modelProb: [0.7, 0.3], ords: [4, 1], winnerIdx: 1 }, // 픽=0, ord4 → 둘다 실패
    ];
    const s = pickStats(races, (r) => r.marketProb);
    expect(s.n).toBe(2);
    expect(s.win).toBe(1);
    expect(s.show).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/eval/benter.test.ts`
Expected: FAIL — `winNLL`/`pickStats` not exported

- [ ] **Step 3: Write minimal implementation**

Append to `src/engine/eval/benter.ts`:

```typescript
/** 경주단위 우승 NLL = 평균(−ln 우승마확률). selector가 경주별 확률배열 반환. */
export function winNLL(races: BenterRace[], selector: (r: BenterRace) => number[]): number {
  if (races.length === 0) return 0;
  let s = 0;
  for (const r of races) s += -Math.log(Math.max(selector(r)[r.winnerIdx]!, 1e-12));
  return s / races.length;
}

export interface PickStat { win: number; show: number; n: number; }

/** argmax 확률 픽의 단승(ord===1)·연승(ord<=3) 집계. */
export function pickStats(races: BenterRace[], selector: (r: BenterRace) => number[]): PickStat {
  const stat: PickStat = { win: 0, show: 0, n: 0 };
  for (const r of races) {
    const p = selector(r);
    let best = 0;
    for (let k = 1; k < p.length; k++) if (p[k]! > p[best]!) best = k;
    const ord = r.ords[best]!;
    stat.n++;
    if (ord === 1) stat.win++;
    if (ord <= 3) stat.show++;
  }
  return stat;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/eval/benter.test.ts`
Expected: PASS (전체)

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/benter.ts src/engine/eval/benter.test.ts
git commit -m "feat(benter): winNLL + pickStats 평가 헬퍼"
```

---

### Task 4: 오케스트레이션 스크립트 + npm 연결

**Files:**
- Create: `scripts/benter_twostage.ts`
- Modify: `package.json` (scripts 블록)

모델 3종(logistic top1·gbdt top1·pl) 각각: 분기 블록마다 train으로 모델+benter 적합, test로 평가. 전 분기 풀링. 모델확률은 logistic/gbdt는 `sigmoid` 후 정규화, PL은 `softmax`.

- [ ] **Step 1: Create the script**

Create `scripts/benter_twostage.ts`:

```typescript
/**
 * Benter 2단계 합성 — 모델이 시장 위에 직교정보를 더하나.
 * 사용: npm run benter
 * 판정: b가 분기 걸쳐 >0 AND 합성 NLL < 시장 NLL = 정보 기여(돌파).
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getLocalDb } from '../src/db/localDb.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { trainAllModels } from '../src/engine/eval/models.js';
import { rollingBlocks } from '../src/engine/eval/rolling.js';
import { sigmoid, normalizeProbs } from '../src/engine/eval/calibration.js';
import { toVector } from '../src/engine/features/alignFeatures.js';
import { predictLogit } from '../src/engine/models/logistic.js';
import { predictGBDT } from '../src/engine/models/gbdt.js';
import { predictPL } from '../src/engine/models/plackettLuce.js';
import {
  marketProbsFromOdds, combinedProbs, fitBenter, winNLL, pickStats, softmax,
} from '../src/engine/eval/benter.js';
import type { BenterRace } from '../src/engine/eval/benter.js';
import type { RaceRecord, HorseRecord } from '../src/engine/eval/types.js';

const FIRST_TEST = { year: 2025, q: 1 };

/** (race,model) → 경주 내 정규화 모델확률. 유효배당 말만 subset으로 받음. */
type ModelProbFn = (horses: HorseRecord[]) => number[];

/** 유효배당(>0) 말만 골라 BenterRace 생성. 우승마(ord===1)가 subset에 없거나 <3두면 null. */
function toBenterRace(race: RaceRecord, modelProb: ModelProbFn): BenterRace | null {
  const subset = race.horses.filter((h) => h.winOdds != null && h.winOdds > 0);
  if (subset.length < 3) return null;
  const winnerIdx = subset.findIndex((h) => h.ord === 1);
  if (winnerIdx < 0) return null;
  return {
    marketProb: marketProbsFromOdds(subset.map((h) => h.winOdds as number)),
    modelProb: modelProb(subset),
    ords: subset.map((h) => h.ord),
    winnerIdx,
  };
}

async function main(): Promise<void> {
  const db = await getLocalDb();
  console.log('📊 Benter 2단계 — 데이터 수집 중...');
  const races = await collectRaces(db, 20240101, 99991231);
  console.log(`  ${races.length}경주`);
  // 게이트 없이 전체 피처(모델에 최대 기회)
  const approved = new Set(races.flatMap((r) => r.horses.flatMap((h) => Object.keys(h.rawScores))));

  const blocks = rollingBlocks(races, FIRST_TEST);

  const MODELS = ['Logistic(t1)', 'GBDT(t1)', 'PL'] as const;
  type ModelName = typeof MODELS[number];

  // 모델별 누적기
  type Acc = {
    test: BenterRace[]; combo: number[][]; // combo[i] = i번째 test race의 합성확률(블록 a,b로 계산)
    bTrend: { key: string; a: number; b: number }[];
  };
  const acc = new Map<ModelName, Acc>(MODELS.map((m) => [m, { test: [], combo: [], bTrend: [] }]));

  for (const block of blocks) {
    console.log(`  [${block.key}] train=${block.train.length} test=${block.test.length} 학습중...`);
    const tm = trainAllModels(block.train, approved);
    const schema = tm.featureSchema;
    const probFns: Record<ModelName, ModelProbFn> = {
      'Logistic(t1)': (hs) => normalizeProbs(hs.map((h) => sigmoid(predictLogit(tm.logisticTop1, toVector(h.features, schema))))),
      'GBDT(t1)': (hs) => normalizeProbs(hs.map((h) => sigmoid(predictGBDT(tm.gbdtTop1, toVector(h.features, schema))))),
      'PL': (hs) => softmax(hs.map((h) => predictPL(tm.pl, toVector(h.features, schema)))),
    };

    for (const m of MODELS) {
      const fn = probFns[m];
      const trainBR = block.train.map((r) => toBenterRace(r, fn)).filter((x): x is BenterRace => x !== null);
      const { a, b } = fitBenter(trainBR);
      acc.get(m)!.bTrend.push({ key: block.key, a, b });
      for (const r of block.test) {
        const br = toBenterRace(r, fn);
        if (!br) continue;
        acc.get(m)!.test.push(br);
        acc.get(m)!.combo.push(combinedProbs(a, b, br.marketProb, br.modelProb));
      }
    }
  }

  // 리포트
  const pct = (a: number, n: number) => (n ? ((a / n) * 100).toFixed(1) : '-');
  console.log('\n' + '='.repeat(72));
  console.log('Benter 2단계 — 모델이 시장 위에 직교정보를 더하나 (OOS 풀링)');
  console.log('='.repeat(72));
  for (const m of MODELS) {
    const A = acc.get(m)!;
    const sel = {
      mkt: (r: BenterRace) => r.marketProb,
      mod: (r: BenterRace) => r.modelProb,
      combo: (_: BenterRace, i: number) => A.combo[i]!,
    };
    const comboSel = (() => { let i = -1; return (_r: BenterRace) => { i++; return A.combo[i]!; }; });
    // NLL: combo는 사전계산 배열 사용
    const nllMkt = winNLL(A.test, sel.mkt);
    const nllMod = winNLL(A.test, sel.mod);
    let nllComboSum = 0;
    for (let i = 0; i < A.test.length; i++) nllComboSum += -Math.log(Math.max(A.combo[i]![A.test[i]!.winnerIdx]!, 1e-12));
    const nllCombo = A.test.length ? nllComboSum / A.test.length : 0;

    const sMkt = pickStats(A.test, sel.mkt);
    const sMod = pickStats(A.test, sel.mod);
    // combo pick: argmax of precomputed combo
    const sCombo = { win: 0, show: 0, n: 0 };
    for (let i = 0; i < A.test.length; i++) {
      const p = A.combo[i]!; let best = 0;
      for (let k = 1; k < p.length; k++) if (p[k]! > p[best]!) best = k;
      const ord = A.test[i]!.ords[best]!; sCombo.n++; if (ord === 1) sCombo.win++; if (ord <= 3) sCombo.show++;
    }

    const lastB = A.bTrend.length ? A.bTrend[A.bTrend.length - 1]!.b : 0;
    const bStr = A.bTrend.map((t) => t.b.toFixed(2)).join(' ');
    const diff = (nllCombo - nllMkt);
    const verdict = (A.bTrend.every((t) => t.b > 0) && diff < 0) ? '정보 기여 O ✅' : '정보 기여 X';
    console.log(`\n[${m}]  최종 a=${(A.bTrend.at(-1)?.a ?? 1).toFixed(2)} b=${lastB.toFixed(2)}  (분기별 b: ${bStr})`);
    console.log(`  NLL    합성 ${nllCombo.toFixed(4)} / 시장 ${nllMkt.toFixed(4)} / 모델 ${nllMod.toFixed(4)}   (합성−시장 ${diff >= 0 ? '+' : ''}${diff.toFixed(4)})`);
    console.log(`  단승   합성 ${pct(sCombo.win, sCombo.n)} / 시장 ${pct(sMkt.win, sMkt.n)} / 모델 ${pct(sMod.win, sMod.n)}  (n=${sCombo.n})`);
    console.log(`  연승   합성 ${pct(sCombo.show, sCombo.n)} / 시장 ${pct(sMkt.show, sMkt.n)} / 모델 ${pct(sMod.show, sMod.n)}`);
    console.log(`  → 판정: ${verdict}  (조건: 모든 분기 b>0 그리고 합성 NLL<시장 NLL)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('💥', e); process.exit(1); });
}
```

> 참고: 위 `sel.combo`/`comboSel` 미사용 변수는 제거하고 사전계산 `A.combo` 배열만 쓴다(NLL·pick 모두 인덱스 i로 접근). Step 2 타입체크에서 미사용 경고 나오면 삭제.

- [ ] **Step 2: Clean unused, typecheck**

`benter_twostage.ts`에서 미사용 `sel.combo`·`comboSel` 정의 삭제(실제 사용은 `A.combo[i]` 직접 접근).

Run: `npm run build`
Expected: 타입 에러 0 (미사용 변수 제거 후).

- [ ] **Step 3: Add npm script**

Modify `package.json` — `"benchmark"` 줄 아래에 추가:

```json
    "benter": "tsx scripts/benter_twostage.ts",
```

- [ ] **Step 4: Smoke run**

Run: `npm run benter`
Expected: 각 모델(Logistic·GBDT·PL)마다 a·b·분기별 b·NLL 3종·단승·연승·판정 줄 출력. 에러 없이 종료.

> ⚠️ DuckDB 미러(`db:pull`)가 채워져 있어야 함. 비어 있으면 `collectRaces`가 0경주 → "0경주" 출력 후 빈 리포트. 이 경우 사용자에게 `db:pull` 상태 확인 요청(6/23 이후 데이터). 코드 자체는 정상.

- [ ] **Step 5: Commit**

```bash
git add scripts/benter_twostage.ts package.json
git commit -m "feat(benter): benter_twostage 스크립트 + npm run benter — OOS 합성 vs 시장 리포트"
```

---

## Self-Review

**Spec coverage:**
- ① 입력 데이터(collect 재사용·odds≥3두·우승마 필터) → Task 4 `toBenterRace`. ✅
- ② 두 확률 정규화(시장 역수·모델 sigmoid/softmax) → Task 1 `marketProbsFromOdds`/`softmax` + Task 4 probFns. ✅
- ③ 적합기 `fitBenter`·`combinedProbs` → Task 2. ✅
- ④ OOS 롤링(train만 적합) → Task 4 블록 루프(train으로 fitBenter, test로 평가). ✅
- ⑤ 측정·판정(NLL 3종·단/연승·b 추세·돌파 판정) → Task 3 헬퍼 + Task 4 리포트·verdict. ✅
- ⑥ 산출물(스크립트·npm·테스트) → Task 4 + Task 1~3 테스트. ✅

**Placeholder scan:** 모든 step에 실제 코드/명령. Task 4 미사용 변수는 Step 2에서 명시적 제거 지시. 통과.

**Type consistency:** `BenterRace{marketProb,modelProb,ords,winnerIdx}` Task 1 정의 = Task 2·3·4 사용 일치. `fitBenter`/`combinedProbs`/`winNLL`/`pickStats`/`softmax`/`marketProbsFromOdds` 시그니처 전 Task 일관. `sigmoid`·`normalizeProbs`는 `calibration.ts`에서 import. 통과.

**주의:** Task 4의 리포트 부분은 사전계산 `A.combo[i]` 인덱스 접근으로 통일 — `winNLL`/`pickStats` 헬퍼는 합성에는 쓰지 않고 시장·모델 곡선에만 사용(합성은 블록별 a,b가 달라 selector로 일괄 표현 불가). 이 비대칭은 의도된 것.
