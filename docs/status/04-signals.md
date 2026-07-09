# 신호발굴 — 진행 상황
> 마지막 업데이트: 2026-07-09 · 관련 메모리: [[project_feature_gate_findings]], [[project_training_signals]], [[project_gate_multimetric]], [[project_medical_signals]], [[feedback_no_human_compression]], [[project_race_shape_track]]

## 경주 전개 shape_signal 통제 A/B (2026-07-09) — 판정 미채택, t3 후속 후보 ⏸
probe H1~H9([[project_race_shape_track]])에서 발굴한 전개 피처 2종(`shape_pred_gap`·`shape_p_achieve`, as-of par 편차 기반)을 구현하고 사전 확정 합격선으로 통제 A/B (스펙 `docs/superpowers/specs/2026-07-08-race-shape-features-design.md`).
- **판정 지표 Logistic(t2) 연승**: OFF 58.5% → ON 58.7% = **Δ +0.2%p < 합격선 +0.5%p → 미채택** (분기 4/6 양수는 충족했으나 AND 조건 미달). 게이트B도 자율 판정에서 제외.
- **참고 진단 — top3 라벨 계열 일관 양수**: Logistic(t3) 57.9→59.4 (**+1.5%p**, 분기 5/6 양수) · GBDT(t3) 55.2→57.3 (+2.1%p). 신호의 출처가 연승(3착내) 역학이라 도메인 정합 — 단 판정 지표 사후 변경 금지 원칙에 따라 **후속 검증 후보**로만 기록 (하려면 t3 지표로 새로 사전등록).
- 코드는 자산으로 유지: 피처는 게이트B 자율 제외 + 챔피언 동결이라 **라이브 무영향(휴면)**. 재실험은 `npm run benchmark -- --include shape_signal` / `--exclude shape_signal`.
- 로그: `.superpowers/sdd/ab_off.log`·`ab_on.log` (2026-07-09, cutoff par 20250101).

## 현재 상태
2단계 게이트 방법론: A=`probe:corr`(후보↔기존 |r|>0.5 중복제외) → B=`backtest:box`(holdout 복승박스 ROI, 다분기 표준). 게이트B는 holdout 3지표(연승·fade·복승) 동시 측정.
- **채택: 등급이동 `class_move`** — 다분기 +3.9%p(4/5분기 강건), prize_cond 사전가용 → 라이브 클린.

## 다음 후보·남음
- 🔲 조교 *다른* 조작화 (강도·간격 등 recent_form이 못 담는 각도) — 단 흡수 입증 후라 기대↓
- 🔲 마체중 직전수집 (D1) — `wg_hr` 경기후수집=라이브누수 회피할 사전수집 경로 필요

## 종결·기각 (요약)
- ⏸ 전개 shape_signal 미채택 (2026-07-09) — 통제 A/B t2 Δ+0.2%p 합격선 미달. t3 계열 +1.5~2.1%p 일관 양수 = 후속 후보. 코드 휴면 자산. [[project_race_shape_track]]
- ❌ 조교 train_signal 흡수 확정 (2026-06-19) — 게이트B +1.8%p였으나 통제 A/B(같은 스펙 ON/OFF) Δ−0.12% = 흡수. ⚠️ **승격 판정은 통제 A/B로**(게이트B 한계기여 과대보고 의심). [[project_training_signals]]
- ❌ 의료 신호 기각 (2026-06-15) — 출혈·피로치료 게이트B 한계기여 ~0. [[project_medical_signals]]
- ❌ z-score·구간6·경쟁강도3·장구·기수변경·class_dropped 탈락 (2026-06-10).
- ⏸ 마체중 게이트B +7.2%p 보류 — `wg_hr` 라이브 누수.

## 참고
- 문서: [feature_hypotheses.md](../feature_hypotheses.md) (가설 카탈로그)
