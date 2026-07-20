# /picks 지난 주 탐색 — 설계 스펙

> 2026-07-20 브레인스토밍 승인. 기존 주간 강추(`docs/superpowers/specs/2026-07-17-weekly-picks-design.md`)는
> "이번 주 고정" 설계(§6에서 주 이동 UI를 범위 밖으로 명시)라 일요일 24시가 지나 새 주로 넘어가면
> 지난 주 강추를 다시 볼 방법이 없었음. 이 스펙은 그 §6을 뒤집어 이전/다음 주 탐색을 추가한다.

---

## 1. 목적·범위 (사용자 확정)

- `/picks`에서 이전/다음 주로 이동하며 그 주의 강추 픽 + 결과(적중/미적중)를 볼 수 있게 한다.
- 조회 범위: **제한 없음** — `predictions`에 데이터가 있는 한 과거 어디든 조회 가능.
- 미래 방향은 이번 주까지만(현재 이상 미래 주는 데이터가 없으므로 진입 불가).
- URL에 조회 중인 주를 반영(`?week=YYYYMMDD`) — 새로고침·링크 공유 시 같은 주 유지.
- 여러 주 뒤로 간 상태에서 바로 이번 주로 복귀하는 버튼 추가.

## 2. `client/src/lib/week.ts` — 날짜 이동 헬퍼 추가

- 기존 `weekRange(today: number): { from: number; to: number }` 그대로 유지.
- 신규: `addDaysToYmd(ymd: number, days: number): number` — YYYYMMDD 숫자에 일수(음수 가능) 더한 결과를 YYYYMMDD로 반환. UTC 산술(기존 `weekRange`와 동일 패턴), 월말·연말 롤오버 안전.
- 주 이동은 호출부에서 `addDaysToYmd(monday, delta * 7)`로 계산(주 단위 전용 함수는 별도로 만들지 않음 — YAGNI).

## 3. 데이터 훅 (`client/src/lib/queries.ts`)

- `useWeeklyPicks()` → **`useWeeklyPicks(anchorDate: number)`**로 시그니처 변경. 내부에서 `weekRange(anchorDate)`로 from/to 계산(기존 로직 그대로, 인자만 외부에서 주입).
- queryKey는 기존과 동일하게 `['weekly-picks', from]` — 주가 바뀔 때마다 자동으로 별도 캐시 엔트리, staleTime 10분 유지.
- `useRaceEntryNamesByRange(from, to)`는 변경 없음(이미 범위 인자를 받음 — 호출부에서 새 anchor 기준 from/to만 넘기면 됨).

## 4. 화면 (`client/src/pages/TodayPicks.tsx`)

- `react-router-dom`의 `useSearchParams`로 `week` 쿼리 파라미터를 읽음.
  - 파싱: 8자리 숫자가 아니거나 유효하지 않은 날짜면 조용히 오늘(`getTodayRaceDate()`)로 폴백(에러 UI 없음).
  - anchor = 파싱된 값 또는 오늘. `weekRange(anchor)`로 해당 주의 월요일을 구하고, **월요일 값으로 정규화해 URL을 다시 씀**(사용자가 URL을 수요일 날짜로 직접 넣어도 항상 그 주의 월요일로 표시되게).
- 헤더 UI: `◀ 7/13(월) ~ 7/19(일) ▶` — 화살표 클릭 시 `setSearchParams({ week: String(addDaysToYmd(monday, ±7)) })`.
  - `▶`(다음 주) 비활성화 조건: 현재 조회 중인 주의 월요일 ≥ 이번 주 월요일(`weekRange(getTodayRaceDate()).from`). 즉 이번 주에 도달하면 더 못 감(미래 주 없음).
  - `◀`(이전 주)는 항상 활성(범위 무제한).
- "이번 주로" 버튼: 조회 중인 주가 이번 주가 아닐 때만 노출. 클릭 시 `week` 파라미터 제거(또는 오늘 값으로 설정) → 이번 주로 즉시 복귀.
- 제목: 이번 주 조회 중이면 기존 그대로 "이번 주 강추". 과거 주 조회 중이면 "지난 강추"로 바꾸고 부제의 날짜 범위(`fmtDate(from)~fmtDate(to)`)로 실제 주 구분.
- 빈 상태 문구 일반화: "선택한 주 강추 없음"(기존 "이번 주 강추 없음"에서 변경). 안내 힌트("출마표는 수·목·금 오후에 도착합니다")는 **이번 주 조회 중일 때만** 표시 — 과거 주는 이미 지난 일이라 그 안내가 맞지 않음.
- 페이스 배지·섹션 분류(다가오는/지난 경주) 로직은 무변경 — anchor가 바뀌어도 동일 컴포넌트가 새 데이터로 재렌더링될 뿐.

## 5. 테스트

- `client/src/lib/week.test.ts`에 `addDaysToYmd` 케이스 추가: 같은 달 내 이동, 월말 롤오버(예: 20260128 + 7 = 20260204), 연말 롤오버(예: 20261230 + 7 = 20270106), 음수 이동(이전 주).
- 나머지(URL 파라미터 파싱·화살표 활성/비활성·버튼 노출 조건)는 로직이 짧아 유닛 분리 안 함(YAGNI) — 타입체크 + 브라우저 수동 확인으로 갈음.

## 6. 범위 밖

- 주간 적중률 요약 통계 — 여전히 `/statistics` 몫(2026-07-17 스펙 §6 결정 유지).
- 특정 주를 직접 검색/달력 선택하는 UI — 화살표로 순차 이동만 지원. 필요해지면 후속.
- 서버·DB·모델 변경 없음. `predictions` 테이블 구조·API 변경 없음.

## 7. 참고

- 이번 스펙이 뒤집는 결정: `docs/superpowers/specs/2026-07-17-weekly-picks-design.md` §6 "주 이동(지난 주/다음 주 탐색) UI — 이번 주 고정".
- `weekRange()` 원본 및 KST/UTC 산술 패턴: 같은 파일 §2.
