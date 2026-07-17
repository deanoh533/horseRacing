# /picks 주간 강추 전환 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /picks를 "오늘의 강추"에서 "이번 주 강추"로 전환 — 이번 주(월~일) 픽 전체를 다가오는 경주(날짜 그룹)와 지난 경주(실착순 ✅/❌)로 나눠 한 화면에.

**Architecture:** 주간 경계는 순수함수 `weekRange`(신설 lib/week.ts), 데이터는 기존 훅 2개를 주간 범위 버전으로 교체(`useWeeklyPicks`·`useRaceEntryNamesByRange`), 화면은 TodayPicks 한 파일 개편. 섹션 분류는 시각이 아니라 결과 유무(actual_ord).

**Tech Stack:** React + TS + Tailwind (client/), TanStack Query, 루트 vitest.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-17-weekly-picks-design.md`. 순수 UI — 서버(src/)·DB·모델 변경 금지.
- 주간 경계: **월요일(from)~일요일(to)**, 입력은 `getTodayRaceDate()`의 YYYYMMDD 숫자. TZ 무관(UTC 산술)으로 구현.
- 섹션 분류: 경주의 픽 중 `actual_ord`가 **하나라도 non-null → 지난 경주**, 아니면 다가오는 경주.
- 적중 표기: **✅ = actual_ord 1~3** (useSelectivePickAccuracy의 place 기준과 동일). actual_ord null 픽은 표기 생략.
- 픽 0건 주간엔 명단·abilities 쿼리 스킵 (enabled 가드).
- 기존 훅 `useUpcomingPicks`·`useRaceEntryNamesByDate`는 **삭제** (사용처 TodayPicks뿐 — 확인됨). 단 컴파일이 항상 통과하도록 Task 2에서 새 훅 추가, Task 3에서 페이지 전환 후 옛 훅 삭제.
- 내비 라벨(Layout.tsx)은 "강추" — **변경 불필요** (스펙 §4 조건 해당 없음, 확인됨).
- 각 커밋 전: `npm run test:run`(루트) + `cd client && npx tsc -b` 통과.
- 커밋 메시지 한국어 + scope + 트레일러:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019mNxwWBSj5TPozmoznJ4BA
- 브랜치: `feat/f001-pace-ui` (스펙 커밋 7cd6a66 위에 쌓기 — 사용자 결정).

---

### Task 1: lib/week.ts — 주간 경계 순수함수 (TDD)

**Files:**
- Create: `client/src/lib/week.ts`
- Test: `client/src/lib/week.test.ts`

**Interfaces:**
- Produces (Task 2·3이 import): `weekRange(today: number): { from: number; to: number }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// client/src/lib/week.test.ts
import { describe, it, expect } from 'vitest';
import { weekRange } from './week';

describe('weekRange — YYYYMMDD가 속한 월~일 주간', () => {
  it('평일(금 20260717) → 그 주 월 20260713 ~ 일 20260719', () => {
    expect(weekRange(20260717)).toEqual({ from: 20260713, to: 20260719 });
  });
  it('월요일 입력 → 자기 자신이 from', () => {
    expect(weekRange(20260713)).toEqual({ from: 20260713, to: 20260719 });
  });
  it('일요일 입력 → 자기 자신이 to', () => {
    expect(weekRange(20260719)).toEqual({ from: 20260713, to: 20260719 });
  });
  it('연말 걸친 주(목 20261231) → 20261228 ~ 20270103 롤오버', () => {
    expect(weekRange(20261231)).toEqual({ from: 20261228, to: 20270103 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run client/src/lib/week.test.ts`
Expected: FAIL — "Cannot find module './week'"

- [ ] **Step 3: 구현**

```ts
// client/src/lib/week.ts
/**
 * 주간 경계 (주간 강추): YYYYMMDD 숫자가 속한 주의 월요일(from)~일요일(to).
 * 입력이 이미 KST 기준 날짜 숫자이므로 UTC 산술로 계산 — 실행 머신 TZ 무관.
 * 스펙: docs/superpowers/specs/2026-07-17-weekly-picks-design.md §2
 */
export function weekRange(today: number): { from: number; to: number } {
  const y = Math.floor(today / 10000);
  const m = Math.floor(today / 100) % 100;
  const d = today % 100;
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay();      // 0=일 … 6=토
  const mondayOffset = (dow + 6) % 7;       // 월=0 … 일=6
  const fromMs = t - mondayOffset * 86400000;
  const toMs = fromMs + 6 * 86400000;
  const toNum = (ms: number) => {
    const dt = new Date(ms);
    return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
  };
  return { from: toNum(fromMs), to: toNum(toMs) };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run client/src/lib/week.test.ts && cd client && npx tsc -b && cd ..`
Expected: 4 tests PASS + 타입 에러 0

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/week.ts client/src/lib/week.test.ts
git commit -m "feat(ui): weekRange 주간 경계 순수함수 — 월~일, UTC 산술로 TZ 무관 (주간 강추)"
```

---

### Task 2: queries.ts — 주간 훅 2개 추가 (옛 훅은 아직 유지)

**Files:**
- Modify: `client/src/lib/queries.ts` — `useUpcomingPicks`(245행 부근) 아래에 `useWeeklyPicks` 추가, `useRaceEntryNamesByDate`(614행 부근) 아래에 `useRaceEntryNamesByRange` 추가. **옛 훅 삭제는 Task 3에서** (컴파일 항상 통과 유지).

**Interfaces:**
- Consumes: `weekRange` (Task 1), `getTodayRaceDate`(이미 이 파일에 import돼 있음 — 7행), `supabase`·`Prediction`(기존)
- Produces (Task 3이 import):
  - `useWeeklyPicks(): UseQueryResult<Prediction[]>` — 이번 주(월~일) p_top3 있는 predictions
  - `useRaceEntryNamesByRange(from: number | null, to: number | null)` → `{ race_date; meet; rc_no; hr_name }[]`

- [ ] **Step 1: 훅 2개 추가**

`useUpcomingPicks` 함수 바로 아래:

```ts
/**
 * 이번 주(월~일) 강추 후보 — 주간 강추 화면용. useUpcomingPicks(당일)의 주간 버전.
 * 스펙: docs/superpowers/specs/2026-07-17-weekly-picks-design.md §3
 */
export function useWeeklyPicks() {
  const { from, to } = weekRange(getTodayRaceDate());
  return useQuery({
    queryKey: ['weekly-picks', from],
    queryFn: async (): Promise<Prediction[]> => {
      const { data, error } = await supabase
        .from('predictions')
        .select('*')
        .gte('race_date', from)
        .lte('race_date', to)
        .not('p_top3', 'is', null)
        .order('race_date')
        .order('meet')
        .order('rc_no');
      if (error) throw error;
      return (data ?? []) as Prediction[];
    },
    staleTime: 10 * 60 * 1000,
  });
}
```

`useRaceEntryNamesByDate` 함수 바로 아래:

```ts
/**
 * 날짜 범위 출전마 명단 (주간 강추 페이스 배지용) — useRaceEntryNamesByDate의 범위 버전.
 * 픽 0건이면 from/to null → 쿼리 스킵.
 */
export function useRaceEntryNamesByRange(from: number | null, to: number | null) {
  return useQuery({
    queryKey: ['race-entry-names-range', from, to],
    queryFn: async (): Promise<Array<{ race_date: number; meet: number; rc_no: number; hr_name: string }>> => {
      const { data, error } = await supabase
        .from('race_entries')
        .select('race_date, meet, rc_no, hr_name')
        .gte('race_date', from!)
        .lte('race_date', to!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: from != null && to != null,
    staleTime: 10 * 60 * 1000,
  });
}
```

import 추가 (파일 상단 기존 import 블록):

```ts
import { weekRange } from './week';
```

- [ ] **Step 2: 검증**

Run: `cd client && npx tsc -b && cd .. && npm run test:run`
Expected: 타입 에러 0 + 전체 통과

- [ ] **Step 3: 커밋**

```bash
git add client/src/lib/queries.ts
git commit -m "feat(ui): 주간 훅 추가 — useWeeklyPicks·useRaceEntryNamesByRange (옛 당일 훅은 다음 커밋에서 제거)"
```

---

### Task 3: TodayPicks 주간 개편 + 옛 훅 삭제 + 문서

**Files:**
- Modify: `client/src/pages/TodayPicks.tsx` (전면 교체 — 아래 코드)
- Modify: `client/src/lib/queries.ts` (`useUpcomingPicks`·`useRaceEntryNamesByDate` 두 함수와 그 JSDoc 삭제)
- Modify: `docs/status/06-ui.md` ("현재 상태"의 F-001 줄 뒤에 주간 전환 1줄 추가)

**Interfaces:**
- Consumes: `useWeeklyPicks`·`useRaceEntryNamesByRange`(Task 2), `weekRange`(Task 1), `RacePaceBadge`·`PickBadge`·`classifyRunningStyle`·`classifyPick`·`fmtPct`·`getTodayRaceDate`(기존)

- [ ] **Step 1: TodayPicks.tsx 전면 교체**

```tsx
// client/src/pages/TodayPicks.tsx — 이번 주 강추 (월~일, 다가오는/지난 섹션)
import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { useWeeklyPicks, useRaceEntryNamesByRange, useHorseSectionalAbilityByNames } from '../lib/queries';
import { classifyPick } from '../lib/selectivePicks';
import { PickBadge } from '../components/PickBadge';
import { RacePaceBadge } from '../components/RacePaceBadge';
import { classifyRunningStyle, type RunningStyle } from '../lib/runningStyle';
import { fmtPct } from '../lib/sectional';
import { getTodayRaceDate } from '../lib/supabase';
import { weekRange } from '../lib/week';
import type { Prediction } from '../lib/supabase';

const MEET_NAME: Record<number, string> = { 1: '서울', 2: '제주', 3: '부경' };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function fmtDate(d: number): string {
  const y = Math.floor(d / 10000);
  const m = Math.floor(d / 100) % 100;
  const day = d % 100;
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return `${m}/${day}(${DOW[dow]})`;
}

/** 경주 카드 (다가오는/지난 공용). showResult=true면 픽마다 실착순 ✅/❌ 표기. */
function RaceCard({
  raceKey, horses, styles, showResult,
}: {
  raceKey: string;
  horses: Prediction[];
  styles: RunningStyle[] | undefined;
  showResult: boolean;
}) {
  const h0 = horses[0]!;
  return (
    <div key={raceKey} className="rounded-lg border border-[var(--color-bg-elevated)] p-3">
      <Link
        to={`/race/${h0.meet}/${h0.race_date}/${h0.rc_no}/sheet`}
        className="text-sm font-medium text-[var(--color-accent-cyan)]"
      >
        {MEET_NAME[h0.meet] ?? h0.meet} {h0.rc_no}R →
      </Link>
      {styles && (
        <div className="mt-1.5">
          <RacePaceBadge styles={styles} />
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {horses.map((p) => (
          <li key={`${p.race_date}-${p.meet}-${p.rc_no}-${p.hr_name}`} className="flex items-center gap-2 text-sm">
            <PickBadge pTop3={p.p_top3} />
            <span className="font-semibold">{p.hr_name}</span>
            {showResult && p.actual_ord != null && (
              <span className={`text-xs font-semibold ${p.actual_ord <= 3 ? 'text-emerald-300' : 'text-red-400'}`}>
                {p.actual_ord}착 {p.actual_ord <= 3 ? '✅' : '❌'}
              </span>
            )}
            <span className="text-xs text-[var(--color-text-secondary)] ml-auto">
              연승 {p.p_top3 != null ? fmtPct(p.p_top3) : '-'}
              {p.p_win != null && <> · 우승 {fmtPct(p.p_win)}</>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TodayPicks() {
  const { from, to } = weekRange(getTodayRaceDate());
  const { data, isLoading } = useWeeklyPicks();

  const picks = useMemo(
    () => (data ?? []).filter((p) => classifyPick(p.p_top3) !== null),
    [data]
  );

  // 페이스 배지 — 픽 경주의 전체 출전마 성향 필요. 픽 0건이면 쿼리 스킵.
  const hasPicks = picks.length > 0;
  const { data: entryNames } = useRaceEntryNamesByRange(hasPicks ? from : null, hasPicks ? to : null);
  const allNames = useMemo(() => [...new Set((entryNames ?? []).map((e) => e.hr_name))], [entryNames]);
  const { data: abilities } = useHorseSectionalAbilityByNames(allNames);
  const stylesByRace = useMemo(() => {
    const styleByName = new Map<string, RunningStyle>();
    (abilities ?? []).forEach((a) => {
      styleByName.set(a.hr_name, classifyRunningStyle(a.avg_position_ratio, a.stddev_position_ratio));
    });
    const map = new Map<string, RunningStyle[]>();
    for (const e of entryNames ?? []) {
      const k = `${e.race_date}-${e.meet}-${e.rc_no}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(styleByName.get(e.hr_name) ?? 'unknown');
    }
    return map;
  }, [entryNames, abilities]);

  // 경주별 그룹 (data가 race_date→meet→rc_no 정렬이라 카드 순서 자동 유지) + 픽은 강추 우선 정렬
  const { upcomingByDate, pastRaces, raceCount } = useMemo(() => {
    const byRace = new Map<string, Prediction[]>();
    for (const p of picks) {
      const k = `${p.race_date}-${p.meet}-${p.rc_no}`;
      if (!byRace.has(k)) byRace.set(k, []);
      byRace.get(k)!.push(p);
    }
    const tierRank = (t: ReturnType<typeof classifyPick>) => (t === 'strong' ? 0 : 1);
    for (const horses of byRace.values()) {
      horses.sort(
        (a, b) =>
          tierRank(classifyPick(a.p_top3)) - tierRank(classifyPick(b.p_top3)) ||
          (b.p_top3 ?? 0) - (a.p_top3 ?? 0)
      );
    }
    // 섹션 분류 = 결과 유무 (스펙 §4: 픽 중 하나라도 actual_ord 있으면 지난 경주)
    const upcoming: Array<[string, Prediction[]]> = [];
    const past: Array<[string, Prediction[]]> = [];
    for (const entry of byRace.entries()) {
      (entry[1].some((p) => p.actual_ord != null) ? past : upcoming).push(entry);
    }
    const byDate = new Map<number, Array<[string, Prediction[]]>>();
    for (const entry of upcoming) {
      const d = entry[1][0]!.race_date;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(entry);
    }
    return { upcomingByDate: [...byDate.entries()], pastRaces: past, raceCount: byRace.size };
  }, [picks]);

  if (isLoading) return <div className="text-[var(--color-text-secondary)]">불러오는 중…</div>;

  if (picks.length === 0) {
    return (
      <div className="py-12 text-center text-[var(--color-text-secondary)]">
        <p className="text-lg mb-1">이번 주 강추 없음</p>
        <p className="text-sm">기준(연승 확률 임계값)을 넘는 출주마가 없습니다. 출마표는 수·목·금 오후에 도착합니다.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">이번 주 강추</h1>
      <p className="text-sm text-[var(--color-text-secondary)]">
        {fmtDate(from)} ~ {fmtDate(to)} · 보정 연승확률 기준 강추/주목 {picks.length}마리 · {raceCount}경주
      </p>

      {upcomingByDate.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)]">다가오는 경주</h2>
          {upcomingByDate.map(([date, races]) => (
            <div key={date} className="space-y-2">
              <h3 className="text-xs font-semibold text-[var(--color-accent-cyan)]">{fmtDate(date)}</h3>
              {races.map(([key, horses]) => (
                <RaceCard key={key} raceKey={key} horses={horses} styles={stylesByRace.get(key)} showResult={false} />
              ))}
            </div>
          ))}
        </section>
      )}

      {pastRaces.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)]">지난 경주 (이번 주 결과)</h2>
          {pastRaces.map(([key, horses]) => (
            <RaceCard key={key} raceKey={key} horses={horses} styles={stylesByRace.get(key)} showResult={true} />
          ))}
        </section>
      )}
    </div>
  );
}
```

주의: 기존 카드의 날짜 표기(`{h0.race_date}`)는 날짜 그룹 헤더로 이동했으므로 카드 Link에선 `{h0.rc_no}R`만 (지난 경주 카드도 같은 카드 — 지난 섹션은 날짜 그룹이 없으니 Link 옆이 아니라 카드 내 표기가 없어도 h0.race_date가 key에 있음. 혼동되면 지난 경주 카드 Link를 `{MEET_NAME[h0.meet]} {fmtDate(h0.race_date)} {h0.rc_no}R →`로 렌더해도 좋다 — 구현자 재량, 단 다가오는 카드와 같은 컴포넌트 유지).

- [ ] **Step 2: 옛 훅 삭제**

`client/src/lib/queries.ts`에서 `useUpcomingPicks` 함수(JSDoc 포함)와 `useRaceEntryNamesByDate` 함수(JSDoc 포함) 삭제. 삭제 후 grep으로 사용처 0건 확인:

Run: `grep -rn "useUpcomingPicks\|useRaceEntryNamesByDate" client/src/`
Expected: 매치 0건

- [ ] **Step 3: 문서 1줄**

`docs/status/06-ui.md` "현재 상태"의 F-001 줄 바로 아래에 추가:

```markdown
- **/picks 주간 전환 (2026-07-17)** — 오늘 → 이번 주(월~일, `weekRange`) 강추. 다가오는 경주(날짜 그룹)/지난 경주(실착순 ✅=1~3착) 섹션, 분류는 actual_ord 유무. 훅 `useWeeklyPicks`·`useRaceEntryNamesByRange`(당일 훅 삭제).
```

- [ ] **Step 4: 검증**

Run: `cd client && npx tsc -b && cd .. && npm run test:run`
Expected: 타입 에러 0 + 전체 통과 (week 4 포함)

- [ ] **Step 5: 커밋**

```bash
git add client/src/pages/TodayPicks.tsx client/src/lib/queries.ts docs/status/06-ui.md
git commit -m "feat(ui): /picks 주간 강추 전환 — 월~일 윈도우·다가오는/지난 섹션·실착순 표기, 당일 훅 제거"
```

---

## Self-Review 결과

- **스펙 커버리지**: §2 weekRange(Task 1) / §3 훅 교체·범위 일반화·0건 스킵(Task 2·3 — hasPicks 가드) / §4 제목·부제·섹션 분류(결과 유무)·적중 ✅=1~3착·날짜 그룹·빈 상태 문구·내비 라벨(변경 불필요 확인, Global Constraints에 명시) / §5 week 테스트 4종 / §6 범위 밖(주간 통계·주 이동 없음 — 코드에 미포함) ✓
- **플레이스홀더**: 없음 — 전 코드 실물 ✓
- **타입 일관성**: `weekRange` (Task 1 정의 → 2·3 소비), `useWeeklyPicks()`·`useRaceEntryNamesByRange(from, to)` (Task 2 정의 → 3 소비), `RaceCard` props는 Task 3 내부 정의·소비 ✓. `getTodayRaceDate`는 queries.ts엔 이미 import돼 있고(7행) TodayPicks.tsx엔 신규 import ✓
