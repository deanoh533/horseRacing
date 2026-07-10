# 예측모델·벤치마크 — 진행 상황
> 마지막 업데이트: 2026-07-10 · 관련 메모리: [[project_rolling_benchmark_integration]], [[project_market_benchmark]], [[project_race_shape_track]], [[project_score_learning_redesign]]

## 현재 상태
활성 모델 **id=7 (v7-shape, logistic)** — 2026-07-10 승격. 전개 shape_signal 포함, 학습 2022-01~2026-06(82,716행·피처 108). 검증 벤치(2025Q1~2026Q2) 연승 61.9% vs v6 61.6% vs 시장 68.8%(−6.9%p); 미래 예측력 근거는 t3 사전등록 A/B Δ+2.1%p([[project_race_shape_track]]). Platt 임베드 완료(renormWin=false). `npm run benchmark` = 롤링 확장윈도우 9모델 + 챔피언 대결 + 시장 진단, **기간 플래그 지원**(`--from/--to/--first-test/--gate-holdout`, 2026-07-09). 코드 `src/engine/eval/`. 롤백 = `npm run promote -- --version 6`.

> ⚠️ promote의 DATABASE_URL 경로는 미확정 예측 재생성을 생략(egress 차단기 레거시 메시지 출력). 이번 승격은 재생성 대상이 없어 무해 — 다음 승격 때 정리 후보.

> 캘리브레이션(Platt `p_win`/`p_top3`)·선별표시는 **시장엣지 트랙**이 SSOT → [03-market-edge](03-market-edge.md). 랭킹 모델(여기)과는 분리.

## 다음 후보·남음
- 🔲 model_versions 스키마 영구화 — `feature_schema`/`params` Supabase 반영 + 챔피언 artifact 저장 (egress 리셋 후)

## 종결·기각 (요약)
- 🔚 walkforward_eval.ts 삭제 (2026-06-14) — benchmark가 롤링·챔피언·시장진단 흡수. [[project_rolling_benchmark_integration]]
- ✅ 패리티 버그 수정 (2026-06-11) — scorePredictor 기수·조교사 90일 쿼리가 Supabase 1000행 캡에 걸려 비결정 잘림 → 페이지네이션+안정정렬. `gatherRaceInputs` 배치화로 187경주 224s→61s(3.7×).
- ❌ PL(Plackett-Luce) 모델 폐기 (2026-06-11) — 단·연·복·쌍승 전부 로지스틱이 흡수.
- ❌ ⑳ 속도능력지수 v3 미승격 (2026-06-03) — ρ=0.271, 시장격차 좁혔으나 로지스틱 재설계로 방향전환. [[project_speed_figure]]
- ★ 시장 벤치마크 음성지식 — 모델이 인기1위에 연승 뒤지고 엇갈릴 때 더 틀림. [[project_market_benchmark]]

## 참고
- 서사 정본: [modeling-history](../history/modeling-history.md)
- 스펙(설계 raw: git 이력): multi-model-benchmark(2026-06-12), rolling-benchmark-integration(2026-06-14)
- 문서: [accuracy_metrics.md](../accuracy_metrics.md)
