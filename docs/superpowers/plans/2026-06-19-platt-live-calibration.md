# Platt 보정 확률 라이브 연결 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모델의 확률 버릇을 데이터로 펴주는 Platt 보정자를 라이브 예측에 연결해, 우승확률 P(1착)·연승확률 P(3착내)을 정직하게 계산·저장·웹 표시한다.

**Architecture:** 접근법 A(아티팩트 확장). 기존 top3 랭킹 로지스틱 모델은 불변, 거기에 P1 전용 모델 + Platt 계수 2개를 `artifact.calibration`으로 임베드한다. `predictRace`가 경주별로 보정 확률을 산출해 `predictions.p_win/p_top3`에 저장하고, UI가 % 표시한다. 개발은 로컬 DuckDB로(egress 절약), 검증 후 Supabase로 push.

**Tech Stack:** Node.js + TypeScript, vitest, DuckDB(`@duckdb/node-api`) 로컬 미러 / Supabase(PostgreSQL) 프로덕션, React + Vite(client).

**설계:** `docs/superpowers/specs/2026-06-19-platt-live-calibration-design.md`

> **⚠️ 변경 (2026-06-19, 옵션 A 확정 — 코드리뷰 발견 반영):** 보정자 저장은 **로컬 DuckDB 직접 쓰기 금지**. 로컬 `model_versions.artifact` 컬럼은 `read_json_auto`가 STRUCT로 추론 → 새 `calibration` 필드가 JSON→STRUCT 캐스트 시 **유실**되고, 로컬 파일은 backfill 등에 의해 **쓰기 락**이 걸린다. 대신 **`calib:fit-live`가 Supabase(jsonb)에 직접 기록 → `npm run db:pull`로 로컬 미러 갱신**(로컬=Supabase 읽기미러 설계와 일치). Supabase egress는 조직 이전으로 복구됨. 영향: Task 3 `writeLocal` 제거(Supabase 전용), Task 6/7 순서 아래 갱신본 사용.

---

## 파일 구조

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `src/engine/eval/calibratedProbs.ts` | 순수 함수: 아티팩트+경주 벡터 → 보정 P(1착)·P(3착내). `Calibration` 타입 정의 | 신규 |
| `src/engine/eval/calibratedProbs.test.ts` | 위 단위테스트 | 신규 |
| `src/engine/modelVersion.ts` | `ActiveModelVersion.artifact` 타입에 `calibration?` 반영 | 수정 |
| `src/engine/scorePredictor.ts` | `predictRace`가 보정 확률 산출, `PredictionRow`에 `p_win`/`p_top3` | 수정 |
| `src/engine/scorePredictor.test.ts` | predictRace 회귀(랭킹 불변·확률 범위·null 호환) | 신규/수정 |
| `scripts/fit_live_calibration.ts` | P1 모델 학습 + Platt fit → 아티팩트 임베드 → **Supabase 기록**(옵션 A) | 신규 |
| `scripts/fit_live_calibration.test.ts` | fit 통합테스트(합성 매트릭스) | 신규 |
| `supabase/migrations/014_prediction_calibrated_probs.sql` | `predictions`에 `p_win`/`p_top3` 컬럼 | 신규 |
| `client/src/lib/supabase.ts` | `Prediction` 인터페이스에 `p_win`/`p_top3` | 수정 |
| `client/src/pages/PredictionSheet.tsx` | 우승·연승확률 % 표시 | 수정 |
| `client/src/pages/RaceEntries.tsx` | 컴팩트 우승확률 표시 | 수정 |
| `package.json` | `calib:fit-live` 스크립트 | 수정 |

---

## Task 1: 순수 보정 모듈 `calibratedProbs.ts`

**Files:**
- Create: `src/engine/eval/calibratedProbs.ts`
- Test: `src/engine/eval/calibratedProbs.test.ts`

참고 타입 (기존):
- `LogisticModel`(`src/engine/models/logistic.ts`): `{ type:'logistic'; features:string[]; means:number[]; stds:number[]; coef:Record<string,number>; intercept:number }`
- `predictLogit(model, rawRow:number[]):number` — rawRow는 `model.features` 순서의 raw 값. 내부에서 표준화.
- `src/engine/eval/calibration.ts`: `sigmoid`, `normalizeProbs`, `applyPlatt({a,b}, p)`.

- [ ] **Step 1: 실패 테스트 작성**

`src/engine/eval/calibratedProbs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { calibratedRaceProbs, type Calibration } from './calibratedProbs.js';
import type { LogisticModel } from '../models/logistic.js';

// 피처 1개("x")짜리 최소 모델. means=0, stds=1 → predictLogit = intercept + coef*x.
function model(coefX: number, intercept = 0): LogisticModel {
  return { type: 'logistic', features: ['x'], means: [0], stds: [1], coef: { x: coefX }, intercept };
}

describe('calibratedRaceProbs', () => {
  it('calibration 없으면 모든 확률 null', () => {
    const base = model(1);
    const { pWin, pTop3 } = calibratedRaceProbs(base, [[0], [1], [2]]);
    expect(pWin).toEqual([null, null, null]);
    expect(pTop3).toEqual([null, null, null]);
  });

  it('p_top3 = applyPlatt(platt3, sigmoid(base logit)), 정규화 안 함', () => {
    const base = model(1, 0); // logit = x
    const cal: Calibration = {
      p1Model: model(1, 0),
      platt1: { a: 1, b: 0 },
      platt3: { a: 1, b: 0 }, // 항등 Platt → p_top3 = sigmoid(x)
      renormWin: false,
      fitMeta: { rows: 0, from: 0, to: 0, fitAt: '', baseModelId: 0 },
    };
    const artifact = { ...base, calibration: cal };
    const { pTop3 } = calibratedRaceProbs(artifact, [[0], [2]]);
    expect(pTop3[0]).toBeCloseTo(0.5, 6);          // sigmoid(0)
    expect(pTop3[1]).toBeCloseTo(1 / (1 + Math.exp(-2)), 6);
  });

  it('p_win = 항등 Platt면 경주내 정규화된 P1과 같다 (renormWin=false)', () => {
    const base = model(1, 0);
    const cal: Calibration = {
      p1Model: model(1, 0), platt1: { a: 1, b: 0 }, platt3: { a: 1, b: 0 },
      renormWin: false,
      fitMeta: { rows: 0, from: 0, to: 0, fitAt: '', baseModelId: 0 },
    };
    const artifact = { ...base, calibration: cal };
    const { pWin } = calibratedRaceProbs(artifact, [[0], [0]]); // 동일 → 정규화 0.5/0.5
    // 항등 Platt는 normWin을 logit→sigmoid→다시 매핑하므로 정확히 0.5는 아님. 합은 보존 안 됨(정규화 안 재적용).
    expect(pWin[0]).toBeCloseTo(pWin[1]!, 9);       // 대칭
    expect(pWin[0]!).toBeGreaterThan(0);
    expect(pWin[0]!).toBeLessThan(1);
  });

  it('renormWin=true면 p_win 합≈1', () => {
    const base = model(1, 0);
    const cal: Calibration = {
      p1Model: model(2, 0), platt1: { a: 1.3, b: -0.2 }, platt3: { a: 1, b: 0 },
      renormWin: true,
      fitMeta: { rows: 0, from: 0, to: 0, fitAt: '', baseModelId: 0 },
    };
    const artifact = { ...base, calibration: cal };
    const { pWin } = calibratedRaceProbs(artifact, [[0], [1], [2]]);
    const sum = pWin.reduce((s, v) => s + (v ?? 0), 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('1마리·빈 경주 방어', () => {
    const base = model(1, 0);
    const cal: Calibration = {
      p1Model: model(1, 0), platt1: { a: 1, b: 0 }, platt3: { a: 1, b: 0 },
      renormWin: true, fitMeta: { rows: 0, from: 0, to: 0, fitAt: '', baseModelId: 0 },
    };
    const artifact = { ...base, calibration: cal };
    expect(calibratedRaceProbs(artifact, []).pWin).toEqual([]);
    const one = calibratedRaceProbs(artifact, [[1]]);
    expect(one.pWin[0]).toBeCloseTo(1, 6); // renorm 1마리 → 1
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- src/engine/eval/calibratedProbs.test.ts`
Expected: FAIL — "Cannot find module './calibratedProbs.js'".

- [ ] **Step 3: 최소 구현**

`src/engine/eval/calibratedProbs.ts`:
```ts
/**
 * 라이브 보정 확률 — 아티팩트(base 모델 + calibration) + 경주 내 정렬 벡터 → P(1착)·P(3착내).
 * 순수 함수. calibration 없으면 전부 null(구 아티팩트 무중단 호환).
 * 설계: docs/superpowers/specs/2026-06-19-platt-live-calibration-design.md
 */
import type { LogisticModel } from '../models/logistic.js';
import { sigmoid, normalizeProbs, applyPlatt } from './calibration.js';

export interface Calibration {
  p1Model: LogisticModel;            // ord===1 학습, P(1착) 전용
  platt1: { a: number; b: number };  // 경주내 정규화된 P1에 적용
  platt3: { a: number; b: number };  // base(top3) 모델 raw 확률에 적용
  renormWin: boolean;                // p_win에 Platt 후 경주내 재정규화 여부
  fitMeta: { rows: number; from: number; to: number; fitAt: string; baseModelId: number };
}

export type CalibratedArtifact = LogisticModel & { calibration?: Calibration };

/** model.features 순서의 raw 벡터로 logit → sigmoid. */
function rawProb(model: LogisticModel, vec: number[]): number {
  let z = model.intercept;
  model.features.forEach((f, j) => {
    z += (model.coef[f] ?? 0) * ((vec[j]! - model.means[j]!) / model.stds[j]!);
  });
  return sigmoid(z);
}

/**
 * 한 경주의 모든 출주마(벡터는 base 모델.features 순서) → 보정 확률.
 * p_top3: applyPlatt(platt3, sigmoid(base logit)) — 정규화 안 함.
 * p_win:  applyPlatt(platt1, normWin(sigmoid(p1 logit))) — renormWin이면 다시 정규화.
 */
export function calibratedRaceProbs(
  artifact: CalibratedArtifact,
  vectors: number[][],
): { pWin: (number | null)[]; pTop3: (number | null)[] } {
  const cal = artifact.calibration;
  if (!cal || vectors.length === 0) {
    return { pWin: vectors.map(() => null), pTop3: vectors.map(() => null) };
  }
  const pTop3 = vectors.map((v) => applyPlatt(cal.platt3, rawProb(artifact, v)));
  const rawP1 = vectors.map((v) => rawProb(cal.p1Model, v));
  const normWin = normalizeProbs(rawP1);
  const plattWin = normWin.map((p) => applyPlatt(cal.platt1, p));
  const pWin = cal.renormWin ? normalizeProbs(plattWin) : plattWin;
  return { pWin, pTop3 };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- src/engine/eval/calibratedProbs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/engine/eval/calibratedProbs.ts src/engine/eval/calibratedProbs.test.ts
git commit -m "feat(calib): calibratedRaceProbs 순수 모듈 + Calibration 타입"
```

---

## Task 2: `predictRace` 연결 + `PredictionRow` 확장

**Files:**
- Modify: `src/engine/modelVersion.ts` (artifact 타입)
- Modify: `src/engine/scorePredictor.ts:41-51`(PredictionRow), `:264-296`(predictRace)
- Test: `src/engine/scorePredictor.test.ts`

- [ ] **Step 1: artifact 타입 확장 (`modelVersion.ts`)**

`src/engine/modelVersion.ts`에서 import·타입 수정:
```ts
import type { CalibratedArtifact } from './eval/calibratedProbs.js';
// ...
export interface ActiveModelVersion {
  id: number | null;
  label: string;
  model_type: string;
  weights: Record<string, number>;
  artifact: CalibratedArtifact | null;   // LogisticModel & { calibration? }
}
```
그리고 `getActiveModelVersion` 내부 `artifact: (data.artifact as LogisticModel | null) ?? null` → `as CalibratedArtifact | null`. (기존 `LogisticModel` import 유지.)

- [ ] **Step 2: 실패 테스트 작성 (`scorePredictor.test.ts`)**

`predictRace`는 DB(ReadClient)에 의존하므로, 보정 로직을 **추출한 헬퍼**를 테스트한다. 먼저 scorePredictor에서 export할 헬퍼를 가정한 테스트 작성:
```ts
import { describe, it, expect } from 'vitest';
import { attachCalibratedProbs } from './scorePredictor.js';
import type { CalibratedArtifact } from './eval/calibratedProbs.js';

function model(coefX: number): CalibratedArtifact {
  return { type: 'logistic', features: ['x'], means: [0], stds: [1], coef: { x: coefX }, intercept: 0 };
}

describe('attachCalibratedProbs', () => {
  it('calibration 없으면 p_win/p_top3 null', () => {
    const r = attachCalibratedProbs(model(1), [[0], [1]]);
    expect(r).toEqual([{ p_win: null, p_top3: null }, { p_win: null, p_top3: null }]);
  });

  it('calibration 있으면 (0,1) 범위 확률', () => {
    const base = model(1);
    const artifact: CalibratedArtifact = {
      ...base,
      calibration: {
        p1Model: model(2), platt1: { a: 1, b: 0 }, platt3: { a: 1, b: 0 },
        renormWin: false, fitMeta: { rows: 0, from: 0, to: 0, fitAt: '', baseModelId: 0 },
      },
    };
    const r = attachCalibratedProbs(artifact, [[0], [1], [2]]);
    for (const row of r) {
      expect(row.p_win!).toBeGreaterThan(0); expect(row.p_win!).toBeLessThan(1);
      expect(row.p_top3!).toBeGreaterThan(0); expect(row.p_top3!).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm run test:run -- src/engine/scorePredictor.test.ts`
Expected: FAIL — `attachCalibratedProbs` export 없음.

- [ ] **Step 4: 구현 — 헬퍼 + PredictionRow + predictRace**

`src/engine/scorePredictor.ts`:

(a) import 추가(파일 상단 import 구역):
```ts
import { calibratedRaceProbs, type CalibratedArtifact } from './eval/calibratedProbs.js';
```

(b) `PredictionRow`(41-51)에 필드 추가:
```ts
export interface PredictionRow {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_name: string;
  total_score: number;
  predicted_rank: number;
  item_scores: HorseScoreResult['items'];
  actual_ord: number | null;
  model_version: number | null;
  p_win: number | null;     // 보정 우승확률 (calibration 없으면 null)
  p_top3: number | null;    // 보정 연승확률(3착내)
}
```

(c) export 헬퍼 추가(파일 하단, predictRace 근처):
```ts
/** 경주 내 벡터(=artifact.features 순서)로 보정 확률 산출. calibration 없으면 null. */
export function attachCalibratedProbs(
  artifact: CalibratedArtifact,
  vectors: number[][],
): { p_win: number | null; p_top3: number | null }[] {
  const { pWin, pTop3 } = calibratedRaceProbs(artifact, vectors);
  return vectors.map((_, i) => ({ p_win: pWin[i]!, p_top3: pTop3[i]! }));
}
```

(d) `predictRace`(264-296) 수정 — `results` 산출 후, return 전에 벡터·확률 계산. `buildFeatures`/`toVector` import 필요:
```ts
import { buildFeatures } from './features/buildFeatures.js';
import { toVector } from './features/alignFeatures.js';
```
predictRace 본문(`const sorted = ...` 위)에 추가:
```ts
  // 보정 확률(로지스틱 + calibration 있을 때만). 랭킹과 무관.
  const artifact = activeVersion.artifact;
  const probRows = artifact
    ? attachCalibratedProbs(
        artifact,
        results.map((r) => toVector(buildFeatures(r.row.input), artifact.features)),
      )
    : results.map(() => ({ p_win: null, p_top3: null }));
```
그리고 return의 `results.map((r) => ({...}))`를 인덱스 포함으로:
```ts
  return results.map((r, i) => ({
    race_date: rcDate,
    meet,
    rc_no: rcNo,
    hr_name: r.row.hr_name,
    total_score: r.score.total,
    predicted_rank: rankMap.get(r.row.pthr_no)!,
    item_scores: r.score.items,
    actual_ord: r.row.ord,
    model_version: activeVersion.id,
    p_win: probRows[i]!.p_win,
    p_top3: probRows[i]!.p_top3,
  }));
```

- [ ] **Step 5: 테스트 통과 + 빌드 + 무회귀**

Run: `npm run test:run -- src/engine/scorePredictor.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: tsc 통과(타입 에러 0). `backfill_predictions`·`dailySync`는 rows 통째 insert라 추가 수정 불필요.

- [ ] **Step 6: 커밋**

```bash
git add src/engine/modelVersion.ts src/engine/scorePredictor.ts src/engine/scorePredictor.test.ts
git commit -m "feat(calib): predictRace가 p_win/p_top3 산출 — 랭킹 불변"
```

---

## Task 3: 보정자 학습 스크립트 `fit_live_calibration.ts`

**Files:**
- Create: `scripts/fit_live_calibration.ts`
- Create: `scripts/fit_live_calibration.test.ts`
- Modify: `package.json`

참고:
- `extract_training_matrix.ts` 출력 JSONL 한 줄: `{ race_date, meet, rc_no, hr_name, ord, win_odds, top3, top2, features }`. `features`는 `Feature[]`(`{name,value}`).
- `buildSchema(features[])`·`toVector(features, schema)`: `src/engine/features/alignFeatures.js`.
- `fitLogistic(X, y, features, opts)`·`predictLogit`: `src/engine/models/logistic.js`.
- `fitPlatt(pairs)`: `src/engine/eval/calibration.js`.
- 활성 아티팩트 읽기: `getReadClient()`(`src/db/localDb.js`) → `.from('model_versions').select('id, artifact').eq('is_active', true).maybeSingle()`. artifact가 문자열이면 `JSON.parse`.
- DuckDB 직접 쓰기: `_probe_mv.mts` 패턴 — `DuckDBInstance.create('data/local.duckdb')`.

핵심 로직을 **순수 함수 `buildCalibration`로 분리**해 테스트한다(DB·파일 IO는 main에서).

- [ ] **Step 1: 실패 테스트 작성 (`fit_live_calibration.test.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import { buildCalibration, type MatrixRow } from './fit_live_calibration.js';
import type { LogisticModel } from '../src/engine/models/logistic.js';
import { calibratedRaceProbs } from '../src/engine/eval/calibratedProbs.js';

// 합성: 피처 x가 클수록 1착·3착 확률↑. 5경주 × 4마리.
function synth(): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (let r = 0; r < 5; r++) {
    for (let h = 0; h < 4; h++) {
      const x = h; // 0..3
      rows.push({
        race_date: 20240100 + r, meet: 1, rc_no: 1,
        ord: 4 - h,                       // x 큰 말이 1착(ord 1)
        top3: (4 - h) <= 3 ? 1 : 0,
        features: [{ name: 'x', value: x }],
      });
    }
  }
  return rows;
}

describe('buildCalibration', () => {
  const base: LogisticModel = {
    type: 'logistic', features: ['x'], means: [1.5], stds: [1.1],
    coef: { x: 1.0 }, intercept: 0,
  };

  it('calibration 구조 생성 + 계수 유한', () => {
    const cal = buildCalibration(base, synth(), { renormWin: false, baseModelId: 6 });
    expect(cal.p1Model.features).toEqual(['x']);
    expect(Number.isFinite(cal.platt1.a)).toBe(true);
    expect(Number.isFinite(cal.platt1.b)).toBe(true);
    expect(Number.isFinite(cal.platt3.a)).toBe(true);
    expect(cal.fitMeta.rows).toBe(20);
    expect(cal.fitMeta.baseModelId).toBe(6);
    expect(cal.renormWin).toBe(false);
  });

  it('생성된 calibration으로 보정 확률이 (0,1)', () => {
    const cal = buildCalibration(base, synth(), { renormWin: true, baseModelId: 6 });
    const artifact = { ...base, calibration: cal };
    const { pWin, pTop3 } = calibratedRaceProbs(artifact, [[0], [1], [2], [3]]);
    for (const v of [...pWin, ...pTop3]) {
      expect(v!).toBeGreaterThan(0); expect(v!).toBeLessThan(1);
    }
    expect(pWin.reduce((s, v) => s + v!, 0)).toBeCloseTo(1, 6); // renorm
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- scripts/fit_live_calibration.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현 (`fit_live_calibration.ts`)**

```ts
/**
 * 라이브 Platt 보정자 학습 — P1 전용 모델 + Platt(P1·P3)을 활성 아티팩트에 임베드.
 * 보정자는 활성 모델의 학습행렬과 같은 데이터로 fit(누수 노트: 설계 §9).
 * 사용: npm run calib:fit-live -- [--matrix data/training_matrix.jsonl] [--renorm] [--target local|supabase]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';
import { getReadClient } from '../src/db/localDb.js';
import { fitLogistic, predictLogit, type LogisticModel } from '../src/engine/models/logistic.js';
import { toVector } from '../src/engine/features/alignFeatures.js';
import { sigmoid, normalizeProbs, fitPlatt, type Pair } from '../src/engine/eval/calibration.js';
import type { Calibration } from '../src/engine/eval/calibratedProbs.js';
import type { Feature } from '../src/engine/features/types.js';

export interface MatrixRow {
  race_date: number; meet: number; rc_no: number;
  ord: number; top3: number; features: Feature[];
}

const CFG = { l2: 0.02, iters: 800, lr: 0.2 }; // learn_logistic과 동일

/** base 모델(랭킹용 top3)·학습행렬 → Calibration. 스키마는 base.features에 고정(라이브 패리티). */
export function buildCalibration(
  base: LogisticModel,
  rows: MatrixRow[],
  opts: { renormWin: boolean; baseModelId: number },
): Calibration {
  const schema = base.features;
  const X = rows.map((r) => toVector(r.features, schema));
  const y1 = rows.map((r) => (r.ord === 1 ? 1 : 0));
  const p1Model = fitLogistic(X, y1, schema, CFG);

  // platt3: base(top3) raw 확률 vs top3 라벨 (정규화 안 함)
  const p3Pairs: Pair[] = rows.map((r, i) => ({ p: sigmoid(predictLogit(base, X[i]!)), y: r.top3 }));
  const platt3 = fitPlatt(p3Pairs);

  // platt1: 경주내 정규화된 P1 vs ord===1 라벨
  const byRace = new Map<string, number[]>(); // key → row index 목록
  rows.forEach((r, i) => {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    (byRace.get(k) ?? byRace.set(k, []).get(k)!).push(i);
  });
  const p1Pairs: Pair[] = [];
  for (const idxs of byRace.values()) {
    const norm = normalizeProbs(idxs.map((i) => sigmoid(predictLogit(p1Model, X[i]!))));
    idxs.forEach((i, k) => p1Pairs.push({ p: norm[k]!, y: rows[i]!.ord === 1 ? 1 : 0 }));
  }
  const platt1 = fitPlatt(p1Pairs);

  return {
    p1Model, platt1, platt3, renormWin: opts.renormWin,
    fitMeta: {
      rows: rows.length,
      from: Math.min(...rows.map((r) => r.race_date)),
      to: Math.max(...rows.map((r) => r.race_date)),
      fitAt: new Date().toISOString(),
      baseModelId: opts.baseModelId,
    },
  };
}

async function readActiveArtifact(): Promise<{ id: number; artifact: LogisticModel }> {
  const sb = await getReadClient();
  const { data, error } = await sb.from('model_versions')
    .select('id, model_type, artifact').eq('is_active', true).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('활성 model_versions 없음');
  if (data.model_type !== 'logistic') throw new Error(`활성 모델이 logistic 아님: ${data.model_type}`);
  const artifact = typeof data.artifact === 'string' ? JSON.parse(data.artifact) : data.artifact;
  return { id: data.id as number, artifact: artifact as LogisticModel };
}

async function writeLocal(id: number, artifact: object): Promise<void> {
  const inst = await DuckDBInstance.create('data/local.duckdb');
  const conn = await inst.connect();
  const prepared = await conn.prepare(`UPDATE model_versions SET artifact = ? WHERE id = ?`);
  prepared.bindVarchar(1, JSON.stringify(artifact));
  prepared.bindInteger(2, id);
  await prepared.run();
}

async function writeSupabase(id: number, artifact: object): Promise<void> {
  const { getSupabaseAdmin } = await import('../src/db/supabase.js');
  const sb = getSupabaseAdmin();
  const { error } = await sb.from('model_versions').update({ artifact }).eq('id', id);
  if (error) throw error;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const renormWin = args.includes('--renorm');
  const target = arg('--target', 'local');

  const rows: MatrixRow[] = readFileSync(matrixPath, 'utf8')
    .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const { id, artifact: base } = await readActiveArtifact();
  console.log(`활성 모델 id=${id}, 학습행렬 ${rows.length}행, renormWin=${renormWin}`);

  const calibration = buildCalibration(base, rows, { renormWin, baseModelId: id });
  const augmented = { ...base, calibration };
  console.log(`platt1={a:${calibration.platt1.a.toFixed(3)},b:${calibration.platt1.b.toFixed(3)}} ` +
              `platt3={a:${calibration.platt3.a.toFixed(3)},b:${calibration.platt3.b.toFixed(3)}}`);

  if (target === 'supabase') { await writeSupabase(id, augmented); console.log('✅ Supabase 기록'); }
  else { await writeLocal(id, augmented); console.log('✅ 로컬 DuckDB 기록'); }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```
> ⚠️ `prepared.bindVarchar`/`bindInteger`/`prepare` API는 설치된 `@duckdb/node-api` 버전 시그니처에 맞춘다. 불확실하면 Step 5 검증에서 실제 API로 교정(예: `conn.run("UPDATE ... SET artifact = ? WHERE id = ?", [json, id])`).

`package.json` scripts에 추가:
```json
    "calib:fit-live": "tsx scripts/fit_live_calibration.ts",
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- scripts/fit_live_calibration.test.ts`
Expected: PASS (2 tests). (test는 `buildCalibration` 순수부만 — DB/파일 IO 없음.)

- [ ] **Step 5: 빌드**

Run: `npm run build`
Expected: tsc 통과.

- [ ] **Step 6: 커밋**

```bash
git add scripts/fit_live_calibration.ts scripts/fit_live_calibration.test.ts package.json
git commit -m "feat(calib): fit_live_calibration — P1 모델·Platt 학습→아티팩트 임베드"
```

---

## Task 4: DB 컬럼 (마이그레이션 014 + 로컬 DuckDB)

**Files:**
- Create: `supabase/migrations/014_prediction_calibrated_probs.sql`
- (로컬 DuckDB 컬럼 추가는 명령으로)

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migrations/014_prediction_calibrated_probs.sql`:
```sql
-- 014: predictions에 보정 확률 컬럼 추가 (Platt 라이브 연결)
-- p_win  = 보정 우승확률 P(1착), p_top3 = 보정 연승확률 P(3착내). nullable(보정 전 데이터 호환).
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS p_win REAL;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS p_top3 REAL;
```

> **옵션 A 참고:** 로컬 DuckDB predictions 컬럼은 별도 ALTER 불필요. (1) 로컬 검증(Task 6)은 `predictRace`가 p_win/p_top3를 **메모리에서 반환**하므로 컬럼이 필요 없고, (2) 저장 경로는 Supabase backfill(Task 7) → 이후 `db:pull` 시 로컬 미러에 자동 반영. 즉 이 Task는 **Supabase 마이그 파일 작성**만.

- [ ] **Step 2: 커밋**

```bash
git add supabase/migrations/014_prediction_calibrated_probs.sql
git commit -m "feat(db): 014 predictions p_win/p_top3 컬럼 (Platt 라이브)"
```

---

## Task 5: UI 표시

**Files:**
- Modify: `client/src/lib/supabase.ts:151-160` (`Prediction` 인터페이스)
- Modify: `client/src/pages/PredictionSheet.tsx`
- Modify: `client/src/pages/RaceEntries.tsx`

> 쿼리는 `.select('*')`라 컬럼 추가만으로 데이터 흐름. 타입·표시만 손댄다.

- [ ] **Step 1: `Prediction` 타입 확장**

`client/src/lib/supabase.ts`:
```ts
export interface Prediction {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_name: string;
  total_score: number;
  predicted_rank: number;
  item_scores: Record<string, ItemScore>;
  actual_ord: number | null;
  p_win: number | null;
  p_top3: number | null;
}
```

- [ ] **Step 2: 포맷 유틸 (PredictionSheet 내 또는 공통)**

`client/src/pages/PredictionSheet.tsx` 상단(컴포넌트 밖)에 추가:
```ts
/** 0~1 확률 → 정수 %. null이면 빈 문자열. */
const fmtPct = (p: number | null | undefined): string =>
  p == null ? '' : `${Math.round(p * 100)}%`;
```

- [ ] **Step 3: PredictionSheet에 우승·연승확률 표시**

말 카드의 점수(`{p.total_score.toFixed(1)}점`, ~303-305행) 근처에, `p.p_win`/`p.p_top3`가 있을 때만 표시:
```tsx
{p.p_win != null && (
  <span className="text-xs text-[var(--color-text-secondary)] ml-2">
    우승 {fmtPct(p.p_win)} · 연승 {fmtPct(p.p_top3)}
  </span>
)}
```
> 정확한 JSX 위치는 해당 말 카드의 점수 표시 라인 옆. `p`가 `Prediction`인 스코프에서.

- [ ] **Step 4: RaceEntries에 컴팩트 우승확률**

`RaceEntries.tsx`에서 예측 표시 영역(점수 `{p.total_score.toFixed(1)}점`, ~179행) 옆에:
```tsx
{p.p_win != null && <span className="text-xs text-[var(--color-text-disabled)] ml-1">{fmtPct(p.p_win)}</span>}
```
동일 `fmtPct` 유틸을 RaceEntries 상단에도 정의(또는 `client/src/lib`의 공통 포맷 모듈로 추출 — 두 곳 이상 쓰므로 DRY 권장).

- [ ] **Step 5: 클라이언트 타입체크/빌드**

Run: `cd client && npm run build`
Expected: tsc/vite 빌드 통과.

- [ ] **Step 6: 커밋**

```bash
git add client/src/lib/supabase.ts client/src/pages/PredictionSheet.tsx client/src/pages/RaceEntries.tsx
git commit -m "feat(ui): 예상지·출마정보에 보정 우승/연승확률 % 표시"
```

---

## Task 6: 검증 + renormWin 확정 (옵션 A: Supabase fit → db:pull → 로컬 predictRace)

> ⚠️ Step 1·3은 로컬 DuckDB를 읽기/쓰기 → **backfill 등 로컬 쓰기 프로세스가 끝나 락이 풀린 뒤** 실행. Step 2(Supabase fit)는 로컬 락과 무관하게 언제든 가능.

- [ ] **Step 1: 학습행렬 최신화 (필요 시)**

`data/training_matrix.jsonl`이 최신인지 확인. 없거나 오래됐으면(로컬 DuckDB 읽기 — 락 풀린 뒤):
Run: `npm run extract:matrix -- --from 20240101 --to 20991231 --out data/training_matrix.jsonl`
(KRA API 호출 아님 — 토큰/쿼터 무관.)

- [ ] **Step 2: 보정자 학습 → Supabase 기록 (plain Platt)**

Run: `npm run calib:fit-live`
Expected: "활성 모델 id=6 ...", "platt1={...} platt3={...}", "✅ Supabase 기록 완료 — ... db:pull 실행하세요." (랭킹·계수 불변, calibration만 추가.)

- [ ] **Step 3: 로컬 미러 갱신**

Run: `npm run db:pull`  (락 풀린 뒤. 로컬 `model_versions.artifact`가 calibration 포함 STRUCT로 재추론됨.)

- [ ] **Step 4: 샘플 경주 확률 출력 (로컬 predictRace)**

Run:
```bash
npx tsx -e "import('dotenv/config').then(async()=>{const {getReadClient}=await import('./src/db/localDb.js');const {predictRace}=await import('./src/engine/scorePredictor.js');const sb=await getReadClient();const {data}=await sb.from('races').select('race_date,meet,rc_no').not('rc_dist','is',null).limit(1);const r=data[0];const rows=await predictRace(sb,r.race_date,r.meet,r.rc_no);console.log(rows.map(x=>({hr:x.hr_name,rank:x.predicted_rank,p_win:x.p_win,p_top3:x.p_top3})));})"
```
Expected: 각 말에 p_win·p_top3가 0~1 숫자(null 아님 = calibration 적재 확인). 상위 랭크 말의 p_win이 큼. 합리성 눈검사.

- [ ] **Step 5: `calib:recal`과 대조 + renormWin 결정**

Run: `npm run calib:recal`
대조: 보정 확률이 OOS Platt 행(ECE 0.004대)과 **일관**한지. plain vs +재정규화 중 ECE 낮은 쪽 식별. **+재정규화가 우세면** `npm run calib:fit-live -- --renorm` 재실행 → `npm run db:pull` 재실행. 아니면 plain 유지. 결정 근거를 설계 §2 renormWin 행에 한 줄 기록.

- [ ] **Step 6: 전체 테스트·빌드 무회귀**

Run: `npm run test:run` (전체) · `npm run build`
Expected: 전부 통과.

- [ ] **Step 7: 검증 결과 커밋(문서)**

```bash
git add docs/superpowers/specs/2026-06-19-platt-live-calibration-design.md
git commit -m "docs(calib): renormWin 실측 확정 + 로컬 E2E 검증 결과"
```

---

## Task 7: 프로덕션 마무리 (predictions 영속화 + 웹 배포)

> ⚠️ Task 6 검증 통과 후. (보정자 Supabase 기록은 Task 6 Step 2에서 이미 완료 — 여기선 컬럼·백필·배포만.)

- [ ] **Step 1: 마이그레이션 014 Supabase 적용**

사용자가 Supabase SQL Editor에서 `supabase/migrations/014_prediction_calibrated_probs.sql` 실행. 컬럼 `p_win`/`p_top3` 생성 확인.

- [ ] **Step 2: predictions 백필**

Run: `npm run backfill`  (또는 범위 한정 `npm run backfill -- --date YYYYMMDD`)
Expected: p_win/p_top3가 채워진 predictions 재생성. (활성 artifact에 calibration이 이미 있으므로 자동 산출. egress 고려해 필요한 범위만.)

- [ ] **Step 3: 배포·웹 확인**

`main` 머지 또는 현 배포 경로로 Vercel 배포 → 예상지에서 "우승 N% · 연승 M%" 표시 확인. 보정 전 과거 데이터는 빈칸(graceful).

- [ ] **Step 4: 메모리·문서 갱신**

`[[project_market_edge_strategy]]`에 "Platt 라이브 연결 완료(첫 서비스 캘리브레이션 채택)" 반영. CLAUDE.md 실행 상태 갱신.

---

## Self-Review

**스펙 커버리지:** §2 결정(범위 풀/확률 2종/Platt/접근법 A/저장/재정규화) → Task 1~6. §4.1 타입 → Task 1·2. §4.2 순수모듈 → Task 1. §4.3 fit 스크립트 → Task 3. §4.4 predictRace → Task 2. §4.5 DB → Task 4. §4.6 UI → Task 5. §6 테스트 → 각 Task TDD + Task 6 전체. §7 단계 → Task 6(Phase1)·7(Phase2). §9 누수노트 → Task 3 주석. 누락 없음.

**플레이스홀더:** 없음. `renormWin`은 Task 6에서 데이터로 확정(방법 명시). 보정자 저장은 옵션 A(Supabase jsonb + db:pull)로 확정 — 로컬 DuckDB STRUCT 직접 쓰기 폐기.

**타입 일관성:** `Calibration`(Task 1) ↔ `CalibratedArtifact`(Task 1·2) ↔ `attachCalibratedProbs`(Task 2) ↔ `buildCalibration`(Task 3) ↔ `MatrixRow`(Task 3) ↔ `Prediction`(Task 5) 모두 동일 필드명(`p_win`/`p_top3`, `platt1`/`platt3`/`p1Model`/`renormWin`/`fitMeta`)로 일치.
