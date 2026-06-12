# Score Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가중치를 Spearman ρ에 직접 매핑하고, 신호 없는 항목(⑦④) SEALED, ① 레이팅 재설계, E/G 기수·조교사 최근형·⑲ 주행성향×페이스 신규 추가로 예측 정확도를 개선한다.

**Architecture:** 3단계 직렬 배포. 각 단계마다 Spearman α=1.0 재학습으로 효과 검증. 새 항목(09b/10b/19)은 race-level 배치 fetch를 활용해 N+1 쿼리를 방지한다.

**Tech Stack:** TypeScript, Vitest, Supabase JS Client, `src/engine/`, `src/types/index.ts`

---

## 현재 상태 (작업 시작 전 확인)

**이미 구현됨 (미커밋):**
- `01_rating.ts` — T-015 경주 내 percentile 알고리즘 완료
- `01_rating.test.ts` — 전체 테스트 완료
- `engine/index.ts` — `allRaceRatings?: number[]` 추가됨
- `scorePredictor.ts` — `allRaceRatings` 수집 및 전달 완료

**아직 남은 작업:** Task 1~5

---

## File Map

| 파일 | 역할 | 변경 |
|---|---|---|
| `src/types/index.ts` | 항목 ID·가중치·이름 레지스트리 | 수정 (SEALED 0, 신규 항목 추가) |
| `src/engine/weightLearner.ts` | SEALED_ITEMS 집합, blendWeights | 수정 (⑦④ SEALED, alpha 파라미터) |
| `scripts/apply_learned_weights.ts` | 가중치 학습+적용 CLI | 수정 (--alpha 옵션) |
| `src/engine/scoreItems/09b_jockey_recent.ts` | 기수 최근 3개월 단승률 | 신규 |
| `src/engine/scoreItems/09b_jockey_recent.test.ts` | 테스트 | 신규 |
| `src/engine/scoreItems/10b_trainer_recent.ts` | 조교사 최근 3개월 복승률 | 신규 |
| `src/engine/scoreItems/10b_trainer_recent.test.ts` | 테스트 | 신규 |
| `src/engine/scoreItems/19_running_style_pace.ts` | 주행성향 × 페이스 매핑 | 신규 |
| `src/engine/scoreItems/19_running_style_pace.test.ts` | 테스트 | 신규 |
| `src/engine/index.ts` | ScoreEngineInput + ScoreEngine | 수정 (신규 항목 등록) |
| `src/engine/scorePredictor.ts` | race-level 배치 fetch, paceType 계산 | 수정 |

---

## Task 1: T-015 기존 변경 커밋

**Files:**
- Commit: `src/engine/scoreItems/01_rating.ts`, `01_rating.test.ts`, `src/engine/index.ts`, `src/engine/scorePredictor.ts`, `src/engine/weightLearner.ts`, `scripts/apply_learned_weights.ts`

- [ ] **Step 1: 테스트 실행 확인**

```bash
npm run test:run -- --reporter=verbose src/engine/scoreItems/01_rating.test.ts
```
Expected: 11 tests PASS

- [ ] **Step 2: 커밋**

```bash
git add src/engine/scoreItems/01_rating.ts \
        src/engine/scoreItems/01_rating.test.ts \
        src/engine/index.ts \
        src/engine/scorePredictor.ts \
        src/engine/weightLearner.ts \
        scripts/apply_learned_weights.ts
git commit -m "feat(score): T-015 ① 레이팅 경주 내 percentile 재설계

- allRaceRatings 수집 → 경주 내 등급 말 중 betterCount 기반 percentile
- 미등급(rating=0): 0.5 중립 / 유일 등급: 0.75 / fallback: rating/140
- scorePredictor.ts: allRaceRatings = entryList.map(e => e.ratg ?? 0)"
```

---

## Task 2: SEALED 항목 추가 + blendWeights alpha 파라미터

**Files:**
- Modify: `src/engine/weightLearner.ts`
- Modify: `src/types/index.ts`
- Modify: `scripts/apply_learned_weights.ts`

- [ ] **Step 1: weightLearner.ts — SEALED_ITEMS에 ⑦④ 추가**

`src/engine/weightLearner.ts` 의 `SEALED_ITEMS` 블록을:

```ts
const SEALED_ITEMS = new Set<ScoreItemId>([
  '13_age_distance_gender',  // ρ=-0.017 역방향, 영구 비활성화
  '07_track_adaptation',     // ρ=-0.304, 가중치 낭비 최대
  '04_sectional_time',       // ρ=-0.225, ⑤와 같은 데이터인데 역상관
]);
```

- [ ] **Step 2: weightLearner.ts — blendWeights alpha 파라미터 추가**

`blendWeights` 함수 전체를 교체:

```ts
/**
 * 점진 수렴: alpha=0.5 → (현재 + 적정) / 2, alpha=1.0 → 직접 매핑
 */
export function blendWeights(
  current: Weights,
  optimal: Weights,
  alpha = 0.5
): Weights {
  const blended = {} as Weights;
  for (const itemId of ALL_ITEMS) {
    if (SEALED_ITEMS.has(itemId)) {
      blended[itemId] = 0;
      continue;
    }
    blended[itemId] =
      Math.round(
        (current[itemId] * (1 - alpha) + optimal[itemId] * alpha) * 100
      ) / 100;
  }
  // 합이 100이 되도록 정규화 (봉인 제외)
  const s = Object.values(blended).reduce((a, b) => a + b, 0);
  if (s > 0) {
    for (const itemId of ALL_ITEMS) {
      if (SEALED_ITEMS.has(itemId)) continue;
      blended[itemId] =
        Math.round(((blended[itemId] / s) * 100) * 100) / 100;
    }
  }
  return blended;
}
```

- [ ] **Step 3: types/index.ts — ITEM_WEIGHTS에서 ⑦④ 0으로 설정**

`ITEM_WEIGHTS`에서 두 항목을 수정:

```ts
'04_sectional_time': 0,    // SEALED: ρ=-0.225
'07_track_adaptation': 0,  // SEALED: ρ=-0.304
```

- [ ] **Step 4: apply_learned_weights.ts — --alpha 옵션 추가**

`main()` 함수 상단에 추가 (import 바로 아래):

```ts
const args = process.argv.slice(2);
const alphaFlag = args.find(a => a.startsWith('--alpha='));
const alpha = alphaFlag ? parseFloat(alphaFlag.replace('--alpha=', '')) : 0.5;
```

그리고 `blendWeights` 호출 변경:

```ts
const blended = blendWeights(current, optimal, alpha);
```

그리고 로그에 alpha 표시 추가 (학습 경주 로그 다음 줄):

```ts
console.log(`  alpha: ${alpha} (${alpha === 1.0 ? 'ρ 직접 매핑' : '점진 수렴'})`);
```

- [ ] **Step 5: weightLearner 테스트 실행**

```bash
npm run test:run
```
Expected: all existing tests PASS (blendWeights 시그니처 변경이지만 default alpha=0.5라 기존 동작 유지)

- [ ] **Step 6: 커밋**

```bash
git add src/engine/weightLearner.ts src/types/index.ts scripts/apply_learned_weights.ts
git commit -m "feat(weights): ⑦④ SEALED + blendWeights alpha 파라미터 추가

- SEALED_ITEMS: 07_track_adaptation(ρ=-0.304), 04_sectional_time(ρ=-0.225) 추가
- blendWeights(current, optimal, alpha=0.5): alpha=1.0으로 ρ 직접 매핑 가능
- apply_learned_weights.ts: --alpha=1.0 옵션 추가
- ITEM_WEIGHTS: 04/07 = 0 (default fallback도 0으로 일치)"
```

- [ ] **Step 7: [사용자 직접 실행] Spearman 재학습**

```bash
npx ts-node --esm scripts/apply_learned_weights.ts --alpha=1.0
```

Expected output 예시:
```
📚 가중치 학습 + 적용
==================================================
[1/4] 전체 데이터 Spearman 계산...
  학습 경주: 3585
  alpha: 1 (ρ 직접 매핑)
[2/4] weight_history 저장...
...
=== 새 가중치 적중률 (...) ===
  단승  : .../... = ...%
```

- [ ] **Step 8: [사용자] SQL로 새 가중치 확인**

Supabase SQL Editor:
```sql
SELECT weights FROM weight_history ORDER BY applied_at DESC LIMIT 1;
```
Expected: `06_distance_fitness` 가중치가 24+ (압도적 1위), `07_track_adaptation` = 0

---

## Task 3: E 기수 최근 3개월형 (`09b_jockey_recent`)

**Files:**
- Create: `src/engine/scoreItems/09b_jockey_recent.ts`
- Create: `src/engine/scoreItems/09b_jockey_recent.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

`src/engine/scoreItems/09b_jockey_recent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calculateJockeyRecentScore } from './09b_jockey_recent';

describe('⑨b 기수 최근 3개월형', () => {
  it('데이터 없음 → 0.5 중립', () => {
    expect(calculateJockeyRecentScore({ recentOrds: [] })).toBe(0.5);
  });

  it('3전 전승 → 1.0', () => {
    expect(calculateJockeyRecentScore({ recentOrds: [1, 1, 1] })).toBe(1.0);
  });

  it('3전 전패 → 0.0', () => {
    expect(calculateJockeyRecentScore({ recentOrds: [5, 4, 3] })).toBe(0.0);
  });

  it('5전 2승 → 0.4', () => {
    expect(calculateJockeyRecentScore({ recentOrds: [1, 1, 2, 3, 4] })).toBe(0.4);
  });

  it('1전 1승 → 1.0', () => {
    expect(calculateJockeyRecentScore({ recentOrds: [1] })).toBe(1.0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm run test:run -- src/engine/scoreItems/09b_jockey_recent.test.ts
```
Expected: FAIL (파일 없음)

- [ ] **Step 3: 구현 파일 작성**

`src/engine/scoreItems/09b_jockey_recent.ts`:

```ts
export interface JockeyRecentInput {
  /** 최근 90일 완주 경기 착순 배열 (1=1위, ...) */
  recentOrds: number[];
}

export function calculateJockeyRecentScore(input: JockeyRecentInput): number {
  const { recentOrds } = input;
  if (!recentOrds || recentOrds.length === 0) return 0.5;
  const wins = recentOrds.filter(o => o === 1).length;
  return wins / recentOrds.length;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm run test:run -- src/engine/scoreItems/09b_jockey_recent.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/scoreItems/09b_jockey_recent.ts \
        src/engine/scoreItems/09b_jockey_recent.test.ts
git commit -m "feat(score): ⑨b 기수 최근 3개월 단승률 항목 추가"
```

---

## Task 4: G 조교사 최근 3개월형 (`10b_trainer_recent`)

**Files:**
- Create: `src/engine/scoreItems/10b_trainer_recent.ts`
- Create: `src/engine/scoreItems/10b_trainer_recent.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

`src/engine/scoreItems/10b_trainer_recent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calculateTrainerRecentScore } from './10b_trainer_recent';

describe('⑩b 조교사 최근 3개월형', () => {
  it('데이터 없음 → 0.5 중립', () => {
    expect(calculateTrainerRecentScore({ recentOrds: [] })).toBe(0.5);
  });

  it('4전 전원 1~2위 → 1.0', () => {
    expect(calculateTrainerRecentScore({ recentOrds: [1, 2, 1, 2] })).toBe(1.0);
  });

  it('4전 전원 3위+ → 0.0', () => {
    expect(calculateTrainerRecentScore({ recentOrds: [3, 4, 5, 6] })).toBe(0.0);
  });

  it('5전 2회 복승(1~2위) → 0.4', () => {
    expect(calculateTrainerRecentScore({ recentOrds: [1, 2, 3, 4, 5] })).toBe(0.4);
  });

  it('3전 1회 1위, 1회 2위 → 0.667', () => {
    expect(calculateTrainerRecentScore({ recentOrds: [1, 2, 4] })).toBeCloseTo(0.667, 2);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm run test:run -- src/engine/scoreItems/10b_trainer_recent.test.ts
```
Expected: FAIL

- [ ] **Step 3: 구현 파일 작성**

`src/engine/scoreItems/10b_trainer_recent.ts`:

```ts
export interface TrainerRecentInput {
  /** 최근 90일 완주 경기 착순 배열 (1=1위, ...) */
  recentOrds: number[];
}

export function calculateTrainerRecentScore(input: TrainerRecentInput): number {
  const { recentOrds } = input;
  if (!recentOrds || recentOrds.length === 0) return 0.5;
  const places = recentOrds.filter(o => o <= 2).length;
  return places / recentOrds.length;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm run test:run -- src/engine/scoreItems/10b_trainer_recent.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/scoreItems/10b_trainer_recent.ts \
        src/engine/scoreItems/10b_trainer_recent.test.ts
git commit -m "feat(score): ⑩b 조교사 최근 3개월 복승률 항목 추가"
```

---

## Task 5: E/G 항목 등록 및 데이터 연결

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/engine/index.ts`
- Modify: `src/engine/scorePredictor.ts`

- [ ] **Step 1: types/index.ts — 새 항목 ID 등록**

`SCORE_ITEM_IDS` 배열에 `'09_jockey_form'` 뒤에 `'09b_jockey_recent'` 추가, `'10_trainer_form'` 뒤에 `'10b_trainer_recent'` 추가:

```ts
export const SCORE_ITEM_IDS = [
  '01_rating',
  '02_weight_change',
  '03_recent_form',
  '04_sectional_time',
  '05_late_position',
  '06_distance_fitness',
  '07_track_adaptation',
  '08_burden_weight',
  '09_jockey_form',
  '09b_jockey_recent',     // ← 신규
  '10_trainer_form',
  '10b_trainer_recent',    // ← 신규
  '11_race_interval',
  '12_starting_position',
  '13_age_distance_gender',
  '14_pedigree',
  '15_seasonal_pattern',
  '16_jockey_horse_chemistry',
  '17_market_odds',
  '18_earnings',
] as const;
```

- [ ] **Step 2: ITEM_WEIGHTS + ITEM_NAMES 추가**

`ITEM_WEIGHTS`에 추가 (총합이 100이 되도록 ⑨⑩⑪⑮⑯ 조정):

```ts
export const ITEM_WEIGHTS: Record<ScoreItemId, number> = {
  '01_rating': 6.00,
  '02_weight_change': 1.00,
  '03_recent_form': 10.00,
  '04_sectional_time': 0,        // SEALED
  '05_late_position': 12.50,
  '06_distance_fitness': 24.00,
  '07_track_adaptation': 0,      // SEALED
  '08_burden_weight': 11.00,
  '09_jockey_form': 5.50,        // 7.5→5.5 (-2.0, 통산형 보조로 축소)
  '09b_jockey_recent': 4.00,     // 신규: 최근 3개월 단승률
  '10_trainer_form': 3.00,       // 4.5→3.0 (-1.5, 통산형 보조로 축소)
  '10b_trainer_recent': 2.50,    // 신규: 최근 3개월 복승률
  '11_race_interval': 3.00,      // 4.0→3.0 (-1.0)
  '12_starting_position': 4.50,
  '13_age_distance_gender': 0,   // SEALED
  '14_pedigree': 3.00,
  '15_seasonal_pattern': 2.00,
  '16_jockey_horse_chemistry': 2.00,
  '17_market_odds': 3.00,
  '18_earnings': 3.00,
};
// 합계 검증: 6+1+10+0+12.5+24+0+11+5.5+4+3+2.5+3+4.5+0+3+2+2+3+3 = 100 ✓
```

`ITEM_NAMES`에 추가:

```ts
'09b_jockey_recent': '기수 최근폼',
'10b_trainer_recent': '조교사 최근폼',
```

- [ ] **Step 3: engine/index.ts — ScoreEngineInput에 필드 추가**

`ScoreEngineInput`의 `// ⑨ 기수` 섹션 아래에 추가:

```ts
// ⑨b 기수 최근 3개월형
jockeyRecentOrds?: number[];

// ⑩b 조교사 최근 3개월형
trainerRecentOrds?: number[];
```

- [ ] **Step 4: engine/index.ts — import 및 ScoreEngine.calculateScores() 추가**

파일 상단 import에 추가:

```ts
import { calculateJockeyRecentScore } from './scoreItems/09b_jockey_recent.js';
import { calculateTrainerRecentScore } from './scoreItems/10b_trainer_recent.js';
```

`ScoreEngine.calculateScores()`의 `items['09_jockey_form']` 블록 바로 다음에 추가:

```ts
// ⑨b 기수 최근 3개월형
items['09b_jockey_recent'] = this.make(
  '09b_jockey_recent',
  calculateJockeyRecentScore({ recentOrds: input.jockeyRecentOrds ?? [] })
);

// ⑩b 조교사 최근 3개월형 (items['10_trainer_form'] 다음)
items['10b_trainer_recent'] = this.make(
  '10b_trainer_recent',
  calculateTrainerRecentScore({ recentOrds: input.trainerRecentOrds ?? [] })
);
```

- [ ] **Step 5: scorePredictor.ts — EntryRow에 필드 확인**

`EntryRow` 인터페이스에 `jcky_no`와 `trar_no`가 이미 있는지 확인 (이미 있음):
```ts
jcky_no: string | null;
trar_no: string | null;
```

- [ ] **Step 6: scorePredictor.ts — 배치 fetch 함수 추가**

`predictRace` 함수 안에서 `allRaceRatings` 수집 직후, 경주 거리 fetch 이전에 삽입:

```ts
// 기수·조교사 최근 90일 착순 배치 fetch (⑨b⑩b용)
const ninetyDaysAgo = dateMinusDays(rcDate, 90);
const jockeyNos = [...new Set(entryList.map(e => e.jcky_no).filter(Boolean) as string[])];
const trainerNos = [...new Set(entryList.map(e => e.trar_no).filter(Boolean) as string[])];

const [jockeyRecentRaw, trainerRecentRaw] = await Promise.all([
  jockeyNos.length > 0
    ? sb.from('race_entries')
        .select('jcky_no, ord')
        .in('jcky_no', jockeyNos)
        .gte('race_date', ninetyDaysAgo)
        .lt('race_date', rcDate)
        .not('ord', 'is', null)
        .lt('ord', 50)
    : Promise.resolve({ data: [] }),
  trainerNos.length > 0
    ? sb.from('race_entries')
        .select('trar_no, ord')
        .in('trar_no', trainerNos)
        .gte('race_date', ninetyDaysAgo)
        .lt('race_date', rcDate)
        .not('ord', 'is', null)
        .lt('ord', 50)
    : Promise.resolve({ data: [] }),
]);

const jockeyRecentMap = new Map<string, number[]>();
for (const r of (jockeyRecentRaw.data ?? []) as { jcky_no: string; ord: number }[]) {
  if (!jockeyRecentMap.has(r.jcky_no)) jockeyRecentMap.set(r.jcky_no, []);
  jockeyRecentMap.get(r.jcky_no)!.push(r.ord);
}
const trainerRecentMap = new Map<string, number[]>();
for (const r of (trainerRecentRaw.data ?? []) as { trar_no: string; ord: number }[]) {
  if (!trainerRecentMap.has(r.trar_no)) trainerRecentMap.set(r.trar_no, []);
  trainerRecentMap.get(r.trar_no)!.push(r.ord);
}
```

파일 끝 근처에 `dateMinusDays` 헬퍼 함수 추가:

```ts
function dateMinusDays(dateNum: number, days: number): number {
  const y = Math.floor(dateNum / 10000);
  const m = Math.floor((dateNum % 10000) / 100);
  const d = dateNum % 100;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - days);
  return (
    dt.getFullYear() * 10000 +
    (dt.getMonth() + 1) * 100 +
    dt.getDate()
  );
}
```

- [ ] **Step 7: scorePredictor.ts — buildEngineInput에 파라미터 전달**

`buildEngineInput` 시그니처 변경:

```ts
async function buildEngineInput(
  sb: SupabaseClient,
  e: EntryRow & { rc_dist: number | null; track_type: string | null },
  totalHorses: number,
  currentMonth: number,
  currentSeason: 'spring' | 'summer' | 'autumn' | 'winter',
  jockeyRecentMap: Map<string, number[]>,
  trainerRecentMap: Map<string, number[]>
): Promise<ScoreEngineInput>
```

함수 본문 끝 `return` 객체에 추가:

```ts
jockeyRecentOrds: e.jcky_no ? (jockeyRecentMap.get(e.jcky_no) ?? []) : [],
trainerRecentOrds: e.trar_no ? (trainerRecentMap.get(e.trar_no) ?? []) : [],
```

`predictRace` 내부의 `buildEngineInput` 호출에 인자 추가:

```ts
const input = await buildEngineInput(
  sb, enriched, totalHorses, currentMonth, currentSeason,
  jockeyRecentMap, trainerRecentMap
);
```

- [ ] **Step 8: 타입 체크**

```bash
npm run build
```
Expected: 0 errors

- [ ] **Step 9: 커밋**

```bash
git add src/types/index.ts src/engine/index.ts src/engine/scorePredictor.ts
git commit -m "feat(score): ⑨b⑩b 기수·조교사 최근 3개월형 항목 등록 및 데이터 연결

- SCORE_ITEM_IDS에 09b_jockey_recent, 10b_trainer_recent 추가
- 배치 fetch: race_entries에서 90일 기수·조교사 착순 → Map<jcky_no, number[]>
- N+1 방지: 경주 전체 기수/조교사 1회 쿼리
- dateMinusDays 헬퍼 추가"
```

- [ ] **Step 10: [사용자 직접 실행] backfill + Spearman 재학습**

```bash
npm run backfill
```
완료 후:
```bash
npx ts-node --esm scripts/apply_learned_weights.ts --alpha=1.0
```

- [ ] **Step 11: [사용자] SQL로 ⑨b⑩b ρ 확인**

```sql
WITH race_ranks AS (
  SELECT
    RANK() OVER (
      PARTITION BY p.race_date, p.meet, p.rc_no
      ORDER BY (p.item_scores->'09b_jockey_recent'->>'rawScore')::float DESC
    ) AS score_rank,
    RANK() OVER (
      PARTITION BY p.race_date, p.meet, p.rc_no
      ORDER BY p.actual_ord ASC
    ) AS finish_rank,
    COUNT(*) OVER (
      PARTITION BY p.race_date, p.meet, p.rc_no
    ) AS field_size
  FROM predictions p
  WHERE p.actual_ord IS NOT NULL
    AND (p.item_scores->'09b_jockey_recent'->>'rawScore') IS NOT NULL
)
SELECT
  ROUND(
    (1 - 6.0 * SUM(POWER(score_rank - finish_rank, 2))
      / NULLIF(SUM(field_size::float * (field_size::float * field_size::float - 1)), 0)
    )::numeric, 3
  ) AS rho_09b_jockey_recent,
  COUNT(*) AS n
FROM race_ranks;
```

---

## Task 6: ⑲ 주행성향 × 페이스 (`19_running_style_pace`)

**Files:**
- Create: `src/engine/scoreItems/19_running_style_pace.ts`
- Create: `src/engine/scoreItems/19_running_style_pace.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

`src/engine/scoreItems/19_running_style_pace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  calculateRunningStylePaceScore,
  classifyRunningStyleFromData,
  type PaceType,
} from './19_running_style_pace';

describe('classifyRunningStyleFromData', () => {
  it('avg=null → unknown', () => {
    expect(classifyRunningStyleFromData(null, null)).toBe('unknown');
  });
  it('stddev >= 0.35 → free (우선 판정)', () => {
    expect(classifyRunningStyleFromData(0.1, 0.35)).toBe('free');
  });
  it('avg <= 0.15 → front', () => {
    expect(classifyRunningStyleFromData(0.15, 0.1)).toBe('front');
  });
  it('avg <= 0.35 → pace', () => {
    expect(classifyRunningStyleFromData(0.25, 0.1)).toBe('pace');
  });
  it('avg <= 0.65 → stalker', () => {
    expect(classifyRunningStyleFromData(0.5, 0.1)).toBe('stalker');
  });
  it('avg > 0.65 → closer', () => {
    expect(classifyRunningStyleFromData(0.8, 0.1)).toBe('closer');
  });
});

describe('calculateRunningStylePaceScore', () => {
  it('도주 + HOT → 0.30 (불리)', () => {
    expect(
      calculateRunningStylePaceScore({
        avgPositionRatio: 0.1,
        stddevPositionRatio: 0.1,
        paceType: 'HOT',
      })
    ).toBe(0.30);
  });
  it('도주 + SLOW → 1.00 (유리)', () => {
    expect(
      calculateRunningStylePaceScore({
        avgPositionRatio: 0.1,
        stddevPositionRatio: 0.1,
        paceType: 'SLOW',
      })
    ).toBe(1.00);
  });
  it('추입 + HOT → 0.90 (유리)', () => {
    expect(
      calculateRunningStylePaceScore({
        avgPositionRatio: 0.8,
        stddevPositionRatio: 0.1,
        paceType: 'HOT',
      })
    ).toBe(0.90);
  });
  it('unknown → 0.55 중립', () => {
    expect(
      calculateRunningStylePaceScore({
        avgPositionRatio: null,
        stddevPositionRatio: null,
        paceType: 'NORMAL',
      })
    ).toBe(0.55);
  });
  it('자유마 → 페이스 관계없이 0.60', () => {
    const input = { avgPositionRatio: 0.1, stddevPositionRatio: 0.4 };
    expect(calculateRunningStylePaceScore({ ...input, paceType: 'HOT' })).toBe(0.60);
    expect(calculateRunningStylePaceScore({ ...input, paceType: 'SLOW' })).toBe(0.60);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm run test:run -- src/engine/scoreItems/19_running_style_pace.test.ts
```
Expected: FAIL

- [ ] **Step 3: 구현 파일 작성**

`src/engine/scoreItems/19_running_style_pace.ts`:

```ts
export type RunningStyleClass =
  | 'front'
  | 'pace'
  | 'stalker'
  | 'closer'
  | 'free'
  | 'unknown';

export type PaceType = 'HOT' | 'NORMAL' | 'SLOW';

export function classifyRunningStyleFromData(
  avgPositionRatio: number | null | undefined,
  stddevPositionRatio: number | null | undefined
): RunningStyleClass {
  if (avgPositionRatio == null) return 'unknown';
  if (stddevPositionRatio != null && stddevPositionRatio >= 0.35) return 'free';
  if (avgPositionRatio <= 0.15) return 'front';
  if (avgPositionRatio <= 0.35) return 'pace';
  if (avgPositionRatio <= 0.65) return 'stalker';
  return 'closer';
}

const SCORE_MAP: Record<RunningStyleClass, Record<PaceType, number>> = {
  front:   { HOT: 0.30, NORMAL: 0.65, SLOW: 1.00 },
  pace:    { HOT: 0.50, NORMAL: 0.70, SLOW: 0.85 },
  stalker: { HOT: 0.65, NORMAL: 0.60, SLOW: 0.45 },
  closer:  { HOT: 0.90, NORMAL: 0.55, SLOW: 0.25 },
  free:    { HOT: 0.60, NORMAL: 0.60, SLOW: 0.60 },
  unknown: { HOT: 0.55, NORMAL: 0.55, SLOW: 0.55 },
};

export interface RunningStylePaceInput {
  avgPositionRatio: number | null | undefined;
  stddevPositionRatio: number | null | undefined;
  paceType: PaceType;
}

export function calculateRunningStylePaceScore(
  input: RunningStylePaceInput
): number {
  const style = classifyRunningStyleFromData(
    input.avgPositionRatio,
    input.stddevPositionRatio
  );
  return SCORE_MAP[style][input.paceType];
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm run test:run -- src/engine/scoreItems/19_running_style_pace.test.ts
```
Expected: all tests PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/scoreItems/19_running_style_pace.ts \
        src/engine/scoreItems/19_running_style_pace.test.ts
git commit -m "feat(score): ⑲ 주행성향×페이스 매핑 함수 추가"
```

---

## Task 7: ⑲ 항목 등록 및 scorePredictor 연동

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/engine/index.ts`
- Modify: `src/engine/scorePredictor.ts`

- [ ] **Step 1: types/index.ts — `19_running_style_pace` 등록**

`SCORE_ITEM_IDS`에 `'18_earnings'` 다음에 추가:

```ts
'19_running_style_pace',  // ← 신규
```

`ITEM_WEIGHTS`에 추가 (총 100 유지: 3.5 확보를 위해 ⑯ -1.5, ⑮ -1.5, ② -0.5):

```ts
'02_weight_change': 0.50,           // 1.0→0.5 (-0.5)
// ...
'15_seasonal_pattern': 0.50,        // 2.0→0.5 (-1.5)
'16_jockey_horse_chemistry': 0.50,  // 2.0→0.5 (-1.5)
// ...
'18_earnings': 3.00,
'19_running_style_pace': 3.50,      // ← 신규
```
// 합계 검증: 0.5 대신 이전 값 2.0, 2.0, 1.0 에서 각각 빼고 19 추가 = net 0 ✓

`ITEM_NAMES`에 추가:

```ts
'19_running_style_pace': '주행성향×페이스',
```

- [ ] **Step 2: engine/index.ts — ScoreEngineInput에 필드 추가**

`// ⑱ 수득상금` 섹션 다음에 추가:

```ts
// ⑲ 주행성향 × 페이스
runningStyleAvgRatio?: number | null;
runningStyleStddev?: number | null;
paceType?: PaceType;
```

파일 상단 import에 추가:

```ts
import {
  calculateRunningStylePaceScore,
  type PaceType,
} from './scoreItems/19_running_style_pace.js';
```

`ScoreEngine.calculateScores()`의 `items['18_earnings']` 다음에 추가:

```ts
// ⑲ 주행성향 × 페이스
items['19_running_style_pace'] = this.make(
  '19_running_style_pace',
  calculateRunningStylePaceScore({
    avgPositionRatio: input.runningStyleAvgRatio ?? null,
    stddevPositionRatio: input.runningStyleStddev ?? null,
    paceType: input.paceType ?? 'NORMAL',
  })
);
```

- [ ] **Step 3: scorePredictor.ts — 헬퍼 함수 추가**

파일 끝에 추가 (dateMinusDays 아래):

```ts
function getRcDistCategory(rcDist: number): 'short' | 'middle' | 'long' {
  if (rcDist < 1400) return 'short';
  if (rcDist <= 1800) return 'middle';
  return 'long';
}

function computePaceType(
  styleMap: Map<string, { avg: number | null; std: number | null }>
): 'HOT' | 'NORMAL' | 'SLOW' {
  let frontCount = 0;
  for (const { avg, std } of styleMap.values()) {
    if (avg == null) continue;
    const isFree = std != null && std >= 0.35;
    if (!isFree && avg <= 0.35) frontCount++; // front (≤0.15) + pace (≤0.35)
  }
  if (frontCount >= 3) return 'HOT';
  if (frontCount <= 1) return 'SLOW';
  return 'NORMAL';
}
```

- [ ] **Step 4: scorePredictor.ts — 배치 fetch + paceType 계산**

`predictRace`에서 jockeyRecentMap 수집 직후에 추가:

```ts
// 주행성향 배치 fetch (⑲용) — horse_running_style_by_distance 뷰
const distCat = getRcDistCategory(rcDist ?? 1600);
const hrNames = entryList.map(e => e.hr_name);
const { data: styleRows } = await sb
  .from('horse_running_style_by_distance')
  .select('hr_name, avg_position_ratio, stddev_position_ratio')
  .in('hr_name', hrNames)
  .eq('dist_category', distCat);

const styleMap = new Map<string, { avg: number | null; std: number | null }>();
for (const row of (styleRows ?? []) as {
  hr_name: string;
  avg_position_ratio: number | null;
  stddev_position_ratio: number | null;
}[]) {
  styleMap.set(row.hr_name, {
    avg: row.avg_position_ratio,
    std: row.stddev_position_ratio,
  });
}
const paceType = computePaceType(styleMap);
```

- [ ] **Step 5: scorePredictor.ts — buildEngineInput 파라미터 추가**

`buildEngineInput` 시그니처에 파라미터 추가 (Task 5에서 추가한 파라미터 포함, 최종 전체 시그니처):

```ts
async function buildEngineInput(
  sb: SupabaseClient,
  e: EntryRow & { rc_dist: number | null; track_type: string | null },
  totalHorses: number,
  currentMonth: number,
  currentSeason: 'spring' | 'summer' | 'autumn' | 'winter',
  jockeyRecentMap: Map<string, number[]>,
  trainerRecentMap: Map<string, number[]>,
  styleMap: Map<string, { avg: number | null; std: number | null }>,
  paceType: 'HOT' | 'NORMAL' | 'SLOW'
): Promise<ScoreEngineInput>
```

함수 본문 `return` 객체에 추가:

```ts
runningStyleAvgRatio: styleMap.get(e.hr_name)?.avg ?? null,
runningStyleStddev: styleMap.get(e.hr_name)?.std ?? null,
paceType,
```

`predictRace` 내부 `buildEngineInput` 호출에 인자 추가:

```ts
const input = await buildEngineInput(
  sb, enriched, totalHorses, currentMonth, currentSeason,
  jockeyRecentMap, trainerRecentMap, styleMap, paceType
);
```

- [ ] **Step 6: 타입 체크**

```bash
npm run build
```
Expected: 0 errors

- [ ] **Step 7: 전체 테스트**

```bash
npm run test:run
```
Expected: all tests PASS

- [ ] **Step 8: 커밋**

```bash
git add src/types/index.ts src/engine/index.ts src/engine/scorePredictor.ts
git commit -m "feat(score): ⑲ 주행성향×페이스 항목 등록 및 scorePredictor 연동

- SCORE_ITEM_IDS에 19_running_style_pace 추가
- horse_running_style_by_distance 배치 fetch → paceType 계산 (race-level 1회)
- getRcDistCategory, computePaceType 헬퍼 추가
- buildEngineInput에 styleMap, paceType 전달"
```

- [ ] **Step 9: [사용자 직접 실행] 최종 backfill + Spearman 재학습**

```bash
npm run backfill
npx ts-node --esm scripts/apply_learned_weights.ts --alpha=1.0
```

- [ ] **Step 10: [사용자] 최종 ρ 비교 SQL**

```sql
-- ⑲ Spearman ρ 확인
WITH race_ranks AS (
  SELECT
    RANK() OVER (
      PARTITION BY p.race_date, p.meet, p.rc_no
      ORDER BY (p.item_scores->'19_running_style_pace'->>'rawScore')::float DESC
    ) AS score_rank,
    RANK() OVER (
      PARTITION BY p.race_date, p.meet, p.rc_no
      ORDER BY p.actual_ord ASC
    ) AS finish_rank,
    COUNT(*) OVER (PARTITION BY p.race_date, p.meet, p.rc_no) AS field_size
  FROM predictions p
  WHERE p.actual_ord IS NOT NULL
    AND (p.item_scores->'19_running_style_pace'->>'rawScore') IS NOT NULL
)
SELECT
  ROUND(
    (1 - 6.0 * SUM(POWER(score_rank - finish_rank, 2))
      / NULLIF(SUM(field_size::float * (field_size::float * field_size::float - 1)), 0)
    )::numeric, 3
  ) AS rho_19_running_style_pace,
  COUNT(*) AS n
FROM race_ranks;
```

Expected: ρ > 0.2 (전략적 신호, ⑤와 유사한 수준 기대)

---

## 세션 Handoff 체크리스트

새 세션 시작 시 확인:
- [ ] Task 1 커밋됨? (`git log --oneline -5`로 확인)
- [ ] Task 2 커밋됨 + Spearman alpha=1.0 실행됨?
- [ ] Task 3~5 커밋됨 + backfill + Spearman 실행됨?
- [ ] Task 6~7 커밋됨 + backfill + Spearman 실행됨?
- 스펙: `docs/superpowers/specs/2026-05-28-score-redesign-design.md`
- 주행성향 인사이트: `docs/running_style_insight.md`
