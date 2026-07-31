# 적중 조합 배당 UI 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `combo_dividends`에 쌓인 조합 확정배당을, 결과가 표시되는 4개 화면(경주 상세·예상지·출마정보·/picks)에서 그 경주 착순으로 적중된 조합의 배당만 보여준다.

**Architecture:** 순수 헬퍼(`winningComboPayouts`)가 착순 게이트+조합목록에서 적중 배당을 뽑고, 자기완결형 공용 컴포넌트(`WinningCombos`)가 데이터 훅 2개(`useComboDividends`+기존 `useHorsesByRace`)로 착순을 구해 렌더한다. 결과 없으면 null 렌더라 각 화면은 경주 단위 영역에 컴포넌트만 꽂으면 된다.

**Tech Stack:** React + Vite + Tailwind, @tanstack/react-query, supabase-js, vitest.

## Global Constraints

- **적중 조합만:** 전체 조합 나열 금지. pool별 적중 payout만(복연승은 3착내 2마리 조합 3줄).
- **매칭:** 순서無(복승·복연승·삼복승)=leg 집합 매칭(정렬 후 비교), 순서有(쌍승·삼쌍승)=leg 순서 그대로.
- **odds 단위 = 배**, 원값 그대로(반올림 X).
- **자기완결·자기게이트:** 컴포넌트는 결과 없음/경기 전/데이터 없음이면 `null` 렌더. 호출부는 조건 없이 꽂아도 됨.
- **대상 pool 라벨:** 복승식→복승, 쌍승식→쌍승, 복연승식→복연승, 삼복승식→삼복승, 삼쌍승식→삼쌍승.
- **결과 순서:** 복승 → 쌍승 → 복연승(최대 3) → 삼복승 → 삼쌍승.
- 커밋: 한국어+scope, 푸터 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- 각 태스크 종료 시 `npm run build`(루트 tsc) + `npx vitest run` 통과. 클라이언트 빌드 확인이 필요하면 `cd client && npm run build`.

## File Structure

- `client/src/lib/supabase.ts` (수정) — `ComboDividend` 타입.
- `client/src/lib/queries.ts` (수정) — `useComboDividends` 훅.
- `client/src/lib/combos.ts` (신규) — `POOL_LABELS`·`winningComboPayouts`·`WinningCombo`.
- `client/src/lib/combos.test.ts` (신규) — 헬퍼 단위 테스트.
- `client/src/components/WinningCombos.tsx` (신규) — 공용 컴포넌트.
- `client/src/pages/RaceDetail.tsx` / `RaceEntries.tsx` / `PredictionSheet.tsx` (수정) — 경주 단위 영역에 삽입.
- `client/src/pages/TodayPicks.tsx` (수정) — 지난 경주 카드에 compact 삽입.

---

### Task 1: 타입 + 데이터 훅

**Files:**
- Modify: `client/src/lib/supabase.ts` (타입 추가)
- Modify: `client/src/lib/queries.ts` (훅 추가)

**Interfaces:**
- Produces:
  - `export interface ComboDividend { race_date: number; meet: number; rc_no: number; pool: string; leg1: number; leg2: number; leg3: number; odds: number; }`
  - `export function useComboDividends(rcDate: number, meet: number, rcNo: number)` → `useQuery<ComboDividend[]>`

- [ ] **Step 1: 타입 추가**

`client/src/lib/supabase.ts`의 다른 `export interface`(예: `RaceEntry`, `Prediction`) 정의들이 있는 영역에 추가:
```ts
export interface ComboDividend {
  race_date: number;
  meet: number;
  rc_no: number;
  pool: string;
  leg1: number;
  leg2: number;
  leg3: number;
  odds: number;
}
```

- [ ] **Step 2: 훅 추가**

`client/src/lib/queries.ts` 상단 import에 `ComboDividend`를 기존 `./supabase` import 목록에 추가하고(예: `type Prediction,` 옆), 파일 끝(마지막 함수 뒤)에 훅 추가:
```ts
/**
 * 특정 경주의 조합 확정배당 전체 (combo_dividends).
 * 적중 조합 추출은 WinningCombos 컴포넌트에서 winningComboPayouts로 수행.
 */
export function useComboDividends(rcDate: number, meet: number, rcNo: number) {
  return useQuery({
    queryKey: ['combo-dividends', rcDate, meet, rcNo],
    queryFn: async (): Promise<ComboDividend[]> => {
      const { data, error } = await supabase
        .from('combo_dividends')
        .select('*')
        .eq('race_date', rcDate)
        .eq('meet', meet)
        .eq('rc_no', rcNo);
      if (error) throw error;
      return (data ?? []) as ComboDividend[];
    },
    enabled: !!rcDate && !!meet && !!rcNo,
    staleTime: 10 * 60 * 1000,
  });
}
```

- [ ] **Step 3: 타입체크**

Run: `npm run build`
Expected: tsc 통과(에러 없음).

- [ ] **Step 4: 커밋**

```bash
git add client/src/lib/supabase.ts client/src/lib/queries.ts
git commit -m "feat(ui): ComboDividend 타입 + useComboDividends 훅

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 순수 헬퍼 `winningComboPayouts` (TDD)

**Files:**
- Create: `client/src/lib/combos.ts`
- Create: `client/src/lib/combos.test.ts`

**Interfaces:**
- Consumes: `ComboDividend` (from `./supabase`).
- Produces:
  - `export const POOL_LABELS: Record<string, string>`
  - `export interface WinningCombo { pool: string; legs: number[]; odds: number; }`
  - `export function winningComboPayouts(combos: ComboDividend[], gates: number[]): WinningCombo[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`client/src/lib/combos.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { winningComboPayouts } from './combos';
import type { ComboDividend } from './supabase';

function c(pool: string, leg1: number, leg2: number, leg3: number, odds: number): ComboDividend {
  return { race_date: 20260726, meet: 1, rc_no: 1, pool, leg1, leg2, leg3, odds };
}

// 착순 1·2·3위 게이트 = 3, 7, 1
const combos: ComboDividend[] = [
  c('복승식', 3, 7, 0, 20.5),      // {3,7} 저장(오름차순 아님 케이스도 매칭돼야)
  c('쌍승식', 3, 7, 0, 41.1),      // (3→7)
  c('쌍승식', 7, 3, 0, 99.9),      // (7→3) — 적중 아님(순서 반대)
  c('복연승식', 3, 7, 0, 3.0),
  c('복연승식', 1, 3, 0, 1.8),
  c('복연승식', 1, 7, 0, 2.2),
  c('삼복승식', 1, 3, 7, 138.8),   // {1,3,7}
  c('삼쌍승식', 3, 7, 1, 1070.5),  // (3→7→1)
  c('단승식', 3, 0, 0, 5.0),       // 비대상
];

describe('winningComboPayouts', () => {
  it('복승은 집합 매칭(순서 무관)으로 적중 배당을 찾는다', () => {
    const r = winningComboPayouts(combos, [3, 7, 1]);
    const bok = r.find((x) => x.pool === '복승식');
    expect(bok?.odds).toBe(20.5);
  });

  it('쌍승은 순서 그대로 매칭한다(반대 순서는 제외)', () => {
    const r = winningComboPayouts(combos, [3, 7, 1]);
    const ssang = r.filter((x) => x.pool === '쌍승식');
    expect(ssang).toHaveLength(1);
    expect(ssang[0]!.odds).toBe(41.1);
  });

  it('복연승은 3착내 2마리 조합 3줄을 반환한다', () => {
    const r = winningComboPayouts(combos, [3, 7, 1]);
    const yeon = r.filter((x) => x.pool === '복연승식');
    expect(yeon).toHaveLength(3);
    expect(yeon.map((x) => x.odds).sort()).toEqual([1.8, 2.2, 3.0]);
  });

  it('삼복승은 집합, 삼쌍승은 순서로 매칭한다', () => {
    const r = winningComboPayouts(combos, [3, 7, 1]);
    expect(r.find((x) => x.pool === '삼복승식')?.odds).toBe(138.8);
    expect(r.find((x) => x.pool === '삼쌍승식')?.odds).toBe(1070.5);
  });

  it('결과 순서는 복승→쌍승→복연승→삼복승→삼쌍승', () => {
    const r = winningComboPayouts(combos, [3, 7, 1]);
    expect(r.map((x) => x.pool)).toEqual([
      '복승식', '쌍승식', '복연승식', '복연승식', '복연승식', '삼복승식', '삼쌍승식',
    ]);
  });

  it('착순이 top2만 있으면 복승·쌍승만 반환한다', () => {
    const r = winningComboPayouts(combos, [3, 7]);
    expect(r.map((x) => x.pool)).toEqual(['복승식', '쌍승식']);
  });

  it('적중 조합이 목록에 없으면 그 pool 줄을 생략한다', () => {
    const only = [c('복승식', 3, 7, 0, 20.5)];
    const r = winningComboPayouts(only, [3, 7, 1]);
    expect(r.map((x) => x.pool)).toEqual(['복승식']);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run client/src/lib/combos.test.ts`
Expected: FAIL — `combos.ts` / `winningComboPayouts` 없음.

- [ ] **Step 3: 헬퍼 구현**

`client/src/lib/combos.ts`:
```ts
import type { ComboDividend } from './supabase';

/** 대상 pool 라벨 (표시용) */
export const POOL_LABELS: Record<string, string> = {
  복승식: '복승',
  쌍승식: '쌍승',
  복연승식: '복연승',
  삼복승식: '삼복승',
  삼쌍승식: '삼쌍승',
};

/** 순서가 착순 의미인 pool (leg 순서 그대로 매칭) */
const ORDERED = new Set(['쌍승식', '삼쌍승식']);

export interface WinningCombo {
  pool: string;
  legs: number[];
  odds: number;
}

/** 조합의 leg 배열 (leg3=0이면 2마리) */
function legsOf(c: ComboDividend): number[] {
  return c.leg3 ? [c.leg1, c.leg2, c.leg3] : [c.leg1, c.leg2];
}

/**
 * 착순 게이트(top1~3, 순서=착순) + 조합목록 → pool별 적중 조합 배당.
 * gates 길이 2면 복승·쌍승만, 3이면 전부. 반환 순서: 복승→쌍승→복연승(≤3)→삼복승→삼쌍승.
 * 순서無(복승·복연승·삼복승)은 집합 매칭, 순서有(쌍승·삼쌍승)은 순서 매칭.
 */
export function winningComboPayouts(combos: ComboDividend[], gates: number[]): WinningCombo[] {
  const byPool = new Map<string, ComboDividend[]>();
  for (const c of combos) {
    if (!byPool.has(c.pool)) byPool.set(c.pool, []);
    byPool.get(c.pool)!.push(c);
  }

  const matchSet = (pool: string, wanted: number[]): ComboDividend | undefined => {
    const key = [...wanted].sort((a, b) => a - b).join(',');
    return (byPool.get(pool) ?? []).find(
      (c) => legsOf(c).slice().sort((a, b) => a - b).join(',') === key
    );
  };
  const matchOrdered = (pool: string, wanted: number[]): ComboDividend | undefined =>
    (byPool.get(pool) ?? []).find((c) => legsOf(c).join(',') === wanted.join(','));

  const out: WinningCombo[] = [];
  const add = (pool: string, wanted: number[]) => {
    const m = ORDERED.has(pool) ? matchOrdered(pool, wanted) : matchSet(pool, wanted);
    if (m) out.push({ pool, legs: wanted, odds: m.odds });
  };

  const [g1, g2, g3] = gates;
  if (g1 != null && g2 != null) {
    add('복승식', [g1, g2]);
    add('쌍승식', [g1, g2]);
  }
  if (g1 != null && g2 != null && g3 != null) {
    for (const pair of [[g1, g2], [g1, g3], [g2, g3]] as number[][]) {
      add('복연승식', pair);
    }
    add('삼복승식', [g1, g2, g3]);
    add('삼쌍승식', [g1, g2, g3]);
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run client/src/lib/combos.test.ts`
Expected: PASS (7건).

- [ ] **Step 5: 커밋**

```bash
git add client/src/lib/combos.ts client/src/lib/combos.test.ts
git commit -m "feat(ui): winningComboPayouts — 착순 게이트로 적중 조합 배당 추출

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 공용 컴포넌트 `WinningCombos`

**Files:**
- Create: `client/src/components/WinningCombos.tsx`

**Interfaces:**
- Consumes: `useComboDividends`·기존 `useHorsesByRace` (from `../lib/queries`), `winningComboPayouts`·`POOL_LABELS` (from `../lib/combos`).
- Produces: `export function WinningCombos({ rcDate, meet, rcNo, compact }: { rcDate: number; meet: number; rcNo: number; compact?: boolean }): JSX.Element | null`

- [ ] **Step 1: 컴포넌트 구현**

`client/src/components/WinningCombos.tsx`:
```tsx
import { useMemo } from 'react';
import { useComboDividends, useHorsesByRace } from '../lib/queries';
import { winningComboPayouts, POOL_LABELS } from '../lib/combos';

/** 순서有 pool은 → , 순서無는 - 로 leg 표기 */
const ORDERED_POOLS = new Set(['쌍승식', '삼쌍승식']);

/**
 * 적중 조합 배당 섹션 (경주 단위, 자기완결·자기게이트).
 * 결과 전이거나 combo 데이터/적중 조합이 없으면 null 렌더.
 */
export function WinningCombos({
  rcDate,
  meet,
  rcNo,
  compact = false,
}: {
  rcDate: number;
  meet: number;
  rcNo: number;
  compact?: boolean;
}) {
  const { data: combos } = useComboDividends(rcDate, meet, rcNo);
  const { data: horses } = useHorsesByRace(rcDate, meet, rcNo);

  const gates = useMemo(() => {
    return (horses ?? [])
      .filter((h) => h.ord != null && h.ord >= 1 && h.ord <= 3)
      .sort((a, b) => (a.ord as number) - (b.ord as number))
      .map((h) => h.pthr_no);
  }, [horses]);

  const rows = useMemo(
    () => (combos && combos.length > 0 && gates.length >= 2 ? winningComboPayouts(combos, gates) : []),
    [combos, gates]
  );

  if (rows.length === 0) return null;

  const fmtLegs = (pool: string, legs: number[]) =>
    legs.join(ORDERED_POOLS.has(pool) ? '→' : '-');

  return (
    <div
      className={`bg-[var(--color-bg-surface)] rounded-xl border border-[var(--color-bg-elevated)] ${
        compact ? 'mt-2 p-3' : 'p-4'
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-accent-cyan)] mb-2 font-semibold">
        [적중 조합 배당]
      </div>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li
            key={`${r.pool}-${r.legs.join('-')}-${i}`}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-[var(--color-text-secondary)] flex-shrink-0">
              {POOL_LABELS[r.pool] ?? r.pool}{' '}
              <span className="font-mono-num text-[var(--color-text-disabled)]">
                {fmtLegs(r.pool, r.legs)}
              </span>
            </span>
            <span className="font-mono-num text-[var(--color-text-primary)] text-right">
              {r.odds}배
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크 + 클라이언트 빌드**

Run: `npm run build && cd client && npm run build && cd ..`
Expected: 루트 tsc + 클라이언트 빌드 통과.

- [ ] **Step 3: 커밋**

```bash
git add client/src/components/WinningCombos.tsx
git commit -m "feat(ui): WinningCombos 공용 컴포넌트 — 적중 조합 배당 섹션

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 경주 단위 3화면 통합 (RaceDetail·RaceEntries·PredictionSheet)

**Files:**
- Modify: `client/src/pages/RaceDetail.tsx`
- Modify: `client/src/pages/RaceEntries.tsx`
- Modify: `client/src/pages/PredictionSheet.tsx`

**Interfaces:**
- Consumes: `WinningCombos` (from `../components/WinningCombos`). 각 페이지엔 이미 `rcDate`(또는 `Number(dateStr)`)·`meet`·`rcNo`가 스코프에 있음. 컴포넌트가 자기게이트라 조건 없이 삽입.

- [ ] **Step 1: RaceDetail 삽입**

`client/src/pages/RaceDetail.tsx` 상단 import에 추가:
```ts
import { WinningCombos } from '../components/WinningCombos';
```
그리고 최상위 `return`의 "빈 데이터" 블록 바로 뒤, 하단 안내(`<div className="text-center text-xs ...">ℹ️ 실제 KRA 동기화 데이터...`) **직전**에 삽입:
```tsx
      <WinningCombos rcDate={rcDate} meet={meet} rcNo={rcNo} />
```
(`rcDate`·`meet`·`rcNo`는 이미 `Number(...)`로 선언돼 있음.)

- [ ] **Step 2: RaceEntries 삽입**

`client/src/pages/RaceEntries.tsx` 상단 import에 `import { WinningCombos } from '../components/WinningCombos';` 추가. 파일을 읽어 최상위 `return`에서 **출전마 표(테이블) 컨테이너가 닫힌 직후**(경주 단위 위치)에 삽입:
```tsx
      <WinningCombos rcDate={rcDate} meet={meet} rcNo={rcNo} />
```
(`rcDate`·`meet`·`rcNo`는 이미 스코프에 있음. 컴포넌트가 결과 전이면 null이라 `isPostRace` 가드 불필요.)

- [ ] **Step 3: PredictionSheet 삽입**

`client/src/pages/PredictionSheet.tsx` 상단 import에 `import { WinningCombos } from '../components/WinningCombos';` 추가. 파일을 읽어 페이지 최상위 컴포넌트의 `return`에서 **출전마 목록(행들)이 끝난 직후**의 경주 단위 위치에 삽입:
```tsx
      <WinningCombos rcDate={rcDate} meet={meet} rcNo={rcNo} />
```
(주의: 이 파일은 여러 하위 컴포넌트가 한 파일에 있음 — `useParams`로 `rcDate/meet/rcNo`를 얻는 **페이지 최상위 컴포넌트**의 return에만 삽입. 개별 말 카드 컴포넌트 아님.)

- [ ] **Step 4: 타입체크 + 빌드**

Run: `npm run build && cd client && npm run build && cd ..`
Expected: 통과.

- [ ] **Step 5: 커밋**

```bash
git add client/src/pages/RaceDetail.tsx client/src/pages/RaceEntries.tsx client/src/pages/PredictionSheet.tsx
git commit -m "feat(ui): 경주 상세·출마정보·예상지에 적중 조합 배당 섹션

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: /picks(TodayPicks) 통합 (compact)

**Files:**
- Modify: `client/src/pages/TodayPicks.tsx`

**Interfaces:**
- Consumes: `WinningCombos`. `RaceCard`는 `horses: Prediction[]`를 받고 `h0 = horses[0]`에 `race_date·meet·rc_no`가 있음. `showResult`가 지난 경주 표시 플래그.

- [ ] **Step 1: 지난 경주 카드에 compact 삽입**

`client/src/pages/TodayPicks.tsx` 상단 import에 `import { WinningCombos } from '../components/WinningCombos';` 추가. `RaceCard` 함수의 반환 JSX에서 픽 목록 `<ul>...</ul>`이 닫힌 **직후**, 카드 컨테이너 `</div>` **직전**에, 지난 경주일 때만 삽입:
```tsx
      {showResult && (
        <WinningCombos rcDate={h0.race_date} meet={h0.meet} rcNo={h0.rc_no} compact />
      )}
```
(`h0`는 `RaceCard` 안에 이미 `const h0 = horses[0]!`로 선언됨. `showResult=false`(다가오는 경주)면 렌더 안 함 — 어차피 결과 없어 null이지만, 다가오는 경주에서 불필요한 조회를 피하려 명시적으로 가드.)

- [ ] **Step 2: 타입체크 + 빌드**

Run: `npm run build && cd client && npm run build && cd ..`
Expected: 통과.

- [ ] **Step 3: 전체 테스트**

Run: `npx vitest run`
Expected: 전체 PASS(신규 combos 7건 포함).

- [ ] **Step 4: 커밋**

```bash
git add client/src/pages/TodayPicks.tsx
git commit -m "feat(ui): /picks 지난 경주 카드에 적중 조합 배당(compact)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 문서 갱신

**Files:**
- Modify: `docs/status/06-ui.md`

- [ ] **Step 1: 상태문서 갱신**

`docs/status/06-ui.md`의 현재 상태 목록에 추가:
```markdown
- **적중 조합 배당 표시 (2026-07-31)** — combo_dividends에서 그 경주 착순으로 적중된 조합 배당(복승·쌍승·복연승×3·삼복승·삼쌍승)을 경주 상세·예상지·출마정보·/picks 4화면에 표시. 자기완결형 `WinningCombos` 컴포넌트 + 순수헬퍼 `winningComboPayouts`(집합/순서 매칭). 결과 전·데이터 없음이면 미표시. 스펙/플랜 docs/superpowers/*/2026-07-31-combo-dividends-ui*.
```

- [ ] **Step 2: 커밋**

```bash
git add docs/status/06-ui.md
git commit -m "docs(ui): 적중 조합 배당 표시 반영 (status/06-ui)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 완료 후

- 로컬에서 `npm run client:dev`로 지난 경주(예: 20260726) 상세/예상지/출마정보/picks 열어 "적중 조합 배당" 섹션 육안 확인.
- main 머지 → Vercel 자동 배포.
- 후속(별도): 과거 경주 combo 백필 시 과거 화면에도 자동 표시(컴포넌트가 데이터 유무로 degrade).
