# RaceEntries 아코디언 패널 개선 — 설계 문서

> 작성: 2026-05-30
> 상태: 설계 확정

---

## 1. 배경

출마정보(RaceEntries) 화면의 기수·말 아코디언 패널이 데이터 부족으로 베팅 판단에 충분하지 않다.
PredictionSheet 재설계(2026-05-30)에서 만든 로직·쿼리를 최대한 재사용해 빠르게 보완한다.

---

## 2. 개선 범위

메인 테이블 컬럼 변경 없음. **아코디언 패널 2개만** 수정.
조교사 패널은 현재 수준으로 유지.

---

## 3. JockeyPanel 개선

### 현재
- 기수 통산 성적 (출주/1위/2·3위/단승률/입상률)
- 부담중량 + 전경주 대비 증감

### 추가

**① 이 말과의 조합이력**

```
이 말과의 전적
3전  1승  /  연1  복2
```

- 데이터: `useJockeyHorseComboBatch` — 이미 queries.ts에 구현됨
- 현재 JockeyPanel은 이 훅을 사용하지 않음 → prop으로 전달하면 됨

**② 기수 최근 3개월 폼**

```
최근 3개월  28전 5승  17.9%
```

- 데이터: race_entries에서 `jcky_no` + `race_date >= cutoff` + `ord IS NOT NULL` 집계
- 신규 훅 `useJockeyRecentForm(jckyNo, meet, daysBack=90)` 추가 필요
- 반환: `{ total: number; wins: number; places: number; shows: number } | null`

### JockeyPanel 완성 레이아웃

```
┌─────────────────────────────────────────────────┐
│ 기수 통산 성적          │ 부담중량                │
│ - 출주/1위/2·3위        │ - 이번 경주: 55kg       │
│ - 단승률 / 입상률       │ - 전경주 대비: +1        │
├─────────────────────────────────────────────────┤
│ 이 말과의 전적          │ 최근 3개월              │
│ 3전 1승 / 연1 복2       │ 28전 5승 17.9%         │
└─────────────────────────────────────────────────┘
```

---

## 4. HorsePanel 개선

### 현재
- 기본 정보 (출생지·마주·수득상금·최근1년·통산전적)
- 구간 능력치·주행성향
- 최근 5경주 (날짜·거리·착순·기록만)
- 혈통

### 추가

**① 최근 5경주에 구간기록 서브행**

각 경주 메인행 아래에 서브행 추가:
```
날짜   거리   착순   기록
5/15   1400   ②     1:28.5
  코너 5-3-2-2 · 출발 14.2s · 막판600m 35.8s · 막판200m 12.1s
5/01   1200   ③     1:15.3
  코너 4-2-3-3 · 출발 14.5s · 막판600m 35.2s · 막판200m 12.8s
```

- 데이터: `getSectionalInfo(h)` — PredictionSheet에서 이미 구현됨, 동일 로직 사용
- history는 이미 `select('*')`로 구간기록 컬럼 포함

**② 같은거리 최고/평균 기록**

PredictionSheet의 하이라이트 박스와 동일한 UI:
```
⚡ 1400m 최고   1:25.3   57kg · 양호 · 2위 · 3번 게이트
—  1400m 평균   1:27.1   3전 기준 · 전적 1/1/0
```

- 데이터: `computeSameDistStats(history, rcDist)` — 이미 PredictionSheet.tsx에서 export됨
- `rcDist`는 HorsePanel의 `rcDate`·`meet`·`rcNo`로 races 테이블에서 가져오거나, 부모에서 prop으로 전달

**③ 조교 정보**

```
최근 조교 (5/27)
출전조교 · 박태종(기수) · 85초
```

- 데이터: `useHorseTraining(hr_no)` — 이미 queries.ts에 구현됨
- HorsePanel은 이미 `hr_no`를 가지고 있음

**④ 진료내역**

```
진료내역
근육통 치료 (5/20)
```

- 데이터: `entry.latst_trea1_txt`, `latst_trea2_txt`, `latst_bledg1`, `latst_bledg2`
- entry는 이미 HorsePanel에 전달됨 — UI 추가만 하면 됨

### HorsePanel 완성 레이아웃 (2×2 그리드 유지)

```
┌──────────────────────┬──────────────────────────────┐
│ 기본 정보             │ 구간 능력치·주행성향          │
│ (현재와 동일)         │ (현재와 동일)                │
│                      │                              │
│ [⚡ 1400m 최고]       │                              │
│ [─  1400m 평균]       │                              │
│                      │                              │
│ 최근 조교 5/27 85초   │                              │
│ 진료: 근육통 치료      │                              │
├──────────────────────┴──────────────────────────────┤
│ 최근 5경주 (메인행 + 구간기록 서브행)                  │
├──────────────────────────────────────────────────────┤
│ 혈통                                                 │
└──────────────────────────────────────────────────────┘
```

---

## 5. 신규 데이터 훅

| 훅 | 파일 | 내용 |
|---|---|---|
| `useJockeyRecentForm` | `client/src/lib/queries.ts` | race_entries에서 기수 최근 90일 성적 집계 |

나머지는 기존 훅 재사용.

---

## 6. 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `client/src/lib/queries.ts` | `useJockeyRecentForm` 훅 추가 |
| `client/src/pages/RaceEntries.tsx` | JockeyPanel·HorsePanel 수정, 부모에서 rcDist 전달 |

---

## 7. 재사용 목록

- `getSectionalInfo()` → PredictionSheet.tsx에서 로직 복사 (또는 공통 유틸로 이동)
- `computeSameDistStats()` → PredictionSheet.tsx에서 import
- `useJockeyHorseComboBatch` → queries.ts에 이미 있음
- `useHorseTraining` → queries.ts에 이미 있음
- `formatDate`, `formatRcTime`, `ordColor` 스타일 → PredictionSheet와 동일 패턴

---

## 8. 모바일 대응

현재 패널은 `grid grid-cols-1 md:grid-cols-2`. 추가 요소들도 동일 그리드 유지.
