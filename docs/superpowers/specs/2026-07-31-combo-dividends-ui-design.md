# 적중 조합 배당 UI 표시 — 설계

> 작성: 2026-07-31 · 상태: 승인 대기(사용자 리뷰) → writing-plans
> 선행: [[project_combo_dividends]] (combo_dividends 수집·저장 완료, 2026-07-31 라이브)
> 관련: docs/status/06-ui.md, client/src/lib/queries.ts

## 1. 목표 / 범위

`combo_dividends`에 쌓인 조합 확정배당을, **결과가 표시되는 모든 화면**에서
**그 경주 실제 착순으로 적중된 조합의 배당만** 보여준다.

- **대상 화면(4곳):** 경주 상세(RaceDetail)·예상지(PredictionSheet)·출마정보(RaceEntries)·주간 목록(/picks TodayPicks).
- **표시 형태:** "적중 조합 배당" 섹션 — 복승·쌍승·복연승·삼복승·삼쌍승 각 pool의 **적중 조합 payout만**(전체 조합 나열 X — 삼쌍승만 990개라 무의미).
- **저장까지만 하던 상태에서 UI 노출로 확장.** 백테스트/ROI 연결은 여전히 별도(범위 밖).

## 2. 적중 조합 도출 (핵심 로직)

`combo_dividends`는 모든 조합을 담으므로, 실제 착순으로 적중된 것만 골라낸다.
착순→게이트번호는 `race_entries`(ord + pthr_no)에서 온다. pthr_no = chulNo = combo leg.

착순 1·2·3위 게이트 = `g1, g2, g3`:

| pool | 적중 조합 | 매칭 방식 | 줄 수 |
|---|---|---|---|
| 복승식 | {g1,g2} | 집합(정렬 후 비교), leg3=0 | 1 |
| 쌍승식 | (g1→g2) | 순서 그대로 leg1=g1,leg2=g2, leg3=0 | 1 |
| 복연승식 | {g1,g2}·{g1,g3}·{g2,g3} | 집합, leg3=0 | **3** |
| 삼복승식 | {g1,g2,g3} | 집합(3개) | 1 |
| 삼쌍승식 | (g1→g2→g3) | 순서 그대로 | 1 |

- **순서無(복승·복연승·삼복승):** 저장이 raw라 leg를 **집합으로 매칭**(양쪽 정렬 후 비교).
- **순서有(쌍승·삼쌍승):** leg 순서 그대로 매칭.
- **복연승은 3줄**(3착내 2마리 조합이 셋) 모두 표시.
- **odds 단위 = 배**(RaceDetail의 "단승 배당 N배"와 동일 표기). probe 실측(삼쌍승 1070.5 등)이 배당률과 정합.

## 3. 컴포넌트 구조

### 3.1 타입 — `client/src/lib/supabase.ts`
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

### 3.2 훅 — `client/src/lib/queries.ts`
```ts
export function useComboDividends(rcDate: number, meet: number, rcNo: number)
  // combo_dividends에서 (race_date,meet,rc_no) 전체 조회, staleTime 10분, enabled=키 존재
```

### 3.3 순수 헬퍼 — `client/src/lib/combos.ts` (신규)
```ts
export const POOL_LABELS = { '복승식': '복승', '쌍승식': '쌍승', '복연승식': '복연승', '삼복승식': '삼복승', '삼쌍승식': '삼쌍승' };

export interface WinningCombo { pool: string; legs: number[]; odds: number; }

/**
 * 착순 게이트(top1~3) + 조합목록 → pool별 적중 조합 배당.
 * gates: 유효 착순 게이트 배열(길이 2 또는 3, 순서=착순). 부족하면 가능한 pool만 반환.
 * 반환 순서: 복승, 쌍승, 복연승(최대 3), 삼복승, 삼쌍승.
 */
export function winningComboPayouts(combos: ComboDividend[], gates: number[]): WinningCombo[]
```
- 집합매칭 유틸(정렬 후 join 비교), 순서매칭 유틸 내부 사용.
- gates 길이 2면 복승·쌍승만, 3이면 전부.

### 3.4 공용 컴포넌트 — `client/src/components/WinningCombos.tsx` (신규)
```tsx
export function WinningCombos({ rcDate, meet, rcNo, compact }: {
  rcDate: number; meet: number; rcNo: number; compact?: boolean;
})
```
- **자기완결형:** `useComboDividends(rcDate,meet,rcNo)` + 기존 `useHorsesByRace(rcDate,meet,rcNo)`
  (같은 쿼리키 → React Query 캐시 재사용, per-race 화면에선 추가 네트워크 없음).
- horses에서 ord 1·2·3의 pthr_no로 gates 구성(취소·null 제외) → `winningComboPayouts` 호출 → 렌더.
- `compact`: /picks용 축약 변형(라벨·배당만 촘촘히).
- 렌더 분기(§4 엣지케이스).

## 4. 화면 통합 + 엣지케이스

- **RaceDetail / RaceEntries / PredictionSheet:** 결과 영역(말별 결과 아래 경주 단위 위치)에 `<WinningCombos rcDate meet rcNo />` 삽입.
- **/picks (TodayPicks):** 경주별 펼침/상세 영역에 `<WinningCombos ... compact />`. 목록이라 lazy — 펼칠 때만 조회되도록(컴포넌트가 안 보이면 마운트 안 됨). **TodayPicks 실제 구조(펼침 유무)는 구현 시 확인해 자리 맞춤.**
- **엣지케이스:**
  - `ord` 없음(경기 전): 섹션 미표시(null 렌더).
  - 착순 부족(3위 미확정·출주취소로 top3 못 채움): 가능한 pool만(top2면 복승·쌍승). 완전 부족(top2도 없음)이면 미표시.
  - 경기 끝났는데 combo_dividends 행 없음(migration 이전 과거 경주): 미표시(또는 옅은 "조합배당 없음" — compact 아닐 때만).
  - 적중 조합이 combo_dividends에 없음(개별 pool 결손): 그 줄만 생략.

## 5. 테스트

- **`client/src/lib/combos.test.ts`** (vitest, config가 client/src/lib/**/*.test.ts 포함):
  - 복승/쌍승 집합·순서 매칭
  - 복연승 3조합 반환
  - 삼복승 집합 / 삼쌍승 순서
  - gates 길이 2(top2만) → 복승·쌍승만
  - 적중 조합이 목록에 없으면 그 pool 생략
- **컴포넌트:** 경기전(null 렌더)·결과있음(섹션 렌더) 분기 정도만 가볍게(과한 렌더 테스트 지양).

## 6. 범위 컷 (YAGNI)

- 전체 조합 나열·조합 조회기·인기 조합 표 — 안 함(적중 조합만).
- 배당 기반 백테스트/ROI·수익 계산 — 별도(범위 밖).
- 조합 배당 하이라이트(내 예측과 대조 등) — 이번 범위 아님.
- 과거 경주 combo 백필은 별도 작업 — UI는 데이터 있으면 표시, 없으면 미표시로 자연 degrade.

## 7. 확인 필요(구현 중)

- TodayPicks(/picks)에 경주별 펼침 영역이 있는지 → 있으면 그 안, 없으면 컴팩트 인라인 토글 추가. 구현 시 실제 파일 확인.
- odds 소수 표기(예: 1070.5) 그대로 "배" 표기 — 반올림 안 함(원값 유지).
