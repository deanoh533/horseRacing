# 조교 신호 (Training Signals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 조교 기록(`training_logs`)에서 as-of 피처(최근성·기승자격·강도·추세)를 추출해 모델에 넣고, 기존 benchmark 게이트A/B로 연승 시장격차 축소 여부를 검증한다.

**Architecture:** 누수 0 보장(`train_date < race_date`), prep 사이클 윈도우 `[직전경주일, 대상경주일)`. 데이터는 KRA→로컬 jsonl→로컬 DuckDB로 적재(Supabase 6/23 차단 우회). 피처 추출은 순수 함수로 분리해 단위 테스트, `gatherRaceInputs`가 as-of 조인만 담당, `buildFeatures`가 호출. `collect.ts`/`gates.ts`는 무변경(buildFeatures 출력을 그대로 소비).

**Tech Stack:** Node + TypeScript, vitest, @duckdb/node-api, KRA Open API(API18_1), 기존 `ReadClient` 어댑터.

**스펙:** `docs/superpowers/specs/2026-06-15-training-signals-design.md`

---

## File Structure

- **Create** `src/engine/features/mathUtils.ts` — `mean`/`std`/`slope` 공용화(현재 buildFeatures 내부 중복 제거).
- **Create** `src/engine/features/trainingFeatures.ts` — 순수 피처 추출 함수 + `isJockeyRidden`.
- **Create** `src/engine/features/trainingFeatures.test.ts` — 순수 함수 단위 테스트.
- **Create** `scripts/backfill_training.ts` — KRA API18_1 과거 조교 backfill → jsonl → 로컬 DuckDB.
- **Create** `scripts/backfill_training.test.ts` — 순수 헬퍼(dedup/날짜열거) 테스트.
- **Modify** `src/engine/index.ts` — `ScoreEngineInput`에 조교 필드 + `TrainingSession` 타입.
- **Modify** `src/engine/features/buildFeatures.ts` — mathUtils import + 끝에서 trainingFeatures 합류.
- **Modify** `src/engine/scorePredictor.ts` — `training_logs` as-of 배치 fetch + input 부착.

---

## Task 1: 타입 추가 (ScoreEngineInput 조교 필드 + TrainingSession)

**Files:**
- Modify: `src/engine/index.ts` (`ScoreEngineInput` interface, 시작 line 50)

- [ ] **Step 1: TrainingSession 타입과 ScoreEngineInput 필드 추가**

`src/engine/index.ts`의 `export interface ScoreEngineInput {` (line 50) **바로 위**에 추가:

```ts
/** training_logs의 조교 세션 한 건 (as-of: train_date < race_date). */
export interface TrainingSession {
  trainDate: number;          // YYYYMMDD
  trTerm: number | null;      // 소요시간(초) — 강도 proxy (의미 미확정 ⚠️)
  run1Cnt: number | null;
  run2Cnt: number | null;
  prGubun: string | null;     // 기승자 구분: 이름=기수, 조=조교사, 관=주로조교, 생=교육생, 이름(트)=기수트랙라이더
}
```

그리고 `ScoreEngineInput` 본문 끝(마지막 필드 뒤, 닫는 `}` 앞)에 추가:

```ts
  // 조교 신호 (training signals) — 2026-06-15
  raceDate?: number;                    // 오늘 경주일 YYYYMMDD (조교 윈도우 계산용)
  prevRaceDate?: number | null;         // 직전 경주일 YYYYMMDD (prep 사이클 시작; 신마 null)
  trainingHistory?: TrainingSession[];  // as-of(train_date<raceDate) 조교이력
```

- [ ] **Step 2: 타입체크로 확인**

Run: `npm run build`
Expected: PASS (새 옵셔널 필드라 기존 코드 영향 없음)

- [ ] **Step 3: Commit**

```bash
git add src/engine/index.ts
git commit -m "feat(training): ScoreEngineInput에 조교 신호 필드·TrainingSession 타입 추가"
```

---

## Task 2: math 유틸 공용화 (DRY)

**Files:**
- Create: `src/engine/features/mathUtils.ts`
- Modify: `src/engine/features/buildFeatures.ts` (line 9-27의 로컬 `slope`/`mean`/`std`)

- [ ] **Step 1: mathUtils.ts 생성**

```ts
// src/engine/features/mathUtils.ts
/** 0개면 0. 선형회귀 기울기(인덱스 1..n vs 값). */
export function slope(arr: number[]): number {
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
export function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}
export function std(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}
```

- [ ] **Step 2: buildFeatures.ts에서 로컬 정의 제거하고 import**

`src/engine/features/buildFeatures.ts` line 9-27의 `function slope`/`function mean`/`function std` 세 정의를 삭제하고, 상단 import 블록에 추가:

```ts
import { slope, mean, std } from './mathUtils.js';
```

(`std`가 buildFeatures에서 안 쓰이면 `import { slope, mean } from './mathUtils.js';`로. 사용처는 grep으로 확인.)

- [ ] **Step 3: 기존 테스트로 회귀 없음 확인**

Run: `npm run build && npm run test:run`
Expected: PASS (동작 동일, 정의 위치만 이동)

- [ ] **Step 4: Commit**

```bash
git add src/engine/features/mathUtils.ts src/engine/features/buildFeatures.ts
git commit -m "refactor(features): slope/mean/std를 mathUtils로 공용화"
```

---

## Task 3: 순수 피처 추출 함수 `trainingFeatures` (핵심)

**Files:**
- Create: `src/engine/features/trainingFeatures.ts`
- Test: `src/engine/features/trainingFeatures.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/engine/features/trainingFeatures.test.ts
import { describe, it, expect } from 'vitest';
import { trainingFeatures, isJockeyRidden } from './trainingFeatures.js';
import type { TrainingSession } from '../index.js';

const get = (fs: { name: string; value: number }[], n: string) =>
  fs.find((f) => f.name === n)?.value;

describe('isJockeyRidden', () => {
  it('역할코드(조/관/생)는 기수 아님', () => {
    expect(isJockeyRidden('조')).toBe(false);
    expect(isJockeyRidden('관')).toBe(false);
    expect(isJockeyRidden('생')).toBe(false);
  });
  it('이름/이름(트)/기타는 기수로 간주', () => {
    expect(isJockeyRidden('김기수')).toBe(true);
    expect(isJockeyRidden('박철수(트)')).toBe(true);
  });
  it('null·빈문자는 false', () => {
    expect(isJockeyRidden(null)).toBe(false);
    expect(isJockeyRidden('')).toBe(false);
  });
});

describe('trainingFeatures', () => {
  it('데이터 없으면 has_data=0', () => {
    const fs = trainingFeatures({ trainingHistory: [], prevRaceDate: 20260501, raceDate: 20260515 });
    expect(get(fs, 'train_has_data')).toBe(0);
    expect(get(fs, 'train_window_is_fallback')).toBe(0);
  });

  it('prep 윈도우[직전경주,경주) 내 조교만 집계', () => {
    const hist: TrainingSession[] = [
      { trainDate: 20260430, trTerm: 60, run1Cnt: 1, run2Cnt: 0, prGubun: '김기수' }, // 직전경주 이전 → 제외
      { trainDate: 20260505, trTerm: 70, run1Cnt: 2, run2Cnt: 0, prGubun: '조' },
      { trainDate: 20260512, trTerm: 90, run1Cnt: 2, run2Cnt: 1, prGubun: '이기수' },
    ];
    const fs = trainingFeatures({ trainingHistory: hist, prevRaceDate: 20260501, raceDate: 20260515 });
    expect(get(fs, 'train_has_data')).toBe(1);
    expect(get(fs, 'train_count')).toBe(2);                 // 05,12만
    expect(get(fs, 'train_days_since_last')).toBe(3);       // 0512→0515
    expect(get(fs, 'train_jockey_ridden_ratio')).toBeCloseTo(0.5); // 이기수만
    expect(get(fs, 'train_last_rider_is_jockey')).toBe(1);  // 0512=이기수
    expect(get(fs, 'train_term_mean')).toBeCloseTo(80);     // (70+90)/2
    expect(get(fs, 'train_term_last')).toBe(90);
  });

  it('신마(prevRaceDate=null)는 fallback 90일 + 플래그', () => {
    const hist: TrainingSession[] = [
      { trainDate: 20260510, trTerm: 50, run1Cnt: 1, run2Cnt: 0, prGubun: '조' },
    ];
    const fs = trainingFeatures({ trainingHistory: hist, prevRaceDate: null, raceDate: 20260515 });
    expect(get(fs, 'train_window_is_fallback')).toBe(1);
    expect(get(fs, 'train_has_data')).toBe(1);
    expect(get(fs, 'train_count')).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/engine/features/trainingFeatures.test.ts`
Expected: FAIL ("Cannot find module './trainingFeatures.js'")

- [ ] **Step 3: 구현**

```ts
// src/engine/features/trainingFeatures.ts
import type { Feature } from './types.js';
import type { TrainingSession } from '../index.js';
import { mean, slope } from './mathUtils.js';

const ROLE_CODES = new Set(['조', '관', '생']); // 조교사/주로조교/교육생 = 기수 아님

/** pr_gubun이 역할코드(조/관/생)가 아니면 기수(이름/이름(트))가 탄 것으로 간주. ⚠️ KRA 매뉴얼로 확정 예정. */
export function isJockeyRidden(prGubun: string | null | undefined): boolean {
  if (prGubun == null || prGubun === '') return false;
  return !ROLE_CODES.has(prGubun);
}

function ymdToDate(ymd: number): Date {
  return new Date(Date.UTC(Math.floor(ymd / 10000), Math.floor((ymd % 10000) / 100) - 1, ymd % 100));
}
function daysBetweenYmd(a: number, b: number): number {
  return Math.round((ymdToDate(b).getTime() - ymdToDate(a).getTime()) / 86400000);
}
function subtractDaysYmd(ymd: number, n: number): number {
  const d = ymdToDate(ymd);
  d.setUTCDate(d.getUTCDate() - n);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}
function weeklyCountSlope(rows: TrainingSession[], windowStart: number, raceDate: number): number {
  const totalDays = Math.max(1, daysBetweenYmd(windowStart, raceDate));
  const weeks = Math.max(1, Math.ceil(totalDays / 7));
  const buckets = new Array(weeks).fill(0);
  for (const r of rows) {
    const off = daysBetweenYmd(windowStart, r.trainDate);
    buckets[Math.min(weeks - 1, Math.max(0, Math.floor(off / 7)))]++;
  }
  return slope(buckets);
}

export interface TrainingFeatureContext {
  trainingHistory: TrainingSession[]; // as-of (train_date < raceDate), 순서 무관
  prevRaceDate: number | null;        // 직전 경주일 (신마 null)
  raceDate: number;
  fallbackDays?: number;              // 신마용 윈도우 길이 (기본 90)
}

/** prep 사이클 윈도우 [windowStart, raceDate) 기준 조교 raw 피처. 가치판단 없음 — 모델이 학습. */
export function trainingFeatures(ctx: TrainingFeatureContext): Feature[] {
  const { trainingHistory, prevRaceDate, raceDate } = ctx;
  const fallbackDays = ctx.fallbackDays ?? 90;
  const f: Feature[] = [];
  const add = (name: string, value: number) => f.push({ name, value });

  const isFallback = prevRaceDate == null;
  const windowStart = isFallback ? subtractDaysYmd(raceDate, fallbackDays) : prevRaceDate;
  add('train_window_is_fallback', isFallback ? 1 : 0);

  const rows = trainingHistory
    .filter((t) => t.trainDate >= windowStart && t.trainDate < raceDate)
    .sort((a, b) => a.trainDate - b.trainDate); // oldest→recent

  add('train_has_data', rows.length > 0 ? 1 : 0);
  if (rows.length === 0) return f;

  const last = rows[rows.length - 1]!;

  // ① 최근성·간격
  add('train_days_since_last', daysBetweenYmd(last.trainDate, raceDate));
  add('train_count', rows.length);
  const prepDays = Math.max(1, daysBetweenYmd(windowStart, raceDate));
  add('train_count_per_week', rows.length / (prepDays / 7));

  // ③ 기승자 격
  const jockeyRidden = rows.filter((r) => isJockeyRidden(r.prGubun)).length;
  add('train_jockey_ridden_ratio', jockeyRidden / rows.length);
  add('train_last_rider_is_jockey', isJockeyRidden(last.prGubun) ? 1 : 0);

  // ② 강도 (⚠️ trTerm·run 의미 미확정 — 게이트로 검증)
  const terms = rows.map((r) => r.trTerm).filter((x): x is number => x != null);
  if (terms.length > 0) {
    add('train_term_mean', mean(terms));
    add('train_term_last', last.trTerm ?? mean(terms));
    add('train_term_slope', slope(rows.map((r) => r.trTerm ?? 0)));
  }
  add('train_run_cnt_mean', mean(rows.map((r) => (r.run1Cnt ?? 0) + (r.run2Cnt ?? 0))));

  // ④ 빈도 추세
  add('train_freq_slope', weeklyCountSlope(rows, windowStart, raceDate));

  return f;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/engine/features/trainingFeatures.test.ts`
Expected: PASS (전부)

- [ ] **Step 5: Commit**

```bash
git add src/engine/features/trainingFeatures.ts src/engine/features/trainingFeatures.test.ts
git commit -m "feat(training): prep 사이클 윈도우 조교 raw 피처 추출 함수 + 테스트"
```

---

## Task 4: buildFeatures에 조교 피처 합류

**Files:**
- Modify: `src/engine/features/buildFeatures.ts`
- Test: `src/engine/features/buildFeatures.training.test.ts` (신규)

- [ ] **Step 1: 실패하는 통합 테스트 작성**

```ts
// src/engine/features/buildFeatures.training.test.ts
import { describe, it, expect } from 'vitest';
import { buildFeatures } from './buildFeatures.js';
import type { ScoreEngineInput } from '../index.js';

describe('buildFeatures + 조교', () => {
  it('raceDate·trainingHistory 있으면 조교 피처가 합류된다', () => {
    const input: ScoreEngineInput = {
      rating: 0,
      raceDate: 20260515,
      prevRaceDate: 20260501,
      trainingHistory: [
        { trainDate: 20260512, trTerm: 90, run1Cnt: 2, run2Cnt: 1, prGubun: '이기수' },
      ],
    };
    const fs = buildFeatures(input);
    const names = fs.map((f) => f.name);
    expect(names).toContain('train_has_data');
    expect(names).toContain('train_count');
    expect(fs.find((f) => f.name === 'train_count')?.value).toBe(1);
  });

  it('raceDate 없으면 조교 피처 미합류(기존 동작 보존)', () => {
    const fs = buildFeatures({ rating: 0 });
    expect(fs.map((f) => f.name).some((n) => n.startsWith('train_'))).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/features/buildFeatures.training.test.ts`
Expected: FAIL (`train_*` 피처 없음)

- [ ] **Step 3: buildFeatures.ts 수정**

상단 import에 추가:

```ts
import { trainingFeatures } from './trainingFeatures.js';
```

`buildFeatures()` 함수 본문 **맨 끝, 피처 배열 `f`를 반환하기 직전**에 추가:

```ts
  // 조교 신호 (raceDate 있을 때만 — 기존 호출부 영향 없음)
  if (input.raceDate != null) {
    for (const tf of trainingFeatures({
      trainingHistory: input.trainingHistory ?? [],
      prevRaceDate: input.prevRaceDate ?? null,
      raceDate: input.raceDate,
    })) {
      f.push(tf);
    }
  }
```

- [ ] **Step 4: 통과 + 회귀 없음 확인**

Run: `npm run build && npx vitest run src/engine/features/`
Expected: PASS (전부)

- [ ] **Step 5: Commit**

```bash
git add src/engine/features/buildFeatures.ts src/engine/features/buildFeatures.training.test.ts
git commit -m "feat(training): buildFeatures에 조교 피처 합류 (raceDate 가드)"
```

---

## Task 5: gatherRaceInputs에 조교 as-of 조인

**Files:**
- Modify: `src/engine/scorePredictor.ts` (배치 fetch 블록 ~line 191-205, `RaceBatch` interface ~line 265, rows.map ~line 207-218)

- [ ] **Step 1: RaceBatch에 trainingByHorse 추가**

`interface RaceBatch {` (line 265)에 필드 추가:

```ts
  trainingByHorse: Map<string, import('./index.js').TrainingSession[]>; // key: hr_no
```

- [ ] **Step 2: training_logs 배치 fetch 추가**

`gatherRaceInputs` 안, `const batch: RaceBatch = {...}` (line 205) **직전**에 추가:

```ts
  // (G) 조교이력 as-of: hr_no별 train_date<rcDate (최근 365일 캡). 누수 0.
  const trainingByHorse = new Map<string, import('./index.js').TrainingSession[]>();
  if (hrNosU.length > 0) {
    const trainFloor = subtractDays(rcDate, 365);
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb.from('training_logs')
        .select('hr_no, train_date, tr_term, run1_cnt, run2_cnt, pr_gubun')
        .in('hr_no', hrNosU)
        .gte('train_date', trainFloor)
        .lt('train_date', rcDate)
        .order('hr_no').order('train_date', { ascending: false })
        .range(off, off + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data as Array<{ hr_no: string; train_date: number; tr_term: number | null; run1_cnt: number | null; run2_cnt: number | null; pr_gubun: string | null }>) {
        const s = { trainDate: r.train_date, trTerm: r.tr_term, run1Cnt: r.run1_cnt, run2Cnt: r.run2_cnt, prGubun: r.pr_gubun };
        const a = trainingByHorse.get(r.hr_no); if (a) a.push(s); else trainingByHorse.set(r.hr_no, [s]);
      }
      if (data.length < 1000) break;
    }
  }
```

그리고 `const batch: RaceBatch = {` 객체에 `trainingByHorse,` 추가.

> 참고: `subtractDays`는 이 파일에 이미 정의됨(line 196 사용처). 없으면 `dateMinusDays` 사용.

- [ ] **Step 3: rows.map에서 input에 부착**

`rows.map` 블록(line 207-218), `input.allRaceBodyWeights = allRaceBodyWeights;` (line 215) **다음 줄**에 추가:

```ts
      input.raceDate = e.race_date;
      input.prevRaceDate = batch.histByHorse.get(e.hr_name)?.[0]?.race_date ?? null;
      input.trainingHistory = e.hr_no ? (batch.trainingByHorse.get(e.hr_no) ?? []) : [];
```

> `histByHorse[hr_name]`는 race_date DESC 정렬(line 163)이므로 `[0]`이 직전 경주일.

- [ ] **Step 4: 타입체크 + 기존 테스트**

Run: `npm run build && npm run test:run`
Expected: PASS

- [ ] **Step 5: 통합 스모크 — 조교 피처가 실제 경주에서 채워지는지(데이터 있는 날)**

임시 스크립트로 2026-05-23 한 경주의 features에 `train_*`가 있는지 확인(조교 데이터 보유 구간):

```bash
npx tsx -e "import {getLocalReadClient} from './src/db/localDb.js'; import {gatherRaceInputs} from './src/engine/scorePredictor.js'; import {buildFeatures} from './src/engine/features/buildFeatures.js'; const db=await getLocalReadClient(); const {data:r}=await db.from('races').select('race_date,meet,rc_no').gte('race_date',20260523).lte('race_date',20260525).limit(1); const x=r[0]; const rows=await gatherRaceInputs(db,x.race_date,x.meet,x.rc_no); const f=buildFeatures(rows[0].input); console.log(f.filter(z=>z.name.startsWith('train_')));"
```

Expected: `train_*` 피처 배열 출력(예: train_has_data, train_count …). 비어 있으면 hr_no 키 매칭/적재 점검.

> ⚠️ `getLocalReadClient` 정확한 export명은 `src/db/localDb.ts`에서 확인 후 맞출 것.

- [ ] **Step 6: Commit**

```bash
git add src/engine/scorePredictor.ts
git commit -m "feat(training): gatherRaceInputs에 조교이력 as-of 조인 + prevRaceDate 부착"
```

---

## Task 6: Backfill 스크립트 (KRA → 로컬)

**Files:**
- Create: `scripts/backfill_training.ts`
- Test: `scripts/backfill_training.test.ts`

- [ ] **Step 1: 순수 헬퍼 테스트 작성 (dedup + 날짜열거)**

```ts
// scripts/backfill_training.test.ts
import { describe, it, expect } from 'vitest';
import { enumerateDates, dedupTrainingRows } from './backfill_training.js';

describe('enumerateDates', () => {
  it('월 경계 포함 일별 열거', () => {
    expect(enumerateDates(20240228, 20240302)).toEqual([20240228, 20240229, 20240301, 20240302]); // 2024 윤년
  });
});

describe('dedupTrainingRows', () => {
  it('PK(train_date,meet,hr_no,part) 중복 제거(후자 우선)', () => {
    const rows = [
      { train_date: 20240521, meet: 1, hr_no: 'A', part: 1, tr_term: 60 },
      { train_date: 20240521, meet: 1, hr_no: 'A', part: 1, tr_term: 99 },
      { train_date: 20240521, meet: 1, hr_no: 'B', part: 1, tr_term: 70 },
    ] as any[];
    const out = dedupTrainingRows(rows);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.hr_no === 'A')!.tr_term).toBe(99);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run scripts/backfill_training.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// scripts/backfill_training.ts
import 'dotenv/config';
import { getKRAClient } from '../src/kra/client.js';
import { toTrainingRow, type TrainingLogRow } from '../src/sync/transformer.js';
import { DuckDBInstance } from '@duckdb/node-api';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MeetCode } from '../src/types/index.js';

const DB_PATH = 'data/local.duckdb';
const JSONL_PATH = 'data/training_logs_full.jsonl';

export function enumerateDates(from: number, to: number): number[] {
  const d = (y: number) => new Date(Date.UTC(Math.floor(y / 10000), Math.floor((y % 10000) / 100) - 1, y % 100));
  const out: number[] = [];
  let cur = d(from); const end = d(to);
  while (cur <= end) {
    out.push(cur.getUTCFullYear() * 10000 + (cur.getUTCMonth() + 1) * 100 + cur.getUTCDate());
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function dedupTrainingRows(rows: TrainingLogRow[]): TrainingLogRow[] {
  const m = new Map<string, TrainingLogRow>();
  for (const r of rows) m.set(`${r.train_date}-${r.meet}-${r.hr_no}-${r.part}`, r);
  return [...m.values()];
}

async function fetchDateMeet(kra: any, meet: MeetCode, trDate: number, tries = 5): Promise<TrainingLogRow[] | null> {
  for (let i = 1; i <= tries; i++) {
    try {
      const recs = await kra.getAllTrainingHistory({ meet, trDate });
      return recs.map(toTrainingRow);
    } catch (e) {
      if (i === tries) return null; // 끝까지 실패 → 호출부가 failed에 기록
      await new Promise((r) => setTimeout(r, 1500 * i)); // 지수 백오프(502 대응)
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const argOf = (k: string, def: number) => { const i = args.indexOf(k); return i >= 0 ? parseInt(args[i + 1]!, 10) : def; };
  const today = new Date();
  const todayNum = today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate();
  const from = argOf('--from', 20240401);
  const to = argOf('--to', todayNum);
  const meetsArg = args.indexOf('--meet');
  const meets: MeetCode[] = meetsArg >= 0 ? args[meetsArg + 1]!.split(',').map((s) => parseInt(s, 10) as MeetCode) : [1, 3];

  const kra = getKRAClient();
  const dates = enumerateDates(from, to);
  console.log(`backfill: ${from}~${to} (${dates.length}일) × meets ${meets.join(',')}`);

  const all: TrainingLogRow[] = [];
  const failed: string[] = [];
  let done = 0;
  for (const trDate of dates) {
    for (const meet of meets) {
      const rows = await fetchDateMeet(kra, meet, trDate);
      if (rows === null) { failed.push(`${trDate}-${meet}`); }
      else all.push(...rows);
    }
    if (++done % 50 === 0) console.log(`  ...${done}/${dates.length}일, 누적 ${all.length}행, 실패 ${failed.length}`);
  }

  const deduped = dedupTrainingRows(all);
  writeFileSync(JSONL_PATH, deduped.map((r) => JSON.stringify(r)).join('\n'));
  console.log(`jsonl 기록: ${deduped.length}행 → ${JSONL_PATH}`);

  // 로컬 DuckDB training_logs 교체 적재
  const tmp = join(tmpdir(), 'backfill_training.json').replace(/\\/g, '/');
  writeFileSync(tmp, JSON.stringify(deduped));
  const inst = await DuckDBInstance.create(DB_PATH);
  const conn = await inst.connect();
  await conn.run('DROP TABLE IF EXISTS training_logs');
  await conn.run(`CREATE TABLE training_logs AS SELECT * FROM read_json_auto('${tmp}')`);
  console.log(`DuckDB training_logs 적재 완료`);

  if (failed.length) console.log(`⚠️ 실패 ${failed.length}건(재실행으로 보충): ${failed.slice(0, 20).join(', ')}${failed.length > 20 ? ' …' : ''}`);
}

const isMain = process.argv[1] && process.argv[1].includes('backfill_training');
if (isMain) main().catch((e) => { console.error('💥', e); process.exit(1); });
```

> `TrainingLogRow` export 확인: `src/sync/transformer.ts`에 `export interface TrainingLogRow`(line 416) 이미 export됨.

- [ ] **Step 4: 순수 헬퍼 테스트 통과**

Run: `npm run build && npx vitest run scripts/backfill_training.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill_training.ts scripts/backfill_training.test.ts
git commit -m "feat(training): KRA→로컬 조교 backfill 스크립트 (502 재시도·dedup·DuckDB 적재)"
```

---

## Task 7: 실행 검증 — backfill → 커버리지 → benchmark 게이트A/B

**Files:** (실행·문서. 사용자 위임 가능 — 대용량·장시간)

- [ ] **Step 1: Backfill 실행 (사용자 위임 권장)**

Run: `npx tsx scripts/backfill_training.ts --from 20240401 --to <오늘>`
Expected: `data/training_logs_full.jsonl` 생성, DuckDB training_logs 적재. 실패건은 재실행:
`npx tsx scripts/backfill_training.ts --from <실패시작> --to <실패끝>` (전체 재실행도 무방 — 멱등)

- [ ] **Step 2: 커버리지 확인**

Run (DuckDB 직접):
```bash
npx tsx -e "import {DuckDBInstance} from '@duckdb/node-api'; const c=await (await DuckDBInstance.create('data/local.duckdb')).connect(); const r=await c.run(\"WITH re AS (SELECT strptime(CAST(race_date AS VARCHAR),'%Y%m%d') rd, hr_no FROM race_entries WHERE race_date>=20240601), tl AS (SELECT strptime(CAST(train_date AS VARCHAR),'%Y%m%d') td, hr_no FROM training_logs) SELECT COUNT(*) e, SUM(CASE WHEN EXISTS(SELECT 1 FROM tl WHERE tl.hr_no=re.hr_no AND tl.td<re.rd AND tl.td>=re.rd-INTERVAL 60 DAY) THEN 1 ELSE 0 END) cov FROM re\"); console.log(await r.getRowObjects());"
```
Expected: `cov/e ≥ 0.8` (2024-06 이후). 미달이면 backfill 범위/실패건 점검 후 재실행.

- [ ] **Step 3: Benchmark 게이트A/B 실행**

Run: `npm run benchmark`
Expected: ASCII 리포트. **게이트A**에서 `train_*` 피처의 결과 상관·기존피처 중복 판정, **게이트B**에서 조교 피처 편입 모델의 롤링 연승률·시장격차 변화 확인.

- [ ] **Step 4: 결과 기록 (양성/음성 모두)**

- `docs/score_roadmap.md`: 조교 피처 ρ·게이트 판정 추가.
- `docs/accuracy_metrics.md`: 검증 방법에 조교 신호 추가(통과 시).
- 메모리 `project_feature_gate_findings.md` 갱신: 조교 신호 게이트A/B 결과(채택/기각).
- `CLAUDE.md` 현재 실행 상태: 조교 backfill·검증 결과 한 줄.

- [ ] **Step 5: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs(training): 조교 신호 게이트A/B 검증 결과 기록"
```

---

## Self-Review 메모

- **스펙 커버리지:** ① 최근성(Task3 days_since_last/count/per_week) · ③ 기승자격(jockey_ratio/last) · ② 강도(term_mean/last/slope·run_cnt) · ④ 추세(term_slope·freq_slope) 모두 Task3. backfill 로컬 우회(Task6). as-of 누수 0(Task5 train_date<rcDate). 게이트A/B(Task7). 신마 fallback+플래그(Task3). 모두 매핑됨.
- **타입 일관성:** `TrainingSession{trainDate,trTerm,run1Cnt,run2Cnt,prGubun}` — Task1 정의, Task3/4/5에서 동일 사용. `trainingFeatures`/`isJockeyRidden`/`enumerateDates`/`dedupTrainingRows` 시그니처 테스트와 구현 일치.
- **미확정(의도적):** `run1/2_cnt`·`tr_term` 의미는 ②에 한정. KRA 매뉴얼 확정 전까지 게이트로 검증(음성이면 기각). `getLocalReadClient` export명은 Task5 Step5에서 실제 확인.
