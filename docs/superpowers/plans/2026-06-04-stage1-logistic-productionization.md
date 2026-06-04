# B3 — Stage-1 로지스틱 라이브 프로덕션화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 오프라인 검증된 로지스틱 P(top3) 모델을 라이브 `predictRace`에 올려 실제 예측 순위를 구동하되, 피처 기여도를 21항목 `item_scores`로 묶어 UI 무수정 유지. 파리티+섐도우로 검증.

**Architecture:** `model_versions`에 `model_type`/`artifact` 추가 → `predictRace`가 활성 버전 타입으로 분기 → 로지스틱이면 `buildFeatures→logisticScorer`로 총점+항목기여도 산출. 피처→항목 매핑은 순수 함수로 분리·테스트.

**Tech Stack:** Node ESM(`.js` import), TypeScript, vitest, Supabase, tsx.

**스펙:** `docs/superpowers/specs/2026-06-04-stage1-logistic-productionization-design.md`

**기존 타입(참고, 변경 금지):**
- `LogisticModel = { type:'logistic'; features:string[]; means:number[]; stds:number[]; coef:Record<string,number>; intercept:number }` (`src/engine/models/logistic.ts`), `predictLogit(model, rawRow:number[]):number`.
- `ItemScore = { itemId; itemName; rawScore; weight; weightedScore; status }`, `HorseScoreResult = { total; items: Record<ItemId,ItemScore> }` (`src/engine/index.ts:146-161`).
- `buildFeatures(input: ScoreEngineInput): Feature[]` where `Feature = { name:string; value:number }`.
- `getActiveModelVersion(sb)` → `{ id; label; weights }` (`src/engine/modelVersion.ts`).
- `predictRace` (`src/engine/scorePredictor.ts:159-192`) builds `item_scores: score.items`, `model_version: activeVersion.id`.

---

## File Structure
- **Create** `supabase/migrations/012_model_logistic.sql` — model_type/artifact 컬럼.
- **Create** `src/engine/features/featureItemMap.ts` (+test) — 피처명→항목id 매핑.
- **Create** `src/engine/logisticScorer.ts` (+test) — 기여도 그룹핑 + ItemScore 어댑터.
- **Modify** `src/engine/modelVersion.ts` — model_type/artifact 로드.
- **Modify** `src/engine/scorePredictor.ts` — predictRace 로지스틱 분기.
- **Create** `scripts/learn_logistic.ts` — 후보 버전 학습·삽입.
- **Create** `scripts/verify_logistic.ts` — 파리티 + 섐도우.
- **Modify** `package.json` — `learn:logistic`, `verify:logistic`.

---

## Task 1: 마이그레이션 012 (model_type/artifact)

**Files:** Create `supabase/migrations/012_model_logistic.sql`

- [ ] **Step 1: 작성** → `supabase/migrations/012_model_logistic.sql`:

```sql
-- ============================================
-- 012_model_logistic.sql
-- 로지스틱 모델을 model_versions에 저장 가능하게 확장.
-- 순수 추가형(멱등). 기존 rho-legacy 버전 영향 없음.
-- ============================================

ALTER TABLE model_versions
  ADD COLUMN IF NOT EXISTS model_type TEXT NOT NULL DEFAULT 'rho-legacy';

ALTER TABLE model_versions
  ADD COLUMN IF NOT EXISTS artifact JSONB;

-- ⑳ 속도능력지수 항목 레지스트리 보강(피처→항목 매핑 대상; 없으면 추가)
INSERT INTO score_items (item_id, name) VALUES
  ('20_speed_figure', '속도능력지수')
ON CONFLICT (item_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: 커밋** (적용은 사용자가 Supabase에서 수행 — 적용 없이도 이후 코드 타입체크는 가능)

```bash
git add supabase/migrations/012_model_logistic.sql
git commit -m "feat(db): model_versions model_type/artifact 컬럼 (로지스틱 저장)"
```

> 참고: 이 마이그레이션은 DB에 직접 적용해야 라이브 로지스틱 활성화가 동작한다. 적용 전까지는 기존 rho-legacy(v1)가 그대로 활성.

---

## Task 2: featureItemMap (피처→항목 매핑, 순수)

**Files:** Create `src/engine/features/featureItemMap.ts`, Test `src/engine/features/featureItemMap.test.ts`

- [ ] **Step 1: 실패 테스트** → `featureItemMap.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { featureToItem } from './featureItemMap.js';

describe('featureToItem', () => {
  it('항목별 대표 피처 매핑', () => {
    expect(featureToItem('rating_abs')).toBe('01_rating');
    expect(featureToItem('rating_rel')).toBe('01_rating');
    expect(featureToItem('burden_over_avg')).toBe('08_burden_weight');
    expect(featureToItem('interval_b_28_35')).toBe('11_race_interval');
    expect(featureToItem('x_front_hot')).toBe('19_running_style_pace');
    expect(featureToItem('speed_ability_raw')).toBe('20_speed_figure');
    expect(featureToItem('jockey_recent_win')).toBe('09b_jockey_recent');
  });
  it('결측·표본수 접미사도 같은 항목으로', () => {
    expect(featureToItem('dist_finish_ratio__missing')).toBe('06_distance_fitness');
    expect(featureToItem('same_dist_n')).toBe('06_distance_fitness');
    expect(featureToItem('style_stddev__missing')).toBe('19_running_style_pace');
  });
  it('매핑 없는 공유맥락은 context', () => {
    expect(featureToItem('rc_dist')).toBe('context');
    expect(featureToItem('완전모르는피처')).toBe('context');
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/engine/features/featureItemMap.test.ts`.

- [ ] **Step 3: 구현** → `src/engine/features/featureItemMap.ts`:

```typescript
/**
 * de-biased 피처명 → 21항목 id 매핑 (buildFeatures 주석 그룹 기준).
 * 로지스틱 기여도(βᵢ·zᵢ)를 항목 단위로 묶어 설명력(item_scores) 유지하기 위함.
 * 매핑 없는 공유맥락 피처는 'context'.
 */
const MAP: Record<string, string> = {
  rating_abs: '01_rating', rating_rel: '01_rating',
  weight_diff_last: '02_weight_change', weight_diff_slope: '02_weight_change', weight_diff_n: '02_weight_change',
  recent_ord_mean: '03_recent_form', recent_ord_slope: '03_recent_form', recent_ord_std: '03_recent_form', recent_ord_last: '03_recent_form', hist_n: '03_recent_form',
  sectional_total_improve: '04_sectional_time', sectional_last_improve: '04_sectional_time',
  late_finish_ratio_mean: '05_late_position', late_gain_mean: '05_late_position',
  dist_finish_ratio: '06_distance_fitness', same_dist_n: '06_distance_fitness',
  track_improvement: '07_track_adaptation',
  burden_over_avg: '08_burden_weight', burden_ord_mean: '08_burden_weight',
  jockey_career_qu: '09_jockey_form', jockey_career_win: '09_jockey_form',
  jockey_recent_win: '09b_jockey_recent', jockey_recent_n: '09b_jockey_recent',
  trainer_top3: '10_trainer_form', trainer60_n: '10_trainer_form',
  trainer_recent_top2: '10b_trainer_recent', trainer_recent_n: '10b_trainer_recent',
  interval_days: '11_race_interval',
  interval_b_lt14: '11_race_interval', interval_b_14_20: '11_race_interval', interval_b_21_27: '11_race_interval', interval_b_28_35: '11_race_interval', interval_b_36_45: '11_race_interval', interval_b_46_60: '11_race_interval', interval_b_61_90: '11_race_interval', interval_b_90p: '11_race_interval',
  gate_relative: '12_starting_position',
  age: '13_age_distance_gender', x_young_short: '13_age_distance_gender', x_old_long: '13_age_distance_gender', sex_mare: '13_age_distance_gender', sex_gelding: '13_age_distance_gender',
  pedigree_dsa_mean: '14_pedigree',
  season_top3: '15_seasonal_pattern', season_n: '15_seasonal_pattern',
  chemistry_improvement: '16_jockey_horse_chemistry', combo_n: '16_jockey_horse_chemistry',
  recent_pop_top2: '17_market_odds',
  earnings_log: '18_earnings',
  style_avg_ratio: '19_running_style_pace', style_stddev: '19_running_style_pace', pace_hot: '19_running_style_pace', pace_slow: '19_running_style_pace',
  speed_ability_raw: '20_speed_figure',
};
for (const s of ['front', 'pace', 'stalker', 'closer'])
  for (const p of ['hot', 'normal', 'slow'])
    MAP[`x_${s}_${p}`] = '19_running_style_pace';

/** 피처명 → 항목id. `__missing` 접미사는 본체와 같은 항목. 미매핑은 'context'. */
export function featureToItem(feature: string): string {
  const base = feature.endsWith('__missing') ? feature.slice(0, -'__missing'.length) : feature;
  return MAP[base] ?? 'context';
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/engine/features/featureItemMap.test.ts` → PASS.
- [ ] **Step 5: 커밋**
```bash
git add src/engine/features/featureItemMap.ts src/engine/features/featureItemMap.test.ts
git commit -m "feat(features): 피처→21항목 매핑 (로지스틱 기여도 그룹핑)"
```

---

## Task 3: logisticScorer (기여도 그룹핑 + ItemScore 어댑터)

**Files:** Create `src/engine/logisticScorer.ts`, Test `src/engine/logisticScorer.test.ts`

- [ ] **Step 1: 실패 테스트** → `src/engine/logisticScorer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { itemContributions } from './logisticScorer.js';
import type { LogisticModel } from './models/logistic.js';

const model: LogisticModel = {
  type: 'logistic',
  features: ['rating_abs', 'burden_over_avg', 'rc_dist'],
  means: [80, 0, 1400],
  stds: [10, 2, 200],
  coef: { rating_abs: 0.5, burden_over_avg: -0.3, rc_dist: 0.1 },
  intercept: 0.2,
};

describe('itemContributions', () => {
  it('총점=intercept+Σ(coef·z), 항목별 기여 합산', () => {
    // rating_abs=90 → z=1 → 기여 0.5*1=0.5 → 01_rating
    // burden_over_avg=2 → z=1 → 기여 -0.3 → 08_burden_weight
    // rc_dist=1600 → z=1 → 기여 0.1 → context
    const features = [
      { name: 'rating_abs', value: 90 },
      { name: 'burden_over_avg', value: 2 },
      { name: 'rc_dist', value: 1600 },
    ];
    const { total, byItem } = itemContributions(model, features);
    expect(total).toBeCloseTo(0.2 + 0.5 - 0.3 + 0.1, 6);
    expect(byItem['01_rating']).toBeCloseTo(0.5, 6);
    expect(byItem['08_burden_weight']).toBeCloseTo(-0.3, 6);
    expect(byItem['context']).toBeCloseTo(0.1, 6);
  });
  it('모델에 없는 피처는 무시(스키마=model.features)', () => {
    const { total } = itemContributions(model, [{ name: '엉뚱', value: 9 }, { name: 'rating_abs', value: 80 }]);
    // rating_abs=mean → z=0 기여0, 엉뚱 무시 → total=intercept
    expect(total).toBeCloseTo(0.2, 6);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/engine/logisticScorer.test.ts`.

- [ ] **Step 3: 구현** → `src/engine/logisticScorer.ts`:

```typescript
/**
 * 로지스틱 라이브 스코어러.
 * total = predictLogit, 피처 기여도 βᵢ·zᵢ를 21항목으로 묶어 item_scores 어댑터 생성.
 * 스펙: docs/superpowers/specs/2026-06-04-stage1-logistic-productionization-design.md
 */
import type { LogisticModel } from './models/logistic.js';
import type { ScoreEngineInput, ItemScore, HorseScoreResult } from './index.js';
import { buildFeatures } from './features/buildFeatures.js';
import { featureToItem } from './features/featureItemMap.js';
import { ITEM_NAMES } from '../types/index.js';

/** 피처 기여도(βᵢ·zᵢ)를 항목별 합산 + 총 logit. 스키마=model.features. */
export function itemContributions(
  model: LogisticModel, features: { name: string; value: number }[],
): { total: number; byItem: Record<string, number> } {
  const valByName = new Map(features.map((f) => [f.name, f.value]));
  const byItem: Record<string, number> = {};
  let total = model.intercept;
  model.features.forEach((name, j) => {
    const raw = valByName.get(name) ?? 0;
    const z = (raw - model.means[j]!) / model.stds[j]!;
    const contrib = (model.coef[name] ?? 0) * z;
    total += contrib;
    const item = featureToItem(name);
    byItem[item] = (byItem[item] ?? 0) + contrib;
  });
  return { total, byItem };
}

/** 라이브 로지스틱 점수: 총점 + item_scores(어댑터). */
export function scoreLogistic(model: LogisticModel, input: ScoreEngineInput): HorseScoreResult {
  const features = buildFeatures(input);
  const { total, byItem } = itemContributions(model, features);
  const items: Record<string, ItemScore> = {};
  for (const [itemId, contrib] of Object.entries(byItem)) {
    items[itemId] = {
      itemId: itemId as ItemScore['itemId'],
      itemName: (ITEM_NAMES as Record<string, string>)[itemId] ?? itemId,
      rawScore: 1 / (1 + Math.exp(-contrib)),  // 0-1 표시값(기여도 단조)
      weight: Math.abs(contrib),               // 상위5 정렬 기준
      weightedScore: contrib,                  // 부호 기여도
      status: 'implemented',
    };
  }
  return { total, items: items as HorseScoreResult['items'] };
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run src/engine/logisticScorer.test.ts` → PASS. (`ITEM_NAMES` 위치가 다르면 `src/types/index.ts`에서 export 확인 후 import 경로 조정.)
- [ ] **Step 5: 빌드** — `npm run build` → logisticScorer 관련 타입 에러 없음.
- [ ] **Step 6: 커밋**
```bash
git add src/engine/logisticScorer.ts src/engine/logisticScorer.test.ts
git commit -m "feat(engine): 로지스틱 라이브 스코어러 (기여도→항목 어댑터)"
```

---

## Task 4: modelVersion.ts 확장 (model_type/artifact 로드)

**Files:** Modify `src/engine/modelVersion.ts`

- [ ] **Step 1: 구현** — `src/engine/modelVersion.ts` 전체를 아래로 교체:

```typescript
/**
 * 활성 모델 버전 조회. 라이브 예측은 is_active=true 행을 사용.
 * model_type='logistic'이면 artifact(LogisticModel)로 라이브 스코어링.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ITEM_WEIGHTS } from '../types/index.js';
import type { LogisticModel } from './models/logistic.js';

export interface ActiveModelVersion {
  id: number | null;
  label: string;
  model_type: string;                 // 'rho-legacy' | 'logistic'
  weights: Record<string, number>;
  artifact: LogisticModel | null;
}

export async function getActiveModelVersion(
  sb: SupabaseClient
): Promise<ActiveModelVersion> {
  const { data, error } = await sb
    .from('model_versions')
    .select('id, label, model_type, weights, artifact')
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    return {
      id: data.id as number,
      label: data.label as string,
      model_type: (data.model_type as string) ?? 'rho-legacy',
      weights: (data.weights as Record<string, number>) ?? {},
      artifact: (data.artifact as LogisticModel | null) ?? null,
    };
  }
  return { id: null, label: 'v1-fallback', model_type: 'rho-legacy', weights: { ...ITEM_WEIGHTS }, artifact: null };
}
```

- [ ] **Step 2: 빌드** — `npm run build` → 에러 없음(특히 predictRace가 이 인터페이스 사용 — Task 5에서 갱신).
- [ ] **Step 3: 커밋**
```bash
git add src/engine/modelVersion.ts
git commit -m "feat(engine): getActiveModelVersion model_type/artifact 로드"
```

---

## Task 5: predictRace 로지스틱 분기

**Files:** Modify `src/engine/scorePredictor.ts:168-175`

- [ ] **Step 1: 구현** — `scorePredictor.ts`에서 아래 블록을 찾아:

```typescript
  // 활성 모델 버전 가중치로 엔진 구성 (라이브 = 현재 버전)
  const activeVersion = await getActiveModelVersion(sb);
  const engine = new ScoreEngine(activeVersion.weights);

  const results = rows.map((row) => ({
    row,
    score: engine.calculateScores(row.input),
  }));
```

다음으로 교체:

```typescript
  // 활성 모델 버전으로 스코어링 (rho-legacy=ScoreEngine / logistic=logisticScorer)
  const activeVersion = await getActiveModelVersion(sb);
  const scoreOne = activeVersion.model_type === 'logistic' && activeVersion.artifact
    ? (input: typeof rows[number]['input']) => scoreLogistic(activeVersion.artifact!, input)
    : (() => { const engine = new ScoreEngine(activeVersion.weights); return (input: typeof rows[number]['input']) => engine.calculateScores(input); })();

  const results = rows.map((row) => ({ row, score: scoreOne(row.input) }));
```

- [ ] **Step 2: import 추가** — `scorePredictor.ts` 상단 import에 추가:
```typescript
import { scoreLogistic } from './logisticScorer.js';
```

- [ ] **Step 3: 빌드** — `npm run build` → 에러 없음.
- [ ] **Step 4: 커밋**
```bash
git add src/engine/scorePredictor.ts
git commit -m "feat(engine): predictRace 로지스틱 분기 (model_type 기반)"
```

---

## Task 6: learn:logistic 후보 학습 스크립트

**Files:** Create `scripts/learn_logistic.ts`, Modify `package.json`

- [ ] **Step 1: 작성** → `scripts/learn_logistic.ts`:

```typescript
/**
 * Stage-1 로지스틱 후보 버전 학습·삽입 (is_active=false).
 * 전 확정경주 학습행렬(training_matrix.jsonl) → fitLogistic → model_versions(artifact).
 * 사용: npm run learn:logistic -- --matrix data/training_matrix.jsonl --label v4-logit
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { top3: number; features: Feature[]; }

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const label = arg('--label', 'v4-logit');

  const rows: Row[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const schema = buildSchema(rows.map((r) => r.features));
  const model = fitLogistic(rows.map((r) => toVector(r.features, schema)), rows.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });
  console.log(`학습완료: ${rows.length}행, 피처 ${schema.length}, intercept ${model.intercept.toFixed(3)}`);

  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from('model_versions').insert({
    label, model_type: 'logistic', weights: {}, artifact: model, source: 'learned', is_active: false,
    notes: `Stage-1 로지스틱 후보. 학습행렬 ${matrixPath} ${rows.length}행.`,
  }).select('id').single();
  if (error) throw error;
  console.log(`✅ 후보 삽입: id=${data!.id} label=${label} (is_active=false). 검증 후 promote.`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: npm 스크립트** — `package.json` scripts에 추가:
```json
    "learn:logistic": "tsx scripts/learn_logistic.ts",
    "verify:logistic": "tsx scripts/verify_logistic.ts",
```

- [ ] **Step 3: 빌드** — `npm run build` → 에러 없음.
- [ ] **Step 4: 커밋**
```bash
git add scripts/learn_logistic.ts package.json
git commit -m "feat(scripts): learn:logistic 후보 버전 학습·삽입"
```

---

## Task 7: verify:logistic (파리티 + 섐도우)

**Files:** Create `scripts/verify_logistic.ts`

- [ ] **Step 1: 작성** → `scripts/verify_logistic.ts`:

```typescript
/**
 * 로지스틱 라이브 전환 전 검증 (읽기전용).
 *  - 파리티: 오프라인(행렬→predictLogit) vs 라이브(gatherRaceInputs→scoreLogistic) 총점/순위 일치.
 *  - 섐도우: 라이브 로지스틱 순위 top3 적중 vs predictions(v1) 적중 비교.
 * 사용: npm run verify:logistic -- --label v4-logit --matrix data/training_matrix.jsonl --split 20250101 --races 80
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { gatherRaceInputs } from '../src/engine/scorePredictor.js';
import { scoreLogistic } from '../src/engine/logisticScorer.js';
import { fitLogistic, predictLogit, type LogisticModel } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number | null; top3: number; features: Feature[]; }

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const split = Number(arg('--split', '20250101'));
  const maxRaces = Number(arg('--races', '80'));

  const all: Row[] = readFileSync(matrixPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const train = all.filter((r) => r.race_date < split);
  const test = all.filter((r) => r.race_date >= split);
  const schema = buildSchema(train.map((r) => r.features));
  const model: LogisticModel = fitLogistic(train.map((r) => toVector(r.features, schema)), train.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });

  // 테스트 경주 샘플
  const byRace = new Map<string, Row[]>();
  for (const r of test) { const k = `${r.race_date}-${r.meet}-${r.rc_no}`; if (!byRace.has(k)) byRace.set(k, []); byRace.get(k)!.push(r); }
  const raceKeys = [...byRace.keys()].slice(0, maxRaces);

  const sb = getSupabaseAdmin();
  let parityRaces = 0, parityMismatch = 0;
  let liveHit = 0, total = 0;

  for (const rk of raceKeys) {
    const [d, m, n] = rk.split('-').map(Number);
    // 오프라인 순위 (행렬 피처 → predictLogit)
    const offline = byRace.get(rk)!.map((r) => ({ hr: r.hr_name, s: predictLogit(model, toVector(r.features, schema)), ord: r.ord }));
    // 라이브 순위 (gatherRaceInputs → scoreLogistic)
    const inputs = await gatherRaceInputs(sb, d!, m!, n!);
    const live = inputs.map((row) => ({ hr: row.hr_name, s: scoreLogistic(model, row.input).total, ord: row.ord }));

    // 파리티: 같은 hr 총점 비교(허용오차)
    const liveByHr = new Map(live.map((x) => [x.hr, x.s]));
    let mism = false;
    for (const o of offline) {
      const lv = liveByHr.get(o.hr);
      if (lv == null || Math.abs(lv - o.s) > 1e-6) mism = true;
    }
    parityRaces++; if (mism) parityMismatch++;

    // 섐도우: 라이브 로지스틱 top3 적중 (예측1위가 실제 top3인가 = 연승)
    const sorted = [...live].filter((x) => x.ord != null).sort((a, b) => b.s - a.s);
    if (sorted.length) { total++; if ((sorted[0]!.ord as number) <= 3) liveHit++; }
  }

  console.log(`\n[파리티] 경주 ${parityRaces} 중 불일치 ${parityMismatch} → ${parityMismatch === 0 ? '✅ 라이브==오프라인' : '❌ 불일치(피처 재계산 버그 의심)'}`);
  console.log(`[섐도우] 라이브 로지스틱 연승(1픽 top3) 적중: ${total ? (liveHit / total * 100).toFixed(1) : 0}% (n=${total})`);
  console.log('판정(사람): 파리티 ✅ + 섐도우가 v1 수준(연승 ~57%+) 이상이면 promote 고려.');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: 빌드** — `npm run build` → 에러 없음.
- [ ] **Step 3: 스모크** — `.env`+matrix 필요. `npm run verify:logistic -- --races 40`
  Expected: `[파리티] ... ✅ 라이브==오프라인` + `[섐도우] ... 적중 XX%`. 파리티 불일치면 featureItemMap/라이브경로 디버그. 에러 없이 종료.
- [ ] **Step 4: 커밋**
```bash
git add scripts/verify_logistic.ts
git commit -m "feat(scripts): verify:logistic 파리티+섐도우 검증"
```

---

## 운영 순서 (구현 완료 후, 사람이 수행)
1. 마이그레이션 012 Supabase 적용.
2. (필요시) `npm run extract:matrix`로 학습행렬 최신화.
3. `npm run learn:logistic -- --label v4-logit` → 후보 삽입.
4. `npm run verify:logistic` → 파리티 ✅ + 섐도우 확인.
5. 통과 시 `npm run promote -- --version <id>` → 라이브 전환. (실패 시 보류·디버그.)

---

## Self-Review (작성자 체크 완료)
- **Spec coverage:** §3.1 마이그레이션=Task1 / §3.2 modelVersion=Task4 / §3.3 featureItemMap=Task2 / §3.4 logisticScorer=Task3 / §3.5 predictRace 분기=Task5 / §3.6 learn:logistic=Task6 / §3.7 promote=재사용(운영순서5) / §4 검증(파리티·섐도우)=Task7. 누락 없음.
- **Type consistency:** `ActiveModelVersion`에 model_type/artifact 추가(Task4)를 predictRace(Task5)가 사용. `LogisticModel`·`predictLogit`·`ItemScore`·`HorseScoreResult`·`buildFeatures`·`toVector`는 기존 시그니처대로 import. `itemContributions`/`scoreLogistic`/`featureToItem` 시그니처가 테스트·스코어러·검증에서 일관. `ITEM_NAMES` import는 Task3 Step4에서 위치 확인 명시.
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝 실제 코드.
- **Open items:** ⑳ score_items 시드=Task1에 포함. ITEM_NAMES export 위치=Task3에서 확인. 매핑 누락=context 폴백으로 런타임 안전.
