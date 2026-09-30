# 전개(shape) 피처 주로 상태 보정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 포화·불량 주로의 초반(g3f)·종반(fin600) 시간을 동결 계수로 건조 환산해 전개 피처(`shape_pred_gap`·`shape_p_achieve`)의 par·말별 편차에 반영하고, 사전등록 판정(1단계 예측력 → 2단계 통제 A/B)으로 채택/기각을 가른다.

**Architecture:** 순수 환산 모듈(`trackStateAdjust.ts`)을 새로 만들고, **데이터 경계에서만** 적용한다 — `buildShapeParMap`(par 소스 행)과 `scorePredictor`의 이력 행 매핑. `horseShapeStats`/`raceShapeSignals`는 무변경(숫자만 받으므로 환산된 값을 그대로 먹는다). 스위치는 `shapeStateAdjust`(기본 OFF → 라이브·기존 벤치 비트 동일). 1단계 사전점검이 실패하면 배선(Task 3~4) 없이 종결한다.

**Tech Stack:** TypeScript · vitest · tsx · 로컬 DuckDB 미러(`data/local.duckdb`, 읽기 전용) · `@duckdb/node-api`

**Spec:** `docs/superpowers/specs/2026-09-30-shape-track-state-adjust-design.md` (스펙 §4는 `shapeSignals.ts` 변경을 적었으나, 숫자 경계에서 환산하면 그 파일을 건드릴 필요가 없어 **무변경**으로 확정 — 이 계획이 우선. 또 스펙 §3.1의 "최근 5경주"는 엔진이 이력 전체를 쓰므로 엔진과 같은 창으로 측정한다.)

## Global Constraints

- 모든 출력·커밋 메시지는 한국어, 커밋은 `feat(scope)`/`fix(scope)`/`docs:`/`exp:` 형식 + 변경 의도·다음 단계.
- 계수(2024-01-01 미만 데이터, 표본 32,551행·trim 1.04로 추정, **동결**): c3(초반) = {포화 −0.0141, 불량 −0.0215}, c6(종반) = {포화 −0.0093, 불량 −0.0178}. 양호·다습·건조·미지 상태는 계수 0(Q1=B 확정).
- 환산 식: `건조환산시간 = 시간 / (1 + 계수)`, 역환산 `시간 × (1 + 계수)`.
- 1단계 통과선(확정): 2024·2025·2026 연도별 3슬라이스 중 2개 이상에서 초반 또는 종반 RMSE가 **상대 1% 이상** 감소. 미달이면 Task 3~4 없이 종결(기각).
- 2단계 채택선(확정): Logistic(t3) 연승 Δ(ON−OFF) 평균 ≥ **+0.5%p** 이고 6분기 중 **4분기 이상 Δ>0**. 미달=기각(파라미터 재시도 금지).
- 2단계 시험 창 2025Q1~2026Q2, 학습 2022~ (`--from 20220101 --first-test 2025Q1 --gate-holdout 2024Q4 --include shape_signal`).
- 기본값 OFF. 라이브 승격·v8 재학습은 이 계획 범위 밖.
- DB(Supabase) 호출·KRA 호출 0회 — 로컬 미러만 사용. 작업은 새 브랜치 `feat/shape-state-adjust`에서, push는 사용자 요청 시에만.
- 시험 창 계수 누수 없음: 계수는 2024 이전 추정, par는 as-of 컷오프(`shapeParCutoff`) 유지.

## Review Focus

1. `track_type`이 null·빈 문자열·미지 라벨인 이력 행 → 환산 없이 입력 그대로(비트 동일) (Task 1·3 테스트).
2. `shapeStateAdjust` 기본(OFF)에서 `buildShapeParMap`·이력 매핑 결과가 기존과 완전 동일 (Task 3 테스트).
3. `shapeParMapAsOf` 메모이즈 키가 컷오프만이면 ON/OFF가 캐시를 공유해 A/B가 조용히 무효화된다 → 키에 스위치 포함 (Task 3 테스트).
4. 환산 방향: 젖은 주로는 **빠르므로** 건조 환산은 시간을 **늘린다**(`1+음수계수`로 나눔). 부호를 반대로 구현하면 편향이 두 배가 된다 (Task 1 테스트).
5. 사전점검에서 경주 내 예측 보유 말 < 2두, 또는 par 버킷 없음 → 슬라이스 집계에서 제외, 0 나눗셈 없음 (Task 2 테스트).

---

### Task 0: 브랜치 + 스펙·스파이크 커밋

**Files:**
- Commit: `docs/superpowers/specs/2026-09-30-shape-track-state-adjust-design.md`, `docs/superpowers/plans/2026-09-30-shape-track-state-adjust.md`, `scripts/probe_track_effect.ts`

- [ ] **Step 1: 워킹트리 확인 후 브랜치 생성**

```bash
git status --short
git checkout -b feat/shape-state-adjust
```
Expected: `??` 3개(스펙·계획·probe)만 보이고 다른 수정 없음. 다른 수정이 있으면 멈추고 사용자에게 보고(다른 세션 작업 가능성).

- [ ] **Step 2: 커밋**

```bash
git add docs/superpowers/specs/2026-09-30-shape-track-state-adjust-design.md docs/superpowers/plans/2026-09-30-shape-track-state-adjust.md scripts/probe_track_effect.ts
git commit -m "docs(shape): 주로 상태 보정 스펙·구현계획 + 효과 추정 스파이크(probe_track_effect)

포화·불량만 동결 계수로 환산하는 사전등록 판정(1단계 예측력→2단계 통제 A/B)을 확정.
다음: Task 1 환산 모듈 → Task 2 사전점검(실패 시 종결)."
```

---

### Task 1: 환산 순수 모듈

**Files:**
- Create: `src/engine/trackStateAdjust.ts`
- Test: `src/engine/trackStateAdjust.test.ts`

**Interfaces:**
- Produces:
  - `type ShapePart = 'early' | 'late'`
  - `SHAPE_STATE_COEF: Record<'포화'|'불량', Record<ShapePart, number>>`
  - `stateCoef(state: string | null | undefined, part: ShapePart): number` — 미등록 상태 0
  - `toDryTime(seconds: number, state: string | null | undefined, part: ShapePart): number`
  - `fromDryTime(seconds: number, state: string | null | undefined, part: ShapePart): number`
  - `adjustShapeTimes(g3fAcc: number, rcTime: number, state: string | null | undefined): { g3fAcc: number; rcTime: number }` — 두 계수가 모두 0이면 **입력 그대로 반환**(부동소수 재계산 없음)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/trackStateAdjust.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { stateCoef, toDryTime, fromDryTime, adjustShapeTimes } from './trackStateAdjust.js';

describe('stateCoef', () => {
  it('포화·불량만 계수, 나머지는 0', () => {
    expect(stateCoef('불량', 'early')).toBe(-0.0215);
    expect(stateCoef('불량', 'late')).toBe(-0.0178);
    expect(stateCoef('포화', 'early')).toBe(-0.0141);
    expect(stateCoef('포화', 'late')).toBe(-0.0093);
    for (const s of ['건조', '양호', '다습', '', '미지', null, undefined]) {
      expect(stateCoef(s, 'early')).toBe(0);
      expect(stateCoef(s, 'late')).toBe(0);
    }
  });
});

describe('toDryTime / fromDryTime', () => {
  it('젖은 주로가 빠르므로 건조 환산은 시간을 늘린다 (불량 초반 47초 → 47/0.9785)', () => {
    expect(toDryTime(47, '불량', 'early')).toBeCloseTo(47 / 0.9785, 8);
    expect(toDryTime(47, '불량', 'early')).toBeGreaterThan(47);
  });
  it('미등록 상태는 입력 그대로 (toBe)', () => {
    expect(toDryTime(47, '양호', 'early')).toBe(47);
    expect(toDryTime(47, null, 'late')).toBe(47);
  });
  it('환산 후 역환산하면 원래 값', () => {
    expect(fromDryTime(toDryTime(38.4, '포화', 'late'), '포화', 'late')).toBeCloseTo(38.4, 10);
  });
});

describe('adjustShapeTimes', () => {
  it('불량: g3f는 초반 계수, fin600(=rcTime−g3f)은 종반 계수로 환산, rcTime은 합', () => {
    const a = adjustShapeTimes(48, 86, '불량');
    expect(a.g3fAcc).toBeCloseTo(48 / 0.9785, 8);
    expect(a.rcTime - a.g3fAcc).toBeCloseTo(38 / 0.9822, 8);
  });
  it('건조·null·미지 상태는 입력 값 그대로 (부동소수 재계산 없음)', () => {
    for (const s of ['건조', null, undefined, '미지']) {
      const a = adjustShapeTimes(48.1, 86.3, s);
      expect(a.g3fAcc).toBe(48.1);
      expect(a.rcTime).toBe(86.3);
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/trackStateAdjust.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현**

`src/engine/trackStateAdjust.ts`:
```ts
/**
 * 주로 상태 → 전개 시간 건조 환산 (포화·불량만).
 * 계수: 2024-01-01 미만 데이터의 말·경마장×거리 고정효과 회귀(scripts/probe_track_effect.ts --until 20240101).
 * 동결 — 라이브 표본이 늘어도 임의로 바꾸지 않는다. 스펙 2026-09-30-shape-track-state-adjust-design.md
 */
export type ShapePart = 'early' | 'late';

export const SHAPE_STATE_COEF: Record<'포화' | '불량', Record<ShapePart, number>> = {
  포화: { early: -0.0141, late: -0.0093 },
  불량: { early: -0.0215, late: -0.0178 },
};

export function stateCoef(state: string | null | undefined, part: ShapePart): number {
  if (state === '포화' || state === '불량') return SHAPE_STATE_COEF[state][part];
  return 0;
}

export function toDryTime(seconds: number, state: string | null | undefined, part: ShapePart): number {
  const c = stateCoef(state, part);
  return c === 0 ? seconds : seconds / (1 + c);
}

export function fromDryTime(seconds: number, state: string | null | undefined, part: ShapePart): number {
  const c = stateCoef(state, part);
  return c === 0 ? seconds : seconds * (1 + c);
}

export function adjustShapeTimes(
  g3fAcc: number,
  rcTime: number,
  state: string | null | undefined,
): { g3fAcc: number; rcTime: number } {
  if (stateCoef(state, 'early') === 0 && stateCoef(state, 'late') === 0) return { g3fAcc, rcTime };
  const g3 = toDryTime(g3fAcc, state, 'early');
  const f6 = toDryTime(rcTime - g3fAcc, state, 'late');
  return { g3fAcc: g3, rcTime: g3 + f6 };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/trackStateAdjust.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/engine/trackStateAdjust.ts src/engine/trackStateAdjust.test.ts
git commit -m "feat(shape): 주로 상태 건조 환산 순수 모듈 (포화·불량 동결 계수)

미등록 상태는 입력 그대로 반환해 OFF 경로와 비트 동일 보장. 다음: 1단계 사전점검."
```

---

### Task 2: 1단계 사전점검 (예측력) — 실패 시 종결 게이트

**Files:**
- Create: `src/engine/eval/shapeStatePrecheck.ts`
- Test: `src/engine/eval/shapeStatePrecheck.test.ts`
- Create: `scripts/probe_shape_state_precheck.ts`
- Modify: `package.json` (scripts에 `"probe:shape-state": "tsx scripts/probe_shape_state_precheck.ts",` 를 `probe:shape` 다음 줄에 추가)

**Interfaces:**
- Consumes: `buildShapeParMap`/`ShapeParSourceRow` (`src/engine/shapePar.ts`), `horseShapeStats`/`shapeParKey`/`ShapeHistRace` (`src/engine/features/shapeSignals.ts`), Task 1 `toDryTime`·`fromDryTime`
- Produces:
  - `interface PrecheckRow { date: number; meet: number; rcNo: number; hk: string; dist: number; state: string | null; g3f: number; fin600: number }` (호출자가 raw 유효성 — rc_time>0, g3f>0, fin600 30~60 — 을 이미 거른 행)
  - `interface SliceStat { races: number; horses: number; sseOffE: number; sseOnE: number; sseOffL: number; sseOnL: number }`
  - `precheckRmse(rows: PrecheckRow[], cutoff: number): Map<number, SliceStat>` — 키는 연도(`Math.floor(date/10000)`)
  - `judgePrecheck(stats: Map<number, SliceStat>, minRel?: number, minSlices?: number): { pass: boolean; slices: Array<{ year: number; relEarly: number; relLate: number; ok: boolean }> }` (기본 0.01, 2)

**측정 정의:** 각 시험 경주(date ≥ cutoff)에서 as-of 이력이 2회 이상인 말마다 초반·종반 예측 시간을 만든다. OFF = `par + meanD`(raw). ON = `(par_on + meanD_on) × (1+계수[오늘 상태])`(환산 공간에서 예측 후 오늘 상태로 역환산). 경주 안에서 예측·실측 각각 평균을 빼고(같은 경주 공통 이동은 상쇄) 오차 제곱합을 모은다. 상대 감소 = `1 − sqrt(sseOn/sseOff)`.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/engine/eval/shapeStatePrecheck.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { precheckRmse, judgePrecheck, type PrecheckRow, type SliceStat } from './shapeStatePrecheck.js';

const base = { meet: 1, dist: 1200 };
// par용 채움 40행(2023, 건조 48.0/38.0)
const fillers = (): PrecheckRow[] =>
  Array.from({ length: 40 }, (_, i) => ({ ...base, date: 20230101 + i, rcNo: 1, hk: `f${i}`, state: '건조', g3f: 48, fin600: 38 }));
const hist = (hk: string, state: string, g3f: number, fin600: number): PrecheckRow[] =>
  [20230201, 20230202].map((date) => ({ ...base, date, rcNo: 1, hk, state, g3f, fin600 }));
const testRace = (state: string): PrecheckRow[] =>
  ['A', 'B'].map((hk) => ({ ...base, date: 20240110, rcNo: 1, hk, state, g3f: 48, fin600: 38 }));

describe('precheckRmse', () => {
  it('말 A는 불량에서만, B는 건조에서만 뛴 과거 — 실제 능력이 같으면 환산(ON)이 오차를 없앤다', () => {
    const rows = [
      ...fillers(),
      ...hist('A', '불량', 48 * (1 - 0.0215), 38 * (1 - 0.0178)),
      ...hist('B', '건조', 48, 38),
      ...testRace('건조'),
    ];
    const s = precheckRmse(rows, 20240101).get(2024)!;
    expect(s.races).toBe(1);
    expect(s.horses).toBe(2);
    expect(s.sseOffE).toBeGreaterThan(0.4);   // 2 × 0.516² ≈ 0.53
    expect(s.sseOnE).toBeLessThan(1e-9);
    expect(s.sseOffL).toBeGreaterThan(0.1);
    expect(s.sseOnL).toBeLessThan(1e-9);
  });

  it('경주 내 예측 보유 말이 2두 미만이면 집계 제외', () => {
    const rows = [
      ...fillers(),
      ...hist('A', '불량', 47, 37.4),
      { ...base, date: 20240110, rcNo: 1, hk: 'A', state: '건조', g3f: 48, fin600: 38 },
      { ...base, date: 20240110, rcNo: 1, hk: 'NEW', state: '건조', g3f: 48, fin600: 38 }, // 이력 없음
    ];
    expect(precheckRmse(rows, 20240101).get(2024)).toBeUndefined();
  });

  it('par 버킷이 없으면(표본 < 30) 집계 제외', () => {
    const rows = [...hist('A', '불량', 47, 37.4), ...hist('B', '건조', 48, 38), ...testRace('건조')];
    expect(precheckRmse(rows, 20240101).size).toBe(0);
  });
});

describe('judgePrecheck', () => {
  const st = (offE: number, onE: number): SliceStat => ({ races: 10, horses: 50, sseOffE: offE, sseOnE: onE, sseOffL: 100, sseOnL: 100 });
  it('상대 1% 이상 감소 슬라이스가 2개 이상이면 통과', () => {
    const m = new Map([[2024, st(100, 95)], [2025, st(100, 96)], [2026, st(100, 100)]]);
    const j = judgePrecheck(m);
    expect(j.pass).toBe(true);
    expect(j.slices.filter((x) => x.ok)).toHaveLength(2);
  });
  it('1개뿐이면 미통과', () => {
    const m = new Map([[2024, st(100, 95)], [2025, st(100, 100)], [2026, st(100, 101)]]);
    expect(judgePrecheck(m).pass).toBe(false);
  });
  it('OFF 오차가 0이면 감소율 0으로 처리(0 나눗셈 없음)', () => {
    const j = judgePrecheck(new Map([[2024, st(0, 0)]]));
    expect(j.slices[0]!.relEarly).toBe(0);
    expect(Number.isFinite(j.slices[0]!.relLate)).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/eval/shapeStatePrecheck.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/engine/eval/shapeStatePrecheck.ts`:
```ts
/**
 * 1단계 사전점검 — 주로 상태 환산이 "다음 경주 초반·종반 시간" 예측을 개선하는가.
 * 스펙 2026-09-30-shape-track-state-adjust-design.md §3.1. 순수 함수(입출력 배열/Map).
 */
import { buildShapeParMap, type ShapeParSourceRow } from '../shapePar.js';
import { horseShapeStats, shapeParKey, type ShapeHistRace } from '../features/shapeSignals.js';
import { toDryTime, fromDryTime } from '../trackStateAdjust.js';

export interface PrecheckRow {
  date: number; meet: number; rcNo: number; hk: string; dist: number;
  state: string | null; g3f: number; fin600: number;
}
export interface SliceStat {
  races: number; horses: number;
  sseOffE: number; sseOnE: number; sseOffL: number; sseOnL: number;
}

const demean = (a: number[]): number[] => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return a.map((v) => v - m);
};

export function precheckRmse(rows: PrecheckRow[], cutoff: number): Map<number, SliceStat> {
  const sorted = [...rows].sort((a, b) => a.date - b.date || a.meet - b.meet || a.rcNo - b.rcNo);
  const toSrc = (adj: boolean): ShapeParSourceRow[] => sorted.map((r) => ({
    raceDate: r.date, meet: r.meet, rcDist: r.dist,
    g3fAcc: adj ? toDryTime(r.g3f, r.state, 'early') : r.g3f,
    fin600: adj ? toDryTime(r.fin600, r.state, 'late') : r.fin600,
  }));
  const parOff = buildShapeParMap(toSrc(false), cutoff);
  const parOn = buildShapeParMap(toSrc(true), cutoff);

  const histOff = new Map<string, ShapeHistRace[]>();
  const histOn = new Map<string, ShapeHistRace[]>();
  const push = (m: Map<string, ShapeHistRace[]>, hk: string, h: ShapeHistRace) => {
    const a = m.get(hk); if (a) a.push(h); else m.set(hk, [h]);
  };
  const out = new Map<number, SliceStat>();

  let i = 0;
  while (i < sorted.length) {
    const first = sorted[i]!;
    let j = i;
    while (j < sorted.length && sorted[j]!.date === first.date && sorted[j]!.meet === first.meet && sorted[j]!.rcNo === first.rcNo) j++;
    const race = sorted.slice(i, j);

    if (first.date >= cutoff) {
      const pk = shapeParKey(first.meet, first.dist);
      const pOff = parOff.get(pk), pOn = parOn.get(pk);
      const predOffE: number[] = [], predOnE: number[] = [], predOffL: number[] = [], predOnL: number[] = [];
      const actE: number[] = [], actL: number[] = [];
      if (pOff && pOn) {
        for (const r of race) {
          const sOff = horseShapeStats(histOff.get(r.hk) ?? [], parOff);
          const sOn = horseShapeStats(histOn.get(r.hk) ?? [], parOn);
          if (!sOff || !sOn) continue;
          predOffE.push(pOff.par3 + sOff.meanD3);
          predOffL.push(pOff.par6 + sOff.meanD6);
          predOnE.push(fromDryTime(pOn.par3 + sOn.meanD3, first.state, 'early'));
          predOnL.push(fromDryTime(pOn.par6 + sOn.meanD6, first.state, 'late'));
          actE.push(r.g3f);
          actL.push(r.fin600);
        }
      }
      if (actE.length >= 2) {
        const aE = demean(actE), aL = demean(actL);
        const sse = (p: number[], a: number[]) => demean(p).reduce((s, v, k) => s + (v - a[k]!) ** 2, 0);
        const year = Math.floor(first.date / 10000);
        const st = out.get(year) ?? { races: 0, horses: 0, sseOffE: 0, sseOnE: 0, sseOffL: 0, sseOnL: 0 };
        st.races += 1; st.horses += actE.length;
        st.sseOffE += sse(predOffE, aE); st.sseOnE += sse(predOnE, aE);
        st.sseOffL += sse(predOffL, aL); st.sseOnL += sse(predOnL, aL);
        out.set(year, st);
      }
    }

    for (const r of race) {
      push(histOff, r.hk, { meet: r.meet, rcDist: r.dist, rcTime: r.g3f + r.fin600, g3fAcc: r.g3f });
      const g3 = toDryTime(r.g3f, r.state, 'early');
      const f6 = toDryTime(r.fin600, r.state, 'late');
      push(histOn, r.hk, { meet: r.meet, rcDist: r.dist, rcTime: g3 + f6, g3fAcc: g3 });
    }
    i = j;
  }
  return out;
}

const rel = (off: number, on: number): number => (off > 0 ? 1 - Math.sqrt(on / off) : 0);

export function judgePrecheck(
  stats: Map<number, SliceStat>, minRel = 0.01, minSlices = 2,
): { pass: boolean; slices: Array<{ year: number; relEarly: number; relLate: number; ok: boolean }> } {
  const slices = [...stats.entries()].sort((a, b) => a[0] - b[0]).map(([year, s]) => {
    const relEarly = rel(s.sseOffE, s.sseOnE);
    const relLate = rel(s.sseOffL, s.sseOnL);
    return { year, relEarly, relLate, ok: relEarly >= minRel || relLate >= minRel };
  });
  return { pass: slices.filter((x) => x.ok).length >= minSlices, slices };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/eval/shapeStatePrecheck.test.ts`
Expected: PASS. (첫 케이스: OFF 초반 sse≈0.53, ON≈0. par 중앙값이 48이 아니면 fillers 수를 늘려 조정.)

- [ ] **Step 5: 스크립트 작성**

`scripts/probe_shape_state_precheck.ts`:
```ts
/**
 * 1단계 사전점검 실행 — 로컬 DuckDB 미러(읽기 전용)만 사용, KRA·Supabase 호출 0.
 * 실행: npm run probe:shape-state
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { precheckRmse, judgePrecheck, type PrecheckRow } from '../src/engine/eval/shapeStatePrecheck.js';

const CUTOFF = 20240101; // 계수 추정 종료일(=par as-of 컷오프) — 이후만 시험

async function main(): Promise<void> {
  const inst = await DuckDBInstance.create('data/local.duckdb', { access_mode: 'READ_ONLY' });
  const c = await inst.connect();
  const res = await c.runAndReadAll(`
    select race_date d, meet, rc_no, hr_name hk, rc_dist, track_type st, rc_time,
           se_g3f_acc_time s3, bu_g3f_acc_time b3
    from race_entries
    where ord is not null and rc_time > 0 and rc_dist is not null`);
  const rows: PrecheckRow[] = [];
  for (const r of res.getRowObjectsJson() as any[]) {
    const meet = Number(r.meet);
    const g3f = meet === 1 ? Number(r.s3) : Number(r.b3);
    const fin600 = Number(r.rc_time) - g3f;
    if (!(g3f > 0) || fin600 < 30 || fin600 > 60) continue;
    rows.push({ date: Number(r.d), meet, rcNo: Number(r.rc_no), hk: String(r.hk), dist: Number(r.rc_dist), state: r.st ?? null, g3f, fin600 });
  }
  console.log(`유효 행 ${rows.length}`);
  const stats = precheckRmse(rows, CUTOFF);
  const j = judgePrecheck(stats);
  for (const s of j.slices) {
    const st = stats.get(s.year)!;
    console.log(`${s.year}: 경주 ${st.races}·말 ${st.horses} | 초반 RMSE OFF ${Math.sqrt(st.sseOffE / st.horses).toFixed(4)} → ON ${Math.sqrt(st.sseOnE / st.horses).toFixed(4)} (${(s.relEarly * 100).toFixed(2)}%) | 종반 OFF ${Math.sqrt(st.sseOffL / st.horses).toFixed(4)} → ON ${Math.sqrt(st.sseOnL / st.horses).toFixed(4)} (${(s.relLate * 100).toFixed(2)}%) | ${s.ok ? '≥1% 통과' : '미달'}`);
  }
  console.log(j.pass ? '\n판정: 통과 (슬라이스 ≥2) → Task 3 진행' : '\n판정: 미통과 → 기각·종결 (Task 3~4 생략)');
}
main().catch((e) => { console.error(e); process.exit(1); });
```
`package.json`의 scripts에 `"probe:shape-state": "tsx scripts/probe_shape_state_precheck.ts",` 추가.

- [ ] **Step 6: 타입체크 + 실행**

Run: `npm run build && npm run probe:shape-state`
Expected: tsc 무에러, 연도별 표(2024·2025·2026) + 판정 문구(10줄 이내). 결과를 그대로 기록.

- [ ] **Step 7: 커밋 + 게이트 판정**

```bash
git add src/engine/eval/shapeStatePrecheck.ts src/engine/eval/shapeStatePrecheck.test.ts scripts/probe_shape_state_precheck.ts package.json
git commit -m "exp(shape): 주로 상태 보정 1단계 사전점검 (예측 RMSE OFF vs ON)

결과: <연도별 상대감소·통과 여부를 한 줄로>. 다음: 통과 시 Task 3 배선, 미통과 시 기각 기록."
```
**게이트:** 판정이 "미통과"면 → 스펙 §8에 결과 기록, `docs/status/04-signals.md`·`docs/history/modeling-history.md`에 기각 1줄, 메모리 `project_track_condition_effect.md`에 결과 추가 후 **여기서 종료**(Task 3~4 하지 않음). "통과"면 Task 3으로.

---

### Task 3: 스위치 배선 (기본 OFF)

**Files:**
- Modify: `src/engine/shapePar.ts`
- Modify: `src/engine/shapePar.test.ts`
- Modify: `src/engine/scorePredictor.ts` (76행·366행 opts 타입, 263~275행 매핑)
- Modify: `src/engine/eval/collect.ts` (17행 opts 타입)
- Modify: `scripts/benchmark_all.ts` (플래그 + collectRaces 호출 + 헤더 출력)

**Interfaces:**
- Consumes: Task 1 `toDryTime`·`adjustShapeTimes`
- Produces:
  - `ShapeParSourceRow.trackType?: string | null`
  - `buildShapeParMap(rows, cutoffDate, opts?: { stateAdjust?: boolean }): ShapeParMap`
  - `shapeParCacheKey(cutoffDate: number, stateAdjust: boolean): string`
  - `shapeParMapAsOf(sb, cutoffDate, stateAdjust = false)`
  - `opts.shapeStateAdjust?: boolean` (predictRace·gatherRaceInputs·collectRaces)
  - CLI `--shape-state-adjust`

- [ ] **Step 1: 실패하는 테스트 추가**

`src/engine/shapePar.test.ts`의 import를 `import { buildShapeParMap, shapeParCacheKey, SHAPE_PAR_MIN_ROWS, type ShapeParSourceRow } from './shapePar.js';`로 바꾸고 파일 끝에 추가:
```ts
describe('주로 상태 환산 (stateAdjust)', () => {
  it('ON: 불량 행 par를 건조 환산(나누기 1+계수)으로 산출', () => {
    const rows = mkRows(50, { trackType: '불량' });
    const off = buildShapeParMap(rows, 20991231).get(shapeParKey(1, 1200))!;
    const on = buildShapeParMap(rows, 20991231, { stateAdjust: true }).get(shapeParKey(1, 1200))!;
    expect(on.par3).toBeCloseTo(off.par3 / (1 - 0.0215), 6);
    expect(on.par6).toBeCloseTo(off.par6 / (1 - 0.0178), 6);
  });
  it('OFF(기본): trackType이 있어도 기존 결과와 동일', () => {
    const withState = buildShapeParMap(mkRows(50, { trackType: '불량' }), 20991231).get(shapeParKey(1, 1200))!;
    const plain = buildShapeParMap(mkRows(50), 20991231).get(shapeParKey(1, 1200))!;
    expect(withState).toEqual(plain);
  });
  it('ON이라도 trackType 없음·건조 행은 불변', () => {
    const plain = buildShapeParMap(mkRows(50), 20991231).get(shapeParKey(1, 1200))!;
    const on = buildShapeParMap(mkRows(50, { trackType: '건조' }), 20991231, { stateAdjust: true }).get(shapeParKey(1, 1200))!;
    expect(on).toEqual(plain);
    expect(buildShapeParMap(mkRows(50), 20991231, { stateAdjust: true }).get(shapeParKey(1, 1200))).toEqual(plain);
  });
});

describe('shapeParCacheKey', () => {
  it('같은 컷오프라도 ON/OFF 키가 다르다 (캐시 공유 방지)', () => {
    expect(shapeParCacheKey(20250101, true)).not.toBe(shapeParCacheKey(20250101, false));
    expect(shapeParCacheKey(20250101, false)).toBe(shapeParCacheKey(20250101, false));
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/engine/shapePar.test.ts`
Expected: FAIL (`shapeParCacheKey` 없음 / 옵션 무시)

- [ ] **Step 3: `shapePar.ts` 구현**

1. import 추가: `import { toDryTime } from './trackStateAdjust.js';`
2. `ShapeParSourceRow`에 `trackType?: string | null;` 추가.
3. `buildShapeParMap` 시그니처와 값 수집부 교체:
```ts
export function buildShapeParMap(
  rows: ShapeParSourceRow[],
  cutoffDate: number,
  opts?: { stateAdjust?: boolean },
): ShapeParMap {
  const adj = opts?.stateAdjust ?? false;
  const buckets = new Map<string, { g3: number[]; f6: number[] }>();
  for (const r of rows) {
    if (r.raceDate >= cutoffDate) continue;
    const k = shapeParKey(r.meet, r.rcDist);
    const g3 = adj ? toDryTime(r.g3fAcc, r.trackType, 'early') : r.g3fAcc;
    const f6 = adj ? toDryTime(r.fin600, r.trackType, 'late') : r.fin600;
    const b = buckets.get(k);
    if (b) { b.g3.push(g3); b.f6.push(f6); }
    else buckets.set(k, { g3: [g3], f6: [f6] });
  }
  // (이하 map 구성 부분은 기존 그대로)
```
4. 캐시 키·로더·`shapeParMapAsOf` 수정:
```ts
export function shapeParCacheKey(cutoffDate: number, stateAdjust: boolean): string {
  return `${cutoffDate}|${stateAdjust ? 1 : 0}`;
}
const _mapCache = new Map<string, ShapeParMap>();
```
`loadShapeParSource`의 select를 `'race_date, meet, rc_dist, rc_time, se_g3f_acc_time, bu_g3f_acc_time, track_type'`로, 캐스트 타입에 `track_type: string | null;` 추가, `rows.push({ ..., fin600, trackType: r.track_type })`로 변경.
```ts
export async function shapeParMapAsOf(sb: ReadClient, cutoffDate: number, stateAdjust = false): Promise<ShapeParMap> {
  const key = shapeParCacheKey(cutoffDate, stateAdjust);
  const hit = _mapCache.get(key);
  if (hit) return hit;
  const map = buildShapeParMap(await loadShapeParSource(sb), cutoffDate, { stateAdjust });
  _mapCache.set(key, map);
  return map;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/engine/shapePar.test.ts`
Expected: PASS (기존 3개 + 신규 4개)

- [ ] **Step 5: `scorePredictor.ts` 수정**

1. import 추가: `import { adjustShapeTimes } from './trackStateAdjust.js';`
2. 76행·366행 opts 타입을 `{ shapeParCutoff?: number; forcePrecompetition?: boolean; shapeStateAdjust?: boolean }`로.
3. 263~275행 교체:
```ts
  const shapeStateAdjust = opts?.shapeStateAdjust ?? false;
  const shapePar = await shapeParMapAsOf(sb, opts?.shapeParCutoff ?? rcDate, shapeStateAdjust);
  const shapeStatsList = entryList.map((e) =>
    horseShapeStats(
      (histByHorse.get(e.hr_name) ?? []).map((r) => {
        const g3fAcc = r.meet === 1 ? r.se_g3f_acc_time : r.bu_g3f_acc_time;
        if (shapeStateAdjust && g3fAcc != null && r.rc_time != null) {
          const a = adjustShapeTimes(g3fAcc, r.rc_time, r.track_type);
          return { meet: r.meet, rcDist: r.rc_dist, rcTime: a.rcTime, g3fAcc: a.g3fAcc };
        }
        return { meet: r.meet, rcDist: r.rc_dist, rcTime: r.rc_time, g3fAcc };
      }),
      shapePar,
    )
  );
```
`predictRace`가 `gatherRaceInputs`에 `opts`를 그대로 넘기는지(368행) 확인 — 이미 그대로 전달.

- [ ] **Step 6: `collect.ts`·`benchmark_all.ts` 수정**

`collect.ts` 17행: `opts?: { shapeParCutoff?: number; shapeStateAdjust?: boolean }`.
`benchmark_all.ts`: `const shapeStateAdjust = args.includes('--shape-state-adjust');`를 `noGate` 근처에 추가, 파일 상단 사용법 주석에 `[--shape-state-adjust]` 추가, 64행의 `collectRaces` 호출을 다음으로 교체(첫 줄이 호출 바로 위):
```ts
  if (shapeStateAdjust) console.log('  ⚡ 전개 피처 주로 상태 보정 ON (포화·불량 건조 환산)');
  const races = await collectRaces(db, dataFrom, dataTo, { shapeParCutoff: SHAPE_PAR_CUTOFF, shapeStateAdjust });
```

- [ ] **Step 7: 타입체크 + 전체 테스트**

Run: `npm run build && npm run test:run`
Expected: tsc 무에러, 전체 통과(기존 테스트 모두 유지).

- [ ] **Step 8: 커밋**

```bash
git add src/engine/shapePar.ts src/engine/shapePar.test.ts src/engine/scorePredictor.ts src/engine/eval/collect.ts scripts/benchmark_all.ts
git commit -m "feat(shape): 전개 피처 주로 상태 보정 스위치 (기본 OFF, --shape-state-adjust)

par 소스와 이력 행을 데이터 경계에서 건조 환산. par 캐시 키에 스위치 포함해 A/B 오염 방지.
OFF 경로는 기존과 동일. 다음: 2단계 통제 A/B 벤치마크."
```

---

### Task 4: 2단계 통제 A/B + 결과 기록

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-shape-track-state-adjust-design.md` (§8 결과)
- Modify: `docs/status/04-signals.md`, `docs/history/modeling-history.md` (한 줄씩)
- Modify: 메모리 `project_track_condition_effect.md` (판정 결과 추가)

- [ ] **Step 1: OFF 실행 (로컬 미러만, 큰 출력은 파일로)**

```bash
S="C:/Users/mjy76/AppData/Local/Temp/claude/C--Users-mjy76-Documents-projectFolder/9f531b4d-06bd-4271-a9bd-167951aafdf9/scratchpad"
npm run benchmark -- --from 20220101 --first-test 2025Q1 --gate-holdout 2024Q4 --include shape_signal > "$S/ab_off.txt" 2>&1
```
`run_in_background`로 실행(수 분~수십 분). 완료 알림 후 진행.

- [ ] **Step 2: ON 실행**

```bash
npm run benchmark -- --from 20220101 --first-test 2025Q1 --gate-holdout 2024Q4 --include shape_signal --shape-state-adjust > "$S/ab_on.txt" 2>&1
```
Expected: 로그에 `⚡ 전개 피처 주로 상태 보정 ON` 줄, 경주 수는 OFF와 동일.

- [ ] **Step 3: 추출·판정**

두 파일에서 연승(3착내) 롤링 표의 `Logistic(t3)` 행(분기별 + overall)을 `grep -n "Logistic(t3)"`로 뽑아 분기별 Δ(ON−OFF)와 평균 Δ를 표로 만든다. 단승 표·시장 진단은 참고만. 판정: 평균 Δ ≥ +0.5%p **그리고** 6분기 중 ≥4분기 Δ>0 → 채택, 아니면 기각. 두 실행의 경주 수가 같은지도 확인.

- [ ] **Step 4: 문서 기록**

스펙 §8에 분기별 Δ 표 + 판정 + 한계 한 줄. `docs/status/04-signals.md`에 트랙 결과 1줄, `docs/history/modeling-history.md`에 항목 1개(채택이든 기각이든). 채택이면 `docs/feature_catalog.md`에 "옵션 `shapeStateAdjust`(기본 OFF, 채택됨·승격 미실시)"를 명시하고 승격은 별도 결정(v8 재학습 후보)으로 남긴다. 기각이면 메모리 파일에 "다시 제안 금지" 문구를 추가한다.

- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/specs/2026-09-30-shape-track-state-adjust-design.md docs/status/04-signals.md docs/history/modeling-history.md
git commit -m "docs(shape): 주로 상태 보정 통제 A/B 판정 <채택|기각> — 연승 Δ <값>%p

다음: <채택 시 v8 재학습·승격 논의 / 기각 시 종결>."
```
push·머지는 사용자 요청 시에만.
