# 점수 학습 재설계 — 계획 A: feature 기반 + 학습행렬 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 각 항목의 raw 측정값을 뽑는 de-biased feature 빌더와, 과거 전 경주의 (feature, top3 라벨) 학습행렬을 만든다. (모델 학습은 계획 B)

**Architecture:** 기존 `buildEngineInput`(scorePredictor.ts)이 모으는 `ScoreEngineInput`을 그대로 raw 소스로 재사용한다. 신규 순수함수 `buildFeatures(input)`가 ⓑ 가치판단(임계값·맵·multiplier)을 거치지 않고 raw 숫자 feature 벡터를 낸다. 추출 스크립트가 과거 경주를 순회하며 행렬(JSONL)을 쓴다. **win_odds는 feature에서 제외**(설계 결정 6).

**Tech Stack:** TypeScript, Node, tsx, vitest, Supabase. (Python·모델은 계획 B)

**스펙:** `docs/superpowers/specs/2026-06-04-score-learning-redesign-design.md`

---

## 파일 구조

- Create: `src/engine/features/types.ts` — `Feature`, `FeatureVector` 타입
- Create: `src/engine/features/buildFeatures.ts` — `buildFeatures(input: ScoreEngineInput): FeatureVector` 순수함수
- Create: `src/engine/features/buildFeatures.test.ts` — 단위테스트
- Modify: `src/engine/scorePredictor.ts` — `gatherRaceInputs()` export 추출 (predictRace가 이를 재사용)
- Create: `scripts/extract_training_matrix.ts` — 과거 경주 순회 → JSONL 행렬
- Create: `data/.gitkeep` — 행렬 출력 디렉터리 (산출물은 gitignore)
- Modify: `.gitignore` — `data/*.jsonl` 추가

---

## Task 1: Feature 타입 정의

**Files:**
- Create: `src/engine/features/types.ts`

- [ ] **Step 1: 타입 작성**

```typescript
/**
 * de-biased feature — 항목의 raw 측정값 하나.
 * value는 raw 숫자(표준화 전). missing이면 value=0 + `<name>__missing`=1 동반.
 */
export interface Feature {
  name: string;
  value: number;
}

export type FeatureVector = Feature[];
```

- [ ] **Step 2: 커밋**

```bash
git add src/engine/features/types.ts
git commit -m "feat(features): Feature/FeatureVector 타입"
```

---

## Task 2: buildFeatures — 연속형 raw 추출 (핵심)

**Files:**
- Create: `src/engine/features/buildFeatures.ts`
- Test: `src/engine/features/buildFeatures.test.ts`

각 항목에서 ⓑ 산식을 거치지 않고 raw 숫자만 뽑는다. 입력은 기존 `ScoreEngineInput`(src/engine/index.ts).

- [ ] **Step 1: 실패 테스트 작성**

```typescript
import { describe, it, expect } from 'vitest';
import { buildFeatures } from './buildFeatures.js';
import type { ScoreEngineInput } from '../index.js';

const base: ScoreEngineInput = { rating: 0 };

function val(input: ScoreEngineInput, name: string): number | undefined {
  return buildFeatures(input).find((f) => f.name === name)?.value;
}

describe('buildFeatures — 연속형 raw', () => {
  it('① 절대 레이팅을 raw로 낸다', () => {
    expect(val({ rating: 88 }, 'rating_abs')).toBe(88);
  });

  it('① 경주내 상대순위(0~1): 더 높은 레이팅이 더 큰 값', () => {
    const v = val({ rating: 90, allRaceRatings: [70, 80, 90] }, 'rating_rel');
    expect(v).toBeCloseTo(1.0, 5);
  });

  it('③ 최근 착순 평균과 기울기 (ord5는 과거→최근)', () => {
    const input = { ...base, ord5: [5, 4, 3, 2, 1] };
    expect(val(input, 'recent_ord_mean')).toBeCloseTo(3, 5);
    expect(val(input, 'recent_ord_slope')).toBeLessThan(0); // 향상 추세
    expect(val(input, 'recent_ord_last')).toBe(1);
  });

  it('⑥ 거리 결승비율 raw를 그대로 통과', () => {
    expect(val({ ...base, distFinishRatio: 0.2 }, 'dist_finish_ratio')).toBe(0.2);
  });

  it('⑧ 부담중량: 평균 (내부담−경주평균)과 평균 착순을 따로 낸다', () => {
    const input: ScoreEngineInput = {
      ...base,
      burdenHistory: [
        { ord: 3, myBudam: 57, raceAvgBudam: 54 },
        { ord: 1, myBudam: 55, raceAvgBudam: 54 },
      ],
    };
    expect(val(input, 'burden_over_avg')).toBeCloseTo(2, 5); // ((57-54)+(55-54))/2
    expect(val(input, 'burden_ord_mean')).toBeCloseTo(2, 5);
  });

  it('⑱ 수득상금은 log1p로', () => {
    const v = val({ ...base, erngSump: 100_000_000 }, 'earnings_log');
    expect(v).toBeCloseTo(Math.log1p(100_000_000), 5);
  });

  it('⑪ 경주간격 raw 일수', () => {
    expect(val({ ...base, intervalDays: 21 }, 'interval_days')).toBe(21);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- buildFeatures`
Expected: FAIL ("buildFeatures is not a function" / 모듈 없음)

- [ ] **Step 3: 최소 구현**

```typescript
/**
 * de-biased feature 빌더.
 * 항목의 raw 측정값만 추출 — ⓑ 가치판단(임계값·맵·multiplier·정규화)을 거치지 않는다.
 * 좋고나쁨 판단은 모델(계획 B)이 학습한다. win_odds는 의도적으로 제외.
 */
import type { ScoreEngineInput } from '../index.js';
import type { Feature, FeatureVector } from './types.js';

function slope(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i + 1, y = arr[i] ?? 0;
    sx += x; sy += y; sxy += x * y; sx2 += x * x;
  }
  const den = n * sx2 - sx * sx;
  return den === 0 ? 0 : (n * sxy - sx * sy) / den;
}
function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}
function std(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}

export function buildFeatures(input: ScoreEngineInput): FeatureVector {
  const f: Feature[] = [];
  const add = (name: string, value: number) => f.push({ name, value });

  // ① 레이팅
  add('rating_abs', input.rating ?? 0);
  if (input.allRaceRatings && input.allRaceRatings.length >= 2 && (input.rating ?? 0) > 0) {
    const rated = input.allRaceRatings.filter((r) => r > 0);
    const worse = rated.filter((r) => r < input.rating).length;
    add('rating_rel', rated.length > 1 ? worse / (rated.length - 1) : 0.5);
  }

  // ③ 착순 추세 (ord5: 과거→최근)
  const ord5 = input.ord5 ?? [];
  if (ord5.length > 0) {
    add('recent_ord_mean', mean(ord5));
    add('recent_ord_slope', slope(ord5));
    add('recent_ord_std', std(ord5));
    add('recent_ord_last', ord5[ord5.length - 1]!);
  }

  // ④ 구간시간 단축 (raw 초)
  const times = (input.sameDistTrackTimes && input.sameDistTrackTimes.length >= 2)
    ? input.sameDistTrackTimes
    : (input.sameDistOnlyTimes ?? []);
  if (times.length >= 2) {
    const recentTotal = times[0]!.rcTime;
    const pastTotal = mean(times.slice(1).map((t) => t.rcTime));
    add('sectional_total_improve', pastTotal - recentTotal);
    const recentLast = times[0]!.lastFurlong;
    const pastLast = mean(times.slice(1).map((t) => t.lastFurlong));
    add('sectional_last_improve', pastLast - recentLast);
  }

  // ⑤ 후반 구간: 결승 ratio·gain raw
  const positions = input.positions ?? [];
  if (positions.length > 0) {
    const finishRatios = positions.map((p) => (p.finishOrd - 1) / Math.max(1, p.fieldSize - 1));
    const gains = positions.map((p) => {
      const sr = (p.startOrd - 1) / Math.max(1, p.fieldSize - 1);
      const fr = (p.finishOrd - 1) / Math.max(1, p.fieldSize - 1);
      return sr - fr; // 양수 = 막판 전진
    });
    add('late_finish_ratio_mean', mean(finishRatios));
    add('late_gain_mean', mean(gains));
  }

  // ⑥ 거리 적성
  if (input.distFinishRatio != null) add('dist_finish_ratio', input.distFinishRatio);

  // ⑦ 주로 적응 (raw 향상도)
  const overall = input.overallOrds ?? [];
  const sameTrack = input.sameTrackOrds ?? [];
  if (overall.length >= 1 && sameTrack.length >= 1) {
    add('track_improvement', mean(overall) - mean(sameTrack));
  }

  // ⑧ 부담중량 (raw, α 제거)
  const bh = input.burdenHistory ?? [];
  if (bh.length > 0) {
    add('burden_over_avg', mean(bh.map((h) => h.myBudam - h.raceAvgBudam)));
    add('burden_ord_mean', mean(bh.map((h) => h.ord)));
  }

  // ⑨ 기수 통산
  if (input.jockeyCareerQuRate != null) add('jockey_career_qu', input.jockeyCareerQuRate / 100);
  if (input.jockeyCareerWinRate != null) add('jockey_career_win', input.jockeyCareerWinRate / 100);

  // ⑨b 기수 최근 90일 단승률
  const jr = input.jockeyRecentOrds ?? [];
  if (jr.length > 0) add('jockey_recent_win', jr.filter((o) => o === 1).length / jr.length);

  // ⑩ 조교사 60일 top3율
  const tr60 = input.trainer60DayOrds ?? [];
  if (tr60.length > 0) add('trainer_top3', tr60.filter((o) => o <= 3).length / tr60.length);

  // ⑩b 조교사 최근 90일 top2율
  const trr = input.trainerRecentOrds ?? [];
  if (trr.length > 0) add('trainer_recent_top2', trr.filter((o) => o <= 2).length / trr.length);

  // ⑪ 경주 간격 (raw, 버킷은 계획 B)
  if (input.intervalDays != null) add('interval_days', input.intervalDays);

  // ⑫ 출발번호 상대위치 (raw, ⓑ multiplier 제거)
  if (input.stOrd && input.totalHorses && input.totalHorses > 1) {
    add('gate_relative', (input.totalHorses - input.stOrd) / (input.totalHorses - 1));
  }
  if (input.rcDist) add('rc_dist', input.rcDist);

  // ⑬ 나이 (거리·성별 교차는 계획 B)
  if (input.age) add('age', input.age);

  // ⑭ 혈통 (raw 평균, /10 가정 제거)
  const ped = input.pedigree ?? {};
  const dsa = [ped.dsaBriVl, ped.dsaClcVl, ped.dsaIerVl, ped.dsaPrfVl, ped.dsidxVl]
    .filter((v): v is number => typeof v === 'number' && v > 0);
  if (dsa.length > 0) add('pedigree_dsa_mean', mean(dsa));

  // ⑮ 계절 top3율
  const ss = input.sameSeasonOrds ?? [];
  if (ss.length > 0) add('season_top3', ss.filter((o) => o <= 3).length / ss.length);

  // ⑯ 궁합 (raw 향상도)
  const ha = input.horseAllOrds ?? [];
  const co = input.combinationOrds ?? [];
  if (ha.length >= 1 && co.length >= 1) add('chemistry_improvement', mean(ha) - mean(co));

  // ⑰ 과거 인기 proxy (약함, 오늘 odds 아님)
  const pop = input.recent5Popularities ?? [];
  if (pop.length > 0) add('recent_pop_top2', pop.filter((p) => p <= 2).length / pop.length);

  // ⑱ 수득상금 log
  if (input.erngSump != null) add('earnings_log', Math.log1p(input.erngSump));

  // ⑲ 주행성향 raw (페이스 교차는 계획 B)
  if (input.runningStyleAvgRatio != null) add('style_avg_ratio', input.runningStyleAvgRatio);
  if (input.runningStyleStddev != null) add('style_stddev', input.runningStyleStddev);

  // ⑳ 속도능력지수 raw (LO/HI 매핑 제거)
  if (input.speedFigureAbilityRaw != null) add('speed_ability_raw', input.speedFigureAbilityRaw);

  return f;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- buildFeatures`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/features/buildFeatures.ts src/engine/features/buildFeatures.test.ts
git commit -m "feat(features): buildFeatures 연속형 raw 추출 (ⓑ 가치판단 제거)"
```

---

## Task 3: 표본수 · 결측표시 · 카테고리 one-hot

**Files:**
- Modify: `src/engine/features/buildFeatures.ts`
- Test: `src/engine/features/buildFeatures.test.ts`

표본수(count)·결측표시·성별/페이스 one-hot 추가. 모델이 작은표본 할인과 결측을 직접 학습하도록.

- [ ] **Step 1: 실패 테스트 추가**

```typescript
describe('buildFeatures — count·missing·one-hot', () => {
  it('표본수 feature를 동반한다', () => {
    expect(val({ rating: 0, jockeyRecentOrds: [1, 2, 3] }, 'jockey_recent_n')).toBe(3);
  });
  it('거리적성 결측이면 missing 플래그=1', () => {
    expect(val({ rating: 0 }, 'dist_finish_ratio__missing')).toBe(1);
  });
  it('거리적성 있으면 missing 플래그=0', () => {
    expect(val({ rating: 0, distFinishRatio: 0.3 }, 'dist_finish_ratio__missing')).toBe(0);
  });
  it('성별 one-hot', () => {
    expect(val({ rating: 0, sex: '암' }, 'sex_mare')).toBe(1);
    expect(val({ rating: 0, sex: '수' }, 'sex_mare')).toBe(0);
  });
  it('페이스 one-hot', () => {
    expect(val({ rating: 0, paceType: 'HOT' }, 'pace_hot')).toBe(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:run -- buildFeatures`
Expected: FAIL

- [ ] **Step 3: 구현 — buildFeatures 끝부분(return 직전)에 추가**

```typescript
  // --- 표본수 (작은표본 할인용) ---
  add('jockey_recent_n', (input.jockeyRecentOrds ?? []).length);
  add('trainer_recent_n', (input.trainerRecentOrds ?? []).length);
  add('trainer60_n', (input.trainer60DayOrds ?? []).length);
  add('same_dist_n', (input.sameDistOrds ?? []).length);
  add('season_n', (input.sameSeasonOrds ?? []).length);
  add('combo_n', (input.combinationOrds ?? []).length);
  add('hist_n', (input.ord5 ?? []).length);

  // --- 결측표시 (value=0 + __missing=1) ---
  const missingFlag = (name: string, present: boolean) => {
    add(`${name}__missing`, present ? 0 : 1);
    if (!present) add(name, 0);
  };
  missingFlag('dist_finish_ratio', input.distFinishRatio != null);
  missingFlag('speed_ability_raw', input.speedFigureAbilityRaw != null);
  missingFlag('pedigree_dsa_mean', dsa.length > 0);
  missingFlag('style_avg_ratio', input.runningStyleAvgRatio != null);

  // --- 카테고리 one-hot ---
  add('sex_mare', input.sex === '암' ? 1 : 0);
  add('sex_gelding', input.sex === '거' ? 1 : 0);
  add('pace_hot', input.paceType === 'HOT' ? 1 : 0);
  add('pace_slow', input.paceType === 'SLOW' ? 1 : 0);
```

> 주의: `missingFlag`가 value=0을 push할 때 동일 name이 두 번 들어가지 않도록, 위 `add('dist_finish_ratio', …)` 등은 "있을 때만" push하는 기존 로직을 유지한다(결측 시에는 missingFlag가 0을 push). 중복 방지를 위해 `add`가 같은 name을 덮어쓰도록 바꾸지 말고, 결측 분기에서만 push.

- [ ] **Step 4: 통과 확인**

Run: `npm run test:run -- buildFeatures`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/features/buildFeatures.ts src/engine/features/buildFeatures.test.ts
git commit -m "feat(features): 표본수·결측표시·카테고리 one-hot 추가"
```

---

## Task 4: 경주별 raw 입력 수집 함수 export

**Files:**
- Modify: `src/engine/scorePredictor.ts`

추출 스크립트가 재사용하도록, `buildEngineInput` 호출부를 `gatherRaceInputs`로 추출해 export한다. `predictRace`는 이를 호출하도록 리팩터(동작 불변).

- [ ] **Step 1: `gatherRaceInputs` export 추가**

`scorePredictor.ts`에서 `predictRace`의 entries 조회 + 부속 맵 구성 + `buildEngineInput` 루프를 아래 함수로 추출하고, `predictRace`가 이를 호출하게 한다.

```typescript
export interface RaceInputRow {
  hr_name: string;
  pthr_no: number;
  ord: number | null;
  input: ScoreEngineInput;
}

/** 한 경주의 출전마별 ScoreEngineInput(raw)과 라벨(ord)을 모은다. (학습행렬·예측 공용) */
export async function gatherRaceInputs(
  sb: SupabaseClient,
  rcDate: number,
  meet: number,
  rcNo: number
): Promise<RaceInputRow[]> {
  // predictRace 본문에서 entries 조회 ~ buildEngineInput 루프까지를 그대로 이동.
  // 반환: results.map(r => ({ hr_name, pthr_no, ord: r.entry.ord, input }))
  // (activeVersion/engine/scoring/정렬 부분은 predictRace에 남긴다)
}
```

`predictRace`는 `gatherRaceInputs` 결과를 받아 `engine.calculateScores(row.input)`로 채점·정렬·도장하도록 수정한다.

- [ ] **Step 2: 타입체크 + 기존 테스트**

Run: `npm run build && npm run test:run`
Expected: 통과 (predictRace 동작 불변)

- [ ] **Step 3: 커밋**

```bash
git add src/engine/scorePredictor.ts
git commit -m "refactor(engine): gatherRaceInputs export (학습행렬·예측 공용)"
```

---

## Task 5: 학습행렬 추출 스크립트

**Files:**
- Create: `scripts/extract_training_matrix.ts`
- Modify: `.gitignore`
- Modify: `package.json` (scripts에 `extract:matrix` 추가)

과거 결과확정 경주를 순회 → 출전마별 `buildFeatures` → `data/training_matrix.jsonl`에 `{features, top3, race_date, meet, rc_no, hr_name}` 기록.

- [ ] **Step 1: .gitignore + package.json**

`.gitignore`에 추가:
```
data/*.jsonl
```
`package.json` scripts에 추가:
```json
"extract:matrix": "tsx scripts/extract_training_matrix.ts",
```

- [ ] **Step 2: 스크립트 작성**

```typescript
/**
 * 학습행렬 추출 — 결과확정(ord NOT NULL) 과거 경주를 순회하며
 * 출전마별 de-biased feature + top3 라벨을 JSONL로 쓴다. (계획 B 모델 학습 입력)
 * win_odds는 buildFeatures에서 제외됨(설계 결정 6).
 *
 * 사용: npm run extract:matrix -- --from 20240101 --to 20991231 --out data/training_matrix.jsonl
 */
import 'dotenv/config';
import { writeFileSync, appendFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { gatherRaceInputs } from '../src/engine/scorePredictor.js';
import { buildFeatures } from '../src/engine/features/buildFeatures.js';

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const from = Number(arg('--from', '20240101'));
  const to = Number(arg('--to', '20991231'));
  const out = arg('--out', 'data/training_matrix.jsonl');

  const sb = getSupabaseAdmin();

  // 결과확정 경주 목록 (중복 제거)
  const races = new Set<string>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('race_entries')
      .select('race_date, meet, rc_no')
      .gte('race_date', from).lte('race_date', to)
      .not('ord', 'is', null)
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number }[]) {
      races.add(`${r.race_date}-${r.meet}-${r.rc_no}`);
    }
    if (data.length < PAGE) break;
  }

  writeFileSync(out, ''); // truncate
  let rows = 0, done = 0;
  for (const key of races) {
    const [d, m, n] = key.split('-').map(Number);
    const inputs = await gatherRaceInputs(sb, d!, m!, n!);
    const lines = inputs
      .filter((r) => r.ord != null && r.ord <= 50)
      .map((r) => JSON.stringify({
        race_date: d, meet: m, rc_no: n, hr_name: r.hr_name,
        top3: (r.ord as number) <= 3 ? 1 : 0,
        features: buildFeatures(r.input),
      }));
    if (lines.length) { appendFileSync(out, lines.join('\n') + '\n'); rows += lines.length; }
    if (++done % 100 === 0) console.log(`  ${done}/${races.size} races, ${rows} rows`);
  }
  console.log(`✅ ${rows} rows → ${out}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 3: 소규모 스모크 실행 (사용자 실행 권장 — 토큰 절감)**

Run: `npm run extract:matrix -- --from 20260101 --to 20260201 --out data/smoke.jsonl`
Expected: `✅ <N> rows → data/smoke.jsonl`, 첫 줄에 `features` 배열·`top3` 0/1 포함 확인

- [ ] **Step 4: 커밋**

```bash
git add scripts/extract_training_matrix.ts .gitignore package.json
git commit -m "feat(scripts): 학습행렬 추출 (de-biased feature + top3 라벨 JSONL)"
```

---

## 계획 B 예고 (A 완료 후 실데이터로 상세화)

> 버킷 경계·GBM 하이퍼파라미터가 A의 행렬 분포에 의존하므로, A 완료 후 probe해서 확정·작성한다.

- **B1** 마이그레이션 011 — `model_versions.model_type` + `artifact` 컬럼, 기존 버전 `rho-legacy` 표기
- **B2** 비단조 버킷 probe(⑪간격·②마체중) → `buildFeatures`에 버킷 더미 + 교차항(⑲ 성향×페이스, ⑬ 나이×거리) 추가
- **B3** 로지스틱 학습기(TS, z표준화+L2) — 합성데이터 계수회복 테스트
- **B4** GBM 학습기(`scripts/train_gbm.py`, LightGBM) → 트리 JSON 덤프
- **B5** GBM TS 추론(`gbmInfer.ts`) — 덤프 트리 추론이 LightGBM 예측과 일치
- **B6** 통합 스코어러(`scoreModel.ts`) — logistic/gbm 공통 인터페이스, 기여도 가법분해 불변식 테스트
- **B7** `learn_candidate` 확장 — `--model logistic|gbm` 후보 저장
- **B8** `walkforward_eval` 확장 — ROI 블록 + v1/로지스틱/GBM 3자 비교
- **B9** `scorePredictor` 통합 — model_type별 스코어러 선택, item_scores에 raw 사실+기여도
- **B10** (최소) UI — 항목별 raw 사실 + 기여도 표시

---

## Self-Review (계획 A)

- **스펙 커버리지:** §3.1 컴포넌트1(Feature 빌더)=Task2·3, §4 감사 매핑=Task2·3, win_odds 제외=Task2(미포함 확인), 학습행렬=Task5. 모델/스키마/walkforward는 계획 B로 명시 분리.
- **Placeholder:** Task4 `gatherRaceInputs` 본문은 "predictRace에서 이동"으로 지정 — 기존 코드 이동이라 신규 코드 아님(허용). 그 외 전 스텝 실제 코드 포함.
- **타입 일관성:** `Feature`/`FeatureVector`(Task1) → buildFeatures 반환(Task2·3) → 스크립트 사용(Task5) 일치. `gatherRaceInputs`/`RaceInputRow`(Task4) → 스크립트 호출(Task5) 일치.
