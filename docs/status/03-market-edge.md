# 시장엣지·전략 — 진행 상황
> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[project_market_edge_strategy]], [[project_selective_picks]], [[project_market_dominance_ceiling]], [[project_benter_blend]]

## 현재 상태
공개피처로 승/연승 시장격파 = **종결(천장)**. 두 양성 배포 완료:
- **Platt 라이브 캘리브레이션** — predictions에 `p_win`/`p_top3`(우승·연승 보정확률), UI "우승%·연승%" 표시. 랭킹 파이프라인 불변.
- **선별 표시 (트랙 C)** — `p_top3`로 강추 ≥0.72 / 주목 ≥0.62 라벨 → 뱃지 + `/picks` 뷰 + 통계 "선별 적중률". 실측 강추 연승 73.1%·주목 65.4%(베이스 28.4%). 임계값 단일출처 `client/src/config/selective_picks.json`, 재산출 `npm run probe:picks`.

## 다음 후보·남음
- 🔲 선별 표시 **시각 확인** (`/picks`·뱃지·통계 섹션 — Vercel/로컬)
- 🔲 **B. 조건부 엣지 마이닝** 재탐색 (미착수)
- 🔲 선별 트랙 고도화 — 선별 베팅 ROI·엑조틱

## 종결·기각 (요약)
- ❌ Benter 2단계 음성 종결 (2026-06-17/18) — 방향은 실재하나 크기 0("실재하나 무가치한 엣지"). [[project_market_edge_strategy]]
- ❌ Benter 혼합(복승) 기각 (2026-06-11) — 혼합 ROI −28%. [[project_benter_blend]]
- 🔚 공개피처+win_odds 부가가치 0 (천장, 6분기 강건). [[project_market_dominance_ceiling]]
- ⚠️ KRA 엑조틱 공제율 26% > 단복승 20% → 엑조틱이 더 어려움.

## 참고
- 서사 정본: [modeling-history](../history/modeling-history.md)
- 스펙(설계 raw: git 이력): platt-live-calibration(2026-06-19), selective-picks(2026-06-25)
- 전략: [strategy/2026-06-16](../strategy/2026-06-16-market-edge-and-korean-winning-conditions.md), [strategy/2026-06-17](../strategy/2026-06-17-ceiling-attempts-theoretical-review.md)
