# 모델링·측정 변천사 — 적중률 향상 여정
> 마지막 업데이트: 2026-06-26 · 측정 정본: [accuracy_metrics](../accuracy_metrics.md) · 지표 정본: [score_roadmap](../score_roadmap.md) · 지금 상태: [docs/status](status/)
> 이 문서 = *왜 이 방법들을 거쳐 지금 모델에 왔나*의 서사와 교훈. 상세 수치는 정본 링크, 트랙 현재상태는 docs/status.

## 1. 점수 학습 방식의 변천
- **Spearman 가중치 (v1)** — 항목별 ρ로 가중치 학습. 초기 실측(2026-05): 정직 베이스라인 단승 23.8% → ⑧ 부담중량 재설계 +1.4%p → ⑱ 수득상금 신규 +2.3%p → blend 0.5 학습 +0.8%p = **단승 28.3%**(랜덤 ~9%의 3배). 이후 look-ahead 누수 수정으로 옛 적중률 거품 판명(2026-06-02, 정직 복승 ~58%; earnings ~3.8%p 누수는 2026-06-06 종결). 상세 ρ표는 git 이력(구 `results_log.md`). [[project_weight_versioning]] · [[reference_earnings_asof_leak]]
- **수득상금 차원 종결 (2026-06-06)** — 재설계 "+5.2%p" 중 대부분(~3.8%p)이 earnings 미래누수, 잔여 +1.4%p만 실제 개선. as-of earnings 자체 예측력은 미검증. [[reference_earnings_asof_leak]]
- **로지스틱 전체동시학습 (재설계)** — 항목별 ρ→P(top3) 동시 학습. PL·GBM 챔피언전서 **로지스틱 확정, PL/GBM 폐기**. [[project_score_learning_redesign]]
- **⑳ 속도능력지수 (2026-06-03)** — par-time 절대지수, ρ=0.271. v3 후보였으나 미승격. [[project_speed_figure]]
- **class_move 채택 (2026-06-11)** — 등급이동, 다분기 강건(+3.9%p), 라이브 클린. [[project_feature_gate_findings]]
- **Platt 캘리브레이션 (2026-06-20)** — 첫 서비스 캘리브레이션. p_win/p_top3, 랭킹 불변. [[project_market_edge_strategy]]

## 2. 측정·검증 방식의 변천
- 적중률 4지표(단·연·복·TOP3) → **시장 벤치마크 발견**(2026-06-03): 모델이 인기1위에 뒤지고 엇갈릴 때 더 틀림. [[project_market_benchmark]]
- **2단계 게이트 (2026-06-10)**: A=probe:corr(중복제외) → B=backtest:box(holdout ROI). 이후 **3면화**(연승·fade·복승, 2026-06-15). [[feedback_no_human_compression]] · [[project_gate_multimetric]]
- **walkforward → 롤링 벤치마크 통합 (2026-06-14)**: benchmark가 흡수·walkforward 삭제. [[project_rolling_benchmark_integration]]
- **통제 A/B (2026-06-19)**: 같은 스펙 ON/OFF 토글이 승격 판정의 정답. 게이트B 한계기여는 과대보고일 수 있음.

## 3. 신호 발굴 — 채택/기각 대장
> 아래는 서사용 압축 요약. **전체 카탈로그(재도전·현역재검·재제안 금지·메타패턴) SSOT = [feature_hypotheses](../feature_hypotheses.md)** — 새 가설 등록·상세 사유는 거기에.

| 신호 | 결과 | 근거 |
|---|---|---|
| 등급이동 class_move | ✅ 채택 | 다분기 +3.9%p, 라이브 클린 |
| 조교 train_signal | ❌ 흡수 | 통제 A/B Δ−0.12% [[project_training_signals]] |
| 의료(출혈·피로) | ❌ 기각 | 게이트B 한계기여 ~0 [[project_medical_signals]] |
| 마체중 | ⏸ 보류 | wg_hr 라이브 누수 |
| z·구간6·경쟁강도·장구·기수 | ❌ 탈락 | 다분기 노이즈 |
| Benter 2단계 | ❌ 음성 | 실재하나 무가치(크기 0) [[project_benter_blend]] |

## 4. 메타 교훈 (천장의 구조)
- **시장 천장**: 공개피처로는 승/연승 시장 못 이김(−7~8%p), win_odds를 피처로 넣어도 부가가치 0. [[project_market_dominance_ceiling]]
- **흡수 패턴**: 실측 신호 ≠ 모델 가치. 단변량 양성도 기존 피처에 흡수되면 한계기여 0.
- **게이트B 과대보고 → 통제 A/B로 판정.**
- **"실재하나 무가치한 엣지"**: 방향은 맞아도 크기가 0이면 돌파 아님.
- **공제율**: 엑조틱 26% > 단복승 20% → 엑조틱이 더 어려움.
- 전략 상세: [strategy/2026-06-16](../strategy/2026-06-16-market-edge-and-korean-winning-conditions.md) · [strategy/2026-06-17](../strategy/2026-06-17-ceiling-attempts-theoretical-review.md)
