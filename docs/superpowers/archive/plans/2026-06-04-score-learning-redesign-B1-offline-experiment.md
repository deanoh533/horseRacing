# 점수 학습 재설계 — 계획 B1: 오프라인 로지스틱 실험

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** de-biased feature + 로지스틱이 v1을 이기는지 **행렬만으로 오프라인 검증**한다. DB 쓰기·GBM·UI·엔진통합 없음. 이기면 B2(GBM)·B3(프로덕션화)로.

**Architecture:** 계획 A가 만든 `data/training_matrix.jsonl`(37,992행)에 평가용 메타(ord·win_odds)를 더해 자급식으로 만든다. 시간 분할(train<2025 / test≥2025)로 로지스틱을 학습하고, 경주 내 점수 정렬로 단·연·묶음·ROI를 v1·시장과 비교한다.

**Tech Stack:** TypeScript, Node, tsx, vitest. (Python·GBM은 B2)

**스펙:** `docs/superpowers/specs/2026-06-04-score-learning-redesign-design.md`
**선행:** 계획 A 완료 (`buildFeatures`, `gatherRaceInputs`, 행렬 추출).

**실측 분포 반영 (probe 2026-06-04, n≈31k):**
- ⑪ 경주간격 = **∩자 확정** (<14:19.6% → 28-35:32.9% → 90+:21.3%) → **버킷**.
- ② 마체중 = U자 아님, 거의 단조·약신호 → **선형 유지(버킷 안 함)**.
- feature 신호 정상 방향 (③최근착순 Δ-20%p, ⑱상금 +16%p, ⑨b +13%p 등).

---

## 파일 구조

- Modify: `scripts/extract_training_matrix.ts` — 행에 `ord`·`win_odds` 메타 추가 (feature 아님)
- Modify: `src/engine/features/buildFeatures.ts` — ⑪ 간격 버킷 + ⑲ 성향×페이스 + ⑬ 나이×거리 교차항 (②는 손대지 않음)
- Create: `src/engine/models/logistic.ts` — `fitLogistic`, `predictLogit` 순수함수
- Create: `src/engine/models/logistic.test.ts`
- Create: `src/engine/features/alignFeatures.ts` — 가변 feature → 고정 스키마 벡터
- Create: `src/engine/features/alignFeatures.test.ts`
- Create: `scripts/experiment_logistic.ts` — 학습→홀드아웃 채점 (읽기전용, DB 미접속; predictions v1 비교는 DB 조회)

---

## Task 1: 행렬에 평가 메타(ord·win_odds) 추가 + 재추출

평가에 단승(ord==1)·ROI(win_odds)가 필요하다. feature가 아닌 **메타 컬럼**으로 추가한다(모델 입력 아님).

**Files:** Modify `scripts/extract_training_matrix.ts`

- [ ] **Step 1: win_odds 조회 추가**

`gatherRaceInputs`는 win_odds를 반환하지 않으므로, 스크립트에서 경주별 `race_entries`의 `hr_name→win_odds`를 따로 조회해 join한다. 각 경주 루프에서:

```typescript
    // 평가용 메타: win_odds (feature 아님, ROI·시장 벤치마크용)
    const { data: oddsRows } = await sb
      .from('race_entries')
      .select('hr_name, win_odds')
      .eq('race_date', d!).eq('meet', m!).eq('rc_no', n!);
    const oddsMap = new Map<string, number | null>(
      (oddsRows ?? []).map((o: { hr_name: string; win_odds: number | null }) => [o.hr_name, o.win_odds])
    );
```

그리고 각 행 JSON에 메타 추가 (기존 `top3`·`features` 유지):

```typescript
      .map((r) => JSON.stringify({
        race_date: d, meet: m, rc_no: n, hr_name: r.hr_name,
        ord: r.ord,
        win_odds: oddsMap.get(r.hr_name) ?? null,
        top3: (r.ord as number) <= 3 ? 1 : 0,
        features: buildFeatures(r.input),
      }));
```

- [ ] **Step 2: 타입체크 + 재추출 (사용자 또는 컨트롤러 실행)**

Run: `npm run build` (0 errors)
Run: `npm run extract:matrix -- --from 20240101 --to 20991231 --out data/training_matrix.jsonl`
Expected: `✅ ~37992 rows`, 첫 줄에 `ord`·`win_odds`·`top3`·`features` 포함

- [ ] **Step 3: 커밋**

```bash
git add scripts/extract_training_matrix.ts
git commit -m "feat(scripts): 행렬에 평가 메타(ord·win_odds) 추가"
```

---

## Task 2: 버킷·교차항 (실측 반영)

**Files:** Modify `src/engine/features/buildFeatures.ts`, test `buildFeatures.test.ts`

⑪ 간격 ∩자 버킷 + ⑲·⑬ 교차항. **②는 추가 안 함**(실측상 선형).

- [ ] **Step 1: 실패 테스트 추가**

```typescript
describe('buildFeatures — 버킷·교차항', () => {
  it('⑪ 간격 버킷: 28-35일이면 interval_b_28_35=1, 나머지=0', () => {
    const fs = buildFeatures({ rating: 0, intervalDays: 30 });
    expect(fs.find((f) => f.name === 'interval_b_28_35')?.value).toBe(1);
    expect(fs.find((f) => f.name === 'interval_b_lt14')?.value).toBe(0);
    expect(fs.find((f) => f.name === 'interval_b_90p')?.value).toBe(0);
  });
  it('⑪ raw interval_days도 계속 출력 (버킷과 병존)', () => {
    expect(buildFeatures({ rating: 0, intervalDays: 30 }).find((f) => f.name === 'interval_days')?.value).toBe(30);
  });
  it('⑲ 성향×페이스 교차: 도주(avg<=0.15)×HOT', () => {
    const fs = buildFeatures({ rating: 0, runningStyleAvgRatio: 0.1, paceType: 'HOT' });
    expect(fs.find((f) => f.name === 'x_front_hot')?.value).toBe(1);
  });
  it('⑬ 나이×거리 교차: 노령(age>=6)×장거리(rcDist>=1800)', () => {
    const fs = buildFeatures({ rating: 0, age: 6, rcDist: 1800 });
    expect(fs.find((f) => f.name === 'x_old_long')?.value).toBe(1);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- buildFeatures` → FAIL

- [ ] **Step 3: 구현** — buildFeatures `return f;` 직전에 추가

```typescript
  // ⑪ 경주간격 버킷 (실측 ∩자: <14·14-20·21-27·28-35정점·36-45·46-60·61-90·90+)
  if (input.intervalDays != null) {
    const d = input.intervalDays;
    const inB = (lo: number, hi: number) => (d >= lo && d < hi ? 1 : 0);
    add('interval_b_lt14', d < 14 ? 1 : 0);
    add('interval_b_14_20', inB(14, 21));
    add('interval_b_21_27', inB(21, 28));
    add('interval_b_28_35', inB(28, 36));
    add('interval_b_36_45', inB(36, 46));
    add('interval_b_46_60', inB(46, 61));
    add('interval_b_61_90', inB(61, 91));
    add('interval_b_90p', d >= 91 ? 1 : 0);
  }

  // ⑲ 주행성향 × 페이스 교차 (SCORE_MAP 대체 — 모델이 맵을 학습)
  const avg = input.runningStyleAvgRatio;
  const isFree = input.runningStyleStddev != null && input.runningStyleStddev >= 0.35;
  const style = avg == null ? 'unknown'
    : isFree ? 'free'
    : avg <= 0.15 ? 'front'
    : avg <= 0.35 ? 'pace'
    : avg <= 0.65 ? 'stalker' : 'closer';
  const pace = input.paceType ?? 'NORMAL';
  for (const s of ['front', 'pace', 'stalker', 'closer'] as const) {
    for (const p of ['HOT', 'NORMAL', 'SLOW'] as const) {
      add(`x_${s}_${p.toLowerCase()}`, style === s && pace === p ? 1 : 0);
    }
  }

  // ⑬ 나이 × 거리 교차 (AGE_DIST_MATRIX 대체)
  if (input.age != null && input.rcDist != null) {
    const young = input.age <= 4 ? 1 : 0;
    const old = input.age >= 6 ? 1 : 0;
    const short = input.rcDist <= 1300 ? 1 : 0;
    const long = input.rcDist >= 1800 ? 1 : 0;
    add('x_young_short', young && short ? 1 : 0);
    add('x_old_long', old && long ? 1 : 0);
  }
```

- [ ] **Step 4: 통과 확인** — `npm run test:run -- buildFeatures` → PASS
- [ ] **Step 5: 커밋** — `feat(features): ⑪간격 버킷 + ⑲·⑬ 교차항 (실측 반영, ②는 선형 유지)`

> 주의: 버킷·교차항 추가 후 행렬을 다시 추출해야 학습에 반영됨. Task 4 전에 재추출(Task 1의 명령 재실행).

---

## Task 3: 로지스틱 학습기 (TS, z표준화 + L2)

**Files:** Create `src/engine/models/logistic.ts`, `logistic.test.ts`

- [ ] **Step 1: 실패 테스트 (합성 데이터 계수 회복)**

```typescript
import { describe, it, expect } from 'vitest';
import { fitLogistic, predictLogit } from './logistic.js';

describe('fitLogistic', () => {
  it('알려진 선형 분리 데이터의 계수 부호·확률을 회복한다', () => {
    // y = 1 if 2*x1 - 1*x2 + noise > 0
    const X: number[][] = [];
    const y: number[] = [];
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 2000; i++) {
      const x1 = rnd() * 4 - 2, x2 = rnd() * 4 - 2;
      X.push([x1, x2]);
      y.push(2 * x1 - 1 * x2 + (rnd() - 0.5) * 0.5 > 0 ? 1 : 0);
    }
    const model = fitLogistic(X, y, ['x1', 'x2'], { l2: 0.01, iters: 500, lr: 0.1 });
    // 표준화 계수 부호: x1 양수, x2 음수
    expect(model.coef['x1']).toBeGreaterThan(0);
    expect(model.coef['x2']).toBeLessThan(0);
    expect(Math.abs(model.coef['x1'])).toBeGreaterThan(Math.abs(model.coef['x2']));
    // 확률 범위
    const p = 1 / (1 + Math.exp(-predictLogit(model, [2, -2])));
    expect(p).toBeGreaterThan(0.9);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:run -- logistic` → FAIL

- [ ] **Step 3: 구현**

```typescript
/**
 * L2 규제 로지스틱 회귀 (배치 경사하강) — 순수 TS.
 * z-표준화(학습셋 평균/표준편차)로 계수 비교 가능. 랭킹엔 logit 선형부만 쓰면 됨.
 */
export interface LogisticModel {
  type: 'logistic';
  features: string[];
  means: number[];
  stds: number[];
  coef: Record<string, number>; // 표준화 공간 계수
  intercept: number;
}

export interface FitOpts { l2?: number; iters?: number; lr?: number; }

export function fitLogistic(
  X: number[][], y: number[], features: string[], opts: FitOpts = {}
): LogisticModel {
  const { l2 = 0.01, iters = 500, lr = 0.1 } = opts;
  const n = X.length, d = features.length;
  // 표준화
  const means = new Array(d).fill(0), stds = new Array(d).fill(0);
  for (let j = 0; j < d; j++) {
    let m = 0; for (let i = 0; i < n; i++) m += X[i]![j]!; m /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (X[i]![j]! - m) ** 2; v /= n;
    means[j] = m; stds[j] = Math.sqrt(v) || 1;
  }
  const Z = X.map((row) => row.map((x, j) => (x - means[j]!) / stds[j]!));
  const w = new Array(d).fill(0); let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b; for (let j = 0; j < d; j++) z += w[j]! * Z[i]![j]!;
      const p = 1 / (1 + Math.exp(-z));
      const err = p - y[i]!;
      for (let j = 0; j < d; j++) gw[j]! += err * Z[i]![j]!;
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j]! -= lr * (gw[j]! / n + l2 * w[j]!);
    b -= lr * (gb / n);
  }
  const coef: Record<string, number> = {};
  features.forEach((f, j) => (coef[f] = w[j]!));
  return { type: 'logistic', features, means, stds, coef, intercept: b };
}

/** 표준화 공간 logit(=랭킹 점수). 확률은 sigmoid(이 값). */
export function predictLogit(model: LogisticModel, rawRow: number[]): number {
  let z = model.intercept;
  model.features.forEach((f, j) => {
    const zj = (rawRow[j]! - model.means[j]!) / model.stds[j]!;
    z += model.coef[f]! * zj;
  });
  return z;
}
```

- [ ] **Step 4: 통과 확인** — `npm run test:run -- logistic` → PASS
- [ ] **Step 5: 커밋** — `feat(models): L2 로지스틱 학습기 (z표준화 경사하강)`

---

## Task 4: feature 정렬 (고정 스키마)

**Files:** Create `src/engine/features/alignFeatures.ts`, `alignFeatures.test.ts`

행렬의 가변 feature(29~49개)를 **모든 행 공통 고정 벡터**로. 없는 feature는 0.

- [ ] **Step 1: 실패 테스트**

```typescript
import { describe, it, expect } from 'vitest';
import { buildSchema, toVector } from './alignFeatures.js';

describe('alignFeatures', () => {
  it('여러 행의 feature 이름 합집합을 정렬된 스키마로', () => {
    const rows = [
      [{ name: 'a', value: 1 }, { name: 'b', value: 2 }],
      [{ name: 'b', value: 3 }, { name: 'c', value: 4 }],
    ];
    expect(buildSchema(rows)).toEqual(['a', 'b', 'c']);
  });
  it('없는 feature는 0으로 채운다', () => {
    const schema = ['a', 'b', 'c'];
    expect(toVector([{ name: 'b', value: 3 }], schema)).toEqual([0, 3, 0]);
  });
});
```

- [ ] **Step 2: 실패 확인** — FAIL
- [ ] **Step 3: 구현**

```typescript
import type { Feature } from './types.js';

/** 모든 행의 feature 이름 합집합(정렬). */
export function buildSchema(rows: Feature[][]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const f of r) set.add(f.name);
  return [...set].sort();
}

/** 한 행을 스키마 순서의 숫자 벡터로. 없으면 0. */
export function toVector(row: Feature[], schema: string[]): number[] {
  const m = new Map(row.map((f) => [f.name, f.value]));
  return schema.map((name) => m.get(name) ?? 0);
}
```

- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `feat(features): alignFeatures 고정 스키마 정렬`

---

## Task 5: 오프라인 실험 스크립트 (핵심)

**Files:** Create `scripts/experiment_logistic.ts`, package.json scripts에 `exp:logistic` 추가

행렬 로드 → 시간분할(train<2025 / test≥2025) → 로지스틱 학습 → 테스트 경주별 점수 정렬 → **단·연·묶음·ROI**를 시장(win_odds)·v1(predictions)과 비교.

- [ ] **Step 1: package.json** — `"exp:logistic": "tsx scripts/experiment_logistic.ts",`

- [ ] **Step 2: 스크립트 작성**

```typescript
/**
 * 오프라인 로지스틱 실험 (계획 B1) — DB 쓰기 없음.
 * data/training_matrix.jsonl을 시간 분할해 로지스틱을 학습하고,
 * 테스트 구간에서 단승·연승·상위3묶음·ROI를 시장·v1과 비교한다.
 *
 * 사용: npm run exp:logistic -- --matrix data/training_matrix.jsonl --split 20250101
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit, type LogisticModel } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number | null; win_odds: number | null; top3: number; features: Feature[]; }

function load(path: string): Row[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
const raceKey = (r: Row) => `${r.race_date}-${r.meet}-${r.rc_no}`;
const quarter = (d: number) => `${Math.floor(d / 10000)}-Q${Math.floor(((Math.floor((d % 10000) / 100)) - 1) / 3) + 1}`;

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const split = Number(arg('--split', '20250101'));

  const all = load(matrixPath);
  const train = all.filter((r) => r.race_date < split);
  const test = all.filter((r) => r.race_date >= split);

  // 고정 스키마 (train 기준), 학습행렬
  const schema = buildSchema(train.map((r) => r.features));
  const Xtr = train.map((r) => toVector(r.features, schema));
  const ytr = train.map((r) => r.top3);
  const model: LogisticModel = fitLogistic(Xtr, ytr, schema, { l2: 0.02, iters: 800, lr: 0.2 });

  // 테스트 경주별 그룹
  const byRace = new Map<string, Row[]>();
  for (const r of test) { const k = raceKey(r); if (!byRace.has(k)) byRace.set(k, []); byRace.get(k)!.push(r); }

  // v1 비교: predictions.predicted_rank (활성 v1) 조회 — 같은 테스트 경주
  const sb = getSupabaseAdmin();
  // (구현: race별 predictions에서 hr_name→predicted_rank 맵 조회. 페이지네이션은 walkforward 패턴 따름.)

  // 지표 누적: 모델 / 시장 / v1
  // 각 경주: 모델 1순위(=logit 최대), 시장 1순위(=win_odds 최소), v1 1순위(predicted_rank==1)
  //   win  = ord==1, place(연승) = ord<=3
  //   묶음 = 상위3 픽 ∩ 실제 top3 (0~3)
  //   ROI  = 단승: 1순위 픽이 ord==1이면 win_odds 배당, 아니면 0 → mean - 1
  // (전체 구현은 walkforward_eval.ts의 집계 패턴을 참고해 작성. 분기별 + 누적 출력.)

  // 출력 표:
  //   분기 | 모델연승 | 시장연승 | v1연승 | 모델단승 | 모델묶음 | 모델ROI
  //   + 누적 + 노이즈경고(연승 95% 표본오차)
  console.log('TODO: 집계 구현 — walkforward_eval.ts §집계(addRace/pct) 패턴 재사용');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

> 이 스크립트의 집계부는 `scripts/walkforward_eval.ts`의 `addRace`/`pct`/분기 루프/ROI·시장 벤치마크 패턴을 그대로 차용해 채운다(이미 검증된 코드). 구현자는 walkforward_eval.ts를 읽고 동일 지표 정의로 작성할 것.

- [ ] **Step 3: 실행 (컨트롤러/사용자)**

Run: `npm run exp:logistic -- --matrix data/training_matrix.jsonl --split 20250101`
Expected: 분기별·누적 표. **판정 = 모델 연승이 v1·시장 대비 어떤가 + 노이즈경고.**

- [ ] **Step 4: 커밋** — `feat(scripts): 오프라인 로지스틱 실험 (단·연·묶음·ROI vs v1·시장)`

---

## 판정 게이트 (B2/B3 진행 여부)
- 로지스틱 연승이 v1보다 **누적 + 다분기 우세 + 오차범위 밖** → B2(GBM 도전자) 진행.
- 시장 격차가 v3(현행 -7.5%p)보다 줄면 가점.
- 안 이기면 → feature·라벨·규제 재검토 (방향 재논의).

## Self-Review (계획 B1)
- 스펙 커버리지: 로지스틱 학습=T3, 고정스키마=T4, 버킷/교차(실측 반영)=T2, 4지표 평가=T5, ROI용 win_odds=T1. GBM·스키마마이그·엔진통합·UI는 B2/B3로 명시 분리.
- Placeholder: T5 집계부는 "walkforward_eval.ts 패턴 차용"으로 위임 — 기존 검증 코드 재사용이라 신규 알고리즘 아님. 단 구현자는 그 파일을 읽고 동일 지표로 채울 것(지표 정의는 본문에 명시).
- 타입 일관성: `LogisticModel`/`fitLogistic`/`predictLogit`(T3) → T5 사용. `buildSchema`/`toVector`(T4) → T5 사용. `Feature`(계획 A) → T4. 행렬 `ord`/`win_odds`(T1) → T5 `Row`.
- 비단조 결정: ②는 실측상 선형이라 버킷 제외 (스펙 §4의 "②→버킷"을 데이터로 기각, 본 계획에 기록).
