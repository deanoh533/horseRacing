# E-006 등급/거리 특화 성적 설계 문서

> 작성일: 2026-05-31

---

## 목표

예상지 `ColHorseInfo`의 "같은거리 평균기록" 카드 하단에, 현재 경주와 **동일한 `prize_cond` + `rc_dist`** 조건에서의 특화 성적을 표시한다.

표시 예시:
```
— 1200m 평균
1:15.8
12전 기준 · 2/3/5
R0~65 특화  5전 2승 (연1 복2)
```

---

## 배경

- `races.prize_cond` = 경주 레이팅 조건 (예: `"R0~65"`, `"R0~80"`)
- 현재 경주의 `prize_cond`는 `PredictionSheet`의 `race.prize_cond`로 접근 가능
- 기존 `computeSameDistStats`는 거리만 필터링 → 모든 등급 혼합
- `race_entries`에는 `prize_cond` 컬럼 없음 → `races` 테이블과 JOIN 필요
- 전체 이력 기반 집계가 필요하므로 별도 Supabase 쿼리 훅을 신설

---

## 데이터 흐름

```
PredictionSheet
  └─ race.prize_cond ("R0~65")    ← 이미 있음
  └─ race.rc_dist (1200)          ← 이미 있음
  └─ hrNames[]                    ← 이미 있음
        │
        ▼
useHorseGradeDistStatsBatch(hrNames, prizeCond, rcDist)
        │
        ▼
Supabase: race_entries re
  JOIN races r ON (re.race_date, re.meet, re.rc_no)
  WHERE re.hr_name IN (hrNames)
    AND r.prize_cond = prizeCond
    AND re.rc_dist   = rcDist
    AND re.ord IS NOT NULL
        │
        ▼
Map<hrName, GradeDistStat>
        │
        ▼
HorseCard → ColHorseInfo (prop 추가)
        │
        ▼
평균 카드 하단 한 줄 렌더링
```

---

## 타입 정의

```ts
// client/src/lib/supabase.ts 에 추가
export interface GradeDistStat {
  total: number;
  wins: number;    // ord === 1
  places: number;  // ord <= 2
  shows: number;   // ord <= 3
}
```

---

## 훅: `useHorseGradeDistStatsBatch`

위치: `client/src/lib/queries.ts`

```ts
export function useHorseGradeDistStatsBatch(
  hrNames: string[],
  prizeCond: string | null,
  rcDist: number | null
): UseQueryResult<Map<string, GradeDistStat>>
```

- `hrNames`, `prizeCond`, `rcDist` 중 하나라도 없으면 `enabled: false`
- `queryKey`: `['horse-grade-dist-stats', sortedHrNames, prizeCond, rcDist]`
- `staleTime`: `24 * 60 * 60 * 1000` (하루)

**쿼리 방식:**
```sql
SELECT re.hr_name, re.ord
FROM race_entries re
JOIN races r
  ON re.race_date = r.race_date
 AND re.meet      = r.meet
 AND re.rc_no     = r.rc_no
WHERE re.hr_name IN (hrNames)
  AND r.prize_cond = prizeCond
  AND re.rc_dist   = rcDist
  AND re.ord IS NOT NULL
```

Supabase JS SDK에서는 직접 JOIN이 불가하므로, 아래 2단계로 구현:
1. `races` 테이블에서 `prize_cond = prizeCond` 인 `(race_date, meet, rc_no)` 조합 조회
2. `race_entries`에서 `hr_name IN hrNames AND rc_dist = rcDist` AND 위 race 조합에 해당하는 행 조회

결과를 `Map<string, GradeDistStat>`으로 집계하여 반환.

---

## 렌더링

### `ColHorseInfo` prop 추가

```ts
function ColHorseInfo({
  ...기존 props...,
  gradeDistStat: GradeDistStat | undefined,  // 신규
  racePrizeCond: string | null,              // 신규
})
```

### 표시 조건

- `gradeDistStat != null && gradeDistStat.total >= 2`
- `racePrizeCond`가 있을 때

### 표시 위치

"같은거리 평균" 카드(`sameDistStats` 블록) 하단에 작은 텍스트로 추가:

```tsx
{gradeDistStat != null && gradeDistStat.total >= 2 && racePrizeCond != null && (
  <div className="font-mono-num text-[10px] mt-1 pt-1 border-t border-[var(--color-bg-elevated)]"
       style={{ color: 'var(--color-text-disabled)' }}>
    <span style={{ color: 'var(--color-accent-cyan)' }}>{racePrizeCond} 특화</span>
    {' '}
    {gradeDistStat.total}전 {gradeDistStat.wins}승
    {gradeDistStat.places - gradeDistStat.wins > 0
      ? ` (연${gradeDistStat.places - gradeDistStat.wins} 복${gradeDistStat.shows - gradeDistStat.places})`
      : ''}
  </div>
)}
```

표시 예: `R0~65 특화  5전 2승 (연1 복2)`

### `sameDistStats`가 null인 경우

같은 거리 이력이 없으면 평균 카드 자체가 없으므로, 별도 처리 불필요.

---

## `PredictionSheet.tsx` 변경 요약

1. `useHorseGradeDistStatsBatch` import 추가
2. `const { data: gradeDistStatsMap } = useHorseGradeDistStatsBatch(hrNames, race?.prize_cond ?? null, rcDist)` 추가
3. `HorseCard`에 `gradeDistStat={gradeDistStatsMap?.get(horse.hr_name)}` 전달
4. `HorseCard` → `ColHorseInfo`로 `gradeDistStat`, `racePrizeCond={race?.prize_cond ?? null}` 전달
5. `ColHorseInfo` 내부 렌더링 추가

---

## 변경 파일 목록

| 파일 | 변경 내용 |
|---|---|
| `client/src/lib/supabase.ts` | `GradeDistStat` 인터페이스 추가 |
| `client/src/lib/queries.ts` | `useHorseGradeDistStatsBatch` 훅 추가 |
| `client/src/pages/PredictionSheet.tsx` | 훅 호출, HorseCard→ColHorseInfo prop 전달, 렌더링 추가 |

---

## 스코프 외

- `prize_cond` null인 말(미등급 2세 등)은 자동으로 `enabled: false`로 제외
- `rank_str` 컬럼 추가는 이 작업 스코프 밖
- 출마정보(`RaceEntries`) 화면은 이번 작업 대상 아님
