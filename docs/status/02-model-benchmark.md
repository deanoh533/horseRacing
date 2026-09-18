# 예측모델·벤치마크 — 진행 상황
> 마지막 업데이트: 2026-09-18 · 관련 메모리: [[project_rolling_benchmark_integration]], [[project_market_benchmark]], [[project_race_shape_track]], [[project_score_learning_redesign]]

## 현재 상태
활성 모델 **id=7 (v7-shape, logistic)** — 2026-07-10 승격. 전개 shape_signal 포함, 학습 2022-01~2026-06(82,716행·피처 108). 검증 벤치(2025Q1~2026Q2) 연승 61.9% vs v6 61.6% vs 시장 68.8%(−6.9%p); 미래 예측력 근거는 t3 사전등록 A/B Δ+2.1%p([[project_race_shape_track]]). Platt 임베드 완료(renormWin=false). `npm run benchmark` = 롤링 확장윈도우 9모델 + 챔피언 대결 + 시장 진단, **기간 플래그 지원**(`--from/--to/--first-test/--gate-holdout`, 2026-07-09). 코드 `src/engine/eval/`. 롤백 = `npm run promote -- --version 6`.

v7 **라이브 적중률 추적 시작**(2026-07-11, L-001) — `dailySync`가 predictions을 재계산하지 않고 사전 예측을 보존(`actual_ord`만 결과 UPDATE) + `npm run probe:v7-accuracy`로 강추/주목/전체 판정. 상세: [accuracy_metrics.md §8.6](../accuracy_metrics.md).

> ⚠️ promote의 DATABASE_URL 경로는 미확정 예측 재생성을 생략(egress 차단기 레거시 메시지 출력). 이번 승격은 재생성 대상이 없어 무해 — 다음 승격 때 정리 후보.

> 캘리브레이션(Platt `p_win`/`p_top3`)·선별표시는 **시장엣지 트랙**이 SSOT → [03-market-edge](03-market-edge.md). 랭킹 모델(여기)과는 분리.

**재학습 정책(L-003, 2026-07-12)**: v7 라이브 1개 분기 누적·첫 판정까지 재학습·승격 동결 → 이후 분기 1회 수동 사이클(db:snapshot → extract:matrix → learn:logistic → db:pull --table model_versions → benchmark → promote → calib:fit-live·probe:picks). ⚠️ `learn:candidate`는 레거시 Spearman 경로라 쓰지 말 것 (2026-09-18 정정).

**섀도 실험실(2026-09-18, `feat/shadow-lab`)**: 라이브와 완전 분리된 실험 버전 채점·저장 인프라(`shadow_predictions` + `model_versions.is_shadow`/`train_until`, migration 018 — 2026-09-19 Supabase 적용) + `/lab` 비교 화면 + 학습 방식 실험 도구(`exp:learning`: E0 수렴점검·E1 l2×iters 튜닝·E2 `pl-top3`, 6분기 사전등록 판정) 구현 완료. 현재 등록된 섀도 버전 없음. 스펙: `docs/superpowers/specs/2026-09-18-shadow-lab-design.md`.

## 학습 방식 실험 E0~E2 (2026-09-19) — ❌ 전부 불합격 (학습 방식은 천장이 아님)
사전등록 판정(연승=1순위 3착내, 기준 logistic l2 0.02·800회, 6분기 2025Q1~2026Q2, 합격 = 평균 Δ ≥ +1.0%p AND 과반 분기 양수). 피처 스키마 = v7 108개 고정, 튜닝은 2024Q4 검증 분기만. 7,806경주. 로그 `data/exp_learning_1789724713476.json`.

| 분기 | 기준 | 로지스틱 튜닝 | PL 전체 | PL 상위3 |
|---|---|---|---|---|
| 2025-Q1 | 59.0% | 59.0% | 58.1% | 58.8% |
| 2025-Q2 | 65.9% | 65.9% | 64.3% | 66.1% |
| 2025-Q3 | 57.8% | 57.8% | 57.6% | 59.0% |
| 2025-Q4 | 64.1% | 64.1% | 62.7% | 62.7% |
| 2026-Q1 | 62.3% | 62.3% | 60.3% | 62.5% |
| 2026-Q2 | 60.9% | 60.9% | 60.9% | 62.7% |
| **평균 Δ** | — | 0.00%p (0/6) | −1.01%p (0/6) | +0.29%p (4/6) |

- **E0 수렴:** 손실 800회에서 이미 평탄(0.53308, 3000회까지 불변) → 반복 부족 아님.
- **E1 튜닝:** 검증 분기 최적이 현행값(l2 0.02·800회) 그대로 → 설정값은 이미 최적.
- **E2:** 전체 PL은 일관 열세(끝순위 노이즈 학습 가설 지지, 2026-06-11 결과 재현). 상위3 조건부 로짓은 방향은 양수(4/6)이나 +0.29%p로 합격선·운 범위 안.
- ⚠️ 후보 3개 동시 비교(다중비교 보정 없음). **결론: 남은 여지는 학습 방식이 아니라 새 정보(경주 전 배당 O-005·직전 마체중)** — 피처 흡수 메타패턴과 같은 그림.

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
