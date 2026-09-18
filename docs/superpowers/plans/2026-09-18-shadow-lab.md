# 섀도 실험실(/lab) + 학습 방식 실험 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 라이브(v7)와 별개로 실험 버전 모델의 예측을 `shadow_predictions`에 저장·결과기록하고 `/lab`에서 같은 경주끼리 비교하며, 그 위에 로지스틱 학습 방식 실험(E0 수렴·E1 l2 튜닝·E2 상위3 조건부 로짓)을 돌린다.

**Architecture:** 채점 로직을 `scoreRaceRows()`로 분리해 라이브·섀도가 공유한다. 섀도는 별도 테이블·별도 함수(`predictShadows`)·실패 격리로 라이브 경로를 한 줄도 바꾸지 않는다(호출 추가만). 과거 채우기는 `train_until` 하한 + 누수 점검 합격 후에만 열린다. 실험은 DuckDB 미러에서 오프라인 롤링으로 판정한다.

**Tech Stack:** Node.js + TypeScript(tsx), vitest, Supabase(PostgreSQL) + DuckDB 로컬 미러, React + Vite + Tailwind + React Query.

**Spec:** `docs/superpowers/specs/2026-09-18-shadow-lab-design.md`

## Global Constraints

- 브랜치 `feat/shadow-lab`. 커밋 메시지 한국어 + scope(`feat(x)`/`fix(x)`/`docs:`), 끝에 attribution 2줄:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01ABdDD1UsE9voTSfSYyUhPM`
- 매 커밋 전 `npm run build`(tsc) + `npm run test:run` 통과. 클라이언트 변경 시 `cd client && npx tsc --noEmit`도.
- **라이브 출력 불변:** `predictRace()` 결과는 리팩터 전후 동일해야 한다. 라이브 싱크 결과·`--fail-on-empty` 판정은 섀도 실패에 영향받지 않는다.
- **KRA API 호출 금지**(이 계획엔 KRA 호출 없음). **Supabase 쓰기(마이그레이션 적용·후보 등록·과거 채우기)는 사용자 확인 후.**
- 적중 지표 규칙(이름 아님, spec §6.1): 단승 = 1순위가 1착 / 연승 = 1순위가 3착 안 / 복승 = 1·2순위 두 마리가 모두 실제 2착 안(순서 무관) / TOP3 겹침 = 예측 상위3 중 실제 3착 안 마릿수.
- 판정 규칙(사전등록, spec §7): 연승 평균 Δ ≥ +1.0%p AND 분기 과반 양수, 기준선 = 로지스틱 l2 0.02·800회, 6분기 롤링(2025Q1~2026Q2).
- 튜닝은 **2024Q4 검증 분기에서만**(학습 ≤ 2024-09-30). 시험 분기(2025Q1~)로 설정값을 고르지 않는다.
- 서브에이전트 spawn 시 `model: 'sonnet'`.

## File Structure

| 파일 | 책임 | 작업 |
|---|---|---|
| `supabase/migrations/018_shadow_predictions.sql` | `model_versions.is_shadow/train_until`, `shadow_predictions` 테이블·RLS | 생성 (T1) |
| `src/engine/modelVersion.ts` | `getShadowModelVersions()` 추가 | 수정 (T1) |
| `src/engine/logisticScorer.ts` | 입력 타입을 `LinearModel`로 일반화 | 수정 (T2) |
| `src/engine/scorePredictor.ts` | `scoreRaceRows()` 분리, `LINEAR_MODEL_TYPES` | 수정 (T2) |
| `src/engine/shadowPredictor.ts` | `predictShadows()` — 실험 버전별 채점 | 생성 (T3) |
| `src/sync/shadowWriter.ts` | `writeShadowPredictions()`, `updateShadowActualOrd()` | 생성 (T3) |
| `src/sync/raceCardSync.ts` | 라이브 INSERT 직후 섀도 쓰기(격리) | 수정 (T3) |
| `src/sync/dailySync.ts` | actual_ord UPDATE 직후 섀도 결과 기록(격리) | 수정 (T4) |
| `src/engine/shadow/leakCheck.ts` | 점수 비교 순수함수 | 생성 (T5) |
| `scripts/shadow_leak_check.ts` | 누수 점검 CLI | 생성 (T5) |
| `src/engine/shadow/backfillRange.ts` | `train_until` 하한 가드 순수함수 | 생성 (T6) |
| `scripts/shadow_backfill.ts` | 과거 채우기 CLI | 생성 (T6) |
| `client/src/lib/labMetrics.ts` | 지표·성적표·흔들림 폭·경주별 비교 순수함수 | 생성 (T7) |
| `client/src/lib/queries.ts` | `useLabData()` 훅 | 수정 (T8) |
| `client/src/pages/Lab.tsx` | 옛 가중치 실험실 → 섀도 비교 화면 교체 | 재작성 (T8) |
| `client/src/components/Layout.tsx` | 실험실 링크 title 문구만 | 수정 (T8) |
| `src/engine/models/logistic.ts` | `onLoss` 콜백(수렴 기록) | 수정 (T9) |
| `src/engine/models/plackettLuce.ts` | `topK` 옵션(상위3 조건부 로짓) | 수정 (T9) |
| `src/engine/eval/learningExp.ts` | 실험 지표·판정 순수함수 | 생성 (T10) |
| `scripts/exp_learning.ts` | E0/E1/E2 실행 CLI | 생성 (T10) |
| `scripts/learn_logistic.ts` | `--model/--l2/--iters/--shadow` + `train_until` | 수정 (T11) |
| `package.json` | 스크립트 3개 추가 | 수정 (T5·T6·T10) |
| docs 5종 | 운영·상태 문서 | 수정 (T12) |

---

### Task 1: 마이그레이션 018 + 실험 버전 조회

**Files:**
- Create: `supabase/migrations/018_shadow_predictions.sql`
- Modify: `src/engine/modelVersion.ts`
- Test: `src/engine/modelVersion.test.ts` (신규)

**Interfaces:**
- Produces: `interface ShadowModelVersion extends ActiveModelVersion { train_until: number | null }`, `getShadowModelVersions(sb: ReadClient): Promise<ShadowModelVersion[]>` (id 오름차순, `is_shadow=true`만)

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- ============================================
-- 018_shadow_predictions.sql
-- 섀도(실험) 버전 예측 저장. 라이브 predictions와 완전 분리.
-- spec: docs/superpowers/specs/2026-09-18-shadow-lab-design.md §3
-- ============================================

ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS is_shadow BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE model_versions ADD COLUMN IF NOT EXISTS train_until INT;   -- 학습 데이터 마지막 경주일 YYYYMMDD
ALTER TABLE model_versions DROP CONSTRAINT IF EXISTS chk_model_versions_active_not_shadow;
ALTER TABLE model_versions ADD CONSTRAINT chk_model_versions_active_not_shadow
  CHECK (NOT (is_active AND is_shadow));

CREATE TABLE IF NOT EXISTS shadow_predictions (
  race_date      INT          NOT NULL,
  meet           INT          NOT NULL,
  rc_no          INT          NOT NULL,
  hr_name        VARCHAR(50)  NOT NULL,
  model_version  INT          NOT NULL REFERENCES model_versions(id),
  total_score    NUMERIC      NOT NULL,
  predicted_rank INT          NOT NULL,
  p_top3         NUMERIC,
  actual_ord     INT,
  source         VARCHAR(10)  NOT NULL CHECK (source IN ('live', 'backfill')),
  computed_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (race_date, meet, rc_no, hr_name, model_version)
);
CREATE INDEX IF NOT EXISTS idx_shadow_predictions_version_date
  ON shadow_predictions (model_version, race_date);

-- RLS (015_combo_dividends 관례): anon 읽기, 쓰기는 service_role만
ALTER TABLE shadow_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON shadow_predictions;
CREATE POLICY "anon_read" ON shadow_predictions FOR SELECT TO anon USING (true);

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: 실패 테스트 작성** — `src/engine/modelVersion.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { getShadowModelVersions } from './modelVersion.js';

function fakeClient(rows: Record<string, unknown>[]) {
  const q = {
    filters: [] as Array<[string, unknown]>,
    select() { return q; },
    eq(c: string, v: unknown) { q.filters.push([c, v]); return q; },
    order() { return q; },
    then(res: (v: { data: unknown; error: null }) => unknown) {
      const data = rows.filter((r) => q.filters.every(([c, v]) => r[c] === v))
        .sort((a, b) => (a.id as number) - (b.id as number));
      return Promise.resolve(res({ data, error: null }));
    },
  };
  return { from: () => q } as never;
}

describe('getShadowModelVersions', () => {
  it('is_shadow=true 버전만 id 오름차순으로, train_until 포함해 돌려준다', async () => {
    const sb = fakeClient([
      { id: 9, label: 'v9-pl3', model_type: 'pl-top3', weights: {}, artifact: { features: [] }, is_shadow: true, train_until: 20260630 },
      { id: 7, label: 'v7-shape', model_type: 'logistic', weights: {}, artifact: { features: [] }, is_shadow: false, train_until: null },
      { id: 8, label: 'v8-l2', model_type: 'logistic', weights: {}, artifact: { features: [] }, is_shadow: true, train_until: 20260630 },
    ]);
    const vs = await getShadowModelVersions(sb);
    expect(vs.map((v) => v.id)).toEqual([8, 9]);
    expect(vs[1]!.model_type).toBe('pl-top3');
    expect(vs[0]!.train_until).toBe(20260630);
  });

  it('실험 버전이 없으면 빈 배열', async () => {
    expect(await getShadowModelVersions(fakeClient([]))).toEqual([]);
  });
});
```

- [ ] **Step 3: 실패 확인** — Run: `npx vitest run src/engine/modelVersion.test.ts` → FAIL (`getShadowModelVersions` is not exported)

- [ ] **Step 4: 구현** — `src/engine/modelVersion.ts` 끝에 추가

```ts
export interface ShadowModelVersion extends ActiveModelVersion {
  train_until: number | null;   // 학습 데이터 마지막 경주일 — 과거 채우기 하한
}

/** 실험(섀도) 버전 목록. 라이브 경로는 사용하지 않는다(spec 2026-09-18 §3.1). */
export async function getShadowModelVersions(sb: ReadClient): Promise<ShadowModelVersion[]> {
  const { data, error } = await sb
    .from('model_versions')
    .select('id, label, model_type, weights, artifact, train_until')
    .eq('is_shadow', true)
    .order('id');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((d) => ({
    id: d.id as number,
    label: d.label as string,
    model_type: (d.model_type as string) ?? 'logistic',
    weights: (d.weights as Record<string, number>) ?? {},
    artifact: (d.artifact as CalibratedArtifact | null) ?? null,
    train_until: (d.train_until as number | null) ?? null,
  }));
}
```

- [ ] **Step 5: 통과 확인** — `npx vitest run src/engine/modelVersion.test.ts` → PASS, `npm run build` → 0 errors
- [ ] **Step 6: 커밋** — `git add supabase/migrations/018_shadow_predictions.sql src/engine/modelVersion.ts src/engine/modelVersion.test.ts` → `feat(shadow): 018 마이그레이션 + 실험 버전 조회 getShadowModelVersions`
- [ ] **Step 7: 적용 요청(사용자)** — 마이그레이션 Supabase 적용은 **사용자 확인 후**(SQL Editor 붙여넣기 또는 사용자가 허락하면 `DATABASE_URL`로 psql 실행). 적용 전까지 T3·T4 코드는 `is_shadow` 컬럼 부재로 에러 → 격리 로직이 경고만 남기므로 라이브 무해.

---

### Task 2: 채점 로직 분리 `scoreRaceRows` (라이브 불변)

**Files:**
- Modify: `src/engine/logisticScorer.ts` (타입만), `src/engine/scorePredictor.ts:317-362`
- Test: `src/engine/scorePredictor.test.ts` (기존 파일에 describe 추가)

**Interfaces:**
- Consumes: `ActiveModelVersion` (T1 파일의 기존 타입)
- Produces:
  - `export const LINEAR_MODEL_TYPES: ReadonlySet<string>` = `{'logistic','pl-top3'}`
  - `export function scoreRaceRows(rows: RaceInputRow[], version: ActiveModelVersion, rcDate: number, meet: number, rcNo: number): PredictionRow[]`
  - `logisticScorer.ts`: `export type LinearModel = Pick<LogisticModel, 'features'|'means'|'stds'|'coef'|'intercept'>`; `itemContributions(model: LinearModel, …)`, `scoreLogistic(model: LinearModel, …)`

- [ ] **Step 1: 실패 테스트 작성** — `src/engine/scorePredictor.test.ts`에 추가 (기존 import 유지, 필요한 것만 추가)

```ts
import { scoreRaceRows, LINEAR_MODEL_TYPES, type RaceInputRow } from './scorePredictor.js';
import type { ActiveModelVersion } from './modelVersion.js';

describe('scoreRaceRows', () => {
  // buildFeatures가 만드는 실제 피처명 중 하나를 쓰지 않아도 됨: 입력에 없는 피처는 raw=0으로 채점(패리티 규칙)
  const linear = (coef: number) => ({
    type: 'logistic' as const, features: ['f'], means: [0], stds: [1], coef: { f: coef }, intercept: 0.5,
  });
  const rows: RaceInputRow[] = [
    { hr_name: 'A', pthr_no: 1, ord: null, input: {} as never },
    { hr_name: 'B', pthr_no: 2, ord: 3, input: {} as never },
  ];

  it('선형 모델이면 intercept 기반 총점·순위·버전 도장을 만든다', () => {
    const v: ActiveModelVersion = { id: 42, label: 't', model_type: 'logistic', weights: {}, artifact: linear(1) };
    const out = scoreRaceRows(rows, v, 20260912, 1, 3);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ race_date: 20260912, meet: 1, rc_no: 3, hr_name: 'A', model_version: 42, actual_ord: null });
    expect(out[1]!.actual_ord).toBe(3);
    expect(new Set(out.map((r) => r.predicted_rank))).toEqual(new Set([1, 2]));
    expect(out[0]!.p_top3).toBeNull(); // calibration 없음
  });

  it('pl-top3도 선형 채점 경로를 탄다', () => {
    expect(LINEAR_MODEL_TYPES.has('pl-top3')).toBe(true);
    const v: ActiveModelVersion = { id: 9, label: 'p', model_type: 'pl-top3', weights: {}, artifact: { ...linear(1), intercept: 0 } };
    const out = scoreRaceRows(rows, v, 20260912, 1, 3);
    expect(out.every((r) => typeof r.total_score === 'number')).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/engine/scorePredictor.test.ts` → FAIL (`scoreRaceRows` not exported)
- [ ] **Step 3: `logisticScorer.ts` 타입 일반화** — import 아래에 추가하고 두 함수 파라미터 타입만 교체(본문 불변)

```ts
/** 계수·표준화 구조를 가진 선형 모델(로지스틱·Plackett-Luce 공통). */
export type LinearModel = Pick<LogisticModel, 'features' | 'means' | 'stds' | 'coef' | 'intercept'>;
```
`itemContributions(model: LinearModel, …)`, `scoreLogistic(model: LinearModel, input: ScoreEngineInput)`.

- [ ] **Step 4: `scorePredictor.ts` 리팩터** — `predictRace` 본문을 아래로 교체하고 `scoreRaceRows` 신설

```ts
/** 선형 채점 경로(logisticScorer)를 타는 모델 유형. */
export const LINEAR_MODEL_TYPES: ReadonlySet<string> = new Set(['logistic', 'pl-top3']);

/**
 * 수집된 입력 행을 주어진 버전으로 채점·순위화. 라이브(predictRace)와 섀도(predictShadows) 공용.
 * DB 접근 없음(순수). rho-legacy=ScoreEngine / 선형=logisticScorer.
 */
export function scoreRaceRows(
  rows: RaceInputRow[], version: ActiveModelVersion, rcDate: number, meet: number, rcNo: number,
): PredictionRow[] {
  const scoreOne = LINEAR_MODEL_TYPES.has(version.model_type) && version.artifact
    ? (input: ScoreEngineInput) => scoreLogistic(version.artifact!, input)
    : (() => { const engine = new ScoreEngine(version.weights); return (input: ScoreEngineInput) => engine.calculateScores(input); })();

  const results = rows.map((row) => ({ row, score: scoreOne(row.input) }));

  // 보정 확률(선형 + calibration 있을 때만). 랭킹과 무관.
  const artifact = version.artifact;
  const probRows = artifact
    ? attachCalibratedProbs(
        artifact,
        results.map((r) => toVector(buildFeatures(r.row.input), artifact.features)),
      )
    : results.map(() => ({ p_win: null, p_top3: null }));

  const sorted = [...results].sort((a, b) => b.score.total - a.score.total);
  const rankMap = new Map<number, number>();
  sorted.forEach((r, idx) => rankMap.set(r.row.pthr_no, idx + 1));

  return results.map((r, i) => ({
    race_date: rcDate,
    meet,
    rc_no: rcNo,
    hr_name: r.row.hr_name,
    total_score: r.score.total,
    predicted_rank: rankMap.get(r.row.pthr_no)!,
    item_scores: r.score.items,
    actual_ord: r.row.ord,
    model_version: version.id,
    p_win: probRows[i]!.p_win,
    p_top3: probRows[i]!.p_top3,
  }));
}

export async function predictRace(
  sb: ReadClient,
  rcDate: number,
  meet: number,
  rcNo: number,
  opts?: { shapeParCutoff?: number; forcePrecompetition?: boolean }
): Promise<PredictionRow[]> {
  const rows = await gatherRaceInputs(sb, rcDate, meet, rcNo, opts);
  if (rows.length === 0) return [];
  const activeVersion = await getActiveModelVersion(sb);
  return scoreRaceRows(rows, activeVersion, rcDate, meet, rcNo);
}
```
주의: 기존 조건 `activeVersion.model_type === 'logistic'`은 `LINEAR_MODEL_TYPES.has(...)`로 바뀌지만, 라이브 v7은 `'logistic'`이라 동작 동일. `ActiveModelVersion` 타입 import 추가(`import { getActiveModelVersion, type ActiveModelVersion } from './modelVersion.js'`).

- [ ] **Step 5: 통과 + 라이브 불변 확인** — `npm run test:run` 전체 PASS(기존 `tests/engine/scorePredictor.test.ts`, `src/engine/scorePredictor.test.ts`, `tests/sync/v7LiveTracking.integration.test.ts` 포함), `npm run build` 0 errors.
  추가 확인(로컬 미러 필요, 읽기 전용): `npm run verify:logistic` 출력의 파리티 항목이 리팩터 전과 동일(리팩터 전 `git stash`로 한 번 돌려 비교). 미러가 없으면 이 단계는 건너뛰고 보고서에 명시.
- [ ] **Step 6: 커밋** — `refactor(engine): 채점 로직 scoreRaceRows 분리 + 선형 모델 유형 일반화 (라이브 출력 불변)`

---

### Task 3: 섀도 채점·쓰기 + 수요일 출마표 싱크 연결

**Files:**
- Create: `src/engine/shadowPredictor.ts`, `src/sync/shadowWriter.ts`
- Modify: `src/sync/raceCardSync.ts:131-139`
- Test: `src/engine/shadowPredictor.test.ts`, `tests/sync/shadowWriter.test.ts`, `tests/sync/raceCardSync.test.ts`(케이스 추가)

**Interfaces:**
- Consumes: `getShadowModelVersions` (T1), `scoreRaceRows`, `gatherRaceInputs`, `RaceInputRow` (T2)
- Produces:
  - `interface ShadowPredictionRow { race_date; meet; rc_no; hr_name: string; model_version: number; total_score: number; predicted_rank: number; p_top3: number | null; actual_ord: number | null }`
  - `predictShadows(sb: ReadClient, rcDate, meet, rcNo, opts?: { forcePrecompetition?: boolean; versionIds?: number[]; versions?: ShadowModelVersion[] }): Promise<ShadowPredictionRow[]>` — `versions` 주어지면 DB 조회 생략(T6 과거 채우기용)
  - `writeShadowPredictions(sb: WriteClient, rows: ShadowPredictionRow[], source: 'live'|'backfill'): Promise<void>` — (경주·버전) 단위 delete 후 insert
  - `updateShadowActualOrd(sb: WriteClient, rcDate, meet, rcNo, results: { hrName: string; ord: number | null }[]): Promise<void>`
  - `type WriteClient = { from(t: string): any }` (supabase-js 호환 최소형, `src/sync/shadowWriter.ts`에 export)

- [ ] **Step 1: `predictShadows` 실패 테스트** — `src/engine/shadowPredictor.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVersions = vi.fn();
const mockGather = vi.fn();
vi.mock('./modelVersion.js', () => ({ getShadowModelVersions: (...a: unknown[]) => mockVersions(...a) }));
vi.mock('./scorePredictor.js', async (orig) => {
  const real = await orig<typeof import('./scorePredictor.js')>();
  return { ...real, gatherRaceInputs: (...a: unknown[]) => mockGather(...a) };
});

const lin = (c: number) => ({ type: 'logistic', features: ['f'], means: [0], stds: [1], coef: { f: c }, intercept: c });
const rows = [
  { hr_name: 'A', pthr_no: 1, ord: null, input: {} },
  { hr_name: 'B', pthr_no: 2, ord: null, input: {} },
];

describe('predictShadows', () => {
  beforeEach(() => { mockVersions.mockReset(); mockGather.mockReset(); });

  it('실험 버전이 없으면 입력 수집 없이 빈 배열', async () => {
    mockVersions.mockResolvedValue([]);
    const { predictShadows } = await import('./shadowPredictor.js');
    expect(await predictShadows({} as never, 20260912, 1, 1)).toEqual([]);
    expect(mockGather).not.toHaveBeenCalled();
  });

  it('버전마다 말 수만큼 행을 만들고 versionIds로 거를 수 있다', async () => {
    mockVersions.mockResolvedValue([
      { id: 8, label: 'a', model_type: 'logistic', weights: {}, artifact: lin(1), train_until: 20260630 },
      { id: 9, label: 'b', model_type: 'pl-top3', weights: {}, artifact: lin(2), train_until: 20260630 },
    ]);
    mockGather.mockResolvedValue(rows);
    const { predictShadows } = await import('./shadowPredictor.js');
    const all = await predictShadows({} as never, 20260912, 1, 1);
    expect(all).toHaveLength(4);
    expect(new Set(all.map((r) => r.model_version))).toEqual(new Set([8, 9]));
    expect(Object.keys(all[0]!).sort()).toEqual(
      ['actual_ord', 'hr_name', 'meet', 'model_version', 'p_top3', 'predicted_rank', 'race_date', 'rc_no', 'total_score'].sort());
    const only9 = await predictShadows({} as never, 20260912, 1, 1, { versionIds: [9] });
    expect(only9.every((r) => r.model_version === 9)).toBe(true);
  });

  it('forcePrecompetition 옵션을 입력 수집에 넘긴다', async () => {
    mockVersions.mockResolvedValue([{ id: 8, label: 'a', model_type: 'logistic', weights: {}, artifact: lin(1), train_until: null }]);
    mockGather.mockResolvedValue(rows);
    const { predictShadows } = await import('./shadowPredictor.js');
    await predictShadows({} as never, 20260912, 1, 1, { forcePrecompetition: true });
    expect(mockGather.mock.calls[0]![4]).toEqual({ forcePrecompetition: true });
  });

  it('versions 주입 시 DB에서 버전을 읽지 않는다', async () => {
    mockGather.mockResolvedValue(rows);
    const { predictShadows } = await import('./shadowPredictor.js');
    const out = await predictShadows({} as never, 20260912, 1, 1, {
      versions: [{ id: 5, label: 'x', model_type: 'logistic', weights: {}, artifact: lin(1) as never, train_until: 20260630 }],
    });
    expect(mockVersions).not.toHaveBeenCalled();
    expect(out.every((r) => r.model_version === 5)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/engine/shadowPredictor.test.ts` → FAIL (module not found)
- [ ] **Step 3: 구현** — `src/engine/shadowPredictor.ts`

```ts
/**
 * 섀도(실험) 버전 채점. 라이브 predictRace와 분리된 호출 — 여기서 난 예외는 호출부가 격리한다.
 * spec: docs/superpowers/specs/2026-09-18-shadow-lab-design.md §4.1
 */
import type { ReadClient } from '../db/localDb.js';
import { getShadowModelVersions, type ShadowModelVersion } from './modelVersion.js';
import { gatherRaceInputs, scoreRaceRows } from './scorePredictor.js';

export interface ShadowPredictionRow {
  race_date: number; meet: number; rc_no: number; hr_name: string;
  model_version: number; total_score: number; predicted_rank: number;
  p_top3: number | null; actual_ord: number | null;
}

export async function predictShadows(
  sb: ReadClient, rcDate: number, meet: number, rcNo: number,
  opts?: { forcePrecompetition?: boolean; versionIds?: number[]; versions?: ShadowModelVersion[] },
): Promise<ShadowPredictionRow[]> {
  let versions = opts?.versions ?? await getShadowModelVersions(sb);
  if (opts?.versionIds) versions = versions.filter((v) => opts.versionIds!.includes(v.id as number));
  if (versions.length === 0) return [];

  const gatherOpts = opts?.forcePrecompetition ? { forcePrecompetition: true } : undefined;
  const rows = await gatherRaceInputs(sb, rcDate, meet, rcNo, gatherOpts);
  if (rows.length === 0) return [];

  return versions.flatMap((v) =>
    scoreRaceRows(rows, v, rcDate, meet, rcNo).map((p) => ({
      race_date: p.race_date, meet: p.meet, rc_no: p.rc_no, hr_name: p.hr_name,
      model_version: v.id as number, total_score: p.total_score, predicted_rank: p.predicted_rank,
      p_top3: p.p_top3, actual_ord: p.actual_ord,
    })),
  );
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/engine/shadowPredictor.test.ts` → PASS
- [ ] **Step 5: `shadowWriter` 실패 테스트** — `tests/sync/shadowWriter.test.ts`. 페이크는 `tests/sync/raceCardSync.test.ts`의 `FakeQuery`/`FakeSupabase` 클래스(16~91행)를 **그대로 복사**해 파일 상단에 둔다(`update`/`insert`/`delete`/`eq` 지원 필요).

```ts
// (FakeQuery / FakeSupabase 복사 — raceCardSync.test.ts 16~91행)
import { describe, it, expect } from 'vitest';
import { writeShadowPredictions, updateShadowActualOrd } from '../../src/sync/shadowWriter.js';

const row = (hr: string, v: number, rank: number) => ({
  race_date: 20260912, meet: 1, rc_no: 3, hr_name: hr, model_version: v,
  total_score: 1 / rank, predicted_rank: rank, p_top3: null, actual_ord: null,
});

describe('writeShadowPredictions', () => {
  it('같은 경주·버전의 기존 행을 지우고 source를 붙여 넣는다 (다른 버전은 보존)', async () => {
    const sb = new FakeSupabase();
    sb.tables['shadow_predictions'] = { rows: [
      { ...row('A', 8, 2), source: 'live' },
      { ...row('A', 9, 1), source: 'live' },
    ] };
    await writeShadowPredictions(sb as never, [row('A', 8, 1), row('B', 8, 2)], 'live');
    const rows = sb.tables['shadow_predictions']!.rows;
    expect(rows.filter((r) => r.model_version === 8)).toHaveLength(2);
    expect(rows.find((r) => r.model_version === 8 && r.hr_name === 'A')!.predicted_rank).toBe(1);
    expect(rows.filter((r) => r.model_version === 9)).toHaveLength(1);
    expect(rows.every((r) => r.source === 'live')).toBe(true);
  });

  it('빈 배열이면 아무것도 하지 않는다', async () => {
    const sb = new FakeSupabase();
    await writeShadowPredictions(sb as never, [], 'live');
    expect(sb.tables['shadow_predictions']).toBeUndefined();
  });
});

describe('updateShadowActualOrd', () => {
  it('모든 버전의 해당 말 actual_ord를 채우고 ord=null은 건너뛴다', async () => {
    const sb = new FakeSupabase();
    sb.tables['shadow_predictions'] = { rows: [row('A', 8, 1), row('A', 9, 2), row('B', 8, 2)] };
    await updateShadowActualOrd(sb as never, 20260912, 1, 3, [{ hrName: 'A', ord: 2 }, { hrName: 'B', ord: null }]);
    const rows = sb.tables['shadow_predictions']!.rows;
    expect(rows.filter((r) => r.hr_name === 'A').every((r) => r.actual_ord === 2)).toBe(true);
    expect(rows.find((r) => r.hr_name === 'B')!.actual_ord).toBeNull();
  });
});
```

- [ ] **Step 6: 실패 확인** — `npx vitest run tests/sync/shadowWriter.test.ts` → FAIL
- [ ] **Step 7: 구현** — `src/sync/shadowWriter.ts`

```ts
/**
 * shadow_predictions 쓰기 (spec 2026-09-18 §4.2~4.3). 라이브 predictions는 건드리지 않는다.
 * 호출부는 반드시 try/catch로 격리 — 여기 예외가 라이브 싱크를 멈추면 안 된다.
 */
import type { ShadowPredictionRow } from '../engine/shadowPredictor.js';

// supabase-js 최소 호환형 (테스트 페이크 주입용)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WriteClient = { from(table: string): any };

export async function writeShadowPredictions(
  sb: WriteClient, rows: ShadowPredictionRow[], source: 'live' | 'backfill',
): Promise<void> {
  if (rows.length === 0) return;
  const groups = new Map<string, ShadowPredictionRow[]>();
  for (const r of rows) {
    const k = `${r.race_date}|${r.meet}|${r.rc_no}|${r.model_version}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  for (const g of groups.values()) {
    const { race_date, meet, rc_no, model_version } = g[0]!;
    const { error: delErr } = await sb.from('shadow_predictions').delete()
      .eq('race_date', race_date).eq('meet', meet).eq('rc_no', rc_no).eq('model_version', model_version);
    if (delErr) throw delErr;
    const { error: insErr } = await sb.from('shadow_predictions').insert(g.map((r) => ({ ...r, source })));
    if (insErr) throw insErr;
  }
}

export async function updateShadowActualOrd(
  sb: WriteClient, rcDate: number, meet: number, rcNo: number,
  results: { hrName: string; ord: number | null }[],
): Promise<void> {
  for (const { hrName, ord } of results) {
    if (ord == null) continue;
    const { error } = await sb.from('shadow_predictions').update({ actual_ord: ord })
      .eq('race_date', rcDate).eq('meet', meet).eq('rc_no', rcNo).eq('hr_name', hrName);
    if (error) throw error;
  }
}
```

- [ ] **Step 8: 통과 확인** — `npx vitest run tests/sync/shadowWriter.test.ts` → PASS
- [ ] **Step 9: raceCardSync 격리 테스트 추가** — `tests/sync/raceCardSync.test.ts`: 기존 `vi.mock` 블록 옆에 섀도 mock 추가, `beforeEach`에서 초기화, 케이스 2개 추가

```ts
let mockPredictShadows: ReturnType<typeof vi.fn>;
vi.mock('../../src/engine/shadowPredictor.js', () => ({
  predictShadows: (...args: unknown[]) => mockPredictShadows(...args),
}));
// beforeEach 안에 추가:  mockPredictShadows = vi.fn().mockResolvedValue([]);

it('섀도 채점이 예외를 던져도 라이브 예측은 저장되고 동기화는 성공한다', async () => {
  mockPredictRace.mockResolvedValue([{
    race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말', total_score: 0.5,
    predicted_rank: 1, item_scores: {}, actual_ord: null, model_version: 7, p_top3: 0.6, p_win: 0.2,
  }]);
  mockPredictShadows.mockRejectedValue(new Error('column is_shadow does not exist'));
  const { syncRaceCards } = await import('../../src/sync/raceCardSync.js');
  const res = [await syncRaceCards({ rcDate: RC_DATE, meets: [MEET as 1] })].flat();
  expect(fakeSb.tables['predictions']!.rows).toHaveLength(1);
  expect(res.reduce((s, r) => s + r.racesSynced, 0)).toBe(1);
  expect(res.flatMap((r) => r.errors)).toHaveLength(0);
});

it('섀도 행은 shadow_predictions에 source=live로 저장된다', async () => {
  mockPredictRace.mockResolvedValue([{
    race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말', total_score: 0.5,
    predicted_rank: 1, item_scores: {}, actual_ord: null, model_version: 7, p_top3: 0.6, p_win: 0.2,
  }]);
  mockPredictShadows.mockResolvedValue([{
    race_date: RC_DATE, meet: MEET, rc_no: RC_NO, hr_name: '테스트말', model_version: 9,
    total_score: 0.1, predicted_rank: 1, p_top3: null, actual_ord: null,
  }]);
  const { syncRaceCards } = await import('../../src/sync/raceCardSync.js');
  await syncRaceCards({ rcDate: RC_DATE, meets: [MEET as 1] });
  const sh = fakeSb.tables['shadow_predictions']!.rows;
  expect(sh).toHaveLength(1);
  expect(sh[0]).toMatchObject({ model_version: 9, source: 'live' });
});
```
(`syncRaceCards`는 날짜별 `RaceCardSyncResult`(필드 `racesSynced`·`errors`)를 돌려준다 — 단일/배열 어느 쪽이든 `[…].flat()`로 흡수.)

- [ ] **Step 10: 실패 확인** — `npx vitest run tests/sync/raceCardSync.test.ts` → 새 케이스 2번째 FAIL
- [ ] **Step 11: raceCardSync 연결** — `src/sync/raceCardSync.ts`: import 2줄 추가, 라이브 INSERT 성공 직후(`if (predErr) throw predErr;` 다음 줄, 같은 `if (preds.length > 0)` 블록 안)에 삽입

```ts
import { predictShadows } from '../engine/shadowPredictor.js';
import { writeShadowPredictions } from './shadowWriter.js';
```
```ts
            // 섀도(실험) 버전 예측 — 라이브와 완전 격리 (spec 2026-09-18 §4.2).
            // 실패해도 경고만: 라이브 결과·--fail-on-empty 판정 불변.
            try {
              const shadows = await predictShadows(sb as unknown as ReadClient, rcDate, meet, rcNo);
              await writeShadowPredictions(sb, shadows, 'live');
            } catch (e) {
              console.warn(`    rc_no=${rcNo} ⚠️ 섀도 예측 실패 (라이브 무영향): ${(e as Error).message}`);
            }
```
- [ ] **Step 12: 통과 확인** — `npm run test:run` 전체 PASS, `npm run build` 0 errors
- [ ] **Step 13: 커밋** — `feat(shadow): 섀도 채점·저장 + 수요일 출마표 싱크 연결 (실패 격리)`

---

### Task 4: 결과 싱크에서 섀도 착순 기록

**Files:**
- Modify: `src/sync/dailySync.ts:323-344` (actual_ord UPDATE 루프 직후)
- Test: `tests/sync/dailySync.test.ts` (케이스 추가)

**Interfaces:**
- Consumes: `updateShadowActualOrd` (T3), dailySync 내부 변수 `resultOrds: { hrName: string; ord: number | null }[]`

- [ ] **Step 1: 실패 테스트** — `tests/sync/dailySync.test.ts`를 먼저 읽고 기존 "actual_ord만 UPDATE" 케이스의 준비 코드(페이크 테이블·KRA mock)를 그대로 재사용해 케이스 2개 추가:
  1. `shadow_predictions`에 같은 경주·말(버전 8·9) 행을 넣어 두고 dailySync 실행 → 두 행 모두 `actual_ord`가 결과값으로 채워짐.
  2. `vi.mock('../../src/sync/shadowWriter.js', …)`로 `updateShadowActualOrd`가 throw하게 한 뒤 실행 → `predictions.actual_ord`는 정상 기록, 동기화 결과에 에러 없음.
  (2번은 mock이 파일 전역이므로 별도 `describe` + `vi.doMock` 후 동적 import로 작성.)
- [ ] **Step 2: 실패 확인** — `npx vitest run tests/sync/dailySync.test.ts` → 1번 FAIL
- [ ] **Step 3: 구현** — import 추가 `import { updateShadowActualOrd } from './shadowWriter.js';`, `for (const { hrName, ord } of resultOrds) { … }` 루프 **바로 다음**에:

```ts
          // 6-b. 섀도(실험) 예측 착순 기록 — 격리 (spec 2026-09-18 §4.3)
          try {
            await updateShadowActualOrd(supabase, rcDate, meet, rcNo, resultOrds);
          } catch (e) {
            console.warn(`    [meet=${meet}, rcNo=${rcNo}] 섀도 actual_ord 실패 (라이브 무영향): ${(e as Error).message}`);
          }
```
- [ ] **Step 4: 통과 확인** — `npm run test:run` PASS, `npm run build` 0 errors
- [ ] **Step 5: 커밋** — `feat(shadow): 결과 싱크에서 섀도 예측 착순 기록 (격리)`

---

### Task 5: 누수 점검 (과거 채우기 개방 조건)

**Files:**
- Create: `src/engine/shadow/leakCheck.ts`, `src/engine/shadow/leakCheck.test.ts`, `scripts/shadow_leak_check.ts`
- Modify: `package.json` (`"shadow:leak-check": "tsx scripts/shadow_leak_check.ts"`)

**Interfaces:**
- Consumes: `gatherRaceInputs`, `scoreRaceRows` (T2), `getActiveModelVersion`, `getReadClient`
- Produces:
  - `interface ScoreRow { hr_name: string; total_score: number; predicted_rank: number }`
  - `compareRace(saved: ScoreRow[], recomputed: ScoreRow[], tol = 1e-6): { status: 'match'|'field-changed'|'mismatch'; maxAbsDiff: number }`
  - `summarize(results: {status}[]): { match: number; fieldChanged: number; mismatch: number; pass: boolean }` — `pass = mismatch === 0 && match > 0`
  - 통과 시 `data/shadow_leak_check.json`에 `{ checkedAt, activeVersion, match, fieldChanged, mismatch, pass }` 기록 (T6이 읽음)

- [ ] **Step 1: 실패 테스트** — `src/engine/shadow/leakCheck.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { compareRace, summarize } from './leakCheck.js';

const r = (hr: string, s: number, k: number) => ({ hr_name: hr, total_score: s, predicted_rank: k });

describe('compareRace', () => {
  it('점수·순위 동일 → match', () => {
    expect(compareRace([r('A', 1, 1), r('B', 0.5, 2)], [r('B', 0.5, 2), r('A', 1, 1)]).status).toBe('match');
  });
  it('출전마 집합이 다르면 field-changed (출전 취소 등 정상 차이)', () => {
    expect(compareRace([r('A', 1, 1), r('B', 0.5, 2)], [r('A', 1, 1)]).status).toBe('field-changed');
  });
  it('허용오차 초과 점수 차 → mismatch, 최대차 보고', () => {
    const res = compareRace([r('A', 1, 1), r('B', 0.5, 2)], [r('A', 1.01, 1), r('B', 0.5, 2)]);
    expect(res.status).toBe('mismatch');
    expect(res.maxAbsDiff).toBeCloseTo(0.01);
  });
  it('점수는 거의 같아도 순위가 다르면 mismatch', () => {
    expect(compareRace([r('A', 1, 1), r('B', 1, 2)], [r('A', 1, 2), r('B', 1, 1)]).status).toBe('mismatch');
  });
});

describe('summarize', () => {
  it('mismatch 0 이고 match ≥ 1 이면 pass', () => {
    expect(summarize([{ status: 'match' }, { status: 'field-changed' }]).pass).toBe(true);
    expect(summarize([{ status: 'match' }, { status: 'mismatch' }]).pass).toBe(false);
    expect(summarize([{ status: 'field-changed' }]).pass).toBe(false);
  });
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/engine/shadow/leakCheck.test.ts` → FAIL
- [ ] **Step 3: 구현** — `src/engine/shadow/leakCheck.ts`

```ts
/** 누수 점검: 수요일 보존 예측 vs 과거채우기 재계산 비교 (spec 2026-09-18 §5). */
export interface ScoreRow { hr_name: string; total_score: number; predicted_rank: number }
export type RaceCheckStatus = 'match' | 'field-changed' | 'mismatch';

export function compareRace(saved: ScoreRow[], recomputed: ScoreRow[], tol = 1e-6): { status: RaceCheckStatus; maxAbsDiff: number } {
  const a = new Map(saved.map((x) => [x.hr_name, x]));
  const b = new Map(recomputed.map((x) => [x.hr_name, x]));
  if (a.size !== b.size || [...a.keys()].some((k) => !b.has(k))) return { status: 'field-changed', maxAbsDiff: NaN };
  let maxAbsDiff = 0, rankDiff = false;
  for (const [k, x] of a) {
    const y = b.get(k)!;
    maxAbsDiff = Math.max(maxAbsDiff, Math.abs(Number(x.total_score) - Number(y.total_score)));
    if (x.predicted_rank !== y.predicted_rank) rankDiff = true;
  }
  return { status: maxAbsDiff > tol || rankDiff ? 'mismatch' : 'match', maxAbsDiff };
}

export function summarize(results: { status: RaceCheckStatus }[]) {
  const match = results.filter((r) => r.status === 'match').length;
  const fieldChanged = results.filter((r) => r.status === 'field-changed').length;
  const mismatch = results.filter((r) => r.status === 'mismatch').length;
  return { match, fieldChanged, mismatch, pass: mismatch === 0 && match > 0 };
}
```
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: CLI** — `scripts/shadow_leak_check.ts`

```ts
/**
 * 누수 점검 — 활성 모델의 보존된 수요일 사전 예측(predictions, L-001 이후)을
 * 과거 채우기 경로(미러 + forcePrecompetition)로 재계산해 일치 여부 판정.
 * ⚠️ 선행: npm run db:pull (미러 최신화). 읽기 전용, DB 쓰기 없음.
 * 사용: npm run shadow:leak-check -- [--from 20260711] [--to 20260917] [--sample 60]
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { getReadClient } from '../src/db/localDb.js';
import { getActiveModelVersion } from '../src/engine/modelVersion.js';
import { gatherRaceInputs, scoreRaceRows } from '../src/engine/scorePredictor.js';
import { compareRace, summarize, type ScoreRow } from '../src/engine/shadow/leakCheck.js';

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const from = Number(arg('--from', '20260711'));
  const to = Number(arg('--to', '20991231'));
  const sample = Number(arg('--sample', '60'));

  const db = await getReadClient();
  const active = await getActiveModelVersion(db);
  console.log(`🔎 누수 점검 — 활성 ${active.label}(id=${active.id}), ${from}~${to}, 표본 최대 ${sample}경주`);

  const { data, error } = await db.from('predictions')
    .select('race_date, meet, rc_no, hr_name, total_score, predicted_rank, model_version')
    .eq('model_version', active.id).gte('race_date', from).lte('race_date', to);
  if (error) throw error;
  const byRace = new Map<string, ScoreRow[]>();
  for (const p of (data ?? []) as (ScoreRow & { race_date: number; meet: number; rc_no: number })[]) {
    const k = `${p.race_date}-${p.meet}-${p.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(p);
  }
  // 균등 간격 표본 (재현 가능)
  const keys = [...byRace.keys()].sort();
  const step = Math.max(1, Math.floor(keys.length / sample));
  const picked = keys.filter((_, i) => i % step === 0).slice(0, sample);

  const results: { key: string; status: 'match' | 'field-changed' | 'mismatch'; maxAbsDiff: number }[] = [];
  for (const k of picked) {
    const [d, m, n] = k.split('-').map(Number) as [number, number, number];
    const rows = await gatherRaceInputs(db, d, m, n, { forcePrecompetition: true });
    const re = scoreRaceRows(rows, active, d, m, n);
    results.push({ key: k, ...compareRace(byRace.get(k)!, re) });
  }
  const s = summarize(results);
  for (const r of results.filter((x) => x.status === 'mismatch')) console.log(`  ❌ ${r.key} 최대 점수차 ${r.maxAbsDiff.toExponential(2)}`);
  console.log(`\n일치 ${s.match} · 출전마 변동(제외) ${s.fieldChanged} · 불일치 ${s.mismatch} → ${s.pass ? '✅ 합격' : '❌ 불합격'}`);
  writeFileSync('data/shadow_leak_check.json', JSON.stringify({ checkedAt: new Date().toISOString(), activeVersion: active.id, ...s }, null, 2));
  if (!s.pass) process.exit(1);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```
`package.json` scripts에 `"shadow:leak-check": "tsx scripts/shadow_leak_check.ts",` 추가.
- [ ] **Step 6: 빌드·테스트** — `npm run build`, `npm run test:run` PASS
- [ ] **Step 7: 커밋** — `feat(shadow): 누수 점검 스크립트 shadow:leak-check`
- [ ] **Step 8: 실행(Claude, 로컬 읽기 전용)** — 미러가 최신인지 사용자에게 확인(`db:pull`은 Supabase 읽기 → 사용자 실행 권장). 그 후 `npm run shadow:leak-check` 실행, 요약 3줄만 보고.
  **불합격 시:** 불일치 경주 1~2개를 골라 `buildFeatures` 결과를 피처 단위로 비교(수요일 저장본엔 피처가 없으므로 재계산 점수 기여도 `item_scores` 항목별 차이로 원인 항목 특정) → 원인 보고 후 **사용자와 대응 결정**(과거 채우기 보류/원인 수정). 이 단계에서 임의 수정 금지.

---

### Task 6: 과거 채우기 `shadow:backfill`

**Files:**
- Create: `src/engine/shadow/backfillRange.ts`, `src/engine/shadow/backfillRange.test.ts`, `scripts/shadow_backfill.ts`
- Modify: `package.json` (`"shadow:backfill": "tsx scripts/shadow_backfill.ts"`)

**Interfaces:**
- Consumes: `predictShadows` (T3), `writeShadowPredictions` (T3), `getShadowModelVersions` (T1), `data/shadow_leak_check.json` (T5)
- Produces: `resolveBackfillRange(trainUntil: number | null, from?: number, to?: number, today: number): { from: number; to: number }` — 위반 시 `Error` throw; `nextDay(yyyymmdd: number): number`

- [ ] **Step 1: 실패 테스트** — `src/engine/shadow/backfillRange.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { resolveBackfillRange, nextDay } from './backfillRange.js';

describe('nextDay', () => {
  it('월말·연말을 넘긴다', () => {
    expect(nextDay(20260630)).toBe(20260701);
    expect(nextDay(20261231)).toBe(20270101);
    expect(nextDay(20240228)).toBe(20240229);
  });
});

describe('resolveBackfillRange', () => {
  it('from 생략 시 train_until 다음 날부터, to 생략 시 오늘까지', () => {
    expect(resolveBackfillRange(20260630, undefined, undefined, 20260918)).toEqual({ from: 20260701, to: 20260918 });
  });
  it('from ≤ train_until 이면 거부 (학습에 쓴 경주)', () => {
    expect(() => resolveBackfillRange(20260630, 20260630, undefined, 20260918)).toThrow(/train_until/);
  });
  it('train_until 미기록 버전은 거부', () => {
    expect(() => resolveBackfillRange(null, 20260701, undefined, 20260918)).toThrow(/train_until/);
  });
  it('from > to 거부', () => {
    expect(() => resolveBackfillRange(20260630, 20260801, 20260720, 20260918)).toThrow();
  });
});
```
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `src/engine/shadow/backfillRange.ts`

```ts
/** 과거 채우기 범위 — 학습에 쓴 경주(≤ train_until)는 절대 채우지 않는다 (spec §4.4). */
export function nextDay(d: number): number {
  const y = Math.floor(d / 10000), m = Math.floor((d % 10000) / 100) - 1, day = d % 100;
  const t = new Date(Date.UTC(y, m, day + 1));
  return t.getUTCFullYear() * 10000 + (t.getUTCMonth() + 1) * 100 + t.getUTCDate();
}

export function resolveBackfillRange(
  trainUntil: number | null, from: number | undefined, to: number | undefined, today: number,
): { from: number; to: number } {
  if (trainUntil == null) throw new Error('train_until 미기록 버전 — 학습 기간을 알 수 없어 과거 채우기 불가');
  const f = from ?? nextDay(trainUntil);
  const t = to ?? today;
  if (f <= trainUntil) throw new Error(`from(${f}) ≤ train_until(${trainUntil}) — 학습에 쓴 경주는 채울 수 없음`);
  if (f > t) throw new Error(`from(${f}) > to(${t})`);
  return { from: f, to: t };
}
```
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: CLI** — `scripts/shadow_backfill.ts`

```ts
/**
 * 섀도 버전 과거 채우기 (spec 2026-09-18 §4.4).
 * 읽기 = 로컬 미러(DuckDB), 쓰기 = Supabase. 누수 점검 합격 기록이 없으면 거부.
 * 사용: npm run shadow:backfill -- --version 9 [--from 20260701] [--to 20260917] [--dry-run] [--force-unverified]
 */
import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { getReadClient } from '../src/db/localDb.js';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { getShadowModelVersions } from '../src/engine/modelVersion.js';
import { predictShadows } from '../src/engine/shadowPredictor.js';
import { writeShadowPredictions } from '../src/sync/shadowWriter.js';
import { resolveBackfillRange } from '../src/engine/shadow/backfillRange.js';

function todayKst(): number {
  const s = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
  return Number(s);
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const versionId = Number(arg('--version'));
  const dryRun = args.includes('--dry-run');
  if (!versionId) throw new Error('--version <id> 필수');

  if (!args.includes('--force-unverified')) {
    const f = 'data/shadow_leak_check.json';
    const ok = existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).pass === true;
    if (!ok) throw new Error('누수 점검 합격 기록 없음 — 먼저 npm run shadow:leak-check (spec §5)');
  }

  const sbw = getSupabaseAdmin();
  // 버전 정보는 Supabase에서 (미러엔 is_shadow/train_until 컬럼이 아직 없을 수 있음)
  const version = (await getShadowModelVersions(sbw as never)).find((v) => v.id === versionId);
  if (!version) throw new Error(`id=${versionId}는 섀도 버전이 아님 (is_shadow=false 또는 없음)`);
  const fromArg = arg('--from'), toArg = arg('--to');
  const range = resolveBackfillRange(version.train_until, fromArg ? Number(fromArg) : undefined, toArg ? Number(toArg) : undefined, todayKst());
  console.log(`🧪 과거 채우기 ${version.label}(id=${versionId}) ${range.from}~${range.to}${dryRun ? ' [dry-run]' : ''}`);

  // 이미 사전 저장본(live)이 있는 경주는 건너뜀
  const { data: liveRows, error: liveErr } = await sbw.from('shadow_predictions')
    .select('race_date, meet, rc_no').eq('model_version', versionId).eq('source', 'live')
    .gte('race_date', range.from).lte('race_date', range.to);
  if (liveErr) throw liveErr;
  const liveKeys = new Set(((liveRows ?? []) as { race_date: number; meet: number; rc_no: number }[]).map((r) => `${r.race_date}-${r.meet}-${r.rc_no}`));

  const db = await getReadClient();
  const { data: races, error } = await db.from('races').select('race_date, meet, rc_no')
    .gte('race_date', range.from).lte('race_date', range.to).order('race_date').order('meet').order('rc_no');
  if (error) throw error;

  let written = 0, skipped = 0, noResult = 0;
  for (const r of (races ?? []) as { race_date: number; meet: number; rc_no: number }[]) {
    const key = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (liveKeys.has(key)) { skipped++; continue; }
    const { data: ords } = await db.from('race_entries').select('hr_name, ord')
      .eq('race_date', r.race_date).eq('meet', r.meet).eq('rc_no', r.rc_no);
    const ordMap = new Map(((ords ?? []) as { hr_name: string; ord: number | null }[]).map((o) => [o.hr_name, o.ord]));
    if (![...ordMap.values()].some((o) => o != null)) { noResult++; continue; }
    const rows = (await predictShadows(db, r.race_date, r.meet, r.rc_no, { forcePrecompetition: true, versionIds: [versionId], versions: [version] }))
      .map((p) => ({ ...p, actual_ord: ordMap.get(p.hr_name) ?? null }));
    if (!dryRun) await writeShadowPredictions(sbw, rows, 'backfill');
    written++;
    if (written % 50 === 0) console.log(`  ${written}경주…`);
  }
  console.log(`✅ 채움 ${written}경주 · 사전저장본 있어 건너뜀 ${skipped} · 결과 없음 ${noResult}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```
버전 객체는 Supabase에서 읽어 `versions`로 주입한다(T3에서 만든 옵션 — 미러엔 `is_shadow`/`train_until` 컬럼이 아직 없을 수 있어서).
`package.json`에 `"shadow:backfill": "tsx scripts/shadow_backfill.ts",` 추가.
- [ ] **Step 6: 빌드·테스트** — `npm run build`, `npm run test:run` PASS
- [ ] **Step 7: 커밋** — `feat(shadow): 과거 채우기 shadow:backfill (train_until 하한·누수점검 게이트)`

---

### Task 7: `/lab` 지표 순수함수

**Files:**
- Create: `client/src/lib/labMetrics.ts`, `client/src/lib/labMetrics.test.ts` (루트 vitest가 `client/src/lib/**/*.test.ts` 포함)

**Interfaces:**
- Produces:
  - `interface LabRow { race_date: number; meet: number; rc_no: number; hr_name: string; predicted_rank: number; actual_ord: number | null; model_version: number; source?: 'live' | 'backfill' | 'prod' }`
  - `raceKey(r): string`
  - `raceHits(rows: LabRow[]): { win: boolean; place: boolean; quinella: boolean; top3Overlap: number } | null` — 한 경주·한 버전. 결과 없음(모든 actual_ord null)이면 null
  - `pairedNoise(liveHits: boolean[], shadowHits: boolean[]): { delta: number; band: number }` — 대응 비교 95% 폭
  - `interface ScoreboardRow { version: number; races: number; win: number; place: number; quinella: number; top3Overlap: number; placeDelta: number | null; placeBand: number | null }`
  - `buildScoreboard(live: LabRow[], shadow: LabRow[], liveVersion: number): ScoreboardRow[]` — 첫 행 라이브(Δ null), 이후 섀도 버전 id순. 섀도 행은 **라이브와 공통 경주만** 집계, 라이브 행 races는 전체 결과 경주
  - `interface RaceComparison { key: string; race_date: number; meet: number; rc_no: number; actualTop3: string[]; picks: Record<number, string[]>; placeHit: Record<number, boolean>; disagree: boolean }`
  - `buildRaceComparisons(live: LabRow[], shadow: LabRow[]): RaceComparison[]` — 최신순, `disagree` = 버전 간 1순위 말이 하나라도 다름

- [ ] **Step 1: 실패 테스트** — `client/src/lib/labMetrics.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { raceHits, pairedNoise, buildScoreboard, buildRaceComparisons, type LabRow } from './labMetrics';

const mk = (v: number, date: number, rc: number, picks: [string, number, number | null][]): LabRow[] =>
  picks.map(([hr, rank, ord]) => ({ race_date: date, meet: 1, rc_no: rc, hr_name: hr, predicted_rank: rank, actual_ord: ord, model_version: v }));

describe('raceHits', () => {
  it('단승·연승·복승(순서무관)·TOP3 겹침', () => {
    const h = raceHits(mk(7, 1, 1, [['A', 1, 2], ['B', 2, 1], ['C', 3, 5], ['D', 4, 3]]))!;
    expect(h).toEqual({ win: false, place: true, quinella: true, top3Overlap: 2 });
  });
  it('결과 없는 경주는 null', () => {
    expect(raceHits(mk(7, 1, 1, [['A', 1, null], ['B', 2, null]]))).toBeNull();
  });
  it('1순위 말 결과 null(출전취소)은 적중 아님', () => {
    const h = raceHits(mk(7, 1, 1, [['A', 1, null], ['B', 2, 1], ['C', 3, 2]]))!;
    expect(h.place).toBe(false);
    expect(h.quinella).toBe(false);
  });
});

describe('pairedNoise', () => {
  it('엇갈림이 없으면 폭 0', () => {
    expect(pairedNoise([true, false], [true, false])).toEqual({ delta: 0, band: 0 });
  });
  it('섀도만 맞힌 경주가 많으면 +Δ, 폭은 양수', () => {
    const live = [false, false, true, true], sh = [true, true, true, true];
    const r = pairedNoise(live, sh);
    expect(r.delta).toBeCloseTo(0.5);
    expect(r.band).toBeGreaterThan(0);
  });
});

describe('buildScoreboard', () => {
  it('섀도는 공통 경주만 집계하고 라이브 대비 Δ를 낸다', () => {
    const live = [...mk(7, 1, 1, [['A', 1, 1], ['B', 2, 2]]), ...mk(7, 1, 2, [['C', 1, 9], ['D', 2, 1]])];
    const shadow = mk(9, 1, 2, [['D', 1, 1], ['C', 2, 9]]); // 2경주 중 1경주만 존재
    const sb = buildScoreboard(live, shadow, 7);
    expect(sb[0]).toMatchObject({ version: 7, races: 2, placeDelta: null });
    expect(sb[1]).toMatchObject({ version: 9, races: 1, place: 1 });
    expect(sb[1]!.placeDelta).toBeCloseTo(1); // 공통 경주(rc2)에서 라이브 0 → 섀도 1
  });
});

describe('buildRaceComparisons', () => {
  it('1순위가 다르면 disagree, 최신 경주가 먼저', () => {
    const live = [...mk(7, 1, 1, [['A', 1, 1]]), ...mk(7, 2, 1, [['B', 1, 1]])];
    const shadow = [...mk(9, 1, 1, [['A', 1, 1]]), ...mk(9, 2, 1, [['C', 1, 2]])];
    const rc = buildRaceComparisons(live, shadow);
    expect(rc[0]!.race_date).toBe(2);
    expect(rc[0]!.disagree).toBe(true);
    expect(rc[1]!.disagree).toBe(false);
    expect(rc[0]!.picks[9]).toEqual(['C']);
  });
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run client/src/lib/labMetrics.test.ts` → FAIL
- [ ] **Step 3: 구현** — `client/src/lib/labMetrics.ts`

```ts
/**
 * /lab 섀도 비교 지표 (spec 2026-09-18 §6.1). 이름이 아니라 규칙으로 정의:
 *  단승 = 1순위가 1착 / 연승 = 1순위가 3착 안 / 복승 = 1·2순위 두 마리 모두 2착 안(순서무관)
 *  TOP3 겹침 = 예측 상위3 중 실제 3착 안 마릿수. actual_ord null(취소 등) = 적중 아님.
 */
export interface LabRow {
  race_date: number; meet: number; rc_no: number; hr_name: string;
  predicted_rank: number; actual_ord: number | null; model_version: number;
  source?: 'live' | 'backfill' | 'prod';
}
export const raceKey = (r: { race_date: number; meet: number; rc_no: number }) => `${r.race_date}-${r.meet}-${r.rc_no}`;

const inTop = (o: number | null, k: number) => o != null && o >= 1 && o <= k;

export function raceHits(rows: LabRow[]) {
  if (!rows.some((r) => r.actual_ord != null)) return null;
  const by = [...rows].sort((a, b) => a.predicted_rank - b.predicted_rank);
  const p1 = by[0], p2 = by[1];
  return {
    win: !!p1 && p1.actual_ord === 1,
    place: !!p1 && inTop(p1.actual_ord, 3),
    quinella: !!p1 && !!p2 && inTop(p1.actual_ord, 2) && inTop(p2.actual_ord, 2),
    top3Overlap: by.slice(0, 3).filter((r) => inTop(r.actual_ord, 3)).length,
  };
}

/** 대응 비교(같은 경주) 95% 흔들림 폭. b=라이브만 적중, c=섀도만 적중. */
export function pairedNoise(liveHits: boolean[], shadowHits: boolean[]) {
  const n = liveHits.length;
  if (n === 0) return { delta: 0, band: 0 };
  let b = 0, c = 0;
  for (let i = 0; i < n; i++) { if (liveHits[i] && !shadowHits[i]) b++; if (!liveHits[i] && shadowHits[i]) c++; }
  const delta = (c - b) / n;
  const variance = Math.max(0, b + c - (c - b) ** 2 / n) / (n * n);
  return { delta, band: 1.96 * Math.sqrt(variance) };
}

function groupBy(rows: LabRow[]) {
  const m = new Map<string, Map<number, LabRow[]>>();
  for (const r of rows) {
    const k = raceKey(r);
    if (!m.has(k)) m.set(k, new Map());
    const byV = m.get(k)!;
    if (!byV.has(r.model_version)) byV.set(r.model_version, []);
    byV.get(r.model_version)!.push(r);
  }
  return m;
}

export interface ScoreboardRow {
  version: number; races: number; win: number; place: number; quinella: number; top3Overlap: number;
  placeDelta: number | null; placeBand: number | null;
}

function agg(version: number, hits: NonNullable<ReturnType<typeof raceHits>>[]): ScoreboardRow {
  const n = hits.length || 1;
  return {
    version, races: hits.length,
    win: hits.filter((h) => h.win).length / n,
    place: hits.filter((h) => h.place).length / n,
    quinella: hits.filter((h) => h.quinella).length / n,
    top3Overlap: hits.reduce((s, h) => s + h.top3Overlap, 0) / n,
    placeDelta: null, placeBand: null,
  };
}

export function buildScoreboard(live: LabRow[], shadow: LabRow[], liveVersion: number): ScoreboardRow[] {
  const liveG = groupBy(live), shG = groupBy(shadow);
  const liveHits = new Map<string, NonNullable<ReturnType<typeof raceHits>>>();
  for (const [k, byV] of liveG) { const h = raceHits(byV.get(liveVersion) ?? []); if (h) liveHits.set(k, h); }
  const out: ScoreboardRow[] = [agg(liveVersion, [...liveHits.values()])];

  const versions = [...new Set(shadow.map((r) => r.model_version))].sort((a, b) => a - b);
  for (const v of versions) {
    const common: { l: NonNullable<ReturnType<typeof raceHits>>; s: NonNullable<ReturnType<typeof raceHits>> }[] = [];
    for (const [k, byV] of shG) {
      const l = liveHits.get(k); const s = raceHits(byV.get(v) ?? []);
      if (l && s) common.push({ l, s });
    }
    const row = agg(v, common.map((c) => c.s));
    const noise = pairedNoise(common.map((c) => c.l.place), common.map((c) => c.s.place));
    row.placeDelta = noise.delta; row.placeBand = noise.band;
    out.push(row);
  }
  return out;
}

export interface RaceComparison {
  key: string; race_date: number; meet: number; rc_no: number;
  actualTop3: string[]; picks: Record<number, string[]>; placeHit: Record<number, boolean>; disagree: boolean;
}

export function buildRaceComparisons(live: LabRow[], shadow: LabRow[]): RaceComparison[] {
  const g = groupBy([...live, ...shadow]);
  const out: RaceComparison[] = [];
  for (const [key, byV] of g) {
    const any = [...byV.values()][0]![0]!;
    const all = [...byV.values()].flat();
    const actual = new Map<string, number>();
    for (const r of all) if (r.actual_ord != null) actual.set(r.hr_name, r.actual_ord);
    const actualTop3 = [...actual.entries()].filter(([, o]) => o >= 1 && o <= 3).sort((a, b) => a[1] - b[1]).map(([h]) => h);
    const picks: Record<number, string[]> = {}, placeHit: Record<number, boolean> = {};
    for (const [v, rows] of byV) {
      picks[v] = [...rows].sort((a, b) => a.predicted_rank - b.predicted_rank).slice(0, 3).map((r) => r.hr_name);
      placeHit[v] = raceHits(rows)?.place ?? false;
    }
    const firsts = new Set(Object.values(picks).map((p) => p[0]));
    out.push({ key, race_date: any.race_date, meet: any.meet, rc_no: any.rc_no, actualTop3, picks, placeHit, disagree: firsts.size > 1 });
  }
  return out.sort((a, b) => b.race_date - a.race_date || a.meet - b.meet || a.rc_no - b.rc_no);
}
```
- [ ] **Step 4: 통과 확인** — PASS
- [ ] **Step 5: 커밋** — `feat(lab): 섀도 비교 지표 순수함수 (규칙 정의·대응비교 흔들림 폭)`

---

### Task 8: `/lab` 화면 교체 + 데이터 훅

**Files:**
- Modify: `client/src/lib/queries.ts` (훅 추가), `client/src/components/Layout.tsx` (title 문구)
- Rewrite: `client/src/pages/Lab.tsx` (옛 가중치 실험실 삭제·교체. `labScoring.ts`는 `/versions`가 쓰므로 유지)

**Interfaces:**
- Consumes: `LabRow`, `buildScoreboard`, `buildRaceComparisons` (T7)
- Produces: `useLabData(from: number, to: number)` → `{ versions: {id; label; is_active; is_shadow}[]; live: LabRow[]; shadow: LabRow[] }`

- [ ] **Step 1: 훅 추가** — `client/src/lib/queries.ts` 끝에

```ts
import type { LabRow } from './labMetrics';

async function fetchAllPaged<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []; const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await build(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/** /lab 섀도 비교 — 기간 내 라이브 예측 + 섀도 예측 + 버전 목록 (spec 2026-09-18 §6). */
export function useLabData(from: number, to: number) {
  return useQuery({
    queryKey: ['lab', from, to],
    queryFn: async () => {
      const { data: versions, error: vErr } = await supabase
        .from('model_versions').select('id, label, is_active, is_shadow').order('id');
      if (vErr) throw vErr;
      const cols = 'race_date, meet, rc_no, hr_name, predicted_rank, actual_ord, model_version';
      const live = await fetchAllPaged<LabRow>((a, b) => supabase.from('predictions').select(cols)
        .gte('race_date', from).lte('race_date', to).order('race_date').order('meet').order('rc_no').order('hr_name').range(a, b));
      const shadow = await fetchAllPaged<LabRow>((a, b) => supabase.from('shadow_predictions').select(`${cols}, source`)
        .gte('race_date', from).lte('race_date', to).order('race_date').order('meet').order('rc_no').order('hr_name').order('model_version').range(a, b));
      return {
        versions: (versions ?? []) as { id: number; label: string; is_active: boolean; is_shadow: boolean }[],
        live: live.map((r) => ({ ...r, source: 'prod' as const })),
        shadow,
      };
    },
    enabled: !!from && !!to,
    staleTime: 10 * 60 * 1000,
  });
}
```
(`import type` 줄은 파일 상단 import 영역으로 옮긴다.)

- [ ] **Step 2: Lab.tsx 재작성**

```tsx
/**
 * Lab.tsx — 섀도 실험실: 라이브 모델 vs 실험(섀도) 버전 예측을 같은 경주끼리 비교.
 * spec: docs/superpowers/specs/2026-09-18-shadow-lab-design.md §6
 * (2026-09-18 옛 "판단항목 가중치 실험"을 교체 — 로지스틱 전환 후 무의미해져서)
 * 진입점: 헤더 "개인 도구" → /lab
 */
import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useLabData } from '../lib/queries';
import { buildScoreboard, buildRaceComparisons } from '../lib/labMetrics';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ymd = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86400_000));
const MEET_NAME: Record<number, string> = { 1: '서울', 3: '부경' };

type SourceFilter = 'all' | 'live' | 'backfill';

export function Lab() {
  const [range, setRange] = useState<{ from: number; to: number }>({ from: daysAgo(28), to: daysAgo(0) });
  const [source, setSource] = useState<SourceFilter>('all');
  const [meet, setMeet] = useState<0 | 1 | 3>(0);
  const [onlyDisagree, setOnlyDisagree] = useState(false);
  const { data, isLoading, error } = useLabData(range.from, range.to);

  const view = useMemo(() => {
    if (!data) return null;
    const active = data.versions.find((v) => v.is_active);
    if (!active) return null;
    const meetOk = (r: { meet: number }) => meet === 0 || r.meet === meet;
    const live = data.live.filter((r) => r.model_version === active.id && meetOk(r));
    const shadow = data.shadow.filter((r) => meetOk(r) && (source === 'all' || r.source === source));
    const label = new Map(data.versions.map((v) => [v.id, v.label]));
    return {
      active, label,
      board: buildScoreboard(live, shadow, active.id),
      races: buildRaceComparisons(live, shadow).filter((r) => !onlyDisagree || r.disagree),
    };
  }, [data, source, meet, onlyDisagree]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center gap-2">
        <FlaskConical className="w-5 h-5 text-[var(--color-accent-cyan)]" />
        <h1 className="text-lg font-bold">실험실 — 라이브 vs 실험 버전</h1>
      </header>

      <section className="flex flex-wrap gap-3 text-sm">
        <label>기간 <input type="number" value={range.from} onChange={(e) => setRange({ ...range, from: Number(e.target.value) })} className="w-28 bg-[var(--color-bg-elevated)] rounded px-2 py-1" />
          ~ <input type="number" value={range.to} onChange={(e) => setRange({ ...range, to: Number(e.target.value) })} className="w-28 bg-[var(--color-bg-elevated)] rounded px-2 py-1" /></label>
        <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} className="bg-[var(--color-bg-elevated)] rounded px-2 py-1">
          <option value="all">실험: 전체</option><option value="live">실험: 사전 저장만</option><option value="backfill">실험: 과거 채우기만</option>
        </select>
        <select value={meet} onChange={(e) => setMeet(Number(e.target.value) as 0 | 1 | 3)} className="bg-[var(--color-bg-elevated)] rounded px-2 py-1">
          <option value={0}>서울+부경</option><option value={1}>서울</option><option value={3}>부경</option>
        </select>
      </section>

      {isLoading && <p className="text-sm text-[var(--color-text-secondary)]">불러오는 중…</p>}
      {error && <p className="text-sm text-red-400">불러오기 실패: {(error as Error).message}</p>}
      {view && (
        <>
          <section className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[var(--color-text-secondary)]">
                <tr><th className="text-left py-1">버전</th><th>경주</th><th>단승</th><th>연승(1순위 3착내)</th><th>복승</th><th>TOP3 겹침</th></tr>
              </thead>
              <tbody>
                {view.board.map((r) => (
                  <tr key={r.version} className="border-t border-[var(--color-bg-elevated)] text-center">
                    <td className="text-left py-1">{view.label.get(r.version) ?? r.version}{r.version === view.active.id ? ' (라이브)' : ''}</td>
                    <td>{r.races}</td><td>{pct(r.win)}</td>
                    <td>
                      {pct(r.place)}
                      {r.placeDelta != null && (
                        <span className="ml-1 text-xs text-[var(--color-text-secondary)]">
                          ({r.placeDelta >= 0 ? '+' : ''}{(r.placeDelta * 100).toFixed(1)}%p, 운 범위 ±{((r.placeBand ?? 0) * 100).toFixed(1)}%p)
                        </span>
                      )}
                    </td>
                    <td>{pct(r.quinella)}</td><td>{r.top3Overlap.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
              실험 버전은 라이브와 둘 다 예측한 경주만 셉니다. 차이가 "운 범위" 안이면 아직 실력 차라고 말할 수 없어요.
            </p>
          </section>

          <section>
            <label className="text-sm flex items-center gap-2 mb-2">
              <input type="checkbox" checked={onlyDisagree} onChange={(e) => setOnlyDisagree(e.target.checked)} /> 1순위가 엇갈린 경주만
            </label>
            <ul className="space-y-1 text-sm">
              {view.races.map((rc) => (
                <li key={rc.key} className="flex flex-wrap gap-x-4 border-t border-[var(--color-bg-elevated)] py-1">
                  <span className="w-36">{rc.race_date} {MEET_NAME[rc.meet] ?? rc.meet} {rc.rc_no}R</span>
                  {Object.entries(rc.picks).map(([v, p]) => (
                    <span key={v}>{view.label.get(Number(v)) ?? v}: {p.join('·')} {rc.placeHit[Number(v)] ? '✅' : ''}</span>
                  ))}
                  <span className="text-[var(--color-text-secondary)]">실제: {rc.actualTop3.join('·') || '결과 전'}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
```
- [ ] **Step 3: Layout title 수정** — `client/src/components/Layout.tsx`의 `/lab` 링크 `title="판단항목 가중치 실험"` → `title="라이브 vs 실험 버전 예측 비교"`. `VersionCompare.tsx:56`의 `/lab` 링크 문구가 "가중치 실험"을 가리키면 "실험실"로만 바꾼다(동작 변경 없음).
- [ ] **Step 4: 타입체크·빌드** — `cd client && npx tsc --noEmit && npm run build` 0 errors, 루트 `npm run test:run` PASS. `labScoring.ts`가 `Lab.tsx` 외에 `VersionCompare.tsx`에서 계속 쓰이는지 확인(쓰이면 유지, 안 쓰이면 삭제하지 말고 보고).
- [ ] **Step 5: 화면 확인** — `npm run client:dev` 후 `/lab` 접속: 마이그레이션 적용 전이면 shadow 조회 에러 메시지가 뜨는지, 적용 후 섀도 0건이면 라이브 한 줄만 뜨는지 확인. 스크린샷은 사용자에게 요청.
- [ ] **Step 6: 커밋** — `feat(lab): /lab을 섀도 비교 화면으로 교체 (옛 가중치 실험실 대체)`

---

### Task 9: 학습기 확장 — 수렴 기록 + 상위3 조건부 로짓

**Files:**
- Modify: `src/engine/models/logistic.ts`, `src/engine/models/plackettLuce.ts`
- Test: `src/engine/models/logistic.test.ts`, `src/engine/models/plackettLuce.test.ts` (케이스 추가)

**Interfaces:**
- Produces:
  - `FitOpts.onLoss?: (iter: number, loss: number) => void` — `lossEvery`(기본 100)회마다 평균 음의 로그우도(+L2항 제외) 보고
  - `PLFitOpts.topK?: number` — 우도에 1~topK 단계만 포함(기본 = 전체). `PLModel.topK?: number` 기록

- [ ] **Step 1: 실패 테스트** — `logistic.test.ts`에 추가

```ts
it('onLoss 콜백으로 손실이 감소하는 궤적을 보고한다', () => {
  const rnd = (() => { let s = 7; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
  const X: number[][] = [], y: number[] = [];
  for (let i = 0; i < 500; i++) { const x = rnd() * 4 - 2; X.push([x]); y.push(rnd() < 1 / (1 + Math.exp(-2 * x)) ? 1 : 0); }
  const losses: number[] = [];
  fitLogistic(X, y, ['x'], { iters: 300, lr: 0.2, onLoss: (_it, l) => losses.push(l), lossEvery: 100 });
  expect(losses).toHaveLength(3);
  expect(losses[2]!).toBeLessThan(losses[0]!);
});
```
`plackettLuce.test.ts`에 추가 (기존 `makeRaces` 재사용)

```ts
it('topK=3은 계수 부호를 회복하고 topK를 기록한다', () => {
  const races = makeRaces(400, 8);
  const model = fitPL(races, ['x1', 'x2'], { l2: 0.02, iters: 800, lr: 0.2, topK: 3 });
  expect(model.coef['x1']).toBeGreaterThan(0);
  expect(model.coef['x2']).toBeLessThan(0);
  expect(model.topK).toBe(3);
});

it('topK=3은 4착 이하 순서를 무시한다 (하위 순서를 뒤섞어도 계수 동일)', () => {
  const races = makeRaces(200, 8);
  const shuffled = races.map((r) => ({
    horses: r.horses.map((h) => (h.ord >= 4 ? { ...h, ord: 12 - h.ord } : h)), // 8두: 4..8 → 8..4 역순
  }));
  const a = fitPL(races, ['x1', 'x2'], { iters: 200, topK: 3 });
  const b = fitPL(shuffled, ['x1', 'x2'], { iters: 200, topK: 3 });
  expect(a.coef['x1']).toBeCloseTo(b.coef['x1']!, 10);
});
```
- [ ] **Step 2: 실패 확인** — `npx vitest run src/engine/models` → 새 케이스 FAIL
- [ ] **Step 3: 구현 (logistic.ts)** — `FitOpts`에 `onLoss?: (iter: number, loss: number) => void; lossEvery?: number;` 추가. 반복문 안에서 기울기 누적 시 손실도 누적:

```ts
    let loss = 0;
    for (let i = 0; i < n; i++) {
      let z = b; for (let j = 0; j < d; j++) z += w[j]! * Z[i]![j]!;
      const p = 1 / (1 + Math.exp(-z));
      const err = p - y[i]!;
      for (let j = 0; j < d; j++) gw[j]! += err * Z[i]![j]!;
      gb += err;
      if (opts.onLoss) { const pc = Math.min(Math.max(p, 1e-12), 1 - 1e-12); loss -= y[i]! ? Math.log(pc) : Math.log(1 - pc); }
    }
    if (opts.onLoss && (it + 1) % (opts.lossEvery ?? 100) === 0) opts.onLoss(it + 1, loss / n);
```
(구조분해 `const { l2 = 0.01, iters = 500, lr = 0.1 } = opts;`는 유지 — `opts.onLoss` 직접 참조.)
- [ ] **Step 4: 구현 (plackettLuce.ts)** — `PLFitOpts`에 `topK?: number`, `PLModel`에 `topK?: number` 추가. 단계 루프를 `for (let i = 0; i < Math.min(K, topK ?? K); i++)`로 교체(`const { l2 = 0.02, iters = 800, lr = 0.2, topK } = opts;`), 반환에 `...(topK ? { topK } : {})`. 주석 "우도 (경주별, ord 오름차순)" 아래에 `topK 지정 시 1~topK 단계만(상위K 조건부 로짓, 2026-09-18 E2)` 한 줄 추가.
- [ ] **Step 5: 통과 확인** — `npm run test:run` PASS(기존 PL/로지스틱 테스트 불변), `npm run build`
- [ ] **Step 6: 커밋** — `feat(models): 로지스틱 수렴 기록(onLoss) + PL topK(상위3 조건부 로짓)`

---

### Task 10: 학습 방식 실험 E0·E1·E2 + 판정

**Files:**
- Create: `src/engine/eval/learningExp.ts`, `src/engine/eval/learningExp.test.ts`, `scripts/exp_learning.ts`
- Modify: `package.json` (`"exp:learning": "tsx scripts/exp_learning.ts"`)

**Interfaces:**
- Consumes: `collectRaces`, `rollingBlocks`, `quarterStart`, `rankHorses`/`ScorableModel` (기존 eval), `fitLogistic` onLoss·`fitPL` topK (T9), `toVector`
- Produces:
  - `placeRate(m: ScorableModel, races: RaceRecord[]): number` — 1순위 ord ≤ 3 비율
  - `verdict(base: number[], cand: number[]): { meanDelta: number; positive: number; quarters: number; pass: boolean }` — `pass = meanDelta ≥ 0.01 && positive > quarters/2`
  - `data/exp_learning_<ts>.json` 결과 파일

- [ ] **Step 1: 실패 테스트** — `src/engine/eval/learningExp.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { placeRate, verdict } from './learningExp.js';

const horse = (name: string, x: number, ord: number) => ({ hrName: name, pthrNo: 0, ord, winOdds: null, rawScores: {}, features: [{ name: 'x', value: x }] });

describe('placeRate', () => {
  it('1순위(점수 최고) 말이 3착 안인 경주 비율', () => {
    const m = { kind: 'logistic' as const, model: { type: 'logistic' as const, features: ['x'], means: [0], stds: [1], coef: { x: 1 }, intercept: 0 } };
    const races = [
      { raceDate: 1, meet: 1, rcNo: 1, horses: [horse('A', 2, 1), horse('B', 1, 5)] },
      { raceDate: 1, meet: 1, rcNo: 2, horses: [horse('C', 2, 7), horse('D', 1, 1)] },
    ];
    expect(placeRate(m, races)).toBe(0.5);
  });
});

describe('verdict', () => {
  const base = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  it('평균 미달이면 양수 분기가 많아도 불합격', () => {
    // Δ = +2,+1,+1,−1,0,+1 %p → 평균 +0.67%p, 양수 4/6
    expect(verdict(base, [0.52, 0.51, 0.51, 0.49, 0.50, 0.51]).pass).toBe(false);
  });
  it('평균 +1.0%p 이상 AND 과반 양수면 합격', () => {
    // Δ = +3,+2,+2,−1,+2,+1 %p → 평균 +1.5%p, 양수 5/6
    const v = verdict(base, [0.53, 0.52, 0.52, 0.49, 0.52, 0.51]);
    expect(v.meanDelta).toBeCloseTo(0.015, 6);
    expect(v.pass).toBe(true);
  });
  it('경계: 평균 정확히 +1.0%p면 합격', () => {
    expect(verdict(base, [0.51, 0.51, 0.51, 0.51, 0.51, 0.51]).pass).toBe(true);
  });
  it('양수 분기 수를 센다', () => {
    const v = verdict([0.5, 0.5, 0.5, 0.5], [0.53, 0.53, 0.49, 0.49]);
    expect(v.positive).toBe(2);
    expect(v.pass).toBe(false); // 2/4는 과반 아님
  });
});
```
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `src/engine/eval/learningExp.ts`

```ts
/** 학습 방식 실험 지표·판정 (spec 2026-09-18 §7, 사전등록). */
import { rankHorses, type ScorableModel } from './score.js';
import type { RaceRecord } from './types.js';

export function placeRate(m: ScorableModel, races: RaceRecord[]): number {
  if (races.length === 0) return 0;
  let hit = 0;
  for (const r of races) { const top = rankHorses(m, r.horses)[0]; if (top && top.ord >= 1 && top.ord <= 3) hit++; }
  return hit / races.length;
}

export function verdict(base: number[], cand: number[]) {
  const deltas = cand.map((c, i) => c - base[i]!);
  const meanDelta = deltas.reduce((s, d) => s + d, 0) / (deltas.length || 1);
  const positive = deltas.filter((d) => d > 0).length;
  return { meanDelta, positive, quarters: deltas.length, pass: meanDelta >= 0.01 - 1e-12 && positive > deltas.length / 2 };
}
```
- [ ] **Step 4: 통과 확인** → PASS
- [ ] **Step 5: 실험 CLI** — `scripts/exp_learning.ts`

```ts
/**
 * 학습 방식 실험 (spec 2026-09-18 §7). DuckDB 미러 읽기 전용, DB 쓰기 없음.
 * 피처 스키마 = 활성 모델(v7) artifact.features 고정 → 학습 방식 차이만 비교.
 *   E0: 수렴 — 튜닝 학습셋(≤2024-09-30)에서 3000회 손실 궤적
 *   E1: l2 × iters 튜닝 — 2024Q4 검증 분기 연승으로만 선택
 *   E2: PL 전체 / PL topK=3 — 같은 튜닝 절차
 *   판정: 6분기 롤링(2025Q1~2026Q2) 연승, 기준선 logistic l2=0.02·800회
 * 사용: npm run exp:learning   (⚠️ 선행 db:pull, 수십 분 소요 가능)
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { getReadClient } from '../src/db/localDb.js';
import { getActiveModelVersion } from '../src/engine/modelVersion.js';
import { collectRaces } from '../src/engine/eval/collect.js';
import { rollingBlocks } from '../src/engine/eval/rolling.js';
import { toVector } from '../src/engine/features/alignFeatures.js';
import { fitLogistic } from '../src/engine/models/logistic.js';
import { fitPL } from '../src/engine/models/plackettLuce.js';
import { placeRate, verdict } from '../src/engine/eval/learningExp.js';
import type { ScorableModel } from '../src/engine/eval/score.js';
import type { RaceRecord } from '../src/engine/eval/types.js';

const L2S = [0.001, 0.005, 0.02, 0.05, 0.1];
const ITERS = [800, 3000];
type Variant = 'logistic' | 'pl' | 'pl-top3';

function train(v: Variant, races: RaceRecord[], schema: string[], l2: number, iters: number): ScorableModel {
  if (v === 'logistic') {
    const X = races.flatMap((r) => r.horses.map((h) => toVector(h.features, schema)));
    const y = races.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));
    return { kind: 'logistic', model: fitLogistic(X, y, schema, { l2, iters, lr: 0.2 }) };
  }
  const pr = races.map((r) => ({ horses: r.horses.map((h) => ({ x: toVector(h.features, schema), ord: h.ord })) }));
  return { kind: 'pl', model: fitPL(pr, schema, { l2, iters, lr: 0.2, ...(v === 'pl-top3' ? { topK: 3 } : {}) }), schema };
}

async function main() {
  const db = await getReadClient();
  const active = await getActiveModelVersion(db);
  const schema = active.artifact!.features;
  console.log(`스키마: 활성 ${active.label} 피처 ${schema.length}개`);
  const races = await collectRaces(db, 20220101, 20260630, { shapeParCutoff: 20250101 });
  console.log(`경주 ${races.length}`);

  const tuneTrain = races.filter((r) => r.raceDate <= 20240930);
  const tuneVal = races.filter((r) => r.raceDate >= 20241001 && r.raceDate <= 20241231);

  // E0 수렴
  const X0 = tuneTrain.flatMap((r) => r.horses.map((h) => toVector(h.features, schema)));
  const y0 = tuneTrain.flatMap((r) => r.horses.map((h) => (h.ord <= 3 ? 1 : 0)));
  const e0: [number, number][] = [];
  fitLogistic(X0, y0, schema, { l2: 0.02, iters: 3000, lr: 0.2, lossEvery: 200, onLoss: (it, l) => e0.push([it, l]) });
  console.log('\nE0 손실 궤적:', e0.map(([i, l]) => `${i}:${l.toFixed(5)}`).join(' '));

  // E1·E2 튜닝 (검증 분기만)
  const best: Record<Variant, { l2: number; iters: number; val: number }> = {} as never;
  for (const v of ['logistic', 'pl', 'pl-top3'] as Variant[]) {
    for (const l2 of L2S) for (const iters of ITERS) {
      const val = placeRate(train(v, tuneTrain, schema, l2, iters), tuneVal);
      console.log(`  튜닝 ${v} l2=${l2} iters=${iters} → 2024Q4 연승 ${(val * 100).toFixed(1)}%`);
      if (!best[v] || val > best[v].val) best[v] = { l2, iters, val };
    }
  }
  console.log('\n선택된 설정:', JSON.stringify(best));

  // 판정 — 6분기 롤링
  const blocks = rollingBlocks(races, { year: 2025, q: 1 });
  const series: Record<string, number[]> = { base: [], logistic: [], pl: [], 'pl-top3': [] };
  for (const b of blocks) {
    series.base!.push(placeRate(train('logistic', b.train, schema, 0.02, 800), b.test));
    for (const v of ['logistic', 'pl', 'pl-top3'] as Variant[]) series[v]!.push(placeRate(train(v, b.train, schema, best[v].l2, best[v].iters), b.test));
    console.log(`  ${b.key}: ` + Object.entries(series).map(([k, s]) => `${k} ${(s.at(-1)! * 100).toFixed(1)}%`).join(' · '));
  }
  const verdicts = Object.fromEntries((['logistic', 'pl', 'pl-top3'] as Variant[]).map((v) => [v, verdict(series.base!, series[v]!)]));
  for (const [v, r] of Object.entries(verdicts)) {
    console.log(`판정 ${v}(튜닝): 평균 Δ ${(r.meanDelta * 100).toFixed(2)}%p · 양수 ${r.positive}/${r.quarters} → ${r.pass ? '✅ 합격' : '❌ 불합격'}`);
  }
  const out = `data/exp_learning_${Date.now()}.json`;
  writeFileSync(out, JSON.stringify({ e0, best, quarters: blocks.map((b) => b.key), series, verdicts }, null, 2));
  console.log(`\n→ ${out}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```
`package.json`에 `"exp:learning": "tsx scripts/exp_learning.ts",` 추가.
- [ ] **Step 6: 빌드·테스트** — PASS
- [ ] **Step 7: 커밋** — `feat(exp): 학습 방식 실험 E0·E1·E2 스크립트 (사전등록 판정)`
- [ ] **Step 8: 실행(Claude, 로컬 읽기 전용, 백그라운드)** — `npm run exp:learning > .superpowers/sdd/exp_learning.log 2>&1`. 끝나면 로그에서 E0 궤적·선택 설정·분기표·판정 4줄만 보고. **결과 해석·다음 단계(섀도 등록 후보 선택)는 사용자와 의논.**
- [ ] **Step 9: 결과 기록 커밋** — `docs/status/02-model-benchmark.md`에 "학습 방식 실험(2026-09-18)" 섹션(분기표·판정·해석) 추가 → `docs(model): 학습 방식 실험 E0~E2 결과 기록`

---

### Task 11: 섀도 후보 학습·등록 경로

**Files:**
- Modify: `scripts/learn_logistic.ts`
- Test: `scripts/learn_logistic.test.ts` (신규, 순수 헬퍼만)

**Interfaces:**
- Consumes: `fitPL` topK (T9)
- Produces: CLI `npm run learn:logistic -- --matrix <path> --label <l> [--model logistic|pl-top3] [--l2 0.02] [--iters 800] [--shadow]`; 헬퍼 `export function groupRowsByRace(rows: MatrixRow[]): { horses: { x: number[]; ord: number }[] }[]` (schema 인자 포함), `export function maxRaceDate(rows): number`

- [ ] **Step 1: 실패 테스트** — `scripts/learn_logistic.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { groupRowsByRace, maxRaceDate } from './learn_logistic.js';

const row = (d: number, rc: number, hr: string, ord: number) => ({ race_date: d, meet: 1, rc_no: rc, hr_name: hr, ord, top3: ord <= 3 ? 1 : 0, features: [{ name: 'x', value: ord }] });

describe('learn_logistic helpers', () => {
  it('경주 단위로 묶는다', () => {
    const g = groupRowsByRace([row(1, 1, 'A', 1), row(1, 1, 'B', 2), row(1, 2, 'C', 1)], ['x']);
    expect(g).toHaveLength(2);
    expect(g[0]!.horses.map((h) => h.ord)).toEqual([1, 2]);
  });
  it('train_until = 행렬의 최대 경주일', () => {
    expect(maxRaceDate([row(20260601, 1, 'A', 1), row(20260630, 1, 'B', 1)])).toBe(20260630);
  });
});
```
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `scripts/learn_logistic.ts`:
  - `Row`를 `export interface MatrixRow { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number; top3: number; features: Feature[] }`로 확장.
  - 헬퍼 export:
```ts
export function groupRowsByRace(rows: MatrixRow[], schema: string[]) {
  const m = new Map<string, { x: number[]; ord: number }[]>();
  for (const r of rows) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push({ x: toVector(r.features, schema), ord: r.ord });
  }
  return [...m.values()].map((horses) => ({ horses }));
}
export function maxRaceDate(rows: { race_date: number }[]): number {
  return rows.reduce((mx, r) => Math.max(mx, r.race_date), 0);
}
```
  - `main()` 인자: `--model`(기본 logistic), `--l2`(기본 0.02), `--iters`(기본 800), `--shadow`(플래그). 모델 분기:
```ts
  const model = modelType === 'pl-top3'
    ? fitPL(groupRowsByRace(rows, schema), schema, { l2, iters, lr: 0.2, topK: 3 })
    : fitLogistic(rows.map((r) => toVector(r.features, schema)), rows.map((r) => r.top3), schema, { l2, iters, lr: 0.2 });
  const trainUntil = maxRaceDate(rows);
```
  - INSERT(두 경로 모두)에 `model_type = modelType`, `is_shadow = shadow`, `train_until = trainUntil` 추가, notes에 `l2·iters·train_until` 기록. pg 경로 SQL:
```sql
INSERT INTO model_versions (label, model_type, weights, artifact, source, is_active, is_shadow, train_until, notes)
VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8) RETURNING id
```
  - `main()` 호출을 `if (process.argv[1]?.endsWith('learn_logistic.ts')) main()…`으로 감싸 테스트 import 시 실행 방지.
- [ ] **Step 4: 통과 확인** — `npm run test:run`, `npm run build` PASS
- [ ] **Step 5: 커밋** — `feat(learn): learn:logistic에 pl-top3·l2·iters·--shadow·train_until 추가`
- [ ] **Step 6: 등록(사용자 확인 후)** — T10 결과를 보고 사용자가 고른 후보마다:
  1. `npm run extract:matrix -- --from 20220101 --to 20260630 --out data/matrix_2022_202606.jsonl` (미러 읽기, 로컬)
  2. `npm run learn:logistic -- --matrix data/matrix_2022_202606.jsonl --label v8-<이름> --model <…> --l2 <…> --iters <…> --shadow` (**Supabase 쓰기 — 사용자 확인**)
  3. `npm run shadow:backfill -- --version <id> --dry-run` → 건수 확인 → 사용자 확인 후 `--dry-run` 빼고 실행.

---

### Task 12: 문서 갱신

**Files:** `docs/pipeline_guide.md`, `docs/data_flow.md`, `docs/status/02-model-benchmark.md`, `docs/status/06-ui.md`, `docs/api_spec.md`, `docs/accuracy_metrics.md`

- [ ] **Step 1:** `pipeline_guide.md` — 명령어 섹션에 `shadow:leak-check`, `shadow:backfill`, `exp:learning`, `learn:logistic` 새 옵션. 재학습 정책 절 옆에 "섀도 실험 사이클: 학습(--shadow) → leak-check → backfill → /lab 관찰 → 승격은 promote".
- [ ] **Step 2:** `data_flow.md` — raceCardSync/dailySync 단계에 섀도 분기(격리) 1줄씩.
- [ ] **Step 3:** `api_spec.md` — Supabase 스키마에 `shadow_predictions`, `model_versions.is_shadow/train_until`; React Query 훅 `useLabData`.
- [ ] **Step 4:** `status/06-ui.md` — `/lab` 교체 기록. `status/02-model-benchmark.md` — 섀도 인프라 한 줄 + 현재 섀도 버전 목록.
- [ ] **Step 5:** `accuracy_metrics.md` — §2 상단에 "⚠️ 이름 정의 불일치 — TODO D-001, `/lab`은 규칙 정의 사용(spec 2026-09-18 §6.1)" 경고 1줄(본 정리는 D-001에서).
- [ ] **Step 6:** 커밋 `docs: 섀도 실험실·학습 실험 운영 문서 반영`

---

## 실행 순서·의존성

```
T1 ─┬─ T2 ─ T3 ─ T4
    │         └─ T5 ─ T6
    └─ T7 ─ T8
T9 ─ T10 ─ (사용자 의논) ─ T11 ─ T12
```
- T1 마이그레이션 적용(사용자)은 T3 실동작·T8 화면 확인 전까지만 필요. 코드·테스트는 적용 없이 진행 가능.
- T9·T10은 T1~T8과 독립 — 병렬 가능하나 서브에이전트는 태스크당 1개, 순차 진행이 기본.
