# /picks 페이스 예측 vs 실측 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/picks`의 지난 경주 페이스 배지에 실측 페이스 + 예측 대비 3단계 일치(정확/근접/빗나감)를 표시한다.

**Architecture:** 서버·DB 변경 없이 F-001/F-004 선례를 따른다 — par 15버킷을 정적 JSON으로 배포하고(생성 스크립트), 클라이언트가 `race_sectional_stats.avg_s1f`를 조회해 실측 페이스를 계산한다. 실측 라벨 규칙(±0.11초)과 par 산식(중앙값)은 서버 SSOT를 미러한다.

**Tech Stack:** React + TypeScript + react-router-dom + @tanstack/react-query + vitest. 생성 스크립트는 tsx + 로컬 DuckDB 미러(`getLocalDb`).

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-21-pace-actual-ui-design.md` — 모든 태스크는 이 문서와 일치.
- 서버·DB·마이그레이션·모델 변경 **없음**. 클라이언트 + 생성 스크립트만.
- 실측 라벨 임계값 SSOT = `src/engine/features/paceForm.ts` `PACE_HOT_DELTA=-0.11`·`PACE_SLOW_DELTA=0.11`. par 산식 SSOT = `src/engine/pacePar.ts` `buildPaceParMap`(버킷별 avg_s1f **중앙값**, 최소 30경주 `PACE_PAR_MIN_ROWS`)·`paceParKey(meet,dist)=`${meet}|${dist}``.
- 예측 라벨은 기존 `computeRacePace`(F-001 현재 성향 스냅샷) 그대로 재사용 — as-of 재계산 안 함.
- 실측/일치 표시는 **지난 경주에만**(`showResult=true` 경로). 다가오는 경주·출마정보 배지는 기존과 100% 동일(회귀 금지).
- 3단계 순서: `HOT<NORMAL<SLOW`. ordinal 차이 0=정확 / 1=근접 / 2=정반대.
- 커밋 메시지: 한국어 + scope 접두사(`feat(pace):` 등).

---

### Task 1: par 정적 JSON 생성 스크립트 + JSON 산출

**Files:**
- Create: `scripts/export_pace_par.ts`
- Modify: `package.json` (scripts에 `export:pace-par` 추가)
- Create(생성물): `client/src/config/pace_par.json`

**Interfaces:**
- Produces: `client/src/config/pace_par.json` — `{ "<meet>|<rcDist>": <par_seconds>, ... }` (예: `"1|1200": 13.82`). Task 2의 `labelActualPace`가 이 파일을 정적 import.
- 생성 명령: `npm run export:pace-par`.

이 태스크는 일회성 생성 스크립트라 유닛 테스트 없음(F-004 export 선례). 검증 = 실행 + JSON 스팟체크.

- [ ] **Step 1: 생성 스크립트 작성**

`scripts/export_pace_par.ts`:

```ts
/**
 * 초반 페이스 par 정적 JSON 생성 — client가 실측 페이스 라벨(labelActualPace) 계산에 사용.
 * 로컬 미러 읽기(egress 0). buildPaceParMap(버킷별 avg_s1f 중앙값·최소 30경주) all-time.
 * 재생성: npm run export:pace-par (새 경주 누적 시 가끔). SSOT: src/engine/pacePar.ts.
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { getLocalDb } from '../src/db/localDb.js';
import { buildPaceParMap, type PaceParSourceRow } from '../src/engine/pacePar.js';

const CUTOFF = 99991231; // all-time (측정 기준선)

async function main() {
  const sb = await getLocalDb();
  const rows: PaceParSourceRow[] = [];
  const PAGE = 5000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_sectional_stats')
      .select('race_date, meet, rc_no, rc_dist, avg_s1f')
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ race_date: number; meet: number; rc_dist: number | null; avg_s1f: number | null }>) {
      if (r.rc_dist == null || r.avg_s1f == null || !(Number(r.avg_s1f) > 0)) continue;
      rows.push({ raceDate: r.race_date, meet: r.meet, rcDist: r.rc_dist, avgS1f: Number(r.avg_s1f) });
    }
    if (data.length < PAGE) break;
  }
  const par = buildPaceParMap(rows, CUTOFF);
  const obj: Record<string, number> = {};
  for (const k of [...par.keys()].sort()) obj[k] = Math.round(par.get(k)! * 100) / 100;
  writeFileSync('client/src/config/pace_par.json', JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log(`✅ pace_par.json 생성 — ${Object.keys(obj).length}버킷`);
  for (const [k, v] of Object.entries(obj)) console.log(`  ${k}: ${v}초`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```

- [ ] **Step 2: package.json에 스크립트 추가**

`package.json`의 `"probe:pace-actual": ...` 줄 다음에 추가:

```json
    "export:pace-par": "tsx scripts/export_pace_par.ts",
```

- [ ] **Step 3: 스크립트 실행 → JSON 생성**

Run: `npm run export:pace-par`
Expected: `✅ pace_par.json 생성 — 15버킷` (대략) + 버킷 목록 출력. 각 값은 대략 13~15초 범위.

- [ ] **Step 4: 생성된 JSON 스팟체크**

Run: `cat client/src/config/pace_par.json`
Expected: `{ "1|1000": 13.xx, "1|1200": 13.xx, ... }` 형태. 키는 `meet|dist` 문자열, 값은 소수 2자리, 버킷 10~20개 내외, 값 13~15초대. 이상치(0·음수·30초+) 없어야 함.

- [ ] **Step 5: 커밋**

```bash
git add scripts/export_pace_par.ts package.json client/src/config/pace_par.json
git commit -m "$(cat <<'EOF'
feat(pace): par 정적 JSON 생성 스크립트 + pace_par.json

실측 페이스 라벨 계산용 par(meet×거리 중앙값) 15버킷을 client에 정적 배포.
buildPaceParMap all-time, 로컬 미러 읽기(egress 0). 재생성: npm run export:pace-par.
EOF
)"
```

---

### Task 2: 클라이언트 실측·일치 유틸 + 테스트 (`client/src/lib/pace.ts`)

**Files:**
- Modify: `client/src/lib/pace.ts`
- Test: `client/src/lib/pace.test.ts`

**Interfaces:**
- Consumes: `client/src/config/pace_par.json` (Task 1), 기존 `PaceType` 타입.
- Produces (Task 3·4가 소비):
  - `labelActualPace(avgS1f: number | null, meet: number, dist: number | null): PaceType | null`
  - `paceMatchLevel(predicted: PaceType, actual: PaceType): PaceMatch` (`type PaceMatch = 'exact' | 'adjacent' | 'opposite'`)
  - `PACE_MATCH_UI: Record<PaceMatch, { symbol: string; label: string; className: string }>`

- [ ] **Step 1: 실패하는 테스트 작성**

`client/src/lib/pace.test.ts`의 import 줄을 교체하고, 파일 끝에 describe 블록 추가.

import 줄(1~2행) 교체:

```ts
import { describe, it, expect } from 'vitest';
import { computeRacePace, PACE_UI, labelActualPace, paceMatchLevel, PACE_MATCH_UI } from './pace';
import paceParJson from '../config/pace_par.json';
```

파일 끝에 추가:

```ts
describe('labelActualPace — avg_s1f vs par → 실측 페이스 (서버 labelPastRacePace 미러)', () => {
  const [someKey, somePar] = Object.entries(paceParJson as Record<string, number>)[0]!;
  const [meet, dist] = someKey.split('|').map(Number) as [number, number];

  it('par 정확히 = NORMAL', () => {
    expect(labelActualPace(somePar, meet, dist)).toBe('NORMAL');
  });
  it('par보다 충분히 빠름(−0.15) = HOT', () => {
    expect(labelActualPace(somePar - 0.15, meet, dist)).toBe('HOT');
  });
  it('par보다 충분히 느림(+0.15) = SLOW', () => {
    expect(labelActualPace(somePar + 0.15, meet, dist)).toBe('SLOW');
  });
  it('경계 안쪽(±0.05) = NORMAL', () => {
    expect(labelActualPace(somePar - 0.05, meet, dist)).toBe('NORMAL');
    expect(labelActualPace(somePar + 0.05, meet, dist)).toBe('NORMAL');
  });
  it('par 없는 버킷 → null', () => {
    expect(labelActualPace(14, 9, 99999)).toBeNull();
  });
  it('avgS1f null/0 → null', () => {
    expect(labelActualPace(null, meet, dist)).toBeNull();
    expect(labelActualPace(0, meet, dist)).toBeNull();
  });
});

describe('paceMatchLevel — HOT<NORMAL<SLOW ordinal 차이', () => {
  it('같으면 exact', () => {
    expect(paceMatchLevel('HOT', 'HOT')).toBe('exact');
    expect(paceMatchLevel('NORMAL', 'NORMAL')).toBe('exact');
    expect(paceMatchLevel('SLOW', 'SLOW')).toBe('exact');
  });
  it('한 칸 차이 adjacent', () => {
    expect(paceMatchLevel('HOT', 'NORMAL')).toBe('adjacent');
    expect(paceMatchLevel('NORMAL', 'HOT')).toBe('adjacent');
    expect(paceMatchLevel('NORMAL', 'SLOW')).toBe('adjacent');
    expect(paceMatchLevel('SLOW', 'NORMAL')).toBe('adjacent');
  });
  it('정반대 opposite', () => {
    expect(paceMatchLevel('HOT', 'SLOW')).toBe('opposite');
    expect(paceMatchLevel('SLOW', 'HOT')).toBe('opposite');
  });
});

describe('PACE_MATCH_UI', () => {
  it('세 단계 모두 symbol·label·className 보유', () => {
    for (const m of ['exact', 'adjacent', 'opposite'] as const) {
      expect(PACE_MATCH_UI[m].symbol).toBeTruthy();
      expect(PACE_MATCH_UI[m].label).toBeTruthy();
      expect(PACE_MATCH_UI[m].className).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test:run -- client/src/lib/pace.test.ts`
Expected: FAIL — `labelActualPace is not a function` 등 (import 에러).

- [ ] **Step 3: `pace.ts`에 유틸 구현**

`client/src/lib/pace.ts` 끝(PACE_UI 정의 다음)에 추가. 파일 상단 import 구역에 JSON import 추가:

파일 최상단(기존 `import type { RunningStyle }` 줄 위 또는 아래)에:

```ts
import paceParJson from '../config/pace_par.json';
```

파일 끝에 추가:

```ts
const PACE_PAR = paceParJson as Record<string, number>;

/**
 * 실측 페이스 — 그 경주 avg_s1f가 par(meet×거리 중앙값)보다 빨랐/느렸나.
 * 서버 SSOT: src/engine/features/paceForm.ts labelPastRacePace (±0.11초). par: src/engine/pacePar.ts.
 * par JSON은 npm run export:pace-par로 생성.
 */
export function labelActualPace(
  avgS1f: number | null,
  meet: number,
  dist: number | null
): PaceType | null {
  if (avgS1f == null || !(avgS1f > 0) || dist == null) return null;
  const par = PACE_PAR[`${meet}|${dist}`];
  if (par == null) return null;
  const d = avgS1f - par;
  if (d <= -0.11) return 'HOT';
  if (d >= 0.11) return 'SLOW';
  return 'NORMAL';
}

export type PaceMatch = 'exact' | 'adjacent' | 'opposite';

const PACE_ORD: Record<PaceType, number> = { HOT: 0, NORMAL: 1, SLOW: 2 };

/** 예측 vs 실측 3단계 일치도 (HOT<NORMAL<SLOW ordinal 차이). */
export function paceMatchLevel(predicted: PaceType, actual: PaceType): PaceMatch {
  const diff = Math.abs(PACE_ORD[predicted] - PACE_ORD[actual]);
  return diff === 0 ? 'exact' : diff === 1 ? 'adjacent' : 'opposite';
}

export const PACE_MATCH_UI: Record<PaceMatch, { symbol: string; label: string; className: string }> = {
  exact: { symbol: '✅', label: '예측 적중', className: 'text-emerald-300' },
  adjacent: { symbol: '≈', label: '근접', className: 'text-amber-300' },
  opposite: { symbol: '❌', label: '빗나감', className: 'text-red-400' },
};
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test:run -- client/src/lib/pace.test.ts`
Expected: PASS — 기존 computeRacePace/PACE_UI 블록 + 신규 3개 describe 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/pace.ts client/src/lib/pace.test.ts
git commit -m "$(cat <<'EOF'
feat(pace): 실측 페이스·일치도 유틸 — labelActualPace·paceMatchLevel

avg_s1f vs par 정적 JSON으로 실측 HOT/NORMAL/SLOW 판정(서버 ±0.11 미러) +
예측 대비 3단계(정확/근접/정반대). PACE_MATCH_UI 표시 상수. 유닛 테스트 포함.
EOF
)"
```

---

### Task 3: RacePaceBadge 실측 줄 확장 (`client/src/components/RacePaceBadge.tsx`)

**Files:**
- Modify: `client/src/components/RacePaceBadge.tsx`

**Interfaces:**
- Consumes: `labelActualPace`, `paceMatchLevel`, `PACE_MATCH_UI`, 기존 `computeRacePace`·`PACE_UI` (Task 2).
- Produces: `RacePaceBadge`에 옵셔널 prop `actual?: { avgS1f: number | null; meet: number; dist: number | null }`. Task 4의 `RaceCard`가 지난 경주에 전달.

UI 컴포넌트라 유닛 테스트 없음(기존 관례). 검증 = 타입체크 + 구조 확인(다가오는 경주 렌더 불변, 실측 줄은 actual+par 있을 때만).

- [ ] **Step 1: 파일 전체 교체**

`client/src/components/RacePaceBadge.tsx`를 아래로 교체:

```tsx
import { computeRacePace, PACE_UI, labelActualPace, paceMatchLevel, PACE_MATCH_UI } from '../lib/pace';
import type { RunningStyle } from '../lib/runningStyle';

/**
 * 경주 페이스 예상 배지 (F-001): 예측 배지 + 근거 + 실측 해석 1줄.
 * actual(지난 경주)이 주어지면 실측 페이스 + 예측 대비 3단계 일치를 둘째 줄에 추가.
 * 판정 불가(성향 데이터 절반 미만)면 회색 안내. 스타일 선례: PickBadge.tsx.
 */
export function RacePaceBadge({
  styles,
  actual,
}: {
  styles: RunningStyle[];
  actual?: { avgS1f: number | null; meet: number; dist: number | null };
}) {
  const pace = computeRacePace(styles);
  if (pace === null) {
    return (
      <div className="text-xs text-[var(--color-text-disabled)]">
        페이스 판정 불가 — 성향 데이터 부족
      </div>
    );
  }
  const ui = PACE_UI[pace.paceType];
  const actualType = actual ? labelActualPace(actual.avgS1f, actual.meet, actual.dist) : null;
  const match = actualType ? paceMatchLevel(pace.paceType, actualType) : null;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold leading-none ${ui.className}`}>
          {ui.emoji} {ui.label}
        </span>
        <span className="text-xs text-[var(--color-text-secondary)]">
          선두권 {pace.frontCount}마리 <span className="text-[var(--color-text-disabled)]">({pace.knownCount}/{pace.total}두 분석)</span>
        </span>
      </div>
      <p className="text-[11px] text-[var(--color-text-disabled)]">{ui.insight}</p>
      {actualType && match && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[var(--color-text-secondary)]">실제</span>
          <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-semibold leading-none ${PACE_UI[actualType].className}`}>
            {PACE_UI[actualType].emoji} {PACE_UI[actualType].label}
          </span>
          <span className={`text-[11px] font-semibold ${PACE_MATCH_UI[match].className}`}>
            {PACE_MATCH_UI[match].symbol} {PACE_MATCH_UI[match].label}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add client/src/components/RacePaceBadge.tsx
git commit -m "$(cat <<'EOF'
feat(pace): RacePaceBadge에 실측 페이스 + 3단계 일치 줄 추가

actual prop(지난 경주)이 주어지면 실측 HOT/NORMAL/SLOW + 예측 대비
정확/근접/정반대를 둘째 줄에 표시. 미전달 시 기존 렌더 100% 유지.
EOF
)"
```

---

### Task 4: 데이터 훅 + TodayPicks 배선 (`queries.ts` + `TodayPicks.tsx`)

**Files:**
- Modify: `client/src/lib/queries.ts` (신규 훅)
- Modify: `client/src/pages/TodayPicks.tsx` (훅 호출 + 지난 경주 카드에 actual 전달)

**Interfaces:**
- Consumes: `RacePaceBadge`의 `actual` prop (Task 3), 기존 `useRaceEntryNamesByRange` 패턴.
- Produces: 최종 소비 지점(페이지). 신규 훅 `useRaceSectionalStatsByRange(from, to)`.

UI·네트워크라 유닛 테스트 없음. 검증 = 타입체크 + 개발서버 수동 확인.

- [ ] **Step 1: `queries.ts`에 범위 훅 추가**

`useRaceEntryNamesByRange` 함수 정의 바로 다음(현재 642행 `}` 다음)에 추가:

```ts
/**
 * 이번 주(월~일) 경주별 초반 페이스 실측 — 지난 경주 배지의 실측 표시용.
 * race_sectional_stats에서 avg_s1f·rc_dist만. 지난 경주 없으면 from/to=null로 스킵.
 */
export function useRaceSectionalStatsByRange(from: number | null, to: number | null) {
  return useQuery({
    queryKey: ['race-sectional-range', from, to],
    queryFn: async (): Promise<Array<{ race_date: number; meet: number; rc_no: number; rc_dist: number | null; avg_s1f: number | null }>> => {
      const rows: Array<{ race_date: number; meet: number; rc_no: number; rc_dist: number | null; avg_s1f: number | null }> = [];
      const PAGE = 1000;
      for (let off = 0; ; off += PAGE) {
        const { data, error } = await supabase
          .from('race_sectional_stats')
          .select('race_date, meet, rc_no, rc_dist, avg_s1f')
          .gte('race_date', from!)
          .lte('race_date', to!)
          .order('race_date')
          .order('meet')
          .order('rc_no')
          .range(off, off + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < PAGE) break;
      }
      return rows;
    },
    enabled: from != null && to != null,
    staleTime: 10 * 60 * 1000,
  });
}
```

- [ ] **Step 2: `TodayPicks.tsx` — import + RaceCard prop 추가**

`import { useWeeklyPicks, useRaceEntryNamesByRange, useHorseSectionalAbilityByNames } from '../lib/queries';` 줄을 교체:

```tsx
import { useWeeklyPicks, useRaceEntryNamesByRange, useHorseSectionalAbilityByNames, useRaceSectionalStatsByRange } from '../lib/queries';
```

`RaceCard` 컴포넌트 시그니처에 `actual` prop 추가. 현재:

```tsx
function RaceCard({
  raceKey, horses, styles, showResult,
}: {
  raceKey: string;
  horses: Prediction[];
  styles: RunningStyle[] | undefined;
  showResult: boolean;
}) {
```

를:

```tsx
function RaceCard({
  raceKey, horses, styles, showResult, actual,
}: {
  raceKey: string;
  horses: Prediction[];
  styles: RunningStyle[] | undefined;
  showResult: boolean;
  actual?: { avgS1f: number | null; meet: number; dist: number | null };
}) {
```

그리고 RaceCard 내부의 페이스 배지 렌더:

```tsx
      {styles && (
        <div className="mt-1.5">
          <RacePaceBadge styles={styles} />
        </div>
      )}
```

를:

```tsx
      {styles && (
        <div className="mt-1.5">
          <RacePaceBadge styles={styles} actual={actual} />
        </div>
      )}
```

- [ ] **Step 3: `TodayPicks.tsx` — 실측 훅 호출 + Map 구성**

`TodayPicks` 컴포넌트에서 `upcomingByDate/pastRaces/raceCount` useMemo(현재 117~145행) **다음**, `if (isLoading) return ...`(현재 147행) **이전**에 추가:

```tsx
  // 지난 경주 실측 페이스 — 지난 경주 있을 때만 조회(훅 규칙 위해 항상 호출, 인자 null 스킵)
  const hasPast = pastRaces.length > 0;
  const { data: sectionalRows } = useRaceSectionalStatsByRange(hasPast ? from : null, hasPast ? to : null);
  const sectionalByKey = useMemo(() => {
    const m = new Map<string, { avgS1f: number | null; meet: number; dist: number | null }>();
    for (const r of sectionalRows ?? []) {
      m.set(`${r.race_date}-${r.meet}-${r.rc_no}`, { avgS1f: r.avg_s1f, meet: r.meet, dist: r.rc_dist });
    }
    return m;
  }, [sectionalRows]);
```

- [ ] **Step 4: `TodayPicks.tsx` — 지난 경주 카드에 actual 전달**

지난 경주 섹션의 map(현재 파일에서 `pastRaces.map(([key, horses]) => (` 부분):

```tsx
          {pastRaces.map(([key, horses]) => (
            <RaceCard key={key} raceKey={key} horses={horses} styles={stylesByRace.get(key)} showResult={true} />
          ))}
```

를:

```tsx
          {pastRaces.map(([key, horses]) => (
            <RaceCard key={key} raceKey={key} horses={horses} styles={stylesByRace.get(key)} showResult={true} actual={sectionalByKey.get(key)} />
          ))}
```

다가오는 경주 섹션의 `RaceCard`는 **변경하지 않는다**(actual 미전달 → 기존 렌더 유지).

- [ ] **Step 5: 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없음.

- [ ] **Step 6: 전체 테스트 회귀**

Run: `npm run test:run`
Expected: 전부 통과(기존 + Task 2 신규). 실패 0.

- [ ] **Step 7: 개발서버 수동 확인**

Run(사용자 터미널): `npm run client:dev`

브라우저 `http://localhost:5173/picks`:
1. 지난 주로 이동(◀) → 결과 도착한 "지난 경주" 카드의 페이스 배지에 둘째/셋째 줄로 `실제 🐢 느림 · ✅ 예측 적중`(또는 `≈ 근접`/`❌ 빗나감`) 표시 확인.
2. "다가오는 경주" 카드에는 실측 줄이 **안** 뜨는지 확인(예측 배지만).
3. 구간기록 없는 지난 경주(par 없는 거리·데이터 부족)는 실측 줄 생략되고 예측 배지는 그대로 뜨는지 확인.
4. 예측 배지 자체(접전/보통/느림 + 선두권 N마리 + 실측 해석 문구)는 기존과 동일한지 확인.

- [ ] **Step 8: 커밋**

```bash
git add client/src/lib/queries.ts client/src/pages/TodayPicks.tsx
git commit -m "$(cat <<'EOF'
feat(pace): /picks 지난 경주 배지에 실측 페이스 배선

useRaceSectionalStatsByRange로 주간 avg_s1f 조회(지난 경주 있을 때만) →
지난 경주 카드에만 actual 전달. 다가오는 경주는 기존 유지. 쿼리 최대 4개.
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- §2 par 정적 JSON + 생성 스크립트 → Task 1.
- §3 `labelActualPace`·`paceMatchLevel`·`PACE_MATCH_UI` → Task 2.
- §4 `useRaceSectionalStatsByRange` → Task 4 Step 1.
- §5 RacePaceBadge 확장 → Task 3 · TodayPicks 배선(훅·Map·actual 전달) → Task 4 Step 2~4.
- §6 테스트(pace.test.ts labelActualPace·paceMatchLevel·PACE_MATCH_UI) → Task 2 Step 1. 컴포넌트 수동 확인 → Task 4 Step 7.
- §7 범위 밖(출마정보·주간통계·서버변경) → 어떤 태스크에도 없음. 확인.

**Placeholder scan:** 없음 — 모든 스텝 완전한 코드/커맨드.

**Type consistency:** `actual` prop 형태 `{ avgS1f: number | null; meet: number; dist: number | null }`가 Task 3(RacePaceBadge)·Task 4(RaceCard·sectionalByKey)에서 동일. `labelActualPace(avgS1f, meet, dist)` 시그니처가 Task 2 정의·Task 3 호출 일치. `PaceType`·`PaceMatch` 타입 일관. 훅 반환 필드 `avg_s1f`·`rc_dist`가 Task 4 Step 3의 Map 구성(`avgS1f: r.avg_s1f`, `dist: r.rc_dist`)과 일치.

**주의(리뷰 참고):** Task 2 테스트는 `pace_par.json`(Task 1 생성물)을 import하므로 Task 1이 반드시 먼저 완료돼야 함(태스크 순서 = 의존 순서). par 값 자체엔 의존하지 않고 첫 버킷을 런타임에 읽어 상대 delta로 검증하므로 재생성 드리프트에 강건.
