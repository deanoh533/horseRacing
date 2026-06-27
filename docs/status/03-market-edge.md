# 시장엣지·전략 — 진행 상황
> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[project_market_edge_strategy]], [[project_selective_picks]], [[project_market_dominance_ceiling]], [[project_benter_blend]]

## 현재 상태
공개피처로 승/연승 시장격파 = **종결(천장)**. 두 양성 배포 완료:
- **Platt 라이브 캘리브레이션** — predictions에 `p_win`/`p_top3`(우승·연승 보정확률), UI "우승%·연승%" 표시. 랭킹 파이프라인 불변.
- **선별 표시 (트랙 C)** — `p_top3`로 강추 ≥0.72 / 주목 ≥0.62 라벨 → 뱃지 + `/picks` 뷰 + 통계 "선별 적중률". 실측 강추 연승 73.1%·주목 65.4%(베이스 28.4%). 임계값 단일출처 `client/src/config/selective_picks.json`, 재산출 `npm run probe:picks`.

## 다음 후보·남음
- 🔲 선별 표시 **시각 확인** (`/picks`·뱃지·통계 섹션 — Vercel/로컬)
- 🔲 **B. 조건부 엣지 마이닝** 재탐색 (미착수)
- 🔲 predictions 중복 행 정리(38,518→distinct 24,296) + in-sample 누수 → 운영전환 L-001(prediction_logs 불변 스냅샷)이 근본 차단

## 강추 OOS 재검증 (2026-06-27) — 73% 정직 확인 ✅
`npm run probe:picks:oos` (walk-forward, train<20250101→test, Platt도 train만 적합). **선별 적중률은 누수 부풀림 아님:**
- 강추 연승(ord≤3) **OOS 72.4%** (출하 in-sample 73.1%) · 주목 **OOS 67.8%** (출하 65.4%) · 베이스 28%. → 라이브 기능 검증 정직.
- 한계 적중률(말 1마리 top3)은 누수에 강건. 누수는 *조합 선택*만 오염(아래).

## 강추 조합(복승) ROI (2026-06-27) — 엑조틱도 천장, + 누수 버그 발견
- 복승(2마리 정확히 1·2착) OOS top-2: **ROI −24.4%**(6분기 전부 음수, 평균배당 5.8x). 강추박스는 n=9 무신호. **베팅 ROI 트랙 공개피처로 종결.**
- ⚠️ **predictions 테이블 p_top3 = in-sample 누수**(사후 backfill). in-sample top-2 복승은 +230%(평균배당 22.4x = 결과를 본 모델이 고배당 조합 선점)였으나 OOS로 −24.4%. **베팅 백테스트는 predictions 테이블 금지, walk-forward 필수.** 단·연승 ROI(−10.9%)는 누수가 도와도 적자라 결론 안전.

## 선별 베팅 ROI (2026-06-27) — 단·연승 천장 재확인
`npm run probe:picks:roi` (DuckDB 읽기, 38,518행 전부 배당조인). **단·연승 한 마리 베팅으로 강추는 흑자 X:**
- 강추 **연승** 73.1% 적중인데 평균배당 **1.22배** → **ROI −10.9%** (인기마라 적중↑·배당↓ 상쇄).
- 강추 **단승** 41.2%·2.14배 → −11.9%. 베이스 연승 −24%·단승 −28.4%.
- 선별은 "덜 잃게"는 함(베이스 −24%→강추 −10.9%)이나 흑자선(0%) 못 넘음. **베팅 수준에서도 시장 천장 재확인.**
- 분기별 강추 연승 9분기 중 양수 3·음수 6 = 일관성 없음(흑자 신호 아님).
- ⚠️ 미세 신호: 강추×단승 **중배당(4-7배) +15.2%** 이나 n=31 노이즈 경계(backtest:value가 이미 탐색→천장).
- 정직성: 사후 확정배당 → 낙관적 상한. 선별의 가치 = "돈"이 아닌 "적중·출혈최소·의사결정 보조".

## 종결·기각 (요약)
- ❌ Benter 2단계 음성 종결 (2026-06-17/18) — 방향은 실재하나 크기 0("실재하나 무가치한 엣지"). [[project_market_edge_strategy]]
- ❌ Benter 혼합(복승) 기각 (2026-06-11) — 혼합 ROI −28%. [[project_benter_blend]]
- 🔚 공개피처+win_odds 부가가치 0 (천장, 6분기 강건). [[project_market_dominance_ceiling]]
- ⚠️ KRA 엑조틱 공제율 26% > 단복승 20% → 엑조틱이 더 어려움.

## 참고
- 서사 정본: [modeling-history](../history/modeling-history.md)
- 스펙(설계 raw: git 이력): platt-live-calibration(2026-06-19), selective-picks(2026-06-25)
- 전략: [strategy/2026-06-16](../strategy/2026-06-16-market-edge-and-korean-winning-conditions.md), [strategy/2026-06-17](../strategy/2026-06-17-ceiling-attempts-theoretical-review.md)
