# /picks 주간 강추 전환 — 설계 스펙

> 2026-07-17 브레인스토밍 승인. "오늘의 강추" → "이번 주 강추": 이번 주 전체 픽 + 끝난 경주는 결과와 함께.
> 브랜치: **feat/f001-pace-ui 위에 쌓기** (사용자 결정 — 같은 파일(TodayPicks) 수정 + F-001 훅 일반화가 얽혀 한 번에 머지).

---

## 1. 목적·범위 (사용자 확정)

- 범위: **이번 주 월요일~일요일(KST)** 의 픽 전체. 다가오는 경주는 위에, 결과 도착한 경주는 아래에 적중/미적중과 함께 — 베팅 참고와 주간 복기를 한 화면에서.
- L-001의 당일 필터 취지(과거 이력 전체 노출 방지)는 유지 — 주간 윈도우로 확장할 뿐 무제한 조회 아님.

## 2. 주간 경계 — `client/src/lib/week.ts` 신설

- `weekRange(today: number): { from: number; to: number }` — YYYYMMDD 숫자 입력, 그 날짜가 속한 주의 **월요일(from)~일요일(to)** 반환. KST 기준(입력 자체가 `getTodayRaceDate()` KST 값).
- 순수함수 + 단위 테스트(루트 vitest): 수요일 입력→그 주 월·일, 월요일 입력→자기 자신이 from, 일요일 입력→자기 자신이 to, 월말·연말 걸친 주(예: 20261230) 롤오버.

## 3. 데이터 훅 (`client/src/lib/queries.ts`)

- **`useWeeklyPicks()`**: `useUpcomingPicks`(당일 필터) **대체** — `predictions`에서 `race_date gte from · lte to`, `.not('p_top3','is',null)`, 정렬 race_date→meet→rc_no. queryKey `['weekly-picks', from]`. staleTime 10분(기존과 동일). `useUpcomingPicks`는 삭제(사용처 TodayPicks 하나뿐 — grep 확인됨).
- **F-001 훅 일반화**: `useRaceEntryNamesByDate(raceDate)` → **`useRaceEntryNamesByRange(from: number | null, to: number | null)`** — `race_entries` select(race_date·meet·rc_no·hr_name) `.gte/.lte`. `enabled: from != null && to != null`. 페이스 배지 데이터가 주 전체 커버. 기존 단일 날짜 훅은 삭제(사용처 TodayPicks 하나뿐).
- 쿼리 예산: 페이지당 **3개**(weekly picks + 명단 + abilities) — 기존 당일 버전과 동일 개수, 범위만 주간으로 확대(주당 명단 ~1,000행 내외, 허용). 픽 0건 주간엔 명단·abilities 쿼리 스킵.

## 4. 화면 (`client/src/pages/TodayPicks.tsx` + `Layout.tsx`)

- 제목 "이번 주 강추", 부제에 주 범위 표시(예: `7/13(월) ~ 7/19(일)`).
- 내비게이션 라벨: Layout(또는 라우트 라벨)에 "오늘의 강추"가 있으면 "주간 강추"로 변경. 라우트 경로 `/picks`는 유지.
- **섹션 분류 기준 = 결과 유무**: 경주의 픽 중 `actual_ord`가 채워졌으면 "지난 경주", 아니면 "다가오는 경주". (시각 기준이 아님 — 당일이라도 결과 도착 시 지난 경주로.)
  - 경주 단위 판정: 그 경주 픽들의 actual_ord가 하나라도 non-null이면 종료 경주로 취급.
- **다가오는 경주 섹션**: 날짜별 그룹 헤더(`금 7/17 · 부경`) → 기존 경주 카드(픽 목록 + F-001 페이스 배지) 그대로.
- **지난 경주 섹션**: 같은 카드 + 픽마다 `실제 N착 ✅/❌` — **✅ = actual_ord 1~3** (기존 `useSelectivePickAccuracy`의 place 기준과 동일). actual_ord null인 픽(취소 등)은 표기 생략.
- 픽 0건: "이번 주 강추 없음" + "출마표는 수·목·금 오후에 도착합니다" 안내 1줄.
- 페이스 배지: 두 섹션 모두 표시(지난 경주는 당시가 아닌 현재 스냅샷 기준 — F-001 스펙 §3의 기존 한계와 동일, 허용).

## 5. 테스트

- `client/src/lib/week.test.ts` — §2 케이스 4종.
- 섹션 분류·적중 표기는 한 줄 로직이라 별도 유닛 분리 안 함(YAGNI) — 전체 테스트·타입체크 + 사용자 시각 확인으로 갈음.

## 6. 범위 밖

- 주간 적중률 요약 통계(픽 N개 중 M 적중) — 통계는 기존 `/statistics`가 담당. 필요해지면 후속.
- 주 이동(지난 주/다음 주 탐색) UI — 이번 주 고정. 과거 복기는 통계 화면 몫.
- 서버·DB·모델 변경 없음.

## 7. 참고

- 기존 당일 필터 출처: L-001 (docs/prediction_mode.md §8) — 취지 유지 확인.
- 적중 기준 원본: `client/src/lib/queries.ts` useSelectivePickAccuracy (place = actual_ord 1~3).
- F-001 배지: `docs/superpowers/specs/2026-07-16-f001-pace-ui-design.md` — 이 스펙이 그 훅(`useRaceEntryNamesByDate`)을 범위 훅으로 대체.
