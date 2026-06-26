# 신호발굴 — 진행 상황
> 마지막 업데이트: 2026-06-26 · 관련 메모리: [[project_feature_gate_findings]], [[project_training_signals]], [[project_gate_multimetric]], [[project_medical_signals]], [[feedback_no_human_compression]]

## 현재 상태
2단계 게이트 방법론: A=`probe:corr`(후보↔기존 |r|>0.5 중복제외) → B=`backtest:box`(holdout 복승박스 ROI, 다분기 표준). 게이트B는 holdout 3지표(연승·fade·복승) 동시 측정.
- **채택: 등급이동 `class_move`** — 다분기 +3.9%p(4/5분기 강건), prize_cond 사전가용 → 라이브 클린.

## 다음 후보·남음
- 🔲 조교 *다른* 조작화 (강도·간격 등 recent_form이 못 담는 각도) — 단 흡수 입증 후라 기대↓
- 🔲 마체중 직전수집 (D1) — `wg_hr` 경기후수집=라이브누수 회피할 사전수집 경로 필요

## 종결·기각 (요약)
- ❌ 조교 train_signal 흡수 확정 (2026-06-19) — 게이트B +1.8%p였으나 통제 A/B(같은 스펙 ON/OFF) Δ−0.12% = 흡수. ⚠️ **승격 판정은 통제 A/B로**(게이트B 한계기여 과대보고 의심). [[project_training_signals]]
- ❌ 의료 신호 기각 (2026-06-15) — 출혈·피로치료 게이트B 한계기여 ~0. [[project_medical_signals]]
- ❌ z-score·구간6·경쟁강도3·장구·기수변경·class_dropped 탈락 (2026-06-10).
- ⏸ 마체중 게이트B +7.2%p 보류 — `wg_hr` 라이브 누수.

## 참고
- 문서: [feature_hypotheses.md](../feature_hypotheses.md) (가설 카탈로그)
