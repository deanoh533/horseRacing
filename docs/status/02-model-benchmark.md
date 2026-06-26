# 예측모델·벤치마크 — 진행 상황
> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[project_rolling_benchmark_integration]], [[project_market_benchmark]], [[project_speed_figure]], [[project_score_learning_redesign]]

## 현재 상태
활성 모델 **id=6 (v6-class-move, logistic)**. 벤치 연승 62.5% / 단승 30.6% / 시장 68.2%(−5.7%p). `npm run benchmark` = 롤링 확장윈도우 9모델 + 챔피언(model_versions) 대결 + 시장 깊은 진단 통합(walkforward 흡수·삭제, 2026-06-14). 코드 `src/engine/eval/`. 롤백 = 이전 model_version id로 promote.

## 다음 후보·남음
- 🔲 model_versions 스키마 영구화 — `feature_schema`/`params` Supabase 반영 + 챔피언 artifact 저장 (egress 리셋 후)

## 종결·기각 (요약)
- 🔚 walkforward_eval.ts 삭제 (2026-06-14) — benchmark가 롤링·챔피언·시장진단 흡수. [[project_rolling_benchmark_integration]]
- ❌ PL(Plackett-Luce) 모델 폐기 (2026-06-11) — 단·연·복·쌍승 전부 로지스틱이 흡수.
- ❌ ⑳ 속도능력지수 v3 미승격 (2026-06-03) — ρ=0.271, 시장격차 좁혔으나 로지스틱 재설계로 방향전환. [[project_speed_figure]]
- ★ 시장 벤치마크 음성지식 — 모델이 인기1위에 연승 뒤지고 엇갈릴 때 더 틀림. [[project_market_benchmark]]

## 참고
- 스펙: [multi-model-benchmark](../superpowers/specs/2026-06-12-multi-model-benchmark-design.md), [rolling-benchmark-integration](../superpowers/specs/2026-06-14-rolling-benchmark-integration-design.md)
- 문서: [accuracy_metrics.md](../accuracy_metrics.md)
