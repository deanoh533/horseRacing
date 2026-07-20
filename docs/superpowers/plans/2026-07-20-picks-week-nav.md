# /picks 지난 주 탐색 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/picks`(주간 강추)에서 이전/다음 주 화살표로 과거 주 픽·결과를 조회할 수 있게 하고, 조회 중인 주를 `?week=` URL 파라미터로 유지한다.

**Architecture:** `client/src/lib/week.ts`에 순수함수 `addDaysToYmd`를 추가(주 이동 계산의 기반, `weekRange`도 이를 재사용하도록 리팩터). `useWeeklyPicks` 훅이 anchor 날짜를 인자로 받도록 확장(기본값 = 오늘, 기존 호출부인 Dashboard는 무변경). `TodayPicks.tsx`가 `useSearchParams`의 `week` 값을 anchor로 사용하고, 화살표 클릭 시 그 값을 갱신한다.

**Tech Stack:** React + TypeScript + react-router-dom(`useSearchParams`) + lucide-react(아이콘) + vitest(유닛 테스트).

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-07-20-picks-week-nav-design.md` — 모든 태스크는 이 문서와 일치해야 함.
- 서버·DB·모델 변경 없음. `predictions`/`race_entries` 테이블·API 변경 없음.
- 과거 조회 범위는 무제한, 미래 방향은 이번 주까지만(그 이상 비활성화).
- 기존 `Dashboard.tsx`의 `useWeeklyPicks()` 호출부(인자 없음)는 그대로 동작해야 함 — 시그니처 변경 시 하위호환 유지.
- 커밋 메시지는 한국어 + scope 접두사(`feat(picks):`, `test(picks):` 등).

---

### Task 1: `addDaysToYmd` 순수함수 추가 + `weekRange` 리팩터

**Files:**
- Modify: `client/src/lib/week.ts`
- Test: `client/src/lib/week.test.ts`

**Interfaces:**
- Produces: `addDaysToYmd(ymd: number, days: number): number` — YYYYMMDD 숫자에 일수(음수 가능)를 더한 결과를 YYYYMMDD로 반환. Task 3(`TodayPicks.tsx`)가 이 함수로 주 이동(±7일)을 계산.
- `weekRange(today: number): { from: number; to: number }`의 기존 시그니처·반환값은 변경 없음(내부 구현만 `addDaysToYmd` 재사용으로 리팩터).

- [ ] **Step 1: 실패하는 테스트 작성**

`client/src/lib/week.test.ts` 끝에 새 `describe` 블록 추가:

```ts
describe('addDaysToYmd — YYYYMMDD에 일수 더하기', () => {
  it('같은 달 내 이동: 20260710 + 7 = 20260717', () => {
    expect(addDaysToYmd(20260710, 7)).toBe(20260717);
  });
  it('월말 롤오버: 20260128 + 7 = 20260204', () => {
    expect(addDaysToYmd(20260128, 7)).toBe(20260204);
  });
  it('연말 롤오버: 20261230 + 7 = 20270106', () => {
    expect(addDaysToYmd(20261230, 7)).toBe(20270106);
  });
  it('음수 이동(이전 주): 20260717 - 7 = 20260710', () => {
    expect(addDaysToYmd(20260717, -7)).toBe(20260710);
  });
});
```

파일 상단 import도 갱신:

```ts
import { describe, it, expect } from 'vitest';
import { weekRange, addDaysToYmd } from './week';
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npm run test:run -- client/src/lib/week.test.ts`
Expected: FAIL — `addDaysToYmd is not a function` (또는 import 에러)

- [ ] **Step 3: `week.ts`에 `addDaysToYmd` 구현 + `weekRange` 리팩터**

`client/src/lib/week.ts` 전체를 아래로 교체:

```ts
/**
 * YYYYMMDD 숫자에 일수(음수 가능)를 더한 결과를 YYYYMMDD로 반환.
 * UTC 산술로 계산 — 실행 머신 TZ 무관.
 * 스펙: docs/superpowers/specs/2026-07-20-picks-week-nav-design.md §2
 */
export function addDaysToYmd(ymd: number, days: number): number {
  const y = Math.floor(ymd / 10000);
  const m = Math.floor(ymd / 100) % 100;
  const d = ymd % 100;
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

/**
 * 주간 경계 (주간 강추): YYYYMMDD 숫자가 속한 주의 월요일(from)~일요일(to).
 * 입력이 이미 KST 기준 날짜 숫자이므로 UTC 산술로 계산 — 실행 머신 TZ 무관.
 * 스펙: docs/superpowers/specs/2026-07-17-weekly-picks-design.md §2
 */
export function weekRange(today: number): { from: number; to: number } {
  const y = Math.floor(today / 10000);
  const m = Math.floor(today / 100) % 100;
  const d = today % 100;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일 … 6=토
  const mondayOffset = (dow + 6) % 7;                       // 월=0 … 일=6
  const from = addDaysToYmd(today, -mondayOffset);
  const to = addDaysToYmd(from, 6);
  return { from, to };
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npm run test:run -- client/src/lib/week.test.ts`
Expected: PASS — 기존 4개 케이스 + 신규 4개 케이스 전부 통과 (총 8개)

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/week.ts client/src/lib/week.test.ts
git commit -m "$(cat <<'EOF'
feat(picks): addDaysToYmd 추가 + weekRange 리팩터 — 주 이동 계산 기반

지난 주 탐색(이전/다음 주 화살표) 구현을 위해 날짜 이동 순수함수 추가.
weekRange는 내부적으로 이 함수를 재사용하도록 정리(동작 변경 없음).
EOF
)"
```

---

### Task 2: `useWeeklyPicks` 훅에 anchor 인자 추가

**Files:**
- Modify: `client/src/lib/queries.ts:239-258`

**Interfaces:**
- Consumes: 없음(기존 `weekRange`, `getTodayRaceDate`, `supabase` 그대로 사용).
- Produces: `useWeeklyPicks(anchorDate: number = getTodayRaceDate())` — Task 3의 `TodayPicks.tsx`가 URL의 `week` 파라미터(또는 오늘)를 `anchorDate`로 넘겨 호출. 인자 생략 시 기존과 동일하게 오늘 기준 이번 주(예: `Dashboard.tsx:90`의 `useWeeklyPicks()` 호출은 무변경으로 계속 동작).

이 태스크는 순수 시그니처 변경이라 별도 유닛 테스트 없음(스펙 §5 — 훅은 Supabase 의존이라 유닛 테스트 대상 아님). 타입체크로 검증.

- [ ] **Step 1: `queries.ts`의 `useWeeklyPicks` 시그니처 변경**

`client/src/lib/queries.ts:239` 다음 줄을 교체:

```ts
// 변경 전
export function useWeeklyPicks() {
  const { from, to } = weekRange(getTodayRaceDate());
```

```ts
// 변경 후
export function useWeeklyPicks(anchorDate: number = getTodayRaceDate()) {
  const { from, to } = weekRange(anchorDate);
```

나머지 함수 본문(쿼리 로직)은 그대로 둔다.

- [ ] **Step 2: 타입체크로 확인**

Run: `npm run build`
Expected: 에러 없음(`Dashboard.tsx:90`의 `useWeeklyPicks()` 호출이 여전히 유효한 default-parameter 호출로 타입체크 통과).

- [ ] **Step 3: 커밋**

```bash
git add client/src/lib/queries.ts
git commit -m "$(cat <<'EOF'
feat(picks): useWeeklyPicks에 anchorDate 인자 추가(기본값=오늘)

/picks 화면에서 임의 주 조회를 위해 훅이 anchor 날짜를 받도록 확장.
기존 호출부(Dashboard 등)는 인자 생략 시 동일하게 동작 — 하위호환 유지.
EOF
)"
```

---

### Task 3: `TodayPicks.tsx` — 주 이동 UI + URL 반영

**Files:**
- Modify: `client/src/pages/TodayPicks.tsx`

**Interfaces:**
- Consumes: `addDaysToYmd(ymd, days)`, `weekRange(today)` from `../lib/week`; `useWeeklyPicks(anchorDate)` from `../lib/queries`; `getTodayRaceDate()` from `../lib/supabase`.
- Produces: 없음(페이지 컴포넌트, 최종 소비 지점).

이 태스크는 UI 컴포넌트 변경이라 유닛 테스트 없음(스펙 §5). `npm run build` 타입체크 + 개발 서버에서 수동 확인으로 검증.

- [ ] **Step 1: import 구문 갱신**

`client/src/pages/TodayPicks.tsx` 1~11행을 교체:

```tsx
// client/src/pages/TodayPicks.tsx — 주간 강추 (월~일, 다가오는/지난 섹션 + 지난 주 탐색)
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useWeeklyPicks, useRaceEntryNamesByRange, useHorseSectionalAbilityByNames } from '../lib/queries';
import { classifyPick } from '../lib/selectivePicks';
import { PickBadge } from '../components/PickBadge';
import { RacePaceBadge } from '../components/RacePaceBadge';
import { classifyRunningStyle, type RunningStyle } from '../lib/runningStyle';
import { fmtPct } from '../lib/sectional';
import { getTodayRaceDate } from '../lib/supabase';
import { addDaysToYmd, weekRange } from '../lib/week';
import type { Prediction } from '../lib/supabase';
```

- [ ] **Step 2: 컴포넌트 본문 교체 — anchor 파싱 + 주 이동 로직**

`client/src/pages/TodayPicks.tsx`의 `export function TodayPicks() {` 시작부(기존 69행)부터 데이터 훅 호출 부분(기존 76행 `const { data, isLoading } = useWeeklyPicks();`)까지를 교체:

```tsx
export function TodayPicks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = getTodayRaceDate();
  const thisWeekMonday = weekRange(today).from;

  const weekParam = searchParams.get('week');
  const parsedWeek = weekParam && /^\d{8}$/.test(weekParam) ? Number(weekParam) : null;
  const anchor = parsedWeek ?? today;
  const { from, to } = weekRange(anchor);
  const isCurrentWeek = from === thisWeekMonday;

  // URL의 week 값이 그 주의 월요일이 아니면(예: 수동 편집) 월요일로 정규화
  useEffect(() => {
    if (parsedWeek !== null && parsedWeek !== from) {
      setSearchParams({ week: String(from) }, { replace: true });
    }
  }, [parsedWeek, from, setSearchParams]);

  const goToWeek = (monday: number) => setSearchParams({ week: String(monday) });

  const { data, isLoading } = useWeeklyPicks(anchor);
```

- [ ] **Step 3: 픽/섹션 계산 로직은 그대로 유지 확인**

기존 76~126행(변경 전 파일 기준: `picks` useMemo, 페이스 배지 계산, `upcomingByDate`/`pastRaces`/`raceCount` useMemo)은 **수정하지 않는다** — `from`/`to`/`picks`/`data` 변수명이 그대로 유효하므로 로직 변경 불필요. (Step 2에서 이미 `from`, `to`, `data`, `isLoading`을 재정의했으므로 이 블록은 그 아래 이어짐.)

- [ ] **Step 4: 렌더링부 교체 — 주 이동 네비게이션 + 제목 + 빈 상태**

기존 128행(`if (isLoading) return ...`)부터 파일 끝(기존 170행)까지를 교체:

```tsx
  if (isLoading) return <div className="text-[var(--color-text-secondary)]">불러오는 중…</div>;

  const weekNav = (
    <div className="flex items-center gap-2 text-sm">
      <button
        type="button"
        onClick={() => goToWeek(addDaysToYmd(from, -7))}
        aria-label="이전 주"
        className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="font-medium">{fmtDate(from)} ~ {fmtDate(to)}</span>
      <button
        type="button"
        onClick={() => goToWeek(addDaysToYmd(from, 7))}
        disabled={isCurrentWeek}
        aria-label="다음 주"
        className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronRight size={16} />
      </button>
      {!isCurrentWeek && (
        <button
          type="button"
          onClick={() => goToWeek(thisWeekMonday)}
          className="ml-1 text-xs text-[var(--color-accent-cyan)] hover:underline"
        >
          이번 주로
        </button>
      )}
    </div>
  );

  if (picks.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">{isCurrentWeek ? '이번 주 강추' : '지난 강추'}</h1>
        {weekNav}
        <div className="py-12 text-center text-[var(--color-text-secondary)]">
          <p className="text-lg mb-1">선택한 주 강추 없음</p>
          {isCurrentWeek && (
            <p className="text-sm">기준(연승 확률 임계값)을 넘는 출주마가 없습니다. 출마표는 수·목·금 오후에 도착합니다.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{isCurrentWeek ? '이번 주 강추' : '지난 강추'}</h1>
      {weekNav}
      <p className="text-sm text-[var(--color-text-secondary)]">
        보정 연승확률 기준 강추/주목 {picks.length}마리 · {raceCount}경주
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

- [ ] **Step 5: 타입체크**

Run: `npm run build`
Expected: 에러 없음.

- [ ] **Step 6: 개발 서버에서 수동 확인**

Run(사용자 터미널, 이미 실행 중이 아니면): `npm run client:dev`

브라우저에서 `http://localhost:5173/picks` 접속 후 확인:
1. 기본 진입 시 "이번 주 강추" 제목 + `▶` 비활성화(회색) 확인.
2. `◀` 클릭 → URL이 `?week=<지난주 월요일 YYYYMMDD>`로 바뀌고 제목이 "지난 강추"로, 지난 주 데이터(있다면 결과 포함)가 보임.
3. 여러 번 `◀` 클릭 → 계속 과거로 이동(제한 없음), "이번 주로" 버튼 노출 확인.
4. "이번 주로" 클릭 → 즉시 이번 주로 복귀, 버튼 사라짐.
5. 지난 주 상태에서 브라우저 새로고침 → 같은 주 유지되는지 확인(URL 파라미터 반영 검증).
6. 픽 0건인 과거 주가 있다면(있는 경우) 네비게이션이 여전히 보이고 "선택한 주 강추 없음"만 뜨는지, 출마표 안내 문구는 이번 주에만 뜨는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add client/src/pages/TodayPicks.tsx
git commit -m "$(cat <<'EOF'
feat(picks): 이전/다음 주 화살표 탐색 + URL(?week=) 반영

일요일 자정 이후 지난 주 강추를 다시 볼 방법이 없던 문제 해결.
과거 조회 무제한, 미래는 이번 주까지만, "이번 주로" 복귀 버튼 추가.
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- §2 `addDaysToYmd` — Task 1.
- §3 `useWeeklyPicks(anchorDate)` 시그니처 — Task 2 (기본값으로 Dashboard 하위호환 확보, 스펙에 없던 세부사항이나 기존 호출부 보호를 위해 필요 — Global Constraints에 명시).
- §4 URL 파라미터·화살표·비활성화 조건·"이번 주로" 버튼·제목 분기·빈 상태 문구 일반화 — Task 3.
- §5 테스트 — Task 1 Step 1~4.
- §6 범위 밖(주간 통계·달력 선택 UI·서버 변경) — 어떤 태스크에도 포함 안 됨. 확인 완료.

**Placeholder scan:** 없음 — 모든 스텝에 완전한 코드/커맨드 포함.

**Type consistency:** `addDaysToYmd(ymd, days)`가 Task 1에서 정의되고 Task 3에서 동일 시그니처로 호출됨. `useWeeklyPicks(anchorDate)`가 Task 2에서 정의되고 Task 3에서 `useWeeklyPicks(anchor)`로 호출됨(인자명 다르나 위치 인자라 문제 없음). `weekRange` 반환 타입 `{ from, to }` 일관 사용.
