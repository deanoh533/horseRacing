# E-006 등급/거리 특화 성적 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 예상지 `ColHorseInfo`의 "같은거리 평균" 카드 하단에, 현재 경주와 동일한 `prize_cond` + `rc_dist` 조건에서의 특화 성적을 표시한다.

**Architecture:** `supabase.ts`에 타입 추가 → `queries.ts`에 2단계 Supabase 쿼리 훅 추가 → `PredictionSheet.tsx`에서 훅 호출 후 `HorseCard` → `ColHorseInfo`로 prop 전달 → 평균 카드 하단 렌더링.

**Tech Stack:** React, TypeScript, Supabase JS SDK (`@supabase/supabase-js`), Tailwind CSS.

---

### Task 1: `GradeDistStat` 타입 추가

**Files:**
- Modify: `client/src/lib/supabase.ts` (line 125 부근, `RaceEntry` 인터페이스 끝 직후)

- [ ] **Step 1: `GradeDistStat` 인터페이스 추가**

`client/src/lib/supabase.ts`의 `/** @deprecated ... */` 주석 바로 위(line ~127)에 추가:

찾을 코드:
```typescript
/** @deprecated race_entries로 대체됨 — 기존 코드 호환용 alias */
export type HorseResult = RaceEntry;
```

교체할 코드:
```typescript
/** E-006: 등급+거리 특화 성적 집계 */
export interface GradeDistStat {
  total: number;
  wins: number;    // ord === 1
  places: number;  // ord <= 2
  shows: number;   // ord <= 3
}

/** @deprecated race_entries로 대체됨 — 기존 코드 호환용 alias */
export type HorseResult = RaceEntry;
```

- [ ] **Step 2: 타입체크 확인**

```powershell
Set-Location "C:\Users\mjy76\Documents\projectFolder\client"; npx tsc --noEmit 2>&1 | Select-Object -First 10
```

Expected: 에러 없음 (출력 없음)

- [ ] **Step 3: 커밋**

```powershell
Set-Location "C:\Users\mjy76\Documents\projectFolder"; git add client/src/lib/supabase.ts; git commit -m "feat(types): GradeDistStat 인터페이스 추가"
```

---

### Task 2: `useHorseGradeDistStatsBatch` 훅 추가

**Files:**
- Modify: `client/src/lib/queries.ts` (파일 끝, `useHistoryRacesPrizeCond` 함수 이후)

2단계 쿼리:
1. `races` 테이블에서 `prize_cond = X`인 경주 키 목록 조회
2. `race_entries`에서 `hr_name IN [...] AND rc_dist = X AND ord IS NOT NULL` 조회
3. 클라이언트에서 race 키 교집합 필터 후 집계

- [ ] **Step 1: import에 `GradeDistStat` 추가**

`client/src/lib/queries.ts` 상단의 supabase import를 찾아 `GradeDistStat` 추가:

찾을 코드:
```typescript
import { supabase, type RaceEntry, type Race, type JockeyStat, type HorseSectionalAbility, type RaceSectionalStats } from './supabase';
```

교체할 코드:
```typescript
import { supabase, type RaceEntry, type Race, type JockeyStat, type HorseSectionalAbility, type RaceSectionalStats, type GradeDistStat } from './supabase';
```

- [ ] **Step 2: 훅 추가**

`client/src/lib/queries.ts` 파일 끝 (`useHistoryRacesPrizeCond` 함수 닫는 `}` 이후)에 추가:

```typescript
/**
 * E-006: 등급+거리 특화 성적 배치 조회
 * - 현재 경주와 동일한 prize_cond + rc_dist 에서의 전체 이력 집계
 * - 2단계 쿼리: races(prize_cond 필터) → race_entries(hrName+dist 필터) → 클라이언트 교집합
 * - key: hrName → GradeDistStat
 */
export function useHorseGradeDistStatsBatch(
  hrNames: string[],
  prizeCond: string | null,
  rcDist: number | null
) {
  const sortedNames = hrNames.slice().sort().join(',');
  return useQuery({
    queryKey: ['horse-grade-dist-stats', sortedNames, prizeCond ?? '', rcDist ?? 0],
    queryFn: async (): Promise<Map<string, GradeDistStat>> => {
      if (hrNames.length === 0 || !prizeCond || !rcDist) return new Map();

      // 1단계: prize_cond 일치 경주 키 목록
      const { data: matchingRaces, error: e1 } = await supabase
        .from('races')
        .select('race_date, meet, rc_no')
        .eq('prize_cond', prizeCond);
      if (e1) throw e1;
      if (!matchingRaces || matchingRaces.length === 0) return new Map();

      const raceSet = new Set(
        matchingRaces.map((r) => `${r.race_date}-${r.meet}-${r.rc_no}`)
      );

      // 2단계: 해당 말들의 같은 거리 경주 결과
      const { data: entries, error: e2 } = await supabase
        .from('race_entries')
        .select('hr_name, race_date, meet, rc_no, ord')
        .in('hr_name', hrNames)
        .eq('rc_dist', rcDist)
        .not('ord', 'is', null);
      if (e2) throw e2;

      // 3단계: race 키 교집합 필터 후 집계
      const map = new Map<string, GradeDistStat>();
      for (const e of entries ?? []) {
        if (!e.hr_name || e.ord == null) continue;
        const key = `${e.race_date}-${e.meet}-${e.rc_no}`;
        if (!raceSet.has(key)) continue;

        const s = map.get(e.hr_name) ?? { total: 0, wins: 0, places: 0, shows: 0 };
        s.total++;
        if (e.ord === 1) s.wins++;
        if (e.ord <= 2) s.places++;
        if (e.ord <= 3) s.shows++;
        map.set(e.hr_name, s);
      }
      return map;
    },
    enabled: hrNames.length > 0 && !!prizeCond && !!rcDist,
    staleTime: 24 * 60 * 60 * 1000,
  });
}
```

- [ ] **Step 3: 타입체크 확인**

```powershell
Set-Location "C:\Users\mjy76\Documents\projectFolder\client"; npx tsc --noEmit 2>&1 | Select-Object -First 10
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```powershell
Set-Location "C:\Users\mjy76\Documents\projectFolder"; git add client/src/lib/queries.ts; git commit -m "feat(queries): useHorseGradeDistStatsBatch 훅 추가 (E-006)"
```

---

### Task 3: `ColHorseInfo` props 추가 + 렌더링

**Files:**
- Modify: `client/src/pages/PredictionSheet.tsx`
  - `ColHorseInfo` props 인터페이스 (line ~409~427)
  - "같은거리 평균" 카드 하단 렌더링 (line ~585~601)

- [ ] **Step 1: `ColHorseInfo` props 인터페이스에 필드 추가**

찾을 코드:
```typescript
function ColHorseInfo({
  horse,
  runningStyle: _runningStyle,
  accentColor: _accentColor,
  bloodline,
  history,
  trainerStat,
  gateStats,
  rcDist,
}: {
  horse: RaceEntry;
  runningStyle: RunningStyle;
  accentColor: string;
  bloodline: BloodlineInfo | undefined;
  history: RaceEntry[];
  trainerStat: { total: number; wins: number } | undefined;
  gateStats: Map<number, { total: number; wins: number }> | undefined;
  rcDist: number | null;
})
```

교체할 코드:
```typescript
function ColHorseInfo({
  horse,
  runningStyle: _runningStyle,
  accentColor: _accentColor,
  bloodline,
  history,
  trainerStat,
  gateStats,
  rcDist,
  gradeDistStat,
  racePrizeCond,
}: {
  horse: RaceEntry;
  runningStyle: RunningStyle;
  accentColor: string;
  bloodline: BloodlineInfo | undefined;
  history: RaceEntry[];
  trainerStat: { total: number; wins: number } | undefined;
  gateStats: Map<number, { total: number; wins: number }> | undefined;
  rcDist: number | null;
  gradeDistStat: GradeDistStat | undefined;
  racePrizeCond: string | null;
})
```

- [ ] **Step 2: `supabase.ts`에서 `GradeDistStat` import 추가**

`PredictionSheet.tsx` 상단에서 supabase import를 찾아 `GradeDistStat` 추가:

찾을 코드:
```typescript
import { supabase, type RaceEntry, type Race,
```

교체할 코드 (해당 import 라인 전체를 확인 후):
— `GradeDistStat` 를 기존 `type` import 목록에 추가한다. 예:

찾을 코드:
```typescript
  type TrainingLog,
} from '../lib/supabase';
```

교체할 코드:
```typescript
  type TrainingLog,
  type GradeDistStat,
} from '../lib/supabase';
```

- [ ] **Step 3: "같은거리 평균" 카드 하단에 특화 성적 추가**

찾을 코드:
```typescript
            <div className="font-mono-num" style={{ fontSize: '10px', color: 'var(--color-text-disabled)' }}>
              {sameDistStats.count}전 기준 · 전적 {sameDistStats.wins}/{sameDistStats.places - sameDistStats.wins}/{sameDistStats.shows - sameDistStats.places}
            </div>
          </div>
        </>
      ) : dist != null ? (
```

교체할 코드:
```typescript
            <div className="font-mono-num" style={{ fontSize: '10px', color: 'var(--color-text-disabled)' }}>
              {sameDistStats.count}전 기준 · 전적 {sameDistStats.wins}/{sameDistStats.places - sameDistStats.wins}/{sameDistStats.shows - sameDistStats.places}
            </div>
            {gradeDistStat != null && gradeDistStat.total >= 2 && racePrizeCond != null && (
              <div
                className="font-mono-num mt-1 pt-1 border-t"
                style={{ fontSize: '10px', color: 'var(--color-text-disabled)', borderColor: 'var(--color-bg-elevated)' }}
              >
                <span style={{ color: 'var(--color-accent-cyan)' }}>{racePrizeCond} 특화</span>
                {' '}
                {gradeDistStat.total}전 {gradeDistStat.wins}승
                {(gradeDistStat.places - gradeDistStat.wins > 0 || gradeDistStat.shows - gradeDistStat.places > 0) && (
                  <span> (연{gradeDistStat.places - gradeDistStat.wins} 복{gradeDistStat.shows - gradeDistStat.places})</span>
                )}
              </div>
            )}
          </div>
        </>
      ) : dist != null ? (
```

- [ ] **Step 4: 타입체크 확인**

```powershell
Set-Location "C:\Users\mjy76\Documents\projectFolder\client"; npx tsc --noEmit 2>&1 | Select-Object -First 20
```

Expected: `gradeDistStat`, `racePrizeCond` prop을 전달하지 않아 에러 발생. Task 4에서 해결.

---

### Task 4: `HorseCard` + 메인 컴포넌트 연결

**Files:**
- Modify: `client/src/pages/PredictionSheet.tsx`
  - `HorseCard` props 인터페이스 (line ~1130~1144)
  - `HorseCard` 내부 `ColHorseInfo` 호출 (line ~1169~1178)
  - `useHorseGradeDistStatsBatch` import + 호출 (line ~1257~1258)
  - `HorseCard` 사용부 (line ~1387~1403)

- [ ] **Step 1: `useHorseGradeDistStatsBatch` import 추가**

찾을 코드:
```typescript
  useGradeWinnerStats,
  useTrainingBatchByNames,
  useJockeyHorseComboBatch,
  useHorseGateStatsBatch,
  useHistoryRacesPrizeCond,
```

교체할 코드:
```typescript
  useGradeWinnerStats,
  useTrainingBatchByNames,
  useJockeyHorseComboBatch,
  useHorseGateStatsBatch,
  useHistoryRacesPrizeCond,
  useHorseGradeDistStatsBatch,
```

- [ ] **Step 2: `HorseCard` props 인터페이스에 필드 추가**

찾을 코드:
```typescript
  gateStats: Map<number, { total: number; wins: number }> | undefined;
  prizeCondMap: Map<string, string>;
  rcDist: number | null;
```

교체할 코드:
```typescript
  gateStats: Map<number, { total: number; wins: number }> | undefined;
  gradeDistStat: GradeDistStat | undefined;
  racePrizeCond: string | null;
  prizeCondMap: Map<string, string>;
  rcDist: number | null;
```

- [ ] **Step 3: `HorseCard` destructuring에 신규 props 추가**

찾을 코드:
```typescript
function HorseCard({
  horse,
  prediction,
  history,
  runningStyle,
  bloodline,
  trainerStat,
  jockeyStat,
  latestTraining,
  jockeyHorseCombo,
  gateStats,
  prizeCondMap,
  rcDist,
  viewMode,
  onViewModeChange,
}: {
```

교체할 코드:
```typescript
function HorseCard({
  horse,
  prediction,
  history,
  runningStyle,
  bloodline,
  trainerStat,
  jockeyStat,
  latestTraining,
  jockeyHorseCombo,
  gateStats,
  gradeDistStat,
  racePrizeCond,
  prizeCondMap,
  rcDist,
  viewMode,
  onViewModeChange,
}: {
```

- [ ] **Step 4: `HorseCard` 내부 `ColHorseInfo` 호출에 props 전달**

찾을 코드:
```typescript
          <ColHorseInfo
            horse={horse}
            runningStyle={runningStyle}
            accentColor={accent}
            bloodline={bloodline}
            history={history}
            trainerStat={trainerStat}
            gateStats={gateStats}
            rcDist={rcDist}
          />
```

교체할 코드:
```typescript
          <ColHorseInfo
            horse={horse}
            runningStyle={runningStyle}
            accentColor={accent}
            bloodline={bloodline}
            history={history}
            trainerStat={trainerStat}
            gateStats={gateStats}
            rcDist={rcDist}
            gradeDistStat={gradeDistStat}
            racePrizeCond={racePrizeCond}
          />
```

- [ ] **Step 5: 메인 컴포넌트에서 훅 호출**

찾을 코드:
```typescript
  // E-003: 게이트별 통산 성적
  const { data: gateStatsMap } = useHorseGateStatsBatch(hrNames);
```

교체할 코드:
```typescript
  // E-003: 게이트별 통산 성적
  const { data: gateStatsMap } = useHorseGateStatsBatch(hrNames);

  // E-006: 등급+거리 특화 성적
  const { data: gradeDistStatsMap } = useHorseGradeDistStatsBatch(
    hrNames,
    race?.prize_cond ?? null,
    race?.rc_dist ?? null
  );
```

- [ ] **Step 6: `HorseCard` 사용부에서 props 전달**

찾을 코드:
```typescript
              gateStats={gateStatsMap?.get(horse.hr_name)}
              prizeCondMap={prizeCondMap}
```

교체할 코드:
```typescript
              gateStats={gateStatsMap?.get(horse.hr_name)}
              gradeDistStat={gradeDistStatsMap?.get(horse.hr_name)}
              racePrizeCond={race?.prize_cond ?? null}
              prizeCondMap={prizeCondMap}
```

- [ ] **Step 7: 타입체크 통과 확인**

```powershell
Set-Location "C:\Users\mjy76\Documents\projectFolder\client"; npx tsc --noEmit 2>&1 | Select-Object -First 20
```

Expected: 에러 없음 (출력 없음)

- [ ] **Step 8: 커밋**

```powershell
Set-Location "C:\Users\mjy76\Documents\projectFolder"; git add client/src/pages/PredictionSheet.tsx; git commit -m "feat(sheet): E-006 등급+거리 특화 성적 표시 추가"
```

---

### Task 5: 시각 검증 + 최종 커밋

- [ ] **Step 1: 개발 서버가 실행 중인지 확인**

```powershell
netstat -an | Select-String "5173" | Select-Object -First 2
```

Expected: `LISTENING` 상태. 없으면 `npm run client:dev` 실행.

- [ ] **Step 2: 시각 검증**

브라우저에서 이력이 있는 완성마 경주 예상지 접근: `/race/1/20260530/7/sheet`

확인 항목:
- "같은거리 평균" 카드 하단에 `R0~65 특화  N전 M승 (연X 복Y)` 텍스트 표시
- 해당 등급에서 뛴 이력이 없으면 특화 줄이 표시되지 않음
- 2전 미만이면 표시되지 않음

- [ ] **Step 3: TODO.md 업데이트**

`TODO.md`에서 E-006 항목을 완료 처리:

찾을 코드:
```markdown
- [ ] **E-006 현재 등급/거리 특화 성적** — 동일 등급·거리에서의 별도 성적 집계
```

교체할 코드:
```markdown
- [x] **E-006 현재 등급/거리 특화 성적** — 2026-05-31 완료. prize_cond + rc_dist 기준 전체 이력 집계, ColHorseInfo 평균 카드 하단 표시.
```

- [ ] **Step 4: 최종 커밋**

```powershell
Set-Location "C:\Users\mjy76\Documents\projectFolder"; git add TODO.md; git commit -m "chore: E-006 완료 표시 (TODO.md)"
```
