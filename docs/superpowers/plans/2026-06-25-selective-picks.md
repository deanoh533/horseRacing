# 선별 표시·베팅 (Selective Picks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보정확률 `p_top3`로 개별 마에 강추/주목 2단계 라벨을 붙여 UI(뱃지·`/picks` 뷰·통계)에 노출하고, 선별 적중률 향상을 probe + 상시 추적으로 검증한다.

**Architecture:** 랭킹·점수·예측 파이프라인을 일절 건드리지 않는 **읽기 레이어**만 추가. 순수 로직(티어 분류·적중률 곡선)은 `src/engine/eval/selectivePicks.ts`에 SSOT로 두고 root vitest로 테스트. 임계값(튜닝 잦은 값)은 `client/src/config/selective_picks.json` 단일 출처에 두어 클라이언트는 네이티브 import, probe 스크립트는 `node:fs`로 읽고/쓴다.

**Tech Stack:** TypeScript, Node(tsx) 스크립트, DuckDB 로컬 미러(읽기), React + Vite + Tailwind 클라이언트, React Query, vitest.

## Global Constraints

- 랭킹·`total_score`·`item_scores`·예측 파이프라인 **불변**. 읽기 전용 추가만.
- 기준 지표 = 연승 `p_top3`. 단승 `p_win`은 **부수 표시·리포트**로만.
- 티어 임계값 단일 출처 = `client/src/config/selective_picks.json`. 코드에 숫자 하드코딩 금지.
- `minProb <= 0` 인 티어는 **비활성**(미노출). probe 전 기본값 0 → UI 자동 빈 상태.
- probe는 **로컬 DuckDB**(`data/local.duckdb`)에서 읽어 egress 0. 클라이언트(`/picks`·통계)만 Supabase REST 사용.
- 강추 0건일 때 **억지 추천 금지** — 빈 상태 명시(정직성).
- 매 커밋 전 `npm run build`(tsc) + `npm run test:run`(vitest) 통과. 클라이언트 변경 시 `npm run client:build` 추가.
- 커밋 메시지: 한국어 + scope. 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01QkT831bFwUgKH6zVpDwtgJ`.
- 브랜치 `feat/selective-picks` (이미 생성됨).

---

## File Structure

| 파일 | 책임 |
|---|---|
| `client/src/config/selective_picks.json` (생성) | 임계값·메타 단일 출처 |
| `src/engine/eval/selectivePicks.ts` (생성) | 순수 로직 SSOT: classifyTier·buildSelectionCurve·tierAccuracy·pickThreshold |
| `src/engine/eval/selectivePicks.test.ts` (생성) | 위 순수 로직 단위 테스트 (root vitest) |
| `scripts/probe_selective_picks.ts` (생성) | DuckDB 읽기 + config fs I/O + 곡선/타깃/추적 CLI |
| `vitest.config.ts` (수정) | include에 `client/src/lib/**/*.test.ts` 추가 |
| `package.json` (수정) | `probe:picks` 스크립트 |
| `client/tsconfig.app.json` (수정) | `resolveJsonModule: true` |
| `client/src/lib/selectivePicks.ts` (생성) | 클라이언트 래퍼: classifyPick·tierLabel (config 주입) |
| `client/src/lib/selectivePicks.test.ts` (생성) | classifyPickWith 경계 테스트 |
| `client/src/components/PickBadge.tsx` (생성) | 티어 칩 컴포넌트 |
| `client/src/pages/PredictionSheet.tsx` (수정) | 뱃지 2곳 삽입 (line ~306, ~1046) |
| `client/src/pages/RaceEntries.tsx` (수정) | 뱃지 삽입 (line ~180) |
| `client/src/pages/TodayPicks.tsx` (생성) | '오늘의 강추' 모음 뷰 |
| `client/src/App.tsx` (수정) | `/picks` 라우트 |
| `client/src/components/Layout.tsx` (수정) | nav 탭 추가 |
| `client/src/lib/queries.ts` (수정) | `useUpcomingPicks`·`useSelectivePickAccuracy` 훅 |
| `client/src/pages/Statistics.tsx` (수정) | "선별 적중률" 섹션 |

---

## Task 1: 순수 로직 모듈 (SSOT) + 테스트

**Files:**
- Create: `src/engine/eval/selectivePicks.ts`
- Test: `src/engine/eval/selectivePicks.test.ts`

**Interfaces:**
- Produces: `classifyTier(pTop3, strongMin, watchMin): PickTier`, `buildSelectionCurve(rows, thresholds): CurveResult`, `tierAccuracy(rows, strongMin, watchMin): TierStat[]`, `pickThreshold(curve, targetPlace): number|null`, types `PredRow`·`PickTier`·`CurvePoint`·`CurveResult`·`TierStat`.

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/eval/selectivePicks.test.ts
import { describe, it, expect } from 'vitest';
import {
  classifyTier, buildSelectionCurve, tierAccuracy, pickThreshold,
  type PredRow,
} from './selectivePicks.js';

const row = (p_top3: number | null, actual_ord: number | null, rc = 1, p_win = 0.1): PredRow =>
  ({ race_date: 20260101, meet: 1, rc_no: rc, p_top3, p_win, actual_ord });

describe('classifyTier', () => {
  it('강추/주목/null 경계', () => {
    expect(classifyTier(0.9, 0.8, 0.6)).toBe('strong');
    expect(classifyTier(0.8, 0.8, 0.6)).toBe('strong'); // 경계 포함
    expect(classifyTier(0.7, 0.8, 0.6)).toBe('watch');
    expect(classifyTier(0.6, 0.8, 0.6)).toBe('watch');  // 경계 포함
    expect(classifyTier(0.5, 0.8, 0.6)).toBe(null);
    expect(classifyTier(null, 0.8, 0.6)).toBe(null);
  });
  it('minProb<=0 비활성', () => {
    expect(classifyTier(0.99, 0, 0)).toBe(null);
    expect(classifyTier(0.99, 0, 0.6)).toBe('watch'); // 강추만 비활성
  });
});

describe('buildSelectionCurve', () => {
  const rows: PredRow[] = [
    row(0.9, 1, 1), row(0.7, 4, 1),   // 경주1: 한 마리 적중(1착), 한 마리 탈락
    row(0.85, 2, 2), row(0.5, 5, 2),  // 경주2
  ];
  it('임계값별 적중률·커버리지·베이스라인', () => {
    const c = buildSelectionCurve(rows, [0.8, 0.6]);
    expect(c.totalRows).toBe(4);
    expect(c.totalRaces).toBe(2);
    // 베이스라인 연승(1~3착): 0.9→1착O, 0.7→4착X, 0.85→2착O, 0.5→5착X = 2/4
    expect(c.baselinePlace).toBeCloseTo(0.5);
    expect(c.baselineWin).toBeCloseTo(0.25); // 1착 1건/4
    const at08 = c.points.find((p) => p.threshold === 0.8)!;
    expect(at08.picks).toBe(2);             // 0.9, 0.85
    expect(at08.placeHitRate).toBeCloseTo(1.0); // 둘 다 3착내
    expect(at08.coverage).toBeCloseTo(1.0);  // 두 경주 모두 픽 존재
  });
});

describe('tierAccuracy', () => {
  it('주목은 [watchMin, strongMin) 배타 구간', () => {
    const rows: PredRow[] = [row(0.9, 1, 1), row(0.7, 2, 2), row(0.5, 4, 3)];
    const [strong, watch] = tierAccuracy(rows, 0.8, 0.6);
    expect(strong.picks).toBe(1);   // 0.9
    expect(watch.picks).toBe(1);    // 0.7 (0.5는 제외)
    expect(strong.placeHitRate).toBeCloseTo(1.0);
  });
});

describe('pickThreshold', () => {
  it('목표 적중률을 만족하는 최저 임계값', () => {
    const rows: PredRow[] = [row(0.9, 1), row(0.8, 2), row(0.7, 5), row(0.6, 6)];
    const c = buildSelectionCurve(rows, [0.6, 0.7, 0.8, 0.9]);
    // 0.8 이상: 0.9(1착),0.8(2착) → 1.0 ; 0.7 이상: +0.7(5착X) → 2/3
    expect(pickThreshold(c, 0.9)).toBe(0.8);
    expect(pickThreshold(c, 1.1)).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/engine/eval/selectivePicks.test.ts`
Expected: FAIL — `Cannot find module './selectivePicks.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/eval/selectivePicks.ts
/**
 * 선별 표시(Selective Picks) 순수 로직 — p_top3 보정확률 → 강추/주목 티어,
 * 임계값별 적중률·커버리지 곡선, 티어별 실측, 목표적중률→임계값 역산.
 * I/O 없음(테스트 용이). 임계값은 호출측이 주입(config JSON은 probe/클라이언트가 읽음).
 * 설계: docs/superpowers/specs/2026-06-25-selective-picks-design.md
 */
export type PickTier = 'strong' | 'watch' | null;

export interface PredRow {
  race_date: number; meet: number; rc_no: number;
  p_top3: number | null; p_win: number | null; actual_ord: number | null;
}

/** p_top3 → 티어. minProb<=0 인 티어는 비활성. 강추 우선, 그다음 주목. */
export function classifyTier(pTop3: number | null, strongMin: number, watchMin: number): PickTier {
  if (pTop3 == null) return null;
  if (strongMin > 0 && pTop3 >= strongMin) return 'strong';
  if (watchMin > 0 && pTop3 >= watchMin) return 'watch';
  return null;
}

const raceKey = (r: PredRow): string => `${r.race_date}-${r.meet}-${r.rc_no}`;
const isPlace = (r: PredRow): boolean => r.actual_ord != null && r.actual_ord >= 1 && r.actual_ord <= 3;
const isWin = (r: PredRow): boolean => r.actual_ord === 1;
const onlyResolved = (rows: PredRow[]): PredRow[] => rows.filter((r) => r.actual_ord != null && r.p_top3 != null);

export interface CurvePoint {
  threshold: number; picks: number;
  placeHitRate: number; winHitRate: number; coverage: number;
}
export interface CurveResult {
  totalRows: number; totalRaces: number;
  baselinePlace: number; baselineWin: number;
  points: CurvePoint[];
}

/** 사후 행(actual_ord·p_top3 둘 다 non-null) 대상. */
export function buildSelectionCurve(rows: PredRow[], thresholds: number[]): CurveResult {
  const valid = onlyResolved(rows);
  const allRaces = new Set(valid.map(raceKey));
  const rate = (sel: PredRow[], pred: (r: PredRow) => boolean): number =>
    sel.length ? sel.filter(pred).length / sel.length : 0;
  const points = thresholds.map((t): CurvePoint => {
    const picks = valid.filter((r) => (r.p_top3 as number) >= t);
    return {
      threshold: t,
      picks: picks.length,
      placeHitRate: rate(picks, isPlace),
      winHitRate: rate(picks, isWin),
      coverage: allRaces.size ? new Set(picks.map(raceKey)).size / allRaces.size : 0,
    };
  });
  return {
    totalRows: valid.length, totalRaces: allRaces.size,
    baselinePlace: rate(valid, isPlace), baselineWin: rate(valid, isWin),
    points,
  };
}

export interface TierStat {
  tier: 'strong' | 'watch';
  picks: number; placeHitRate: number; winHitRate: number; coverage: number;
}

/** 확정 임계값으로 티어별 실측. watch = [watchMin, strongMin) 배타. */
export function tierAccuracy(rows: PredRow[], strongMin: number, watchMin: number): TierStat[] {
  const valid = onlyResolved(rows);
  const allRaces = new Set(valid.map(raceKey));
  const rate = (sel: PredRow[], pred: (r: PredRow) => boolean): number =>
    sel.length ? sel.filter(pred).length / sel.length : 0;
  const stat = (sel: PredRow[], tier: 'strong' | 'watch'): TierStat => ({
    tier, picks: sel.length,
    placeHitRate: rate(sel, isPlace), winHitRate: rate(sel, isWin),
    coverage: allRaces.size ? new Set(sel.map(raceKey)).size / allRaces.size : 0,
  });
  const isStrong = (r: PredRow): boolean => strongMin > 0 && (r.p_top3 as number) >= strongMin;
  const strong = valid.filter(isStrong);
  const watch = valid.filter((r) => watchMin > 0 && (r.p_top3 as number) >= watchMin && !isStrong(r));
  return [stat(strong, 'strong'), stat(watch, 'watch')];
}

/** placeHitRate ≥ target 를 만족하는 가장 낮은 threshold(커버리지 최대). 없으면 null. */
export function pickThreshold(curve: CurveResult, targetPlace: number): number | null {
  const sorted = [...curve.points].sort((a, b) => a.threshold - b.threshold);
  for (const p of sorted) if (p.placeHitRate >= targetPlace) return p.threshold;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/engine/eval/selectivePicks.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add src/engine/eval/selectivePicks.ts src/engine/eval/selectivePicks.test.ts
git commit -m "feat(picks): 선별 표시 순수 로직(티어 분류·적중률 곡선·임계값 역산) + 테스트

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkT831bFwUgKH6zVpDwtgJ"
```

---

## Task 2: config 단일 출처 + 클라이언트 래퍼 + 테스트

**Files:**
- Create: `client/src/config/selective_picks.json`
- Create: `client/src/lib/selectivePicks.ts`
- Create: `client/src/lib/selectivePicks.test.ts`
- Modify: `vitest.config.ts` (include)
- Modify: `client/tsconfig.app.json` (resolveJsonModule)

**Interfaces:**
- Produces: `classifyPick(pTop3): PickTier`, `classifyPickWith(pTop3, strongMin, watchMin): PickTier`, `tierLabel(t): string|null`, `pickConfig`.

- [ ] **Step 1: Create config (비활성 기본값)**

```json
// client/src/config/selective_picks.json
{
  "version": 1,
  "fitAt": "2026-06-25",
  "metric": "p_top3",
  "tiers": {
    "strong": { "minProb": 0, "targetHit": 0.85, "label": "강추" },
    "watch":  { "minProb": 0, "targetHit": 0.75, "label": "주목" }
  },
  "fitMeta": { "rows": 0, "from": 0, "to": 0 }
}
```

- [ ] **Step 2: Enable JSON import in client tsconfig**

`client/tsconfig.app.json` — `compilerOptions`에 한 줄 추가 (`"skipLibCheck": true,` 다음 줄):

```json
    "skipLibCheck": true,
    "resolveJsonModule": true,
```

- [ ] **Step 3: Extend root vitest include**

`vitest.config.ts` line 8 교체:

```ts
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts', 'client/src/lib/**/*.test.ts'],
```

- [ ] **Step 4: Write the failing test**

```ts
// client/src/lib/selectivePicks.test.ts
import { describe, it, expect } from 'vitest';
import { classifyPickWith, tierLabel } from './selectivePicks';

describe('classifyPickWith', () => {
  it('경계값 분류', () => {
    expect(classifyPickWith(0.9, 0.8, 0.6)).toBe('strong');
    expect(classifyPickWith(0.8, 0.8, 0.6)).toBe('strong');
    expect(classifyPickWith(0.7, 0.8, 0.6)).toBe('watch');
    expect(classifyPickWith(0.59, 0.8, 0.6)).toBe(null);
    expect(classifyPickWith(null, 0.8, 0.6)).toBe(null);
    expect(classifyPickWith(0.99, 0, 0)).toBe(null); // 비활성
  });
});

describe('tierLabel', () => {
  it('티어 라벨', () => {
    expect(tierLabel('strong')).toBe('강추');
    expect(tierLabel('watch')).toBe('주목');
    expect(tierLabel(null)).toBe(null);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test:run -- client/src/lib/selectivePicks.test.ts`
Expected: FAIL — module not found

- [ ] **Step 6: Write implementation**

```ts
// client/src/lib/selectivePicks.ts
import config from '../config/selective_picks.json';

export type PickTier = 'strong' | 'watch' | null;

/** src/engine/eval/selectivePicks.ts classifyTier와 동일 로직(설정값 주입). */
export function classifyPickWith(
  pTop3: number | null | undefined,
  strongMin: number,
  watchMin: number,
): PickTier {
  if (pTop3 == null) return null;
  if (strongMin > 0 && pTop3 >= strongMin) return 'strong';
  if (watchMin > 0 && pTop3 >= watchMin) return 'watch';
  return null;
}

/** config 임계값으로 분류. minProb 0(미확정)이면 전부 null → UI 자동 미노출. */
export function classifyPick(pTop3: number | null | undefined): PickTier {
  return classifyPickWith(pTop3, config.tiers.strong.minProb, config.tiers.watch.minProb);
}

export function tierLabel(t: PickTier): string | null {
  if (t === 'strong') return config.tiers.strong.label;
  if (t === 'watch') return config.tiers.watch.label;
  return null;
}

export const pickConfig = config;
```

- [ ] **Step 7: Run tests + client typecheck**

Run: `npm run test:run -- client/src/lib/selectivePicks.test.ts`
Expected: PASS
Run: `npm run client:build`
Expected: tsc 통과 (JSON import 해결됨), vite build 성공

- [ ] **Step 8: Commit**

```bash
git add client/src/config/selective_picks.json client/src/lib/selectivePicks.ts client/src/lib/selectivePicks.test.ts vitest.config.ts client/tsconfig.app.json
git commit -m "feat(picks): 임계값 config 단일출처 + 클라이언트 classifyPick 래퍼 + 테스트

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkT831bFwUgKH6zVpDwtgJ"
```

---

## Task 3: probe 스크립트 (곡선·타깃·추적)

**Files:**
- Create: `scripts/probe_selective_picks.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `getLocalDb` from `src/db/localDb.js`; `buildSelectionCurve`·`tierAccuracy`·`pickThreshold` from `src/engine/eval/selectivePicks.js`.

- [ ] **Step 1: Add npm script**

`package.json` scripts에 추가 (`"calib:fit-live"` 줄 다음):

```json
    "probe:picks": "tsx scripts/probe_selective_picks.ts",
```

- [ ] **Step 2: Write the probe script**

```ts
// scripts/probe_selective_picks.ts
/**
 * 선별 표시 probe — 로컬 DuckDB predictions(사후)로:
 *  · 기본      : 임계값별 (연승 적중률·단승·커버리지·건수) 곡선 + 베이스라인
 *  · --strong H --watch H : 목표 연승적중률 H를 주는 최저 임계값 역산
 *  · --write   : 위 임계값을 client/src/config/selective_picks.json 에 기록
 *  · --track   : 현재 config 임계값으로 티어별 실측
 *  · --from YYYYMMDD : 시작일 필터(선택)
 * 사용: npm run probe:picks [-- --strong 0.85 --watch 0.75 --write]
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { getLocalDb } from '../src/db/localDb.js';
import {
  buildSelectionCurve, tierAccuracy, pickThreshold, type PredRow,
} from '../src/engine/eval/selectivePicks.js';

const CONFIG_PATH = 'client/src/config/selective_picks.json';
const pct = (x: number): string => (x * 100).toFixed(1) + '%';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadRows(from?: number): Promise<PredRow[]> {
  const db = await getLocalDb();
  let q = db.from('predictions')
    .select('race_date, meet, rc_no, p_top3, p_win, actual_ord')
    .not('actual_ord', 'is', null)
    .not('p_top3', 'is', null);
  if (from) q = q.gte('race_date', from);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PredRow[];
}

async function main(): Promise<void> {
  const from = arg('--from') ? Number(arg('--from')) : undefined;
  const rows = await loadRows(from);
  console.log(`📊 선별 표시 probe — 사후 예측 ${rows.length}행${from ? ` (≥${from})` : ''}\n`);

  const grid: number[] = [];
  for (let t = 0.5; t <= 0.95 + 1e-9; t += 0.05) grid.push(Number(t.toFixed(2)));
  const curve = buildSelectionCurve(rows, grid);
  console.log(`경주 ${curve.totalRaces} · 베이스라인 연승 ${pct(curve.baselinePlace)} · 단승 ${pct(curve.baselineWin)}\n`);
  console.log('p_top3 ≥ | 건수  | 연승적중 | 단승적중 | 커버리지');
  console.log('---------|-------|----------|----------|---------');
  for (const p of [...curve.points].sort((a, b) => b.threshold - a.threshold)) {
    console.log(
      `  ${p.threshold.toFixed(2)}   | ${String(p.picks).padStart(5)} | ${pct(p.placeHitRate).padStart(8)} | ` +
      `${pct(p.winHitRate).padStart(8)} | ${pct(p.coverage).padStart(7)}`,
    );
  }

  if (process.argv.includes('--track')) {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const [strong, watch] = tierAccuracy(rows, cfg.tiers.strong.minProb, cfg.tiers.watch.minProb);
    console.log(`\n── 현재 config 티어 실측 (강추≥${cfg.tiers.strong.minProb} · 주목≥${cfg.tiers.watch.minProb}) ──`);
    for (const s of [strong, watch]) {
      const label = s.tier === 'strong' ? '강추' : '주목';
      console.log(`  ${label}: ${s.picks}건 · 연승 ${pct(s.placeHitRate)} · 단승 ${pct(s.winHitRate)} · 커버리지 ${pct(s.coverage)}`);
    }
  }

  const sTarget = arg('--strong') ? Number(arg('--strong')) : undefined;
  const wTarget = arg('--watch') ? Number(arg('--watch')) : undefined;
  if (sTarget != null || wTarget != null) {
    const fine: number[] = [];
    for (let t = 0.4; t <= 0.99 + 1e-9; t += 0.01) fine.push(Number(t.toFixed(2)));
    const fineCurve = buildSelectionCurve(rows, fine);
    const sMin = sTarget != null ? pickThreshold(fineCurve, sTarget) : null;
    const wMin = wTarget != null ? pickThreshold(fineCurve, wTarget) : null;
    console.log('\n── 목표 적중률 → 최저 임계값 ──');
    if (sTarget != null) console.log(`  강추 목표 연승 ${pct(sTarget)} → p_top3 ≥ ${sMin ?? '(달성 불가)'}`);
    if (wTarget != null) console.log(`  주목 목표 연승 ${pct(wTarget)} → p_top3 ≥ ${wMin ?? '(달성 불가)'}`);

    if (process.argv.includes('--write')) {
      if (sMin == null || wMin == null) { console.error('⚠️ 임계값 달성 불가 — write 취소'); process.exit(1); }
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      cfg.tiers.strong.minProb = sMin; cfg.tiers.strong.targetHit = sTarget;
      cfg.tiers.watch.minProb = wMin;  cfg.tiers.watch.targetHit = wTarget;
      cfg.fitAt = new Date().toISOString().slice(0, 10);
      const dates = rows.map((r) => r.race_date);
      cfg.fitMeta = { rows: rows.length, from: Math.min(...dates), to: Math.max(...dates) };
      writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
      console.log(`\n✅ ${CONFIG_PATH} 기록: 강추≥${sMin} · 주목≥${wMin}`);
    }
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 3: Run the probe (곡선 확인)**

Run: `npm run probe:picks`
Expected: 베이스라인 + 임계값별 표가 출력. (DuckDB 없으면 `data/local.duckdb 없음 — npm run db:pull` 에러 → 사용자에게 `npm run db:pull` 요청)

- [ ] **Step 4: Commit**

```bash
git add scripts/probe_selective_picks.ts package.json
git commit -m "feat(picks): probe:picks 스크립트(임계값 곡선·목표적중률 역산·config 기록·추적)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkT831bFwUgKH6zVpDwtgJ"
```

---

## Task 4: 임계값 확정 (사용자 결정 체크포인트)

**Files:**
- Modify: `client/src/config/selective_picks.json` (probe `--write`가 기록)

> ⚠️ 이 Task는 **사용자와 함께** 진행한다. probe 곡선을 보고 목표 연승 적중률(강추/주목)을 데이터 기반으로 확정한다. 서브에이전트 단독 실행 금지 — 곡선 출력을 사용자에게 제시하고 목표치를 받는다.

- [ ] **Step 1: 곡선 제시**

Run: `npm run probe:picks`
곡선 표(임계값별 연승 적중률·커버리지·건수)와 베이스라인을 사용자에게 보여준다.

- [ ] **Step 2: 목표 적중률 확정**

사용자에게 강추/주목 목표 연승 적중률을 AskUserQuestion(버튼)으로 묻는다. 곡선에서 보이는 실제 달성 가능 구간을 옵션으로 제시(예: 강추 90/85/80%, 주목 75/70%). 커버리지가 너무 낮으면(예: <5%) 경고.

- [ ] **Step 3: config 기록**

Run: `npm run probe:picks -- --strong <확정값> --watch <확정값> --write`
Expected: `✅ client/src/config/selective_picks.json 기록: 강추≥X · 주목≥Y`

- [ ] **Step 4: 검증 (추적 수치)**

Run: `npm run probe:picks -- --track`
Expected: 강추/주목 티어 실측 연승 적중률이 목표치 부근, 베이스라인보다 높음(리프트 확인).

- [ ] **Step 5: Commit**

```bash
git add client/src/config/selective_picks.json
git commit -m "feat(picks): 강추/주목 임계값 데이터 확정(probe 곡선 기반)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkT831bFwUgKH6zVpDwtgJ"
```

---

## Task 5: PickBadge 컴포넌트 + 화면 삽입

**Files:**
- Create: `client/src/components/PickBadge.tsx`
- Modify: `client/src/pages/PredictionSheet.tsx` (line ~306, ~1046)
- Modify: `client/src/pages/RaceEntries.tsx` (line ~180)

**Interfaces:**
- Consumes: `classifyPick`, `tierLabel` from `../lib/selectivePicks`.
- Produces: `<PickBadge pTop3={number|null} />` — 티어 null이면 아무것도 렌더 안 함.

- [ ] **Step 1: Write PickBadge**

```tsx
// client/src/components/PickBadge.tsx
import { classifyPick, tierLabel } from '../lib/selectivePicks';

/** p_top3 → 강추/주목 칩. 임계값 미달·미확정(config 0)·null이면 렌더 안 함. */
export function PickBadge({ pTop3 }: { pTop3: number | null | undefined }) {
  const tier = classifyPick(pTop3);
  if (tier === null) return null;
  const cls =
    tier === 'strong'
      ? 'bg-amber-400 text-black'
      : 'bg-[var(--color-bg-elevated)] text-amber-300 border border-amber-400/40';
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none ${cls}`}>
      {tierLabel(tier)}
    </span>
  );
}
```

- [ ] **Step 2: Insert into PredictionSheet (2곳)**

`client/src/pages/PredictionSheet.tsx` 상단 import 추가:
```tsx
import { PickBadge } from '../components/PickBadge';
```

line ~306 블록 — 기존:
```tsx
                {p.p_win != null && p.p_top3 != null && (
                  <span className="text-xs text-[var(--color-text-secondary)] ml-2">
                    우승 {fmtPct(p.p_win)} · 연승 {fmtPct(p.p_top3)}
                  </span>
                )}
```
교체:
```tsx
                <PickBadge pTop3={p.p_top3} />
                {p.p_win != null && p.p_top3 != null && (
                  <span className="text-xs text-[var(--color-text-secondary)] ml-2">
                    우승 {fmtPct(p.p_win)} · 연승 {fmtPct(p.p_top3)}
                  </span>
                )}
```

line ~1046 블록 — 기존:
```tsx
            {prediction?.p_win != null && prediction?.p_top3 != null && (
              <span className="text-xs text-[var(--color-text-secondary)]">
                우승 {fmtPct(prediction.p_win)} · 연승 {fmtPct(prediction.p_top3)}
              </span>
            )}
```
교체 (앞에 뱃지 추가):
```tsx
            <PickBadge pTop3={prediction?.p_top3} />
            {prediction?.p_win != null && prediction?.p_top3 != null && (
              <span className="text-xs text-[var(--color-text-secondary)]">
                우승 {fmtPct(prediction.p_win)} · 연승 {fmtPct(prediction.p_top3)}
              </span>
            )}
```

- [ ] **Step 3: Insert into RaceEntries**

`client/src/pages/RaceEntries.tsx` 상단 import 추가:
```tsx
import { PickBadge } from '../components/PickBadge';
```

line ~180 블록 — 기존:
```tsx
                  <span className="font-semibold">{p.hr_name}</span>
                  <span className="text-xs text-[var(--color-text-disabled)]">{p.total_score.toFixed(1)}점</span>
                  {p.p_win != null && <span className="text-xs text-[var(--color-text-disabled)] ml-1">{fmtPct(p.p_win)}</span>}
```
교체 (마명 뒤 뱃지):
```tsx
                  <span className="font-semibold">{p.hr_name}</span>
                  <PickBadge pTop3={p.p_top3} />
                  <span className="text-xs text-[var(--color-text-disabled)]">{p.total_score.toFixed(1)}점</span>
                  {p.p_win != null && <span className="text-xs text-[var(--color-text-disabled)] ml-1">{fmtPct(p.p_win)}</span>}
```

> ⚠️ 위 `p`가 `p_top3`를 포함하는지 확인. RaceEntries에서 predictions를 부분 컬럼으로 select하면 `p_top3` 없을 수 있음 — 해당 쿼리(`usePredictionsByRace`는 `select('*')`라 포함됨)를 확인하고, 부분 select면 `p_top3` 추가.

- [ ] **Step 4: Typecheck + build**

Run: `npm run client:build`
Expected: tsc + vite build 통과.

- [ ] **Step 5: 시각 확인 (수동)**

`npm run client:dev` 실행 → 예측 화면에서 임계값 넘는 마에 강추/주목 칩 표시 확인. (Task 4 전이면 칩 안 보임 = 정상)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/PickBadge.tsx client/src/pages/PredictionSheet.tsx client/src/pages/RaceEntries.tsx
git commit -m "feat(picks): PickBadge 강추/주목 칩 + 예측 화면 삽입

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkT831bFwUgKH6zVpDwtgJ"
```

---

## Task 6: '오늘의 강추' 뷰 (`/picks`)

**Files:**
- Modify: `client/src/lib/queries.ts` (`useUpcomingPicks` 훅)
- Create: `client/src/pages/TodayPicks.tsx`
- Modify: `client/src/App.tsx` (라우트)
- Modify: `client/src/components/Layout.tsx` (nav 탭)

**Interfaces:**
- Consumes: `supabase` client, `Prediction` type, `classifyPick`/`tierLabel`, `PickBadge`, `fmtPct`.
- Produces: `useUpcomingPicks()` → `{ data: Prediction[] }` (actual_ord null 사전 예측 전부).

- [ ] **Step 1: Add hook**

`client/src/lib/queries.ts` — `usePredictionsByDate` 다음에 추가:

```ts
/**
 * 다가오는(사전) 예측 — actual_ord NULL, p_top3 존재. 페이지네이션으로 전부 fetch.
 * TodayPicks 뷰에서 classifyPick으로 강추/주목만 클라이언트 필터.
 */
export function useUpcomingPicks() {
  return useQuery({
    queryKey: ['upcoming-picks'],
    queryFn: async (): Promise<Prediction[]> => {
      const rows: Prediction[] = [];
      const PAGE = 1000;
      for (let off = 0; ; off += PAGE) {
        const { data, error } = await supabase
          .from('predictions')
          .select('*')
          .is('actual_ord', null)
          .not('p_top3', 'is', null)
          .order('race_date')
          .order('meet')
          .order('rc_no')
          .range(off, off + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...(data as Prediction[]));
        if (data.length < PAGE) break;
      }
      return rows;
    },
    staleTime: 10 * 60 * 1000,
  });
}
```

> ⚠️ supabase-js의 NULL 필터는 `.is('actual_ord', null)`, NOT NULL은 `.not('p_top3', 'is', null)`. queries.ts 기존 패턴 확인.

- [ ] **Step 2: Create TodayPicks page**

```tsx
// client/src/pages/TodayPicks.tsx
import { Link } from 'react-router-dom';
import { useUpcomingPicks } from '../lib/queries';
import { classifyPick } from '../lib/selectivePicks';
import { PickBadge } from '../components/PickBadge';
import { fmtPct } from '../lib/sectional';
import type { Prediction } from '../lib/supabase';

const MEET_NAME: Record<number, string> = { 1: '서울', 2: '제주', 3: '부경' };

export function TodayPicks() {
  const { data, isLoading } = useUpcomingPicks();

  if (isLoading) return <div className="text-[var(--color-text-secondary)]">불러오는 중…</div>;

  const picks = (data ?? [])
    .filter((p) => classifyPick(p.p_top3) !== null)
    .sort((a, b) => {
      const rank = (t: ReturnType<typeof classifyPick>) => (t === 'strong' ? 0 : 1);
      return rank(classifyPick(a.p_top3)) - rank(classifyPick(b.p_top3)) || (b.p_top3 ?? 0) - (a.p_top3 ?? 0);
    });

  if (picks.length === 0) {
    return (
      <div className="py-12 text-center text-[var(--color-text-secondary)]">
        <p className="text-lg mb-1">이번 주 강추 없음</p>
        <p className="text-sm">기준(연승 확률 임계값)을 넘는 출주마가 없습니다.</p>
      </div>
    );
  }

  // 경주별 그룹
  const byRace = new Map<string, Prediction[]>();
  for (const p of picks) {
    const k = `${p.race_date}-${p.meet}-${p.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(p);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">오늘의 강추</h1>
      <p className="text-sm text-[var(--color-text-secondary)]">
        보정 연승확률 기준 강추/주목 {picks.length}마리 · {byRace.size}경주
      </p>
      {[...byRace.entries()].map(([key, horses]) => {
        const h0 = horses[0]!;
        return (
          <div key={key} className="rounded-lg border border-[var(--color-bg-elevated)] p-3">
            <Link
              to={`/race/${h0.meet}/${h0.race_date}/${h0.rc_no}/sheet`}
              className="text-sm font-medium text-[var(--color-accent-cyan)]"
            >
              {MEET_NAME[h0.meet] ?? h0.meet} {h0.race_date} · {h0.rc_no}R →
            </Link>
            <ul className="mt-2 space-y-1">
              {horses.map((p) => (
                <li key={p.hr_name} className="flex items-center gap-2 text-sm">
                  <PickBadge pTop3={p.p_top3} />
                  <span className="font-semibold">{p.hr_name}</span>
                  <span className="text-xs text-[var(--color-text-secondary)] ml-auto">
                    연승 {p.p_top3 != null ? fmtPct(p.p_top3) : '-'}
                    {p.p_win != null && <> · 우승 {fmtPct(p.p_win)}</>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
```

> ⚠️ `MEET_NAME` 값(1=서울 등)은 프로젝트 기존 매핑과 일치하는지 확인(다른 페이지의 meet 표기 참고). 라우트 경로 `/race/:meet/:date/:rcNo/sheet`는 App.tsx와 일치.

- [ ] **Step 3: Add route**

`client/src/App.tsx` — import + 라우트:
```tsx
import { TodayPicks } from './pages/TodayPicks';
```
`<Route path="/stats" ... />` 위에 추가:
```tsx
          <Route path="/picks" element={<TodayPicks />} />
```

- [ ] **Step 4: Add nav tab**

`client/src/components/Layout.tsx` — lucide import에 `Star` 추가:
```tsx
import { LayoutDashboard, BarChart3, Settings as SettingsIcon, FlaskConical, Star } from 'lucide-react';
```
nav에 대시보드 다음 탭 추가:
```tsx
          <NavTab to="/picks" icon={<Star className="w-4 h-4" />} label="강추" />
```

- [ ] **Step 5: Typecheck + build + 시각 확인**

Run: `npm run client:build`
Expected: 통과.
`npm run client:dev` → `/picks` 진입, 강추/주목 목록 또는 빈 상태 확인.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/queries.ts client/src/pages/TodayPicks.tsx client/src/App.tsx client/src/components/Layout.tsx
git commit -m "feat(picks): '오늘의 강추' /picks 뷰 + 네비 탭 + useUpcomingPicks 훅

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkT831bFwUgKH6zVpDwtgJ"
```

---

## Task 7: 통계 "선별 적중률" 섹션 (상시 추적)

**Files:**
- Modify: `client/src/lib/queries.ts` (`useSelectivePickAccuracy` 훅)
- Modify: `client/src/pages/Statistics.tsx` (섹션 추가)

**Interfaces:**
- Consumes: `supabase`, `classifyPick`, `pickConfig`.
- Produces: `useSelectivePickAccuracy(monthsBack)` → `{ data: { tier, picks, placeHitRate, winHitRate, coverage }[] + baseline }`.

- [ ] **Step 1: Add hook**

`client/src/lib/queries.ts` — `useMonthlyHitRate` 다음에 추가:

```ts
export type SelectiveTierStat = {
  tier: 'strong' | 'watch';
  picks: number; placeHitRate: number; winHitRate: number; coverage: number;
};
export type SelectivePickAccuracy = {
  tiers: SelectiveTierStat[];
  baselinePlace: number; totalRaces: number;
};

/**
 * 선별 적중률 상시 추적 — 사후(actual_ord 존재) 예측을 config 임계값으로 티어 분류,
 * 티어별 연승/단승 적중률·커버리지 + 전체 베이스라인. classifyPick과 같은 config 사용.
 */
export function useSelectivePickAccuracy(monthsBack: number | null = 12) {
  return useQuery({
    queryKey: ['selective-pick-accuracy', monthsBack],
    queryFn: async (): Promise<SelectivePickAccuracy> => {
      const since = monthsBack != null ? dateMonthsAgo(monthsBack) : 0;
      const rows: { race_date: number; meet: number; rc_no: number; p_top3: number | null; actual_ord: number | null }[] = [];
      const PAGE = 1000;
      for (let off = 0; ; off += PAGE) {
        let qb = supabase
          .from('predictions')
          .select('race_date, meet, rc_no, p_top3, actual_ord')
          .not('actual_ord', 'is', null)
          .not('p_top3', 'is', null)
          .order('race_date').range(off, off + PAGE - 1);
        if (since) qb = qb.gte('race_date', since);
        const { data, error } = await qb;
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < PAGE) break;
      }

      const sMin = pickConfig.tiers.strong.minProb;
      const wMin = pickConfig.tiers.watch.minProb;
      const key = (r: typeof rows[number]) => `${r.race_date}-${r.meet}-${r.rc_no}`;
      const allRaces = new Set(rows.map(key));
      const place = (r: typeof rows[number]) => r.actual_ord! >= 1 && r.actual_ord! <= 3;
      const win = (r: typeof rows[number]) => r.actual_ord === 1;
      const rate = (sel: typeof rows, p: (r: typeof rows[number]) => boolean) => (sel.length ? sel.filter(p).length / sel.length : 0);
      const isStrong = (r: typeof rows[number]) => sMin > 0 && r.p_top3! >= sMin;
      const strongSel = rows.filter(isStrong);
      const watchSel = rows.filter((r) => wMin > 0 && r.p_top3! >= wMin && !isStrong(r));
      const stat = (sel: typeof rows, tier: 'strong' | 'watch'): SelectiveTierStat => ({
        tier, picks: sel.length, placeHitRate: rate(sel, place), winHitRate: rate(sel, win),
        coverage: allRaces.size ? new Set(sel.map(key)).size / allRaces.size : 0,
      });
      return {
        tiers: [stat(strongSel, 'strong'), stat(watchSel, 'watch')],
        baselinePlace: rate(rows, place), totalRaces: allRaces.size,
      };
    },
    staleTime: 10 * 60 * 1000,
  });
}
```

> ⚠️ `dateMonthsAgo`가 queries.ts에 이미 있는지 확인(없으면 `monthOf` 근처에 헬퍼 추가: `YYYYMMDD` 정수 반환). `pickConfig` import 필요: `import { pickConfig } from './selectivePicks';`

- [ ] **Step 2: Add Statistics section**

`client/src/pages/Statistics.tsx` — `useSelectivePickAccuracy` import 후, 적당한 위치(월별 적중률 섹션 근처)에 섹션 추가:

```tsx
function SelectivePickSection() {
  const { data } = useSelectivePickAccuracy(12);
  if (!data) return null;
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
  const labelOf = (t: 'strong' | 'watch') => (t === 'strong' ? '강추' : '주목');
  return (
    <section className="rounded-lg border border-[var(--color-bg-elevated)] p-4">
      <h2 className="font-semibold mb-1">선별 적중률 (최근 12개월)</h2>
      <p className="text-xs text-[var(--color-text-secondary)] mb-3">
        전체 연승 베이스라인 {pct(data.baselinePlace)} · {data.totalRaces}경주
      </p>
      <table className="w-full text-sm">
        <thead className="text-[var(--color-text-secondary)] text-xs">
          <tr><th className="text-left">티어</th><th>건수</th><th>연승</th><th>단승</th><th>커버리지</th><th>리프트</th></tr>
        </thead>
        <tbody>
          {data.tiers.map((s) => (
            <tr key={s.tier} className="border-t border-[var(--color-bg-elevated)]">
              <td className="py-1 font-medium">{labelOf(s.tier)}</td>
              <td className="text-center">{s.picks}</td>
              <td className="text-center font-mono-num">{pct(s.placeHitRate)}</td>
              <td className="text-center font-mono-num">{pct(s.winHitRate)}</td>
              <td className="text-center font-mono-num">{pct(s.coverage)}</td>
              <td className="text-center font-mono-num text-[var(--color-accent-cyan)]">
                +{((s.placeHitRate - data.baselinePlace) * 100).toFixed(1)}%p
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.tiers.every((s) => s.picks === 0) && (
        <p className="text-xs text-[var(--color-text-disabled)] mt-2">임계값 미확정(probe 전) 또는 해당 구간 픽 없음.</p>
      )}
    </section>
  );
}
```
그리고 Statistics 본문 JSX에 `<SelectivePickSection />` 배치.

- [ ] **Step 3: Typecheck + build**

Run: `npm run client:build`
Expected: 통과.

- [ ] **Step 4: 시각 확인**

`npm run client:dev` → 통계 페이지에서 강추/주목 적중률 + 리프트 표 확인(베이스라인보다 높아야 트랙 성공).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/queries.ts client/src/pages/Statistics.tsx
git commit -m "feat(picks): 통계 '선별 적중률' 섹션(티어별 연승·단승·커버리지·리프트)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkT831bFwUgKH6zVpDwtgJ"
```

---

## Task 8: 문서·메모 갱신

**Files:**
- Modify: `CLAUDE.md` (현재 실행 상태 섹션)
- Modify: `docs/pipeline_guide.md` 또는 `docs/accuracy_metrics.md` (probe:picks·선별 추적 추가)
- Create/Modify: 메모 `project_market_edge_strategy` 또는 신규 `project_selective_picks`

- [ ] **Step 1: Update docs**

CLAUDE.md "현재 실행 상태"에 선별 표시 트랙 완료 + `npm run probe:picks` 명령·임계값 위치(`client/src/config/selective_picks.json`) 기록. accuracy_metrics.md에 "선별 적중률(강추/주목)" 지표 추가.

- [ ] **Step 2: Update memory**

`C:\Users\mjy76\.claude\projects\C--Users-mjy76-Documents-projectFolder\memory\` 에 선별 표시 트랙 메모(확정 임계값·리프트 실측·파일 위치) 작성 + MEMORY.md 인덱스 한 줄.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs(picks): 선별 표시 트랙 완료 — probe:picks·임계값·선별 적중률 지표 기록

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QkT831bFwUgKH6zVpDwtgJ"
```

---

## 최종 검증

- [ ] `npm run test:run` — 전체 통과 (selectivePicks 순수 + 클라이언트 래퍼 테스트 포함).
- [ ] `npm run build` — 루트 tsc 통과.
- [ ] `npm run client:build` — 클라이언트 tsc + vite build 통과.
- [ ] `npm run probe:picks -- --track` — 강추/주목 연승 적중률이 베이스라인보다 높음(트랙 명분 충족).
- [ ] 시각: `/picks` 뷰·예측 화면 뱃지·통계 섹션 정상.
- [ ] `feat/selective-picks` → main 머지 결정(finishing-a-development-branch).

---

## Self-Review 결과 (작성자 점검)

- **Spec 커버리지:** §2 결정 7개 모두 Task에 매핑(마단위/연승=T1·T5, 목표적중률=T4, 2티어=T1·T2, 뱃지=T5·뷰=T6, probe+상시추적=T3·T7, config단일출처=T2). ✓
- **Placeholder:** Task4의 "확정값"은 의도적 사용자 결정 체크포인트(데이터 기반). 그 외 모든 코드 스텝에 실제 코드 포함. ✓
- **타입 일관성:** `PredRow`(T1) ↔ probe 캐스팅(T3) 동일. `classifyTier`(서버 T1)와 `classifyPickWith`(클라 T2) 동일 시그니처·로직. `PickTier` 양쪽 동일. ✓
- **알려진 확인 필요(⚠️ 표식):** RaceEntries `p` 객체의 `p_top3` 포함 여부(T5), `MEET_NAME` 매핑·라우트(T6), `dateMonthsAgo` 헬퍼 존재(T7) — 각 Task에 명시. 구현 시 해당 파일 확인.
