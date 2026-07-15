# 페이스 조건부 성적 (pace_fit·pace_sens) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 말별 과거 전적을 실측 페이스(HOT/NORMAL/SLOW)로 쪼갠 조건부 성적 피처 3개(pace_fit·pace_sens·pace_fit_n)를 만들어 통제 A/B로 채택/기각 판정한다.

**Architecture:** 과거 경주의 실측 페이스 라벨은 그 경주의 초반 200m 평균(`race_sectional_stats.avg_s1f`)을 meet×거리 par(중앙값)와 비교해 매긴다(pacePar.ts — shapePar.ts 선례 복제). 말별 버킷 집계는 `fetchAsOfHorseStats`에 통합(기존 race_sectional_stats 조회의 select만 확장 — 새 쿼리 0). 순수 계산은 `paceForm.ts`, 피처 노출은 `buildFeatures`(라이브 v7은 스키마 필터로 무시 — logisticScorer.ts:19 확인됨).

**Tech Stack:** TypeScript + vitest + DuckDB 로컬 미러 (`getLocalDb`/ReadClient). KRA API·Supabase 쓰기 없음.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-15-pace-conditional-form-design.md` — 판정은 **통제 A/B만** (사전등록: 연승 Δ ≥ +1.0%p AND 5분기 중 3분기 이상 양수). 게이트A(probe:corr)는 진단 전용.
- 이번 경주 자신의 실측 데이터 사용 금지 — 과거 경주(`race_date < rcDate`) 행만. par cutoff는 기존 `opts?.shapeParCutoff ?? rcDate` 관례 재사용.
- 임계값·shrinkage k는 Task 4 probe 분포로 확정 (초깃값은 자리표시가 아니라 시작점 — probe가 갱신).
- 라이브 승격 없음 (L-003 동결). `promote`·`model_versions` 변경 금지.
- 커밋 메시지 한국어 + scope. 매 커밋 전 `npm run build` + `npm run test:run` 통과.
- DB 원천 변경(마이그레이션) 없음. Supabase egress 유발 명령 금지 (모든 실행은 로컬 미러).
- 브랜치: `feat/pace-conditional-form` (이미 존재, 스펙 커밋 298c3af 위에 쌓기).

---

### Task 1: 기각된 shape_d6_best 제거 (통제 A/B 오염 방지)

shape_d6_best는 2026-07-14 게이트B 기각됐으나 커밋 89d2df2의 코드가 남아 있다. 그대로 두면 이번 재추출·벤치마크 두 팔(ON/OFF) 모두에 섞여 스펙과 실측이 어긋난다. 커밋 하나로 추가된 것이므로 revert가 정확하다.

**Files:**
- Modify (revert로 자동): `src/engine/features/shapeSignals.ts`, `src/engine/features/shapeSignals.test.ts`, `src/engine/features/buildFeatures.ts`, `src/engine/index.ts`, `src/engine/scorePredictor.ts`

**Interfaces:**
- Produces: `HorseShapeStats`에서 `bestD6` 필드 제거됨 — 이후 Task는 bestD6 부재 전제.

- [ ] **Step 1: revert 실행**

```bash
git revert --no-edit 89d2df2
```

Expected: 충돌 없이 revert 커밋 생성. 충돌 시(이후 커밋이 같은 라인을 건드린 경우) `git revert --abort` 후 수동으로 5개 파일에서 bestD6/shapeD6Best/shape_d6_best 관련 라인 제거.

- [ ] **Step 2: 빌드·테스트로 잔재 확인**

Run: `npm run build && npm run test:run`
Expected: PASS (bestD6 참조가 남아 있으면 tsc 에러 — 해당 라인 마저 제거)

Run: `grep -rn "shape_d6_best\|shapeD6Best\|bestD6" src/ scripts/ client/src/`
Expected: 매치 0건

- [ ] **Step 3: 커밋 (revert 커밋이 이미 생성됐으므로 잔재 수정이 있었을 때만 추가 커밋)**

```bash
git commit -am "fix(shape): shape_d6_best 잔재 제거 — 기각 피처는 buildFeatures에서 즉시 제거 원칙"
```

---

### Task 2: paceForm.ts — 순수 계산 모듈 (TDD)

**Files:**
- Create: `src/engine/features/paceForm.ts`
- Test: `src/engine/features/paceForm.test.ts`

**Interfaces:**
- Produces (이후 Task가 그대로 import):
  - `type PaceBucket = 'HOT' | 'NORMAL' | 'SLOW'`
  - `labelPastRacePace(avgS1f: number | null | undefined, parS1f: number | null | undefined): PaceBucket | null`
  - `interface PaceBucketStat { mean: number; n: number }` / `type PaceFormStats = Partial<Record<PaceBucket, PaceBucketStat>>`
  - `computePaceFormStats(races: Array<{ finishRatio: number; paceLabel: PaceBucket | null }>): PaceFormStats`
  - `paceFormFeatures(stats: PaceFormStats | undefined, careerFinishRatio: number | null | undefined, currentPace: PaceBucket): { paceFit: number | null; paceSens: number | null; paceFitN: number }`
  - 상수: `PACE_HOT_DELTA`, `PACE_SLOW_DELTA`, `PACE_FIT_SHRINK_K`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/engine/features/paceForm.test.ts
import { describe, it, expect } from 'vitest';
import {
  labelPastRacePace, computePaceFormStats, paceFormFeatures,
  PACE_HOT_DELTA, PACE_SLOW_DELTA, PACE_FIT_SHRINK_K,
} from './paceForm.js';

describe('labelPastRacePace', () => {
  it('par보다 임계 이상 빠르면 HOT, 느리면 SLOW, 사이는 NORMAL', () => {
    expect(labelPastRacePace(13.0 + PACE_HOT_DELTA, 13.0)).toBe('HOT');
    expect(labelPastRacePace(13.0 + PACE_SLOW_DELTA, 13.0)).toBe('SLOW');
    expect(labelPastRacePace(13.0, 13.0)).toBe('NORMAL');
  });
  it('결측·비양수는 null', () => {
    expect(labelPastRacePace(null, 13.0)).toBeNull();
    expect(labelPastRacePace(13.0, null)).toBeNull();
    expect(labelPastRacePace(0, 13.0)).toBeNull();
  });
});

describe('computePaceFormStats', () => {
  it('라벨별 finish_ratio 평균과 표본수', () => {
    const s = computePaceFormStats([
      { finishRatio: 0.2, paceLabel: 'HOT' },
      { finishRatio: 0.4, paceLabel: 'HOT' },
      { finishRatio: 0.8, paceLabel: 'SLOW' },
      { finishRatio: 0.5, paceLabel: null }, // 라벨 불가 → 제외
    ]);
    expect(s.HOT).toEqual({ mean: expect.closeTo(0.3, 10), n: 2 });
    expect(s.SLOW).toEqual({ mean: 0.8, n: 1 });
    expect(s.NORMAL).toBeUndefined();
  });
});

describe('paceFormFeatures', () => {
  const stats = {
    HOT: { mean: 0.25, n: 3 },
    SLOW: { mean: 0.65, n: 2 },
  };
  it('pace_fit = (버킷평균 - 통산) × n/(n+K) 수축', () => {
    const { paceFit, paceFitN } = paceFormFeatures(stats, 0.5, 'HOT');
    expect(paceFit).toBeCloseTo((0.25 - 0.5) * (3 / (3 + PACE_FIT_SHRINK_K)), 10);
    expect(paceFitN).toBe(3);
  });
  it('버킷 없음 → paceFit null, n=0', () => {
    const { paceFit, paceFitN } = paceFormFeatures(stats, 0.5, 'NORMAL');
    expect(paceFit).toBeNull();
    expect(paceFitN).toBe(0);
  });
  it('통산 결측 → paceFit null', () => {
    expect(paceFormFeatures(stats, null, 'HOT').paceFit).toBeNull();
  });
  it('pace_sens = n≥2 버킷 평균의 최대-최소, 유효 버킷 2개 미만이면 null', () => {
    expect(paceFormFeatures(stats, 0.5, 'HOT').paceSens).toBeCloseTo(0.65 - 0.25, 10);
    expect(paceFormFeatures({ HOT: { mean: 0.3, n: 5 } }, 0.5, 'HOT').paceSens).toBeNull();
    // n=1 버킷은 sens에서 제외
    expect(paceFormFeatures({ HOT: { mean: 0.3, n: 5 }, SLOW: { mean: 0.9, n: 1 } }, 0.5, 'HOT').paceSens).toBeNull();
  });
  it('stats undefined → 전부 결측', () => {
    expect(paceFormFeatures(undefined, 0.5, 'HOT')).toEqual({ paceFit: null, paceSens: null, paceFitN: 0 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/features/paceForm.test.ts`
Expected: FAIL — "Cannot find module './paceForm.js'"

- [ ] **Step 3: 구현**

```ts
// src/engine/features/paceForm.ts
/**
 * 페이스 조건부 성적 (pace_fit·pace_sens) — 순수 계산.
 * 스펙: docs/superpowers/specs/2026-07-15-pace-conditional-form-design.md §2·§3
 * 과거 경주의 실측 페이스(초반 200m vs par) 라벨 × finish_ratio 버킷 집계.
 * 임계값·K는 probe:pace-form 분포로 확정된 값 (아래 상수 주석 참조).
 */
export type PaceBucket = 'HOT' | 'NORMAL' | 'SLOW';

// 초깃값 — Task 4 probe(델타 30/70 분위)로 갱신. 갱신 시 이 주석에 probe 실행일 기록.
export const PACE_HOT_DELTA = -0.25;  // avg_s1f − par ≤ 이 값(초) → HOT
export const PACE_SLOW_DELTA = 0.25;  // avg_s1f − par ≥ 이 값(초) → SLOW
export const PACE_FIT_SHRINK_K = 3;   // pace_fit 수축: × n/(n+K)
const SENS_MIN_N = 2;                 // pace_sens에 참여하는 버킷 최소 표본

export function labelPastRacePace(
  avgS1f: number | null | undefined,
  parS1f: number | null | undefined
): PaceBucket | null {
  if (avgS1f == null || parS1f == null || !(avgS1f > 0)) return null;
  const d = avgS1f - parS1f;
  if (d <= PACE_HOT_DELTA) return 'HOT';
  if (d >= PACE_SLOW_DELTA) return 'SLOW';
  return 'NORMAL';
}

export interface PaceBucketStat { mean: number; n: number }
export type PaceFormStats = Partial<Record<PaceBucket, PaceBucketStat>>;

export function computePaceFormStats(
  races: Array<{ finishRatio: number; paceLabel: PaceBucket | null }>
): PaceFormStats {
  const acc = new Map<PaceBucket, number[]>();
  for (const r of races) {
    if (r.paceLabel == null) continue;
    const a = acc.get(r.paceLabel);
    if (a) a.push(r.finishRatio); else acc.set(r.paceLabel, [r.finishRatio]);
  }
  const out: PaceFormStats = {};
  for (const [k, v] of acc) out[k] = { mean: v.reduce((s, x) => s + x, 0) / v.length, n: v.length };
  return out;
}

export interface PaceFormFeatureOut { paceFit: number | null; paceSens: number | null; paceFitN: number }

export function paceFormFeatures(
  stats: PaceFormStats | undefined,
  careerFinishRatio: number | null | undefined,
  currentPace: PaceBucket
): PaceFormFeatureOut {
  const bucket = stats?.[currentPace];
  const paceFitN = bucket?.n ?? 0;
  let paceFit: number | null = null;
  if (bucket && careerFinishRatio != null) {
    paceFit = (bucket.mean - careerFinishRatio) * (bucket.n / (bucket.n + PACE_FIT_SHRINK_K));
  }
  const means = (['HOT', 'NORMAL', 'SLOW'] as const)
    .map((b) => stats?.[b])
    .filter((s): s is PaceBucketStat => s != null && s.n >= SENS_MIN_N)
    .map((s) => s.mean);
  const paceSens = means.length >= 2 ? Math.max(...means) - Math.min(...means) : null;
  return { paceFit, paceSens, paceFitN };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/features/paceForm.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/engine/features/paceForm.ts src/engine/features/paceForm.test.ts
git commit -m "feat(pace): paceForm 순수 계산 모듈 — 실측 페이스 라벨·버킷 집계·수축 피처 (스펙 2026-07-15)"
```

---

### Task 3: pacePar.ts — meet×거리 초반 par 맵 (TDD)

`shapePar.ts` 선례를 그대로 따른다: 소스 1회 로드 + cutoff별 메모이즈. 소스는 `race_sectional_stats`(경주당 1행, ~3.6k행)라 가볍다.

**Files:**
- Create: `src/engine/pacePar.ts`
- Test: `src/engine/pacePar.test.ts`

**Interfaces:**
- Consumes: `ReadClient` (`src/db/localDb.js`)
- Produces:
  - `type PaceParMap = Map<string, number>` (key = `paceParKey(meet, rcDist)` = `` `${meet}|${rcDist}` ``, value = avg_s1f 중앙값)
  - `paceParKey(meet: number, rcDist: number): string`
  - `buildPaceParMap(rows: PaceParSourceRow[], cutoffDate: number): PaceParMap`
  - `paceParMapAsOf(sb: ReadClient, cutoffDate: number): Promise<PaceParMap>`
  - `interface PaceParSourceRow { raceDate: number; meet: number; rcDist: number; avgS1f: number }`
  - 상수: `PACE_PAR_MIN_ROWS = 30`

- [ ] **Step 1: 실패하는 테스트 작성 (순수 빌더만 — as-of cutoff·최소행수)**

```ts
// src/engine/pacePar.test.ts
import { describe, it, expect } from 'vitest';
import { buildPaceParMap, paceParKey, PACE_PAR_MIN_ROWS } from './pacePar.js';

function rows(n: number, avgS1f: (i: number) => number, raceDate = 20240101) {
  return Array.from({ length: n }, (_, i) => ({ raceDate, meet: 1, rcDist: 1200, avgS1f: avgS1f(i) }));
}

describe('buildPaceParMap', () => {
  it('중앙값 par + 최소행수 미달 버킷 제외', () => {
    const map = buildPaceParMap(rows(PACE_PAR_MIN_ROWS, (i) => 13 + (i % 3) * 0.1), 20250101);
    expect(map.get(paceParKey(1, 1200))).toBeCloseTo(13.1, 5);
    const small = buildPaceParMap(rows(PACE_PAR_MIN_ROWS - 1, () => 13), 20250101);
    expect(small.size).toBe(0);
  });
  it('cutoff 이후 행은 par에 반영 안 됨 (as-of)', () => {
    const past = rows(PACE_PAR_MIN_ROWS, () => 13.0, 20240101);
    const future = rows(PACE_PAR_MIN_ROWS, () => 12.0, 20260101);
    const map = buildPaceParMap([...past, ...future], 20250101);
    expect(map.get(paceParKey(1, 1200))).toBeCloseTo(13.0, 5);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/pacePar.test.ts`
Expected: FAIL — "Cannot find module './pacePar.js'"

- [ ] **Step 3: 구현**

```ts
// src/engine/pacePar.ts
/**
 * 초반 페이스 par(meet×rc_dist별 avg_s1f 중앙값) — 과거 경주 실측 페이스 라벨링용.
 * shapePar.ts 선례: 소스 프로세스 1회 로드 + cutoff별 메모이즈. cutoff '미만'만 반영.
 * 소스 = race_sectional_stats (경주당 1행).
 * 스펙: docs/superpowers/specs/2026-07-15-pace-conditional-form-design.md §3
 */
import type { ReadClient } from './db/localDb.js'; // 주의: src/engine/에서 ../db가 아니라 shapePar.ts와 동일한 상대경로 사용

export const PACE_PAR_MIN_ROWS = 30;

export type PaceParMap = Map<string, number>;

export function paceParKey(meet: number, rcDist: number): string {
  return `${meet}|${rcDist}`;
}

export interface PaceParSourceRow {
  raceDate: number;
  meet: number;
  rcDist: number;
  avgS1f: number;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function buildPaceParMap(rows: PaceParSourceRow[], cutoffDate: number): PaceParMap {
  const buckets = new Map<string, number[]>();
  for (const r of rows) {
    if (r.raceDate >= cutoffDate) continue;
    const k = paceParKey(r.meet, r.rcDist);
    const b = buckets.get(k);
    if (b) b.push(r.avgS1f); else buckets.set(k, [r.avgS1f]);
  }
  const map: PaceParMap = new Map();
  for (const [k, b] of buckets) {
    if (b.length < PACE_PAR_MIN_ROWS) continue;
    map.set(k, median(b.sort((a, c) => a - c)));
  }
  return map;
}

let _sourceCache: PaceParSourceRow[] | null = null;
const _mapCache = new Map<number, PaceParMap>();

async function loadPaceParSource(sb: ReadClient): Promise<PaceParSourceRow[]> {
  if (_sourceCache) return _sourceCache;
  const rows: PaceParSourceRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_sectional_stats')
      .select('race_date, meet, rc_no, rc_dist, avg_s1f')
      .order('race_date').order('meet').order('rc_no') // 결정적 페이지 경계
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ race_date: number; meet: number; rc_dist: number | null; avg_s1f: number | null }>) {
      if (r.rc_dist == null || r.avg_s1f == null || !(r.avg_s1f > 0)) continue;
      rows.push({ raceDate: r.race_date, meet: r.meet, rcDist: r.rc_dist, avgS1f: Number(r.avg_s1f) });
    }
    if (data.length < PAGE) break;
  }
  _sourceCache = rows;
  return rows;
}

export async function paceParMapAsOf(sb: ReadClient, cutoffDate: number): Promise<PaceParMap> {
  const hit = _mapCache.get(cutoffDate);
  if (hit) return hit;
  const map = buildPaceParMap(await loadPaceParSource(sb), cutoffDate);
  _mapCache.set(cutoffDate, map);
  return map;
}
```

⚠️ import 경로: `shapePar.ts`(같은 디렉터리)의 첫 줄이 `import type { ReadClient } from '../db/localDb.js';`인지 확인하고 **그대로 복사**할 것 (위 주석의 경로는 확인 후 교정).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/pacePar.test.ts && npm run build`
Expected: PASS + tsc 통과

- [ ] **Step 5: 커밋**

```bash
git add src/engine/pacePar.ts src/engine/pacePar.test.ts
git commit -m "feat(pace): 초반 페이스 par 맵 (meet×거리 avg_s1f 중앙값, as-of cutoff) — shapePar 선례"
```

---

### Task 4: probe:pace-form — 분포 확인 → 임계값·K 확정

직관으로 넣은 초깃값(±0.25초, K=3)을 실측 분포로 교정한다. 로컬 미러만 사용.

**Files:**
- Create: `scripts/probe_pace_form.ts`
- Modify: `package.json` (scripts에 `"probe:pace-form": "tsx scripts/probe_pace_form.ts"` 추가)
- Modify: `src/engine/features/paceForm.ts` (상수 갱신 + 주석에 probe 근거 기록)
- Modify: `docs/superpowers/specs/2026-07-15-pace-conditional-form-design.md` (§3에 확정값 추기)

**Interfaces:**
- Consumes: `buildPaceParMap`/`paceParKey`/`PACE_PAR_MIN_ROWS` (Task 3), `getLocalDb` (`src/db/localDb.js`)

- [ ] **Step 1: probe 스크립트 작성**

```ts
// scripts/probe_pace_form.ts
/**
 * 페이스 조건부 성적 probe — 임계값·shrinkage K 확정용 분포 조사. 로컬 미러 전용(DB 0회).
 * 출력: ① delta(avg_s1f−par) 분위 ② 라벨 커버리지 ③ 말별 버킷 표본수 분포 → 권장 상수.
 * 스펙: docs/superpowers/specs/2026-07-15-pace-conditional-form-design.md §5-1
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { buildPaceParMap, paceParKey, type PaceParSourceRow } from '../src/engine/pacePar.js';

const CUTOFF = 99991231; // 진단이므로 전 기간 par (as-of 아님 — 게이트 실행이 아니라 분포 조사)

function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

async function main() {
  const sb = await getLocalDb();

  // ① race_sectional_stats 전체 → par + delta 분포
  const src: PaceParSourceRow[] = [];
  const raceRows: Array<{ key: string; raceDate: number; meet: number; rcNo: number; rcDist: number; avgS1f: number }> = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_sectional_stats')
      .select('race_date, meet, rc_no, rc_dist, avg_s1f, horses')
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ race_date: number; meet: number; rc_no: number; rc_dist: number | null; avg_s1f: number | null; horses: number }>) {
      if (r.rc_dist == null || r.avg_s1f == null || !(Number(r.avg_s1f) > 0)) continue;
      src.push({ raceDate: r.race_date, meet: r.meet, rcDist: r.rc_dist, avgS1f: Number(r.avg_s1f) });
      raceRows.push({ key: `${r.race_date}-${r.meet}-${r.rc_no}`, raceDate: r.race_date, meet: r.meet, rcNo: r.rc_no, rcDist: r.rc_dist, avgS1f: Number(r.avg_s1f) });
    }
    if (data.length < PAGE) break;
  }
  const par = buildPaceParMap(src, CUTOFF);
  const deltas: number[] = [];
  const labelByRace = new Map<string, number>(); // key → delta
  for (const r of raceRows) {
    const p = par.get(paceParKey(r.meet, r.rcDist));
    if (p == null) continue;
    const d = r.avgS1f - p;
    deltas.push(d);
    labelByRace.set(r.key, d);
  }
  deltas.sort((a, b) => a - b);
  console.log(`경주 수: ${raceRows.length} · par 버킷: ${par.size} · delta 계산 가능: ${deltas.length} (커버리지 ${(100 * deltas.length / raceRows.length).toFixed(1)}%)`);
  console.log('delta 분위(초):');
  for (const q of [0.1, 0.3, 0.5, 0.7, 0.9]) console.log(`  p${q * 100}: ${quantile(deltas, q).toFixed(3)}`);
  const hotThr = quantile(deltas, 0.3), slowThr = quantile(deltas, 0.7);
  console.log(`→ 권장 PACE_HOT_DELTA=${hotThr.toFixed(2)} · PACE_SLOW_DELTA=${slowThr.toFixed(2)} (30/70 분위)`);

  // ② 말별 버킷 표본수: race_entries에서 (hr_name, 경주key) 수집 → delta 임계로 라벨 → 말×버킷 카운트
  const perHorse = new Map<string, { HOT: number; NORMAL: number; SLOW: number }>();
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('hr_name, race_date, meet, rc_no, ord')
      .not('ord', 'is', null)
      .order('race_date').order('meet').order('rc_no').order('pthr_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ hr_name: string; race_date: number; meet: number; rc_no: number }>) {
      const d = labelByRace.get(`${r.race_date}-${r.meet}-${r.rc_no}`);
      if (d == null) continue;
      const lab = d <= hotThr ? 'HOT' : d >= slowThr ? 'SLOW' : 'NORMAL';
      const c = perHorse.get(r.hr_name) ?? { HOT: 0, NORMAL: 0, SLOW: 0 };
      c[lab]++;
      perHorse.set(r.hr_name, c);
    }
    if (data.length < PAGE) break;
  }
  const hotNs = [...perHorse.values()].map((c) => c.HOT).sort((a, b) => a - b);
  const withAny = hotNs.filter((n) => n > 0).length;
  console.log(`\n말 수(1경주 이상 라벨 보유): ${perHorse.size} · HOT 경험 말: ${withAny} (${(100 * withAny / perHorse.size).toFixed(1)}%)`);
  console.log(`말별 HOT 버킷 n 분위: p50=${quantile(hotNs, 0.5)} p70=${quantile(hotNs, 0.7)} p90=${quantile(hotNs, 0.9)}`);
  console.log(`→ K 권장: 버킷 n 중앙값 근처 (수축 절반점). n 중앙값 ${quantile(hotNs.filter((n) => n > 0), 0.5)} 확인 후 결정.`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: package.json에 스크립트 추가 후 실행**

`package.json` scripts에 추가: `"probe:pace-form": "tsx scripts/probe_pace_form.ts"`

Run: `npm run probe:pace-form`
Expected: delta 분위·커버리지(기대 ~95%+)·말별 버킷 n 분포·권장 상수 출력. 실패 시(컬럼명 등) 수정 후 재실행.

- [ ] **Step 3: 상수 확정 반영**

probe 출력의 권장값으로 `paceForm.ts`의 `PACE_HOT_DELTA`·`PACE_SLOW_DELTA` 갱신, `PACE_FIT_SHRINK_K`는 "HOT 버킷 n 중앙값(0 제외)"과 같은 자릿수로 설정(예: 중앙값 3이면 K=3 유지). 상수 주석에 `// probe:pace-form 2026-07-XX: p30=…, p70=…, HOT n 중앙값=…` 기록. 스펙 §3 끝에 같은 내용 1줄 추기.

- [ ] **Step 4: 테스트 재실행 (상수 기반 테스트가 상대값이라 통과 유지 확인)**

Run: `npx vitest run src/engine/features/paceForm.test.ts && npm run build`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add scripts/probe_pace_form.ts package.json src/engine/features/paceForm.ts docs/superpowers/specs/2026-07-15-pace-conditional-form-design.md
git commit -m "feat(pace): probe:pace-form 분포 조사 — 임계값·K 실측 확정 (직관→데이터 교정)"
```

---

### Task 5: asOfHorseStats 통합 — 버킷 집계 as-of 계산

**Files:**
- Modify: `src/engine/asOfHorseStats.ts` (AsOfPastRace·AsOfHorseStats·computeAsOfHorseStats·fetchAsOfHorseStats)
- Modify: `src/engine/scorePredictor.ts:156` 부근 (paceParMapAsOf 로드 + 인자 전달)
- Test: `src/engine/asOfHorseStats.test.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Consumes: `labelPastRacePace`, `computePaceFormStats`, `PaceFormStats`, `PaceBucket` (Task 2) / `paceParMapAsOf`, `paceParKey`, `PaceParMap` (Task 3)
- Produces:
  - `AsOfPastRace` += `paceLabel: PaceBucket | null`
  - `AsOfHorseStats` += `paceForm: PaceFormStats`
  - `fetchAsOfHorseStats(sb, hrName, beforeDate, currentDistCategory, parMap, pacePar: PaceParMap)` — **인자 6개로 변경** (유일 호출부: scorePredictor.ts:156)

- [ ] **Step 1: 실패하는 테스트 추가**

`asOfHorseStats.test.ts`의 기존 패턴(직접 `computeAsOfHorseStats(past, …)` 호출 방식)을 확인하고 그 스타일로 추가:

```ts
import { computeAsOfHorseStats } from './asOfHorseStats.js'; // 기존 import에 병합

describe('paceForm 버킷 집계', () => {
  it('paceLabel별 finish_ratio 평균·n이 paceForm에 담긴다', () => {
    const past = [
      { s1fOrd: 1, ord: 2, fieldSize: 11, distCategory: 'short' as const, paceLabel: 'HOT' as const },
      { s1fOrd: 2, ord: 6, fieldSize: 11, distCategory: 'short' as const, paceLabel: 'HOT' as const },
      { s1fOrd: 3, ord: 11, fieldSize: 11, distCategory: 'short' as const, paceLabel: 'SLOW' as const },
      { s1fOrd: 4, ord: 6, fieldSize: 11, distCategory: 'short' as const, paceLabel: null },
    ];
    const s = computeAsOfHorseStats(past, 'short');
    // finish_ratio = (ord-1)/10 → HOT: (0.1+0.5)/2=0.3, SLOW: 1.0
    expect(s.paceForm.HOT).toEqual({ mean: expect.closeTo(0.3, 10), n: 2 });
    expect(s.paceForm.SLOW).toEqual({ mean: 1.0, n: 1 });
    expect(s.paceForm.NORMAL).toBeUndefined();
  });
  it('past 없음 → paceForm 빈 객체', () => {
    expect(computeAsOfHorseStats([], null).paceForm).toEqual({});
  });
});
```

주의: 기존 테스트의 `AsOfPastRace` 리터럴들이 `paceLabel` 필드 없이는 타입 에러가 되므로, **기존 리터럴 전부에 `paceLabel: null` 추가**가 필요하다 (컴파일 에러 목록 따라 기계적으로).

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/asOfHorseStats.test.ts`
Expected: FAIL (paceForm 프로퍼티 없음 / 타입 에러)

- [ ] **Step 3: 구현**

`asOfHorseStats.ts` 변경 4곳:

```ts
// (1) import 추가
import { computePaceFormStats, type PaceBucket, type PaceFormStats, labelPastRacePace } from './features/paceForm.js';
import { paceParKey, type PaceParMap } from './pacePar.js';

// (2) 타입 확장
export interface AsOfPastRace {
  s1fOrd: number | null;
  ord: number | null;
  fieldSize: number;
  distCategory: DistCategory | null;
  paceLabel: PaceBucket | null; // 그 경주의 실측 초반 페이스 (par 없으면 null)
}
export interface AsOfHorseStats {
  // …기존 필드…
  paceForm: PaceFormStats; // 페이스 버킷별 {finish_ratio 평균, n} — 스펙 2026-07-15
}
// EMPTY에 paceForm: {} 추가

// (3) computeAsOfHorseStats 안 — careerFinishRatio 계산 루프(§⑱) 근처에 추가
const paceForm = computePaceFormStats(
  past
    .filter((r) => r.fieldSize >= 2 && r.ord != null)
    .map((r) => ({ finishRatio: (r.ord! - 1) / (r.fieldSize - 1), paceLabel: r.paceLabel }))
);
// return에 paceForm 포함

// (4) fetchAsOfHorseStats — 시그니처에 pacePar: PaceParMap 추가.
//     fsMap 쿼리 select를 'race_date, meet, rc_no, horses, avg_s1f'로 확장하고
//     avg_s1f도 키별 맵(s1fMap)에 저장. races 매핑에:
paceLabel: labelPastRacePace(
  s1fMap.get(`${r.race_date}-${r.meet}-${r.rc_no}`) ?? null,
  r.rc_dist != null ? (pacePar.get(paceParKey(r.meet, r.rc_dist)) ?? null) : null
),
```

`scorePredictor.ts` 변경 2곳:

```ts
// import
import { paceParMapAsOf } from './pacePar.js';

// gatherRaceInputs 내 asOfMap 채우기(155행 부근) 직전에:
const pacePar = await paceParMapAsOf(sb, opts?.shapeParCutoff ?? rcDate);
// 호출부 변경:
asOfMap.set(e.hr_name, await fetchAsOfHorseStats(sb, e.hr_name, rcDate, distCat, parMap, pacePar));
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/asOfHorseStats.test.ts && npm run build && npm run test:run`
Expected: 전체 PASS (scorePredictor.test.ts 인메모리 DuckDB가 race_sectional_stats에 avg_s1f 컬럼이 없으면 실패 → 해당 테스트 픽스처에 컬럼 추가)

- [ ] **Step 5: 커밋**

```bash
git add src/engine/asOfHorseStats.ts src/engine/asOfHorseStats.test.ts src/engine/scorePredictor.ts tests/engine/scorePredictor.test.ts
git commit -m "feat(pace): as-of 페이스 버킷 집계 — fetchAsOfHorseStats select 확장(새 쿼리 0) + pacePar 주입"
```

---

### Task 6: 피처 노출 — ScoreEngineInput·buildFeatures·featureItemMap

**Files:**
- Modify: `src/engine/index.ts` (ScoreEngineInput에 `paceForm?: PaceFormStats` 추가 — `paceType`·`careerFinishRatio`는 기존 필드)
- Modify: `src/engine/scorePredictor.ts` buildEngineInput 반환 객체 (533행 `paceType,` 근처에 `paceForm: asOf.paceForm,` 추가)
- Modify: `src/engine/features/buildFeatures.ts`
- Modify: `src/engine/features/featureItemMap.ts:48` 부근
- Test: `src/engine/features/buildFeatures.test.ts` (기존 파일에 케이스 추가), `src/engine/features/featureItemMap.test.ts`

**Interfaces:**
- Consumes: `paceFormFeatures`, `PaceFormStats` (Task 2), `AsOfHorseStats.paceForm` (Task 5)
- Produces: 매트릭스/벤치마크에 피처 `pace_fit`(+`__missing`), `pace_sens`(+`__missing`), `pace_fit_n` — featureToItem 그룹id **`pace_form`**

- [ ] **Step 1: 실패하는 테스트 추가**

```ts
// buildFeatures.test.ts에 추가 (기존 테스트의 최소 input 헬퍼 스타일 확인 후 맞추기)
describe('pace_fit·pace_sens (페이스 조건부 성적)', () => {
  it('paceForm 있으면 수축 델타·민감도·표본수 노출', () => {
    const f = toMap(buildFeatures({
      ...minimalInput(),
      paceType: 'HOT',
      careerFinishRatio: 0.5,
      paceForm: { HOT: { mean: 0.25, n: 3 }, SLOW: { mean: 0.65, n: 2 } },
    }));
    expect(f.get('pace_fit')).toBeCloseTo((0.25 - 0.5) * (3 / (3 + PACE_FIT_SHRINK_K)), 10);
    expect(f.get('pace_sens')).toBeCloseTo(0.4, 10);
    expect(f.get('pace_fit_n')).toBe(3);
    expect(f.get('pace_fit__missing')).toBe(0);
  });
  it('paceForm 없으면 결측 플래그', () => {
    const f = toMap(buildFeatures(minimalInput()));
    expect(f.get('pace_fit')).toBe(0);
    expect(f.get('pace_fit__missing')).toBe(1);
    expect(f.get('pace_sens__missing')).toBe(1);
    expect(f.get('pace_fit_n')).toBe(0);
  });
});

// featureItemMap.test.ts에 추가
it('pace_fit·pace_sens 계열은 pace_form 그룹', () => {
  expect(featureToItem('pace_fit')).toBe('pace_form');
  expect(featureToItem('pace_fit_n')).toBe('pace_form');
  expect(featureToItem('pace_fit__missing')).toBe('pace_form');
  expect(featureToItem('pace_sens')).toBe('pace_form');
  expect(featureToItem('pace_hot')).not.toBe('pace_form'); // 기존 경주단위 one-hot과 분리
});
```

(`toMap`/`minimalInput` 헬퍼가 기존 테스트에 없으면 기존 스타일대로 인라인 작성.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/features/buildFeatures.test.ts src/engine/features/featureItemMap.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`buildFeatures.ts` — `x_` 교차 블록(223행) 뒤에 계산, 결측표시 블록(249행 부근)에 플래그:

```ts
// 페이스 조건부 성적 (2026-07-15 스펙): 예상 페이스 버킷의 통산 대비 초과 성적 + 환경 민감도
const pf = paceFormFeatures(input.paceForm, input.careerFinishRatio, input.paceType ?? 'NORMAL');
if (pf.paceFit != null) add('pace_fit', pf.paceFit);
if (pf.paceSens != null) add('pace_sens', pf.paceSens);
add('pace_fit_n', pf.paceFitN);
```

결측표시 블록의 기존 `missingFlag(...)` 나열에 추가:

```ts
missingFlag('pace_fit', pf.paceFit != null);
missingFlag('pace_sens', pf.paceSens != null);
```

`featureItemMap.ts:48` 뒤에 추가 (⚠️ `pace_hot`/`pace_slow`를 잡지 않도록 prefix 주의):

```ts
if (base.startsWith('pace_fit') || base.startsWith('pace_sens')) return 'pace_form';
```

`index.ts` ScoreEngineInput에 필드 + import:

```ts
import type { PaceFormStats } from './features/paceForm.js';
// ScoreEngineInput 내:
paceForm?: PaceFormStats; // 페이스 버킷별 과거 성적 (스펙 2026-07-15)
```

- [ ] **Step 4: 전체 통과 확인**

Run: `npm run build && npm run test:run`
Expected: 전체 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/index.ts src/engine/scorePredictor.ts src/engine/features/buildFeatures.ts src/engine/features/buildFeatures.test.ts src/engine/features/featureItemMap.ts src/engine/features/featureItemMap.test.ts
git commit -m "feat(pace): pace_fit·pace_sens·pace_fit_n 피처 노출 — featureToItem 그룹 pace_form (라이브 v7 스키마 필터로 무영향)"
```

---

### Task 7: 재추출 + 게이트A 진단 (탈락 판정 없음)

**Files:**
- 실행만 (코드 변경 없음). 결과는 `docs/status/04-signals.md` 진행중 항목에 추기.

- [ ] **Step 1: 미러 신선도 확인**

Run: `npx tsx -e "import('./src/db/localDb.js').then(async m => { const db = await m.getLocalDb(); const { data } = await db.from('race_entries').select('race_date').not('ord','is',null).order('race_date',{ascending:false}).limit(1); console.log('미러 최신 결과일:', data?.[0]?.race_date); })"`
Expected: 2026-06 이후 날짜. 게이트 분기(과거 5분기)가 커버되면 db:pull 불필요 — 최신이 아니어도 진행.

- [ ] **Step 2: 매트릭스 재추출**

Run: `npm run extract:matrix` (기존 사용법 헤더를 열어 인자 확인 — 기간 인자 있으면 기존 관례값 유지)
Expected: 매트릭스 JSONL 갱신, `pace_fit`·`pace_sens`·`pace_fit_n` 컬럼 등장. 로그 100줄 넘으면 tail만 확인.

- [ ] **Step 3: 게이트A 상관 진단 (기록만)**

Run: `npm run probe:corr`
Expected: pace_fit·pace_sens와 기존 피처(특히 x_* 성향 one-hot·shape_*·career_finish_ratio·dist_finish_ratio)의 |r| 표 출력. **탈락 판정 없이** 최대 |r| 값을 기록.

- [ ] **Step 4: 04-signals에 진단 결과 1줄 추기 + 커밋**

`docs/status/04-signals.md` 진행중 항목 아래에 `  - 게이트A 진단(YYYY-MM-DD): pace_fit 최대 |r|=… (vs …), pace_sens 최대 |r|=… — 진단 전용, 판정은 통제 A/B` 형식으로 추가.

```bash
git add docs/status/04-signals.md
git commit -m "docs(signals): pace_form 게이트A 상관 진단 기록 (판정 아님)"
```

---

### Task 8: 통제 A/B 판정 (사전등록 기준) + 결과 처리

**Files:**
- 실행 + `docs/status/04-signals.md`·`docs/session_history.md` 갱신. 기각 시 `buildFeatures.ts` 노출 라인 제거.

- [ ] **Step 1: 통제 A/B 두 팔 실행 (같은 스펙, pace_form ON/OFF만 차이)**

Run (OFF 팔): `npm run benchmark -- --exclude pace_form 2>&1 | tail -60`
Run (ON 팔): `npm run benchmark -- --include pace_form 2>&1 | tail -60`

Expected: 각 실행에서 분기별(5분기) 연승(top3) 적중률 표. 시간이 오래 걸리면 run_in_background로 순차 실행.
⚠️ 두 실행의 다른 플래그(기간·챔피언 등)는 완전히 동일해야 함 (기본값 그대로).

- [ ] **Step 2: 판정 — 사전등록 기준 적용**

분기별 Δ(ON−OFF, 연승 %p)를 표로 정리:

| 분기 | OFF | ON | Δ |
|---|---|---|---|

판정 (스펙 §5-3, 변경 금지): **평균 Δ ≥ +1.0%p AND 5분기 중 3분기 이상 Δ > 0 → 채택. 아니면 기각.**

- [ ] **Step 3-A (채택 시): 기록**

- `docs/status/04-signals.md`: 진행중 → 채택 섹션 이동, Δ 수치 기록. "라이브 반영은 10월 재학습 사이클 (L-003)" 명기.
- `docs/session_history.md`에 1줄 추가.
- 커밋: `docs(signals): pace_form 통제 A/B 채택 — Δ+X.X%p (n/5분기) · 라이브는 10월 사이클`

- [ ] **Step 3-B (기각 시): 기록 + 코드 정리**

- `buildFeatures.ts`에서 pace_fit/pace_sens/pace_fit_n 노출 라인(add 3줄 + missingFlag 2줄)과 관련 buildFeatures 테스트 케이스 제거. **paceForm.ts·pacePar.ts·asOfHorseStats 집계는 유지** (다음 조작화 재사용 — 노출만 차단하면 재학습 오염 없음).
- `docs/status/04-signals.md`: 진행중 → 종결·기각 섹션 이동, Δ 수치와 원인 해석 기록.
- Run: `npm run build && npm run test:run` → PASS 확인.
- 커밋: `fix(pace): pace_form 기각 — buildFeatures 노출 제거 (게이트B Δ−X.X%p), 집계 인프라는 유지`

- [ ] **Step 4: 최종 검증 + 사용자 보고**

Run: `npm run build && npm run test:run`
Expected: 전체 PASS. 판정 결과·근거 표를 사용자에게 보고하고 main 머지 여부 확인.

---

## Self-Review 결과

- **스펙 커버리지**: §2 피처 3개(Task 2·6) / §3 라벨·par(Task 3·4) / §4 누수(과거 행만 — Task 5의 `race_date < beforeDate` 기존 쿼리 유지) / §5 probe→게이트A 진단→통제 A/B(Task 4·7·8) / §5-5 기각 시 제거(Task 8-3B) / §6 구현 위치 전부 매핑 ✓. 스펙 §5-5의 "기각 기록" — Task 8-3B ✓. shape_d6_best 선행 정리는 스펙 §5 원칙의 적용(Task 1).
- **플레이스홀더**: 코드 블록 전부 실제 코드. 임계값 초깃값은 자리표시가 아니라 probe가 갱신하는 시작점으로 명시 ✓.
- **타입 일관성**: `PaceBucket`·`PaceFormStats`·`paceFormFeatures` 시그니처가 Task 2 정의 → 5·6 소비에서 동일 ✓. `fetchAsOfHorseStats` 6번째 인자 추가는 유일 호출부(scorePredictor.ts:156)와 함께 변경 ✓. `pace_hot`/`pace_slow`(기존)와 `pace_fit*`/`pace_sens`(신규)의 featureToItem 분리 테스트 포함 ✓.
