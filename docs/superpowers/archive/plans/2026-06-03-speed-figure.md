# ⑳ 속도능력지수 (`20_speed_figure`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 거리·주로별 par-time 대비 시간비율로 말의 절대 능력을 0~1 점수화하는 신규 평가항목을 append-only로 추가하고, 워크포워드로 효과를 검증한다.

**Architecture:** par-time 기준표(DB view) → 말의 과거 각 경주 figure = par/완주시간 → 최근 N경주 figure 평균(as-of) → 전역 분포 기준 0~1 매핑. 순수 함수(`speedFigure.ts`)로 산식 격리, as-of 집계는 기존 `asOfHorseStats.ts`에 통합, 엔진/예측기 배선, 키-추가 backfill 후 후보 버전으로 워크포워드.

**Tech Stack:** Node.js + TypeScript, Supabase(PostgreSQL), vitest, 기존 ScoreEngine/weightLearner/walkforward 인프라.

**Spec:** `docs/superpowers/specs/2026-06-03-speed-figure-design.md`

---

## File Structure

| 파일 | 책임 |
|---|---|
| `supabase/migrations/011_speed_figure.sql` (생성) | `score_items` 행 등록 + `race_par_times` view |
| `src/engine/speedFigure.ts` (생성) | 순수 산식: 버킷키, figure=par/time, 최근 N평균, as-of 필터. par map 로더 |
| `src/engine/speedFigure.test.ts` (생성) | 순수 함수 단위테스트 |
| `src/engine/scoreItems/20_speed_figure.ts` (생성) | 순수 스코어 함수 `abilityRaw→0~1` + 매핑 상수 |
| `src/engine/scoreItems/20_speed_figure.test.ts` (생성) | 스코어 함수 단위테스트 |
| `scripts/probe_speed_figure.ts` (생성) | 전역 abilityRaw 분포 측정 → LO/HI 상수 결정 |
| `scripts/backfill_speed_figure.ts` (생성) | predictions.item_scores에 `20_speed_figure` 키만 머지 |
| `src/types/index.ts` (수정) | 항목 등록(SCORE_ITEM_IDS·ITEM_WEIGHTS=0·ITEM_NAMES) |
| `src/engine/asOfHorseStats.ts` (수정) | as-of speedFigureAbilityRaw 추가 |
| `src/engine/index.ts` (수정) | ScoreEngineInput·items 블록 추가 |
| `src/engine/scorePredictor.ts` (수정) | par map 로드 + fetchAsOfHorseStats에 전달, 입력 배선 |

---

## Task 1: 마이그레이션 011 — score_items 등록 + race_par_times view

**Files:**
- Create: `supabase/migrations/011_speed_figure.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

```sql
-- ============================================
-- 011_speed_figure.sql
-- ⑳ 속도능력지수 항목 등록 + par-time 기준표 view
-- ============================================

-- 1. score_items 레지스트리에 신규 항목 등록 (append-only)
INSERT INTO score_items (item_id, name) VALUES
  ('20_speed_figure', '속도능력지수')
ON CONFLICT (item_id) DO NOTHING;

-- 2. race_par_times — 버킷별(경마장×거리×주로) 우승마 평균 완주시간
--    figure = par_time / 내 완주시간 의 분모. 전 기간 1회 계산(공유 베이스라 누수 없음).
DROP VIEW IF EXISTS race_par_times;
CREATE VIEW race_par_times AS
SELECT
  meet,
  rc_dist,
  track_type,
  ROUND(AVG(rc_time)::numeric, 2) AS par_time,
  COUNT(*) AS n_wins
FROM race_entries
WHERE ord = 1
  AND rc_time IS NOT NULL AND rc_time > 0
  AND rc_dist IS NOT NULL
  AND track_type IS NOT NULL
GROUP BY meet, rc_dist, track_type;

COMMENT ON VIEW race_par_times IS
  '버킷(meet×rc_dist×track_type)별 우승마(ord=1) 평균 완주시간. 속도능력지수 figure의 분모.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: 마이그레이션 적용**

사용자가 Supabase SQL Editor에서 `011_speed_figure.sql` 전체를 실행 (DB 쓰기는 사용자 위임 관례).

- [ ] **Step 3: 적용 검증 (사용자 실행 SQL)**

```sql
-- 버킷 분포: 유효 버킷(n_wins>=10)이 충분한지 + par_time 범위가 합리적인지
SELECT
  COUNT(*) AS total_buckets,
  COUNT(*) FILTER (WHERE n_wins >= 10) AS valid_buckets,
  MIN(par_time) AS min_par, MAX(par_time) AS max_par
FROM race_par_times;

-- 항목 등록 확인
SELECT item_id, name FROM score_items WHERE item_id = '20_speed_figure';
```
Expected: `valid_buckets`가 수십 개 이상(거리×주로×경마장 조합), par_time이 거리에 비례(예: 1000m ~62초, 2000m ~127초대). score_items 1행.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/011_speed_figure.sql
git commit -m "feat(db): ⑳ 속도능력지수 항목 등록 + race_par_times view (마이그레이션 011)"
```

---

## Task 2: 타입 등록 — 항목 ID·가중치(0)·이름

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: SCORE_ITEM_IDS에 추가**

`src/types/index.ts`의 `SCORE_ITEM_IDS` 배열 마지막 항목 `'19_running_style_pace',` 다음 줄에 추가:

```typescript
  '19_running_style_pace',
  '20_speed_figure',
] as const;
```

- [ ] **Step 2: ITEM_WEIGHTS에 추가 (v1 가중치 0 — 켜지 않음)**

`ITEM_WEIGHTS` 객체의 `'19_running_style_pace': 3.50,` 다음 줄에 추가:

```typescript
  '19_running_style_pace': 3.50,
  '20_speed_figure': 0,         // v1 미적용. 후보 버전에서 ρ로 가중치 결정
```

- [ ] **Step 3: ITEM_NAMES에 추가**

`ITEM_NAMES` 객체의 `'19_running_style_pace': '주행성향×페이스',` 다음 줄에 추가:

```typescript
  '19_running_style_pace': '주행성향×페이스',
  '20_speed_figure': '속도능력지수',
```

- [ ] **Step 4: 타입체크로 누락 없음 확인**

Run: `npm run build`
Expected: PASS. (`ITEM_WEIGHTS`/`ITEM_NAMES`가 `Record<ScoreItemId, number>`라 누락 시 컴파일 에러 → 통과 = 3곳 모두 반영됨)

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): 20_speed_figure 항목 등록 (v1 가중치 0, append-only)"
```

---

## Task 3: 순수 산식 모듈 `speedFigure.ts` (figure·집계·par 로더)

**Files:**
- Create: `src/engine/speedFigure.ts`
- Test: `src/engine/speedFigure.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/speedFigure.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parBucketKey, raceSpeedFigure, computeAbilityRaw, figuresBeforeDate } from './speedFigure.js';

describe('parBucketKey', () => {
  it('meet·거리·주로를 하나의 키로', () => {
    expect(parBucketKey(1, 1200, '건조')).toBe('1|1200|건조');
  });
});

describe('figuresBeforeDate (as-of 누수 차단)', () => {
  const timeline = [
    { date: 20250601, fig: 1.05 }, // 미래 (예측일 이후)
    { date: 20250515, fig: 1.00 }, // 예측일 당일 — 제외
    { date: 20250401, fig: 0.95 }, // 과거
    { date: 20250301, fig: 0.90 }, // 과거
  ];
  it('beforeDate 이상(당일·미래)은 제외, 과거만 최신순 반환', () => {
    expect(figuresBeforeDate(timeline, 20250515)).toEqual([0.95, 0.9]);
  });
  it('과거가 없으면 빈 배열', () => {
    expect(figuresBeforeDate(timeline, 20250101)).toEqual([]);
  });
});

describe('raceSpeedFigure', () => {
  it('par/time — 빠르면(시간 작으면) 1보다 큼', () => {
    expect(raceSpeedFigure(69, 70)!).toBeCloseTo(70 / 69, 5);
  });
  it('느리면 1보다 작음', () => {
    expect(raceSpeedFigure(72, 70)!).toBeCloseTo(70 / 72, 5);
  });
  it('완주시간 0/음수면 null', () => {
    expect(raceSpeedFigure(0, 70)).toBeNull();
    expect(raceSpeedFigure(70, 0)).toBeNull();
  });
});

describe('computeAbilityRaw', () => {
  it('빈 배열 → null', () => {
    expect(computeAbilityRaw([], 5)).toBeNull();
  });
  it('최신순 figures의 최근 N개 평균', () => {
    // 최신순: [1.05, 1.00, 0.95, 0.90, 0.85, 0.80], N=3 → 앞 3개 평균
    expect(computeAbilityRaw([1.05, 1.0, 0.95, 0.9, 0.85, 0.8], 3)!).toBeCloseTo(1.0, 5);
  });
  it('N보다 적으면 있는 것만 평균', () => {
    expect(computeAbilityRaw([1.0, 0.9], 5)!).toBeCloseTo(0.95, 5);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- speedFigure`
Expected: FAIL ("Cannot find module './speedFigure.js'" 또는 함수 미정의)

- [ ] **Step 3: 최소 구현 작성**

`src/engine/speedFigure.ts`:

```typescript
/**
 * ⑳ 속도능력지수 — 순수 산식 + DB 보조
 *
 * figure(말,경주) = par_time(버킷) / rc_time  (1보다 크면 기준 우승마보다 빠름)
 * 거리·주로별 par로 정규화 → 클래스가 시간에 녹아든 절대 능력 척도.
 * 집계는 반드시 as-of(과거 경주만). 자세한 근거: docs/superpowers/specs/2026-06-03-speed-figure-design.md
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** par 유효 최소 우승표본 (튜닝 대상) */
export const PAR_MIN_WINS = 10;

/** 버킷 키 = meet|거리|주로 */
export function parBucketKey(meet: number, rcDist: number, trackType: string): string {
  return `${meet}|${rcDist}|${trackType}`;
}

/** 한 경주 figure = par_time / rc_time. 유효하지 않으면 null */
export function raceSpeedFigure(rcTime: number, parTime: number): number | null {
  if (!(rcTime > 0) || !(parTime > 0)) return null;
  return parTime / rcTime;
}

/** 최신순 figures의 최근 N개 평균. 빈 배열이면 null */
export function computeAbilityRaw(figures: number[], n: number): number | null {
  if (figures.length === 0) return null;
  const recent = figures.slice(0, n);
  return recent.reduce((s, v) => s + v, 0) / recent.length;
}

/**
 * as-of 누수 차단: 타임라인(최신순 {date,fig})에서 beforeDate '미만'만 figure로 추출.
 * 예측 대상 경주 당일·이후는 제외 (착순 훔쳐보기 방지).
 */
export function figuresBeforeDate(
  timeline: { date: number; fig: number }[],
  beforeDate: number
): number[] {
  return timeline.filter((t) => t.date < beforeDate).map((t) => t.fig);
}

/** race_par_times view → 버킷키→par_time 맵 (n_wins>=PAR_MIN_WINS만) */
export async function loadParMap(sb: SupabaseClient): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data, error } = await sb
    .from('race_par_times')
    .select('meet, rc_dist, track_type, par_time, n_wins');
  if (error) throw error;
  for (const r of (data ?? []) as Array<{ meet: number; rc_dist: number; track_type: string; par_time: number; n_wins: number }>) {
    if (r.n_wins >= PAR_MIN_WINS && r.par_time > 0) {
      map.set(parBucketKey(r.meet, r.rc_dist, r.track_type), r.par_time);
    }
  }
  return map;
}
```

(`SPEED_FIGURE_N`은 이 모듈에서 안 씀 — 집계 N은 `asOfHorseStats`·backfill에서 적용하므로 import하지 않는다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- speedFigure`
Expected: PASS (parBucketKey/raceSpeedFigure/computeAbilityRaw/figuresBeforeDate 4 describe). (`loadParMap`는 DB 통합이라 단위테스트 제외 — Task 10 워크포워드에서 통합 검증)

- [ ] **Step 5: Commit**

```bash
git add src/engine/speedFigure.ts src/engine/speedFigure.test.ts
git commit -m "feat(engine): 속도능력지수 순수 산식 모듈(figure·집계·par 로더) + 테스트"
```

---

## Task 4: 스코어 함수 `20_speed_figure.ts` (abilityRaw → 0~1)

**Files:**
- Create: `src/engine/scoreItems/20_speed_figure.ts`
- Test: `src/engine/scoreItems/20_speed_figure.test.ts`

> 매핑 상수 LO/HI는 임시값으로 두고 Task 5(probe)에서 실측 분포로 확정한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/scoreItems/20_speed_figure.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { calculateSpeedFigureScore, SPEED_FIGURE_LO, SPEED_FIGURE_HI } from './20_speed_figure.js';

describe('calculateSpeedFigureScore', () => {
  it('이력 없음(null) → 0.5 중립', () => {
    expect(calculateSpeedFigureScore({ abilityRaw: null })).toBe(0.5);
  });
  it('LO 이하 → 0', () => {
    expect(calculateSpeedFigureScore({ abilityRaw: SPEED_FIGURE_LO - 0.05 })).toBe(0);
  });
  it('HI 이상 → 1', () => {
    expect(calculateSpeedFigureScore({ abilityRaw: SPEED_FIGURE_HI + 0.05 })).toBe(1);
  });
  it('중간값 → 선형 0~1 사이', () => {
    const mid = (SPEED_FIGURE_LO + SPEED_FIGURE_HI) / 2;
    expect(calculateSpeedFigureScore({ abilityRaw: mid })).toBeCloseTo(0.5, 5);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test:run -- 20_speed_figure`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현 작성**

`src/engine/scoreItems/20_speed_figure.ts`:

```typescript
/**
 * 항목 ⑳ 속도능력지수
 *
 * 거리·주로별 par-time 대비 완주시간 비율(figure)의 최근 N경주 평균(abilityRaw)을
 * 전역 분포 기준으로 0~1에 선형 매핑한다. 절대성 보존을 위해 경주 내 percentile은 쓰지 않는다.
 *
 * LO/HI: 전역 abilityRaw 분포의 p5/p95 (scripts/probe_speed_figure.ts로 확정).
 */

/** 최근 N경주 figure 평균 윈도우 (튜닝 대상) */
export const SPEED_FIGURE_N = 5;
/** 매핑 하한 (probe p5로 확정 예정 — 임시값) */
export const SPEED_FIGURE_LO = 0.93;
/** 매핑 상한 (probe p95로 확정 예정 — 임시값) */
export const SPEED_FIGURE_HI = 1.02;

export interface SpeedFigureInput {
  /** 최근 N경주 figure 평균 (as-of). null = 이력 없음 */
  abilityRaw: number | null;
}

export function calculateSpeedFigureScore(input: SpeedFigureInput): number {
  const { abilityRaw } = input;
  if (abilityRaw == null) return 0.5;
  const score = (abilityRaw - SPEED_FIGURE_LO) / (SPEED_FIGURE_HI - SPEED_FIGURE_LO);
  return Math.max(0, Math.min(1, score));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test:run -- 20_speed_figure`
Expected: PASS (4 it)

- [ ] **Step 5: Commit**

```bash
git add src/engine/scoreItems/20_speed_figure.ts src/engine/scoreItems/20_speed_figure.test.ts
git commit -m "feat(engine): 속도능력지수 스코어 함수(abilityRaw→0~1) + 테스트"
```

---

## Task 5: probe — 전역 abilityRaw 분포로 매핑 상수(LO/HI) 확정

**Files:**
- Create: `scripts/probe_speed_figure.ts`
- Modify: `src/engine/scoreItems/20_speed_figure.ts` (LO/HI 확정값으로 갱신)

- [ ] **Step 1: probe 스크립트 작성**

`scripts/probe_speed_figure.ts`:

```typescript
/**
 * 속도능력지수 abilityRaw 전역 분포 측정 → 매핑 상수(LO/HI) 결정 (읽기 전용)
 *
 * 모든 (말×경주)의 as-of abilityRaw를 계산해 분포(p5·p50·p95)를 출력한다.
 * 사용: npx tsx scripts/probe_speed_figure.ts
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { parBucketKey, raceSpeedFigure, computeAbilityRaw, loadParMap } from '../src/engine/speedFigure.js';
import { SPEED_FIGURE_N } from '../src/engine/scoreItems/20_speed_figure.js';

async function main() {
  const sb = getSupabaseAdmin();
  const parMap = await loadParMap(sb);
  console.log(`par 버킷(유효): ${parMap.size}`);

  // 전체 race_entries 완주기록 1회 로드 → 말별 최신순 figure 타임라인
  type Row = { race_date: number; meet: number; rc_no: number; hr_name: string; rc_dist: number | null; track_type: string | null; rc_time: number | null };
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('race_entries')
      .select('race_date, meet, rc_no, hr_name, rc_dist, track_type, rc_time')
      .not('ord', 'is', null)
      .order('race_date', { ascending: false })
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  // 말별 (최신순) figure 리스트
  const byHorse = new Map<string, number[]>();
  for (const r of rows) {
    if (r.rc_time == null || r.rc_dist == null || r.track_type == null) continue;
    const par = parMap.get(parBucketKey(r.meet, r.rc_dist, r.track_type));
    if (par == null) continue;
    const f = raceSpeedFigure(r.rc_time, par);
    if (f == null) continue;
    if (!byHorse.has(r.hr_name)) byHorse.set(r.hr_name, []);
    byHorse.get(r.hr_name)!.push(f); // rows가 최신순이라 push 순서 = 최신순
  }

  // 각 말의 "현재 시점" abilityRaw (최근 N평균) 분포 — 매핑이 보게 될 값의 대표
  const abilities: number[] = [];
  for (const figs of byHorse.values()) {
    const a = computeAbilityRaw(figs, SPEED_FIGURE_N);
    if (a != null) abilities.push(a);
  }
  abilities.sort((a, b) => a - b);
  const q = (p: number) => abilities[Math.floor((abilities.length - 1) * p)];
  console.log(`abilityRaw 표본: ${abilities.length}`);
  console.log(`p5=${q(0.05).toFixed(4)} p25=${q(0.25).toFixed(4)} p50=${q(0.5).toFixed(4)} p75=${q(0.75).toFixed(4)} p95=${q(0.95).toFixed(4)}`);
  console.log(`→ 권장 LO=p5=${q(0.05).toFixed(3)}, HI=p95=${q(0.95).toFixed(3)}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: probe 실행**

Run: `npx tsx scripts/probe_speed_figure.ts`
Expected: par 버킷 수 + abilityRaw 분포(p5/p50/p95) 출력. p50이 1.0 부근(par=우승마평균이므로 일반 말은 ≤1), p5<p50<p95.

- [ ] **Step 3: LO/HI 상수 갱신**

probe가 출력한 `p5`·`p95`로 `src/engine/scoreItems/20_speed_figure.ts`의 상수를 교체:

```typescript
export const SPEED_FIGURE_LO = 0.93; // ← probe p5 값으로 교체
export const SPEED_FIGURE_HI = 1.02; // ← probe p95 값으로 교체
```

- [ ] **Step 4: 테스트 재확인 (상수 바뀌어도 통과해야 함)**

Run: `npm run test:run -- 20_speed_figure`
Expected: PASS (테스트가 상수를 import해 상대 비교하므로 값 바뀌어도 통과)

- [ ] **Step 5: Commit**

```bash
git add scripts/probe_speed_figure.ts src/engine/scoreItems/20_speed_figure.ts
git commit -m "feat(scripts): 속도능력지수 분포 probe + 매핑 상수(LO/HI) 실측값 확정"
```

---

## Task 6: as-of 통합 — `asOfHorseStats.ts`에 speedFigureAbilityRaw 추가

**Files:**
- Modify: `src/engine/asOfHorseStats.ts`

> 기존 as-of 패스가 이미 말별 과거 경주를 한 번 fetch하므로, 여기에 par 조인·figure 집계를 합쳐 중복 쿼리를 피한다.

- [ ] **Step 1: AsOfHorseStats 인터페이스·EMPTY에 필드 추가**

`src/engine/asOfHorseStats.ts`의 import에 추가:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { parBucketKey, raceSpeedFigure, computeAbilityRaw } from './speedFigure.js';
import { SPEED_FIGURE_N } from './scoreItems/20_speed_figure.js';
```

`AsOfHorseStats` 인터페이스에 필드 추가:

```typescript
export interface AsOfHorseStats {
  avgPositionRatio: number | null; // ⑫⑲
  stddevPositionRatio: number | null; // ⑫⑲
  frontRunSuccessRate: number | undefined; // ⑤
  distFinishRatio: number | null; // ⑥ (현재 경주 거리 카테고리 한정)
  speedFigureAbilityRaw: number | null; // ⑳ 최근 N경주 figure 평균
}
```

`EMPTY` 상수에 추가:

```typescript
const EMPTY: AsOfHorseStats = {
  avgPositionRatio: null,
  stddevPositionRatio: null,
  frontRunSuccessRate: undefined,
  distFinishRatio: null,
  speedFigureAbilityRaw: null,
};
```

- [ ] **Step 2: fetchAsOfHorseStats에 parMap 파라미터 + figure 집계 추가**

`fetchAsOfHorseStats` 시그니처에 `parMap` 추가:

```typescript
export async function fetchAsOfHorseStats(
  sb: SupabaseClient,
  hrName: string,
  beforeDate: number,
  currentDistCategory: DistCategory | null,
  parMap: Map<string, number>
): Promise<AsOfHorseStats> {
```

select에 `rc_time, track_type` 추가 (기존: `race_date, meet, rc_no, ord, rc_dist, sj_s1f_ord, bu_s1f_ord`):

```typescript
  const { data: pastRaw } = await sb
    .from('race_entries')
    .select('race_date, meet, rc_no, ord, rc_dist, track_type, rc_time, sj_s1f_ord, bu_s1f_ord')
    .eq('hr_name', hrName)
    .lt('race_date', beforeDate)
    .not('ord', 'is', null)
    .order('race_date', { ascending: false })
    .limit(60);
```

`past` 타입에 `track_type`·`rc_time` 추가:

```typescript
  const past = (pastRaw ?? []) as Array<{
    race_date: number; meet: number; rc_no: number; ord: number | null;
    rc_dist: number | null; track_type: string | null; rc_time: number | null;
    sj_s1f_ord: number | null; bu_s1f_ord: number | null;
  }>;
  if (past.length === 0) return { ...EMPTY };
```

함수 끝, `return computeAsOfHorseStats(races, currentDistCategory);` 직전에 figure 집계 + 병합:

```typescript
  // ⑳ 속도능력지수: par 조인 → 최신순 figure → 최근 N평균 (past는 race_date desc 정렬)
  const figs: number[] = [];
  for (const r of past) {
    if (r.rc_time == null || r.rc_dist == null || r.track_type == null) continue;
    const par = parMap.get(parBucketKey(r.meet, r.rc_dist, r.track_type));
    if (par == null) continue;
    const f = raceSpeedFigure(r.rc_time, par);
    if (f != null) figs.push(f);
  }
  const base = computeAsOfHorseStats(races, currentDistCategory);
  return { ...base, speedFigureAbilityRaw: computeAbilityRaw(figs, SPEED_FIGURE_N) };
}
```

(기존 마지막 `return computeAsOfHorseStats(...)` 줄을 위 블록으로 교체)

- [ ] **Step 3: computeAsOfHorseStats의 EMPTY 반환도 새 필드 포함 확인**

`computeAsOfHorseStats`는 `if (past.length === 0) return { ...EMPTY };`를 쓰므로 자동 포함. 끝의 명시적 return 객체에 `speedFigureAbilityRaw`를 추가(순수 함수는 figure를 모르므로 null):

```typescript
  return { avgPositionRatio, stddevPositionRatio, frontRunSuccessRate, distFinishRatio, speedFigureAbilityRaw: null };
```

(figure는 fetch 래퍼가 채우고, 순수 함수 단독 호출 시엔 null)

- [ ] **Step 4: 타입체크**

Run: `npm run build`
Expected: PASS. (예측기에서 parMap 인자 누락 에러가 나면 Task 8에서 해결되므로, 이 시점엔 scorePredictor가 아직 미수정 → 에러 발생 가능. 그 경우 Task 8과 함께 통과시킨다. 단독 통과를 원하면 Task 8을 이어서 수행.)

- [ ] **Step 5: Commit**

```bash
git add src/engine/asOfHorseStats.ts
git commit -m "feat(engine): as-of 속도능력지수 집계 추가 (parMap 조인, 누수 차단)"
```

---

## Task 7: 엔진 배선 — ScoreEngineInput·items 블록

**Files:**
- Modify: `src/engine/index.ts`

- [ ] **Step 1: import 추가**

`src/engine/index.ts`의 마지막 scoreItem import(`19_running_style_pace`) 다음에 추가:

```typescript
import { calculateSpeedFigureScore } from './scoreItems/20_speed_figure.js';
```

- [ ] **Step 2: ScoreEngineInput에 입력 필드 추가**

`ScoreEngineInput` 인터페이스의 ⑲ 블록 다음에 추가:

```typescript
  // ⑲ 주행성향 × 페이스
  runningStyleAvgRatio?: number | null;
  runningStyleStddev?: number | null;
  paceType?: PaceType;

  // ⑳ 속도능력지수 (as-of figure 평균)
  speedFigureAbilityRaw?: number | null;
}
```

- [ ] **Step 3: items 블록 추가**

`calculateScores` 내 ⑲ 블록(`items['19_running_style_pace'] = ...`) 다음, `// 종합 점수` 직전에 추가:

```typescript
    // ⑳ 속도능력지수
    items['20_speed_figure'] = this.make(
      '20_speed_figure',
      calculateSpeedFigureScore({ abilityRaw: input.speedFigureAbilityRaw ?? null })
    );
```

- [ ] **Step 4: 타입체크**

Run: `npm run build`
Expected: PASS (scorePredictor 미수정이면 parMap 인자 에러 → Task 8과 함께 통과)

- [ ] **Step 5: Commit**

```bash
git add src/engine/index.ts
git commit -m "feat(engine): ScoreEngine에 ⑳ 속도능력지수 항목 배선"
```

---

## Task 8: 예측기 배선 — par map 로드 + as-of 전달 + 입력 매핑

**Files:**
- Modify: `src/engine/scorePredictor.ts`

- [ ] **Step 1: import 추가**

`src/engine/scorePredictor.ts` 상단 import에 추가:

```typescript
import { loadParMap } from './speedFigure.js';
```

- [ ] **Step 2: par map 로드 + fetchAsOfHorseStats에 전달**

기존 as-of 패스(라인 ~122-128)를 교체:

```typescript
  // ⑤⑥⑫⑲⑳ 통계: 누수 방지 as-of(말별 과거 경주만) 사전 패스 — 전역 뷰 미사용
  const distCat = distCategoryOf(rcDist ?? 1600);
  const parMap = await loadParMap(sb); // ⑳ par-time 기준표 (1회 로드)
  const asOfMap = new Map<string, AsOfHorseStats>();
  await Promise.all(
    entryList.map(async (e) => {
      asOfMap.set(e.hr_name, await fetchAsOfHorseStats(sb, e.hr_name, rcDate, distCat, parMap));
    })
  );
```

- [ ] **Step 3: buildEngineInput 반환 객체에 입력 매핑 추가**

`buildEngineInput`의 반환 객체(끝부분, `runningStyleStddev`/`paceType` 근처)에 추가. ⑲ 매핑 라인들 다음에:

```typescript
    runningStyleAvgRatio: asOf.avgPositionRatio,
    runningStyleStddev: asOf.stddevPositionRatio,
    paceType,
    speedFigureAbilityRaw: asOf.speedFigureAbilityRaw,
  };
```

(반환 객체의 마지막 ⑲ 필드들 뒤에 `speedFigureAbilityRaw: asOf.speedFigureAbilityRaw,`를 추가. `asOf`는 이미 buildEngineInput 파라미터로 들어옴 — 시그니처 변경 불필요)

- [ ] **Step 4: 타입체크 + 전체 테스트**

Run: `npm run build`
Expected: PASS (이제 parMap 인자 충족)

Run: `npm run test:run`
Expected: PASS (기존 + 신규 테스트)

- [ ] **Step 5: 단일 경주 스모크 테스트**

기존 결과 경주 하나로 predictRace가 `20_speed_figure` 키를 만드는지 확인. 사용자가 SQL로 임의 과거 경주(예: 최근 결과일) 1건의 race_date/meet/rc_no를 고른 뒤:

Run: `npx tsx -e "import('dotenv/config').then(async()=>{const {getSupabaseAdmin}=await import('./src/db/supabase.js');const {predictRace}=await import('./src/engine/scorePredictor.js');const sb=getSupabaseAdmin();const rows=await predictRace(sb,RACE_DATE,MEET,RC_NO);console.log(JSON.stringify(rows[0].item_scores['20_speed_figure'],null,2));})"`
(RACE_DATE/MEET/RC_NO는 실제 값으로 치환)
Expected: `20_speed_figure` 항목 출력 — rawScore 0~1, weight 0(v1), weightedScore 0, status 'implemented'.

- [ ] **Step 6: Commit**

```bash
git add src/engine/scorePredictor.ts
git commit -m "feat(engine): 예측기에 par map 로드 + ⑳ 속도능력지수 as-of 입력 배선"
```

---

## Task 9: 키-추가 backfill — 전 기간 predictions에 20_speed_figure 머지

**Files:**
- Create: `scripts/backfill_speed_figure.ts`

> v1에서 ⑳ 가중치=0이라 total_score·predicted_rank가 불변 → 기존 라이브 기록을 깨지 않는 순수 append. (전체 `npm run backfill`은 다른 항목 as-of까지 재계산해 baseline을 흔들 수 있으므로 사용 금지.)

- [ ] **Step 1: backfill 스크립트 작성**

`scripts/backfill_speed_figure.ts`:

```typescript
/**
 * predictions.item_scores에 20_speed_figure 키만 머지 (append-only, 다른 키 불변)
 *
 * v1에서 ⑳ 가중치=0 → total_score·predicted_rank 불변. 라이브 기록 보존.
 * 사용: npx tsx scripts/backfill_speed_figure.ts
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { parBucketKey, raceSpeedFigure, computeAbilityRaw, figuresBeforeDate, loadParMap } from '../src/engine/speedFigure.js';
import { calculateSpeedFigureScore, SPEED_FIGURE_N } from '../src/engine/scoreItems/20_speed_figure.js';
import { ITEM_NAMES } from '../src/types/index.js';

async function main() {
  const sb = getSupabaseAdmin();
  const parMap = await loadParMap(sb);

  // 1) 전체 race_entries 완주기록 1회 로드 → 말별 (날짜,figure) 타임라인 (최신순)
  type ReRow = { race_date: number; meet: number; rc_no: number; hr_name: string; rc_dist: number | null; track_type: string | null; rc_time: number | null };
  const reRows: ReRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('race_entries')
      .select('race_date, meet, rc_no, hr_name, rc_dist, track_type, rc_time')
      .not('ord', 'is', null)
      .order('race_date', { ascending: false })
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    reRows.push(...(data as ReRow[]));
    if (data.length < PAGE) break;
  }
  const byHorse = new Map<string, { date: number; fig: number }[]>();
  for (const r of reRows) {
    if (r.rc_time == null || r.rc_dist == null || r.track_type == null) continue;
    const par = parMap.get(parBucketKey(r.meet, r.rc_dist, r.track_type));
    if (par == null) continue;
    const f = raceSpeedFigure(r.rc_time, par);
    if (f == null) continue;
    if (!byHorse.has(r.hr_name)) byHorse.set(r.hr_name, []);
    byHorse.get(r.hr_name)!.push({ date: r.race_date, fig: f }); // 최신순 유지
  }

  // 2) 전체 predictions 로드
  type PredRow = { id: number; race_date: number; hr_name: string; item_scores: Record<string, unknown> | null };
  const preds: PredRow[] = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('predictions')
      .select('id, race_date, hr_name, item_scores')
      .order('id')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    preds.push(...(data as PredRow[]));
    if (data.length < PAGE) break;
  }

  // 3) 각 prediction: as-of abilityRaw → rawScore → item_scores 머지 → update
  const itemName = (ITEM_NAMES as Record<string, string>)['20_speed_figure'];
  let updated = 0;
  for (const p of preds) {
    const timeline = byHorse.get(p.hr_name) ?? [];
    const figs = figuresBeforeDate(timeline, p.race_date); // as-of: 예측일 미만만 (최신순)
    const abilityRaw = computeAbilityRaw(figs, SPEED_FIGURE_N);
    const rawScore = Math.round(calculateSpeedFigureScore({ abilityRaw }) * 1000) / 1000;
    const merged = {
      ...(p.item_scores ?? {}),
      '20_speed_figure': { itemId: '20_speed_figure', itemName, rawScore, weight: 0, weightedScore: 0, status: 'implemented' },
    };
    const { error } = await sb.from('predictions').update({ item_scores: merged }).eq('id', p.id);
    if (error) throw error;
    updated++;
    if (updated % 2000 === 0) console.log(`  ${updated}/${preds.length}`);
  }
  console.log(`✅ ${updated}행에 20_speed_figure 머지 완료 (total_score·rank 불변)`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: backfill 실행**

Run: `npx tsx scripts/backfill_speed_figure.ts`
Expected: 진행 로그 후 `✅ N행에 20_speed_figure 머지 완료` (N ≈ predictions 행수 38K대). 수 분 소요 가능.

- [ ] **Step 3: 머지 검증 (사용자 실행 SQL)**

```sql
-- 20_speed_figure 키가 채워졌고 rawScore가 0~1 범위인지
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE item_scores ? '20_speed_figure') AS has_key,
  ROUND(AVG((item_scores->'20_speed_figure'->>'rawScore')::float)::numeric, 3) AS avg_raw
FROM predictions;

-- total_score 불변 확인용(샘플): weight=0이라 20 항목 weightedScore는 0
SELECT (item_scores->'20_speed_figure'->>'weightedScore') AS w20
FROM predictions WHERE item_scores ? '20_speed_figure' LIMIT 5;
```
Expected: `has_key == total`, `avg_raw` 0~1 사이(0.5 부근±), `w20` 모두 "0".

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill_speed_figure.ts
git commit -m "feat(scripts): 20_speed_figure 키-추가 backfill (append-only, baseline 불변)"
```

---

## Task 10: 검증 — 항목 ρ + 후보 버전 워크포워드

**Files:** (없음 — 기존 스크립트 실행·관찰)

- [ ] **Step 1: 후보 버전 생성 (ρ 재학습, 20 포함)**

Run: `npm run learn:candidate`
Expected: 새 버전 `vN` 저장(is_active=false) + 상위 가중치 출력. **출력에 "속도능력지수"가 등장하고 가중치가 의미 있는지**(예: 상위권이면 강한 신호) 확인. id를 기록.

- [ ] **Step 2: 항목 단독 ρ 확인 (사용자 실행 SQL)**

```sql
WITH race_ranks AS (
  SELECT
    RANK() OVER (PARTITION BY p.race_date, p.meet, p.rc_no
      ORDER BY (p.item_scores->'20_speed_figure'->>'rawScore')::float DESC) AS score_rank,
    RANK() OVER (PARTITION BY p.race_date, p.meet, p.rc_no
      ORDER BY p.actual_ord ASC) AS finish_rank,
    COUNT(*) OVER (PARTITION BY p.race_date, p.meet, p.rc_no) AS field_size
  FROM predictions p
  WHERE p.actual_ord IS NOT NULL
    AND (p.item_scores->'20_speed_figure'->>'rawScore') IS NOT NULL
)
SELECT ROUND((1 - 6.0*SUM(POWER(score_rank-finish_rank,2))
  / NULLIF(SUM(field_size::float*(field_size::float*field_size::float-1)),0))::numeric, 3) AS rho_20_speed_figure,
  COUNT(*) AS n
FROM race_ranks;
```
Expected: `rho_20_speed_figure` 출력. 기대 — ⑥(≈0.57)에 근접하면 강한 성공 신호, 0.2+면 유효 신호.

- [ ] **Step 2.5 (선택): 워크포워드 채점에 항목 등록 확인**

`scripts/walkforward_eval.ts`는 `item_scores`의 모든 키를 쓰지 않고 `computeOptimalWeights`(=`ALL_ITEMS`)를 통해 학습하므로 자동 포함. 별도 수정 불필요.

- [ ] **Step 3: 워크포워드 — 후보(20 포함) vs 챔피언**

Run: `npm run walkforward -- --candidate <Step1의 id>`
Expected: 분기별 + 누적 복승 챔/후 + **시장 벤치마크 격차** + 노이즈 경고 출력.
**성공 판정:** 후보 누적 복승이 챔피언(v1 57.7%)보다 표본오차(±1.9%p) 밖으로 향상 + 시장 격차(-11.2%p) 축소. 미달이면 Task 11에서 N·매핑·par 임계 튜닝 후 재측정.

- [ ] **Step 4: (성공 시) 결과를 간단 기록** — 별도 커밋 없음(읽기 전용). 수치는 Task 11 문서/메모리에 반영.

---

## Task 11: 문서·메모리 갱신 + (선택) 튜닝 반복

**Files:**
- Modify: `docs/score_roadmap.md` (마스터 상태표에 ⑳ 행 추가)
- Modify: `CLAUDE.md` (핵심 이슈 섹션에 ⑳ 결과 반영)
- Modify: 메모리 `project_market_benchmark.md` / 신규 메모리

- [ ] **Step 1: score_roadmap.md 마스터 상태표에 ⑳ 행 추가**

`docs/score_roadmap.md` §1 표에 측정된 ρ로 1행 추가:

```markdown
| `20_speed_figure` | ⑳ 속도능력지수 | <후보가중치> | **<ρ>** | 🆕 <평가> | 2026-06-03 par-time 절대 능력지수 |
```

- [ ] **Step 2: 워크포워드 결과 한 줄 반영** (roadmap §6 변경 이력 + CLAUDE.md 핵심 이슈)

실측 수치(후보 복승 vs v1 57.7% vs 시장 68.8%)를 1~2줄로 기록.

- [ ] **Step 3: 메모리 갱신**

`project_market_benchmark.md`의 "다음 핵심 실험" 항목을 결과로 갱신, 또는 신규 메모리 `project_speed_figure.md` 작성 (ρ·워크포워드 lift·튜닝 상태). MEMORY.md 인덱스 한 줄 갱신.

- [ ] **Step 4: (성공 미달 시) 튜닝 반복**

후보가 v1을 못 이기면 데이터로 조정 후 Task 9~10 재실행:
- `SPEED_FIGURE_N` (5 → 3 또는 8): 최근 몇 경주를 볼지
- `PAR_MIN_WINS` (10 → 5/20): par 유효 임계
- 매핑 LO/HI 재확정 (probe 재실행)
각 변경은 단일 커밋 + 워크포워드 재측정(데이터로 결정).

- [ ] **Step 5: Commit**

```bash
git add docs/score_roadmap.md CLAUDE.md
git commit -m "docs: ⑳ 속도능력지수 ρ·워크포워드 결과 반영 (마스터 상태표·핵심 이슈)"
```

---

## 승격 판단 (계획 외 — 사람 결정)

워크포워드에서 후보가 v1 대비 유의미 향상 + 시장 격차 축소가 확인되면, **사람 판단 후** 승격:

```bash
npm run promote -- --version <후보 id>
```

이는 본 계획의 범위 밖(별도 의사결정). 계획의 종료점은 Task 11(효과 측정·기록)까지.
