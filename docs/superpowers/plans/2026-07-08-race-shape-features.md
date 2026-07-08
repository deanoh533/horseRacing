# 경주 전개 피처 2종 (shape_pred_gap · shape_p_achieve) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** probe H9로 검증된 경주 전개 신호 2종을 as-of 산식으로 예측 엔진에 피처로 추가하고, 벤치마크 통제 A/B(ON/OFF)로 채택 판정한다.

**Architecture:** 순수 계산 모듈(`shapeSignals.ts`) + par 로더(`shapePar.ts`)를 신설하고, `scorePredictor.gatherRaceInputs`의 경주 단위 사전패스에서 두 값을 계산해 `ScoreEngineInput`에 주입 → `buildFeatures`는 주입값을 그대로 추가. `featureItemMap`이 `shape_` 프리픽스를 `shape_signal` id로 묶어 벤치마크 게이트/ablation 자동 대상화. A/B는 `benchmark_all.ts`에 `--include/--exclude <itemId>` 플래그 추가로 수행.

**Tech Stack:** TypeScript(strict) · vitest · DuckDB 로컬 미러(ReadClient, supabase-js 흉내) · 기존 로지스틱 벤치마크 파이프라인

**Spec:** `docs/superpowers/specs/2026-07-08-race-shape-features-design.md` (산식·결측 규칙·합격선의 SSOT)

## Global Constraints

- 브랜치: `feat/race-shape-features` (Task 0에서 생성, 이후 모든 커밋은 이 브랜치)
- 커밋 메시지: 한국어 + scope (`feat(shape): …`, `test(shape): …`), 매 커밋 전 `npm run build`(tsc)와 해당 테스트 통과
- 데이터: DuckDB 로컬 미러만 사용. KRA API·Supabase 원격 호출 금지
- TDD: 테스트 먼저 → 실패 확인 → 구현 → 통과 → 커밋
- 기존 테스트(318+) 회귀 금지: 최종 검증에서 `npm run test:run` 전체 통과
- 산식 상수(스펙 §2): std 하한 **0.1초**, Φ 근사 `1/(1+exp(−1.702z))`, fin600 유효범위 **[30, 60]초**, mean 요건 **n≥2**, std 요건 **n≥3**(표본표준편차)
- G3F 누적시간 컬럼: meet 1(서울)=`se_g3f_acc_time`, meet 3(부경)=`bu_g3f_acc_time` (기존 `calcLastFurlong` 패턴과 동일)

---

### Task 0: 브랜치 생성 + 스펙 구현 정합 수정

**Files:**
- Modify: `docs/superpowers/specs/2026-07-08-race-shape-features-design.md`

**Interfaces:**
- Produces: 이후 모든 태스크의 판정 기준(§5)과 par 구현 방식(§3)의 확정본

- [ ] **Step 1: 브랜치 생성**

```bash
git checkout -b feat/race-shape-features
```

- [ ] **Step 2: 스펙 §3 par 구현 방식 수정**

스펙 §3의 라이브 항목을 아래로 교체한다 (`npm run build:par` JSON 방식 → cutoff 메모이즈 로더로 단순화. 근거: 벤치마크 아키텍처는 피처를 경주별 1회 계산(collect)하므로 fold별 par 재계산이 불가 — cutoff 고정이 "학습기간만" 결정의 구현형이다):

기존 §3의 두 번째·세 번째 불릿(“**벤치마크/A/B**…”, “**라이브**…”)을 다음으로 교체:

```markdown
- **구현**: `shapeParMapAsOf(sb, cutoffDate)` — race_date < cutoffDate 데이터만으로 meet×rc_dist 중앙값 산출(소스 행은 프로세스당 1회 로드, cutoff별 메모이즈).
- **벤치마크/A/B**: cutoff = 20250101 (롤링 첫 테스트 분기 FIRST_TEST=2025Q1 시작일) 고정 → 모든 테스트 경주에 미래 정보 0. 학습(2024) 경주의 par에는 학습창 내 이후 데이터가 섞이지만 테스트 지표의 정직성과 무관.
- **라이브/백필**: cutoff = 예측 대상 경주일(rcDate) 기본값 → 자동 as-of. 별도 JSON 파일 불필요.
```

- [ ] **Step 3: 스펙 §5 판정 지표 명시**

§5 첫 불릿의 “지표 = 챔피언 모델 1순위 연승(3착내) 적중률 Δ”를 다음으로 교체 (챔피언은 동결 아티팩트라 새 피처를 포함할 수 없음 — 재학습 계열이 판정 대상):

```markdown
- **방법**: 같은 벤치마크 스펙에서 `npm run benchmark -- --include shape_signal`(ON) vs `-- --exclude shape_signal`(OFF). 판정 지표 = 롤링 표 **Logistic(t2)** 1순위 연승(show)률 Δ (overall + 분기별). Logistic(t1)/(t3)·GBDT는 참고 진단.
```

- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/specs/2026-07-08-race-shape-features-design.md
git commit -m "docs(spec): 전개 피처 par cutoff 로더·판정지표 Logistic(t2) 구현 정합 수정"
```

---

### Task 1: shapeSignals 순수 계산 모듈

**Files:**
- Create: `src/engine/features/shapeSignals.ts`
- Test: `src/engine/features/shapeSignals.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 모듈)
- Produces:
  - `type ShapeParMap = Map<string, { par3: number; par6: number }>` (key = `shapeParKey(meet, rcDist)` = `` `${meet}|${rcDist}` ``)
  - `shapeParKey(meet: number, rcDist: number): string`
  - `interface ShapeHistRace { meet: number; rcDist: number | null; rcTime: number | null; g3fAcc: number | null }`
  - `interface HorseShapeStats { meanD3: number; meanD6: number; stdD6: number | null; n: number }`
  - `horseShapeStats(rows: ShapeHistRace[], par: ShapeParMap): HorseShapeStats | null` (유효행 n≥2 아니면 null, stdD6는 n≥3 아니면 null)
  - `interface ShapeSignal { predGap: number; pAchieve: number | null }`
  - `raceShapeSignals(stats: (HorseShapeStats | null)[]): (ShapeSignal | null)[]` (입력과 같은 길이·순서)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/features/shapeSignals.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  shapeParKey, horseShapeStats, raceShapeSignals,
  type ShapeParMap, type ShapeHistRace, type HorseShapeStats,
} from './shapeSignals.js';

const PAR: ShapeParMap = new Map([[shapeParKey(1, 1200), { par3: 48.0, par6: 38.0 }]]);
const row = (g3fAcc: number, fin600: number): ShapeHistRace =>
  ({ meet: 1, rcDist: 1200, rcTime: g3fAcc + fin600, g3fAcc });

describe('horseShapeStats', () => {
  it('유효 이력 3회: meanD3/meanD6/stdD6(표본) 계산', () => {
    // d3 = −0.5, −0.1, +0.3 → mean −0.1 / d6 = 0.0, 0.4, 0.8 → mean 0.4, 표본std 0.4
    const s = horseShapeStats([row(47.5, 38.0), row(47.9, 38.4), row(48.3, 38.8)], PAR);
    expect(s).not.toBeNull();
    expect(s!.n).toBe(3);
    expect(s!.meanD3).toBeCloseTo(-0.1, 6);
    expect(s!.meanD6).toBeCloseTo(0.4, 6);
    expect(s!.stdD6).toBeCloseTo(0.4, 6);
  });

  it('유효 이력 2회: mean은 있고 stdD6=null', () => {
    const s = horseShapeStats([row(47.5, 38.0), row(48.5, 39.0)], PAR);
    expect(s).not.toBeNull();
    expect(s!.n).toBe(2);
    expect(s!.stdD6).toBeNull();
  });

  it('유효 이력 1회 → null', () => {
    expect(horseShapeStats([row(48.0, 38.0)], PAR)).toBeNull();
  });

  it('무효 행 제외: fin600 범위 밖·par 버킷 없음·결측', () => {
    const rows: ShapeHistRace[] = [
      row(47.5, 38.0), row(47.9, 38.4),               // 유효 2
      row(48.0, 25.0),                                 // fin600 < 30 → 제외
      { meet: 3, rcDist: 1200, rcTime: 86, g3fAcc: 48 }, // par 버킷 없음(3|1200) → 제외
      { meet: 1, rcDist: 1200, rcTime: null, g3fAcc: 48 }, // rcTime 결측 → 제외
      { meet: 1, rcDist: null, rcTime: 86, g3fAcc: 48 },   // rcDist 결측 → 제외
    ];
    const s = horseShapeStats(rows, PAR);
    expect(s!.n).toBe(2);
  });
});

const stat = (meanD3: number, meanD6: number, stdD6: number | null): HorseShapeStats =>
  ({ meanD3, meanD6, stdD6, n: 3 });

describe('raceShapeSignals', () => {
  it('예측 선두는 gap 0·pAchieve 0.5, 나머지는 gap·z 계산', () => {
    // A(선두): meanD3 −0.1, meanD6 0.4, std 0.4 → gap 0, z = (0.4−0−0.4)/0.4 = 0 → 0.5
    // D: meanD3 0.7 → gap 0.8; 필요 = 0.4 − 0.8 = −0.4; z = (−0.4 − 1.2)/0.2 = −8 → p ≈ 0
    const out = raceShapeSignals([stat(-0.1, 0.4, 0.4), stat(0.7, 1.2, 0.2)]);
    expect(out[0]!.predGap).toBeCloseTo(0, 6);
    expect(out[0]!.pAchieve).toBeCloseTo(0.5, 6);
    expect(out[1]!.predGap).toBeCloseTo(0.8, 6);
    expect(out[1]!.pAchieve).toBeLessThan(0.001);
  });

  it('stdD6 null인 말은 pAchieve null, predGap은 계산', () => {
    const out = raceShapeSignals([stat(-0.1, 0.4, 0.4), { meanD3: 0.5, meanD6: 1.0, stdD6: null, n: 2 }]);
    expect(out[1]!.predGap).toBeCloseTo(0.6, 6);
    expect(out[1]!.pAchieve).toBeNull();
  });

  it('stats 보유 말 < 2 → 전원 null', () => {
    const out = raceShapeSignals([stat(-0.1, 0.4, 0.4), null, null]);
    expect(out).toEqual([null, null, null]);
  });

  it('std 하한 0.1 클램프: std 0.01이어도 z 폭발 없음', () => {
    // B: gap 0.3, 필요 = 0.4−0.3 = 0.1, own meanD6 0.2 → z = (0.1−0.2)/max(0.01,0.1) = −1
    const out = raceShapeSignals([stat(-0.1, 0.4, 0.4), stat(0.2, 0.2, 0.01)]);
    const expected = 1 / (1 + Math.exp(1.702)); // z=−1
    expect(out[1]!.pAchieve).toBeCloseTo(expected, 6);
  });

  it('par 상쇄 성질: par3에 상수 +1(전 이력 동일 버킷) → 신호 불변', () => {
    const PAR2: ShapeParMap = new Map([[shapeParKey(1, 1200), { par3: 49.0, par6: 38.0 }]]);
    const mk = (p: ShapeParMap) => {
      const a = horseShapeStats([row(47.5, 38.0), row(47.9, 38.4), row(48.3, 38.8)], p)!;
      const b = horseShapeStats([row(48.1, 38.2), row(48.5, 38.6), row(48.9, 39.0)], p)!;
      return raceShapeSignals([a, b]);
    };
    const [o1, o2] = [mk(PAR), mk(PAR2)];
    expect(o2[1]!.predGap).toBeCloseTo(o1[1]!.predGap, 6);
    expect(o2[1]!.pAchieve!).toBeCloseTo(o1[1]!.pAchieve!, 6);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/features/shapeSignals.test.ts`
Expected: FAIL — `Cannot find module './shapeSignals.js'`

- [ ] **Step 3: 구현**

`src/engine/features/shapeSignals.ts`:

```typescript
/**
 * 경주 전개(race shape) 신호 — 순수 계산.
 * 스펙: docs/superpowers/specs/2026-07-08-race-shape-features-design.md §2
 * probe 원형: scripts/probe_race_shape.ts H6·H9.
 * 오늘 경주의 par는 두 신호 모두에서 상쇄되므로 par는 과거 이력 환산에만 쓰인다.
 */

export type ShapeParMap = Map<string, { par3: number; par6: number }>;

export function shapeParKey(meet: number, rcDist: number): string {
  return `${meet}|${rcDist}`;
}

export interface ShapeHistRace {
  meet: number;
  rcDist: number | null;
  rcTime: number | null;
  g3fAcc: number | null;
}

export interface HorseShapeStats {
  meanD3: number;          // G3F 누적시간의 par 대비 편차 평균 (n≥2)
  meanD6: number;          // 종반 600m의 par 대비 편차 평균 (n≥2)
  stdD6: number | null;    // 표본표준편차 (n≥3 아니면 null)
  n: number;
}

const FIN600_MIN = 30;
const FIN600_MAX = 60;
const STD_FLOOR = 0.1;   // 측정 노이즈 미만 편차의 z 폭발 방지
const PHI_SLOPE = 1.702; // 정규 CDF 로지스틱 근사 계수

function sampleStd(values: number[]): number | null {
  if (values.length < 3) return null;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  const ss = values.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

export function horseShapeStats(rows: ShapeHistRace[], par: ShapeParMap): HorseShapeStats | null {
  const d3s: number[] = [];
  const d6s: number[] = [];
  for (const r of rows) {
    if (r.rcDist == null || r.rcTime == null || r.g3fAcc == null) continue;
    if (!(r.rcTime > 0) || !(r.g3fAcc > 0)) continue;
    const fin600 = r.rcTime - r.g3fAcc;
    if (fin600 < FIN600_MIN || fin600 > FIN600_MAX) continue;
    const p = par.get(shapeParKey(r.meet, r.rcDist));
    if (!p) continue;
    d3s.push(r.g3fAcc - p.par3);
    d6s.push(fin600 - p.par6);
  }
  if (d3s.length < 2) return null;
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return { meanD3: mean(d3s), meanD6: mean(d6s), stdD6: sampleStd(d6s), n: d3s.length };
}

export interface ShapeSignal {
  predGap: number;           // 예측 격차(초). 예측 선두 = 0
  pAchieve: number | null;   // 필요속도 달성확률(순위 재료). stdD6 없으면 null
}

/** 경주 단위: 출주마 전원의 stats(순서 유지) → 말별 신호. stats 보유 말 < 2면 전원 null. */
export function raceShapeSignals(stats: (HorseShapeStats | null)[]): (ShapeSignal | null)[] {
  const present = stats.filter((s): s is HorseShapeStats => s !== null);
  if (present.length < 2) return stats.map(() => null);

  let leader = present[0]!;
  for (const s of present) if (s.meanD3 < leader.meanD3) leader = s;

  return stats.map((s) => {
    if (s === null) return null;
    const predGap = s.meanD3 - leader.meanD3;
    if (s.stdD6 === null) return { predGap, pAchieve: null };
    const required = leader.meanD6 - predGap;
    const z = (required - s.meanD6) / Math.max(s.stdD6, STD_FLOOR);
    return { predGap, pAchieve: 1 / (1 + Math.exp(-PHI_SLOPE * z)) };
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/engine/features/shapeSignals.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 타입체크 + 커밋**

```bash
npm run build
git add src/engine/features/shapeSignals.ts src/engine/features/shapeSignals.test.ts
git commit -m "feat(shape): 경주 전개 신호 순수 계산 모듈 (horseShapeStats·raceShapeSignals)"
```

---

### Task 2: shapePar — cutoff par 로더

**Files:**
- Create: `src/engine/shapePar.ts`
- Test: `src/engine/shapePar.test.ts`

**Interfaces:**
- Consumes: Task 1의 `ShapeParMap`, `shapeParKey` / `ReadClient` (`src/db/localDb.js`)
- Produces:
  - `interface ShapeParSourceRow { raceDate: number; meet: number; rcDist: number; g3fAcc: number; fin600: number }`
  - `buildShapeParMap(rows: ShapeParSourceRow[], cutoffDate: number): ShapeParMap` (순수: race_date < cutoff만, meet×dist 중앙값, 버킷 최소 30행)
  - `shapeParMapAsOf(sb: ReadClient, cutoffDate: number): Promise<ShapeParMap>` (소스 1회 로드 + cutoff별 메모이즈)
  - `SHAPE_PAR_MIN_ROWS = 30`

- [ ] **Step 1: 실패하는 테스트 작성 (순수 부분만 — IO 로더는 통합에서 검증)**

`src/engine/shapePar.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildShapeParMap, SHAPE_PAR_MIN_ROWS, type ShapeParSourceRow } from './shapePar.js';
import { shapeParKey } from './features/shapeSignals.js';

const mkRows = (n: number, base: Partial<ShapeParSourceRow> = {}): ShapeParSourceRow[] =>
  Array.from({ length: n }, (_, i) => ({
    raceDate: 20240101 + i, meet: 1, rcDist: 1200,
    g3fAcc: 48 + (i % 5) * 0.1,   // 48.0~48.4 → 중앙값 48.2
    fin600: 38 + (i % 5) * 0.1,   // 중앙값 38.2
    ...base,
  }));

describe('buildShapeParMap', () => {
  it('meet×dist 중앙값으로 par3/par6 산출', () => {
    const map = buildShapeParMap(mkRows(50), 20991231);
    const p = map.get(shapeParKey(1, 1200));
    expect(p).toBeDefined();
    expect(p!.par3).toBeCloseTo(48.2, 6);
    expect(p!.par6).toBeCloseTo(38.2, 6);
  });

  it('cutoff 이후 행은 제외', () => {
    const past = mkRows(SHAPE_PAR_MIN_ROWS);                              // 20240101~
    const future = mkRows(100, { g3fAcc: 99, fin600: 59 }).map((r, i) => ({ ...r, raceDate: 20260101 + i }));
    const map = buildShapeParMap([...past, ...future], 20250101);
    expect(map.get(shapeParKey(1, 1200))!.par3).toBeLessThan(50); // future(99) 미반영
  });

  it('버킷 행수 < SHAPE_PAR_MIN_ROWS → 버킷 없음', () => {
    const map = buildShapeParMap(mkRows(SHAPE_PAR_MIN_ROWS - 1), 20991231);
    expect(map.get(shapeParKey(1, 1200))).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/shapePar.test.ts`
Expected: FAIL — `Cannot find module './shapePar.js'`

- [ ] **Step 3: 구현**

`src/engine/shapePar.ts`:

```typescript
/**
 * 경주 전개 par(거리 표준 기록) — meet×rc_dist 중앙값.
 * 스펙 §3: cutoffDate '미만' 데이터만 반영 (벤치마크=20250101 고정, 라이브=rcDate → 자동 as-of).
 * 소스 행은 프로세스당 1회 로드, ShapeParMap은 cutoff별 메모이즈 (speedFigure.loadParMap 선례).
 */
import type { ReadClient } from '../db/localDb.js';
import { shapeParKey, type ShapeParMap } from './features/shapeSignals.js';

/** 버킷 유효 최소 행수 (희소 거리 노이즈 차단, 튜닝 대상) */
export const SHAPE_PAR_MIN_ROWS = 30;

export interface ShapeParSourceRow {
  raceDate: number;
  meet: number;
  rcDist: number;
  g3fAcc: number;
  fin600: number;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function buildShapeParMap(rows: ShapeParSourceRow[], cutoffDate: number): ShapeParMap {
  const buckets = new Map<string, { g3: number[]; f6: number[] }>();
  for (const r of rows) {
    if (r.raceDate >= cutoffDate) continue;
    const k = shapeParKey(r.meet, r.rcDist);
    const b = buckets.get(k);
    if (b) { b.g3.push(r.g3fAcc); b.f6.push(r.fin600); }
    else buckets.set(k, { g3: [r.g3fAcc], f6: [r.fin600] });
  }
  const map: ShapeParMap = new Map();
  for (const [k, b] of buckets) {
    if (b.g3.length < SHAPE_PAR_MIN_ROWS) continue;
    map.set(k, { par3: median(b.g3.sort((a, c) => a - c)), par6: median(b.f6.sort((a, c) => a - c)) });
  }
  return map;
}

// fin600 유효범위 — shapeSignals와 동일 기준 (스펙 §2.1)
const FIN600_MIN = 30;
const FIN600_MAX = 60;

let _sourceCache: ShapeParSourceRow[] | null = null;
const _mapCache = new Map<number, ShapeParMap>();

/** race_entries 전체에서 par 소스 행 로드 (프로세스 1회). */
async function loadShapeParSource(sb: ReadClient): Promise<ShapeParSourceRow[]> {
  if (_sourceCache) return _sourceCache;
  const rows: ShapeParSourceRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_dist, rc_time, se_g3f_acc_time, bu_g3f_acc_time')
      .not('ord', 'is', null)
      .not('rc_time', 'is', null)
      .order('race_date').order('meet').order('rc_no').order('pthr_no') // 결정적 페이지 경계
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ race_date: number; meet: number; rc_dist: number | null; rc_time: number | null; se_g3f_acc_time: number | null; bu_g3f_acc_time: number | null }>) {
      const g3fAcc = r.meet === 1 ? r.se_g3f_acc_time : r.bu_g3f_acc_time;
      if (r.rc_dist == null || r.rc_time == null || g3fAcc == null || !(g3fAcc > 0)) continue;
      const fin600 = r.rc_time - g3fAcc;
      if (fin600 < FIN600_MIN || fin600 > FIN600_MAX) continue;
      rows.push({ raceDate: r.race_date, meet: r.meet, rcDist: r.rc_dist, g3fAcc, fin600 });
    }
    if (data.length < PAGE) break;
  }
  _sourceCache = rows;
  return rows;
}

export async function shapeParMapAsOf(sb: ReadClient, cutoffDate: number): Promise<ShapeParMap> {
  const hit = _mapCache.get(cutoffDate);
  if (hit) return hit;
  const map = buildShapeParMap(await loadShapeParSource(sb), cutoffDate);
  _mapCache.set(cutoffDate, map);
  return map;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/engine/shapePar.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 타입체크 + 커밋**

```bash
npm run build
git add src/engine/shapePar.ts src/engine/shapePar.test.ts
git commit -m "feat(shape): cutoff par 로더 (buildShapeParMap·shapeParMapAsOf)"
```

---

### Task 3: scorePredictor 배선 — G3F 컬럼 + 경주 단위 사전패스 + 입력 주입

**Files:**
- Modify: `src/engine/scorePredictor.ts` (HistFull 타입 `:324`, 이력 select `:171`, gatherRaceInputs 시그니처 `:67`, batch 이후 사전패스 `:245` 부근, rows 매핑 `:247-259`)
- Modify: `src/engine/index.ts` (`ScoreEngineInput` 인터페이스에 옵셔널 필드 2개)
- Modify: `src/engine/eval/collect.ts` (`collectRaces` 시그니처에 opts 전달)

**Interfaces:**
- Consumes: Task 1 `horseShapeStats`/`raceShapeSignals`/`ShapeHistRace` · Task 2 `shapeParMapAsOf`
- Produces:
  - `ScoreEngineInput.shapePredGap?: number` / `ScoreEngineInput.shapePAchieve?: number`
  - `gatherRaceInputs(sb, rcDate, meet, rcNo, opts?: { shapeParCutoff?: number })` — cutoff 기본값 `rcDate`
  - `collectRaces(db, fromDate, toDate, opts?: { shapeParCutoff?: number })`

- [ ] **Step 1: ScoreEngineInput 필드 추가** (`src/engine/index.ts`의 `ScoreEngineInput` 인터페이스 끝에)

```typescript
  /** 경주 전개(shape) — 경주 단위 사전패스 주입 (스펙 2026-07-08). 결측이면 피처 미생성 */
  shapePredGap?: number;
  shapePAchieve?: number;
```

- [ ] **Step 2: HistFull 타입 + 이력 select에 G3F 컬럼 추가** (`scorePredictor.ts`)

`:324` HistFull에 필드 추가:

```typescript
  se_g3f_acc_time: number | null; bu_g3f_acc_time: number | null;
```

`:171` select 문자열의 `se_g1f_acc_time, bu_g1f_acc_time` 뒤에 `se_g3f_acc_time, bu_g3f_acc_time` 추가:

```typescript
      .select('hr_name, race_date, meet, rc_no, ord, rc_dist, track_type, wg_hr_diff, burd_wgt, win_odds, popularity, jcky_no, rc_time, se_g1f_acc_time, bu_g1f_acc_time, se_g3f_acc_time, bu_g3f_acc_time, sj_s1f_ord, bu_s1f_ord, sj_g1f_ord, bu_g1f_ord')
```

- [ ] **Step 3: gatherRaceInputs 시그니처 + 경주 단위 사전패스**

시그니처(`:67`)에 5번째 옵션 인자 추가:

```typescript
export async function gatherRaceInputs(
  sb: ReadClient,
  rcDate: number,
  meet: number,
  rcNo: number,
  opts?: { shapeParCutoff?: number }
): Promise<RaceInputRow[]> {
```

import 추가 (파일 상단):

```typescript
import { horseShapeStats, raceShapeSignals } from './features/shapeSignals.js';
import { shapeParMapAsOf } from './shapePar.js';
```

`const batch: RaceBatch = { … };` (`:245`) 직후에 사전패스 추가:

```typescript
  // 경주 전개(shape) 사전패스: 전 출주마 as-of 전개 통계 → 예측 선두/격차/달성확률 (스펙 2026-07-08)
  const shapePar = await shapeParMapAsOf(sb, opts?.shapeParCutoff ?? rcDate);
  const shapeStatsList = entryList.map((e) =>
    horseShapeStats(
      (histByHorse.get(e.hr_name) ?? []).map((r) => ({
        meet: r.meet, rcDist: r.rc_dist, rcTime: r.rc_time,
        g3fAcc: r.meet === 1 ? r.se_g3f_acc_time : r.bu_g3f_acc_time,
      })),
      shapePar,
    )
  );
  const shapeSignals = raceShapeSignals(shapeStatsList);
```

rows 매핑(`:247`)에서 인덱스를 받아 주입 — `entryList.map(async (e) => {` 를 `entryList.map(async (e, ei) => {` 로 바꾸고, `input.prevRaceDate = …` 라인 뒤에:

```typescript
      const shapeSig = shapeSignals[ei];
      if (shapeSig) {
        input.shapePredGap = shapeSig.predGap;
        if (shapeSig.pAchieve != null) input.shapePAchieve = shapeSig.pAchieve;
      }
```

- [ ] **Step 4: collectRaces opts 전달** (`src/engine/eval/collect.ts`)

```typescript
export async function collectRaces(
  db: ReadClient,
  fromDate: number,
  toDate: number,
  opts?: { shapeParCutoff?: number }
): Promise<RaceRecord[]> {
```

`:33`의 호출을 다음으로:

```typescript
    const rows = await gatherRaceInputs(db, r.race_date, r.meet, r.rc_no, opts);
```

- [ ] **Step 5: 타입체크 + 기존 테스트 회귀 확인**

Run: `npm run build`
Expected: 에러 0

Run: `npm run test:run`
Expected: 전체 PASS (기존 테스트 회귀 없음 — 이 단계에서 피처는 아직 미생성이라 스냅샷 변화 없음)

- [ ] **Step 6: 커밋**

```bash
git add src/engine/scorePredictor.ts src/engine/index.ts src/engine/eval/collect.ts
git commit -m "feat(shape): G3F 이력 컬럼 + 경주 단위 전개 사전패스 배선 (ScoreEngineInput 주입)"
```

---

### Task 4: buildFeatures 피처 2종 + featureItemMap

**Files:**
- Modify: `src/engine/features/buildFeatures.ts` (⑳ speed_ability_raw 블록 `:187` 뒤)
- Modify: `src/engine/features/featureItemMap.ts` (`featureToItem` 함수 `:42`)
- Test: `src/engine/features/buildFeatures.test.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Consumes: Task 3의 `input.shapePredGap` / `input.shapePAchieve`
- Produces: 피처 `shape_pred_gap`, `shape_p_achieve` (item id `shape_signal`)

- [ ] **Step 1: 실패하는 테스트 추가** (`buildFeatures.test.ts` 말미에 — 기존 테스트의 input 생성 패턴을 따름)

```typescript
import { featureToItem } from './featureItemMap.js';

describe('shape 피처 (경주 전개)', () => {
  it('주입값 있으면 shape_pred_gap·shape_p_achieve 추가', () => {
    const f = buildFeatures({ shapePredGap: 0.8, shapePAchieve: 0.23 } as ScoreEngineInput);
    expect(f.find((x) => x.name === 'shape_pred_gap')?.value).toBeCloseTo(0.8, 6);
    expect(f.find((x) => x.name === 'shape_p_achieve')?.value).toBeCloseTo(0.23, 6);
  });

  it('주입 없으면 미생성 (결측 관례)', () => {
    const f = buildFeatures({} as ScoreEngineInput);
    expect(f.find((x) => x.name === 'shape_pred_gap')).toBeUndefined();
    expect(f.find((x) => x.name === 'shape_p_achieve')).toBeUndefined();
  });

  it('predGap만 있고 pAchieve 없으면 gap만 생성', () => {
    const f = buildFeatures({ shapePredGap: 0.3 } as ScoreEngineInput);
    expect(f.find((x) => x.name === 'shape_pred_gap')).toBeDefined();
    expect(f.find((x) => x.name === 'shape_p_achieve')).toBeUndefined();
  });

  it('featureToItem: shape_ 프리픽스 → shape_signal', () => {
    expect(featureToItem('shape_pred_gap')).toBe('shape_signal');
    expect(featureToItem('shape_p_achieve')).toBe('shape_signal');
    expect(featureToItem('shape_p_achieve__missing')).toBe('shape_signal');
  });
});
```

주의: `import { featureToItem } …` 라인은 describe 블록이 아니라 **파일 상단** import 구역에 추가한다. `ScoreEngineInput`·`buildFeatures`는 기존 import를 재사용하고 중복 추가하지 않는다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/features/buildFeatures.test.ts`
Expected: 신규 4케이스 FAIL (기존 케이스는 PASS 유지)

- [ ] **Step 3: 구현**

`buildFeatures.ts` — `⑳ 속도능력지수 raw` 블록(`:187`) 바로 뒤에:

```typescript
  // ㉑ 경주 전개(shape) — 경주 단위 사전패스 주입값 (스펙 2026-07-08, probe H9 검증)
  if (input.shapePredGap != null) add('shape_pred_gap', input.shapePredGap);
  if (input.shapePAchieve != null) add('shape_p_achieve', input.shapePAchieve);
```

`featureItemMap.ts` — `featureToItem` 내부, `if (base.startsWith('train_'))` 라인 뒤에:

```typescript
  if (base.startsWith('shape_')) return 'shape_signal';
```

- [ ] **Step 4: 테스트 통과 + 전체 회귀 확인**

Run: `npx vitest run src/engine/features/buildFeatures.test.ts`
Expected: PASS

Run: `npm run test:run`
Expected: 전체 PASS

- [ ] **Step 5: 타입체크 + 커밋**

```bash
npm run build
git add src/engine/features/buildFeatures.ts src/engine/features/featureItemMap.ts src/engine/features/buildFeatures.test.ts
git commit -m "feat(shape): shape_pred_gap·shape_p_achieve 피처 추가 (item id shape_signal)"
```

---

### Task 5: benchmark — par cutoff + --include/--exclude 플래그

**Files:**
- Modify: `scripts/benchmark_all.ts` (`:29-48` 인자 파싱·approved 집합, `:37` collectRaces 호출)

**Interfaces:**
- Consumes: Task 3 `collectRaces(db, from, to, opts)` / Task 4 item id `shape_signal`
- Produces: CLI `npm run benchmark -- --include <itemId>` / `-- --exclude <itemId>` (게이트 판정과 무관하게 강제 포함/제외)

- [ ] **Step 1: 인자 파싱 + cutoff + approved 오버라이드 구현**

`:33` (`const championId = …`) 뒤에:

```typescript
  const inclIdx = args.indexOf('--include');
  const forceInclude = inclIdx >= 0 ? args[inclIdx + 1] : undefined;
  const exclIdx = args.indexOf('--exclude');
  const forceExclude = exclIdx >= 0 ? args[exclIdx + 1] : undefined;
```

`:37`의 collectRaces 호출을 다음으로 (shape par cutoff = FIRST_TEST 시작일 — 모든 테스트 경주에 미래 정보 0):

```typescript
  const SHAPE_PAR_CUTOFF = FIRST_TEST.year * 10000 + 101; // 2025Q1 → 20250101
  const races = await collectRaces(db, 20240101, 99991231, { shapeParCutoff: SHAPE_PAR_CUTOFF });
```

`:48` (`approved = new Set(…)` 분기 완료) 뒤에:

```typescript
  if (forceInclude) { approved.add(forceInclude); console.log(`  ⚡ 강제 포함: ${forceInclude}`); }
  if (forceExclude) { approved.delete(forceExclude); console.log(`  ⚡ 강제 제외: ${forceExclude}`); }
```

- [ ] **Step 2: 타입체크 + 스모크 (게이트까지만)**

Run: `npm run build`
Expected: 에러 0

Run: `npm run benchmark -- --gate-only`
Expected: 게이트 A/B 출력에 `shape_signal` 항목이 등장 (포함/제외 판정은 게이트 자율 — 등장 여부만 확인). 수 분 소요 가능.

- [ ] **Step 3: 커밋**

```bash
git add scripts/benchmark_all.ts
git commit -m "feat(shape): benchmark par cutoff 고정 + --include/--exclude 강제 플래그"
```

---

### Task 6: 통제 A/B 실행·판정·기록 — ⚠️ 메인 세션 수행 (서브에이전트 X)

**Files:**
- Modify: `docs/status/04-signals.md` (결과 기록)
- Modify: `docs/pipeline_guide.md` (probe:shape 옆에 --include/--exclude 사용법 1줄)
- (채택 시) Modify: `docs/history/modeling-history.md`

**Interfaces:**
- Consumes: Task 5의 CLI 플래그
- Produces: 채택/기각 판정 + 문서 기록

- [ ] **Step 1: OFF 런 (기준선)**

Run: `npm run benchmark -- --exclude shape_signal`
기록: 롤링 표의 Logistic(t2) 행 — overall 연승(show)률 + 분기별.

- [ ] **Step 2: ON 런**

Run: `npm run benchmark -- --include shape_signal`
기록: 같은 지표.

- [ ] **Step 3: 판정 (스펙 §5 — 사전 확정, 결과 보고 변경 금지)**

- Δ(ON−OFF) ≥ +0.5%p **그리고** 분기별 Δ 과반 양수 → **채택**
- 미달 → 기각/보류
- 참고 진단: Logistic(t1)/(t3)·GBDT Δ, 게이트B shape_signal 한계기여, (채택 우세 시) 로지스틱 계수에서 흡수 여부 해석

- [ ] **Step 4: 문서 기록 + 커밋**

결과와 무관하게 docs/status/04-signals.md에 A/B 수치(ON/OFF·분기별)와 판정 기록. 채택 시 modeling-history에도. 커밋:

```bash
git add docs/status/04-signals.md docs/pipeline_guide.md
git commit -m "docs(signals): 전개 피처 통제 A/B 결과 기록 (판정: <채택|기각|보류>)"
```

- [ ] **Step 5: 브랜치 마무리**

superpowers:finishing-a-development-branch 스킬로 merge/PR 여부를 사용자와 결정 (push는 사용자 승인 후).
