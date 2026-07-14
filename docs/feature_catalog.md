# 피처 카탈로그 — v7 라이브 모델이 먹는 원재료 전체

> 마지막 업데이트: 2026-07-14 (최초 작성)
> 출처: [src/engine/features/buildFeatures.ts](../src/engine/features/buildFeatures.ts) + trainingFeatures.ts + medicalFeatures.ts
> ⚠️ **buildFeatures에 피처를 추가/삭제하면 이 문서도 함께 갱신.**

## 읽기 전에 — 두 층 구조

- **라이브 v7 (로지스틱)**: 아래 raw 피처들을 직접 먹는다. 사람의 점수 환산(1착=100점 등)·임계값·보정 계수 없음 — 좋고 나쁨은 모델이 학습 (2026-06-09 "압축 금지" 원칙).
- **구형 ScoreEngine 21항목** ([src/engine/scoreItems/](../src/engine/scoreItems/)): 수제 점수 맵이 남아있는 레거시 경로. 라이브 순위에 영향 없음. 화면의 항목별 점수 표시는 로지스틱 기여도를 항목으로 묶은 어댑터([logisticScorer.ts](../src/engine/logisticScorer.ts)).
- 결측 처리: 일부 피처는 `이름__missing` 플래그(1=결측)와 쌍. 결측 시 값 0 + 플래그 1로 모델이 "없음"을 구분 학습.
- `*_n` 표본수 피처: 해당 이력의 개수. 모델이 작은 표본을 스스로 할인하도록 재료 제공.

## 능력·클래스

| 피처 | 무엇을 재나 | 산식/기준 |
|---|---|---|
| `rating_abs` | KRA 공식 레이팅 절대값 | `race_entries.ratg` 그대로 (없으면 0) |
| `rating_rel` | 오늘 멤버 중 레이팅 상대 위치 | 1 − (나보다 높은 말 비율). 유효 레이팅 2두 이상일 때만 |
| `field_rating_mean` / `field_rating_max` | 오늘 필드의 난이도 | 출주마 유효 레이팅 평균 / 최고 |
| `rating_minus_field_mean` | 나와 필드 평균의 격차 | 내 레이팅 − 필드 평균 |
| `speed_ability_raw` (+missing) | ⑳ 속도능력지수 — 거리·주로 par 대비 절대 능력 | speedFigure.ts, par-time 편차 기반 |
| `career_finish_ratio` (+missing) | 통산 상대 착순 | 통산 (착순−1)/(출주수−1) 평균 |
| `career_place_rate` (+missing) | 통산 복승권 비율 | 통산 top2 비율 |
| `career_n` | 통산 출주 수 | 표본수 |
| `earnings_asof_log` (+missing) | 경주일 기준(as-of) 수득상금 | log(1+금액). 누수 제거 버전 (API155 기반) |
| `class_move` | 등급 이동 (승급/강급) | 오늘 클래스밴드 − 직전 클래스밴드. 음수=쉬운 상대로 강급. 게이트 채택 2026-06-10 |

## 최근 컨디션·추세

| 피처 | 무엇을 재나 | 산식/기준 |
|---|---|---|
| `recent_ord_mean` | 최근 5전 평균 착순 | ord5 평균 (점수 환산 없이 착순 그대로) |
| `recent_ord_slope` | 착순 추세 방향 | ord5 선형회귀 기울기. 음수=좋아지는 중 |
| `recent_ord_std` | 성적 기복 | ord5 표준편차 |
| `recent_ord_last` | 직전 착순 | ord5 마지막 값 |
| `hist_n` | 최근 이력 수 | ord5 개수 (0~5) |
| `sectional_total_improve` | 같은 거리(+주로) 총 기록 단축 | 과거 평균 기록 − 최근 기록 (초). 클수록 최근이 빠름 |
| `sectional_last_improve` | 막판 1F 기록 단축 | 위와 동일하되 마지막 펄롱 시간 |
| `weight_diff_last` / `weight_diff_slope` / `weight_diff_n` | 마체중 변화 | 최근 변화량(kg) / 변화 추세 기울기 / 표본수 |
| `body_weight` / `body_weight_minus_field_mean` | 마체중 절대값·필드 대비 | 오늘 wg_hr / 필드 평균과의 차 |

## 전개·포지션 (구간 기록)

| 피처 | 무엇을 재나 | 산식/기준 |
|---|---|---|
| `early_pos_s1f_mean` / `early_pos_s1f_ratio_mean` | 초반 200m 위치 습성 | 과거 s1f 통과 순위 평균 / 출주두수 비율(0=선두) |
| `late_pos_g1f_mean` / `late_pos_g1f_ratio_mean` | 결승 200m 전 위치 | g1f 통과 순위 평균 / 비율 |
| `late_200m_speed_mean` | 막판 스퍼트 속도 | 200m ÷ 마지막 200m 시간 (m/s, 거리 무관 물리량) |
| `late_finish_ratio_mean` | 최종 착순 비율 습성 | (착순−1)/(두수−1) 평균 |
| `late_gain_mean` / `early_to_finish_gain_mean` | 추입력 (초반→최종 상승폭) | 비율 버전 / raw 등수 버전 |
| `style_avg_ratio` / `style_stddev` (+missing) | 주행 성향 (앞? 뒤? 들쭉날쭉?) | 초반 위치비율 평균(0=도주) / 표준편차(≥0.35=자유) |
| `x_{front,pace,stalker,closer}_{hot,normal,slow}` (12개) | ⑲ 성향×페이스 교차 one-hot | avg_ratio 구간(≤0.15 도주 / ≤0.35 선행 / ≤0.65 선입 / 그 외 추입) × 오늘 예상 페이스. 맵 점수는 모델이 학습 |
| `shape_pred_gap` | ㉑ 오늘 멤버 중 예상 선두와의 초반 격차 | 이력 G3F 누적시간의 par 대비 편차 평균(meanD3) − 멤버 최솟값 (초). 0=예상 선두 |
| `shape_p_achieve` | ㉑ 그 격차를 종반에 뒤집을 확률 | 필요속도 vs 내 종반 600m 평균·표준편차의 z → 로지스틱 근사. shapeSignals.ts |
| `pace_hot` / `pace_slow` | 오늘 경주 예상 페이스 | paceType one-hot (기본 NORMAL) |

## 조건 적합성

| 피처 | 무엇을 재나 | 산식/기준 |
|---|---|---|
| `dist_finish_ratio` (+missing) | 이 거리 적성 | 같은 거리 과거 착순 비율 평균 |
| `same_dist_n` | 같은 거리 경험 수 | 표본수 |
| `track_improvement` | 이 주로(경마장) 적응 | 전체 평균 착순 − 같은 주로 평균 착순. 클수록 이 주로에서 잘함 |
| `burden_over_avg` | 평소 짊어진 부담중량 대비 | 과거 (내 부담 − 그 경주 평균 부담) 평균 |
| `burden_ord_mean` | 부담 이력에서의 평균 착순 | burdenHistory ord 평균 |
| `age` | 나이 | raw |
| `sex_mare` / `sex_gelding` | 성별 one-hot | 암말 / 거세마 (기준: 수말) |
| `x_young_short` / `x_old_long` | ⑬ 나이×거리 교차 | ≤4세×≤1300m / ≥6세×≥1800m 플래그. 매트릭스는 모델이 학습 |
| `rc_dist` | 오늘 거리 | raw (m) |
| `gate_relative` | 출발 게이트 상대 위치 | (두수−번호)/(두수−1). 1=최내측 |
| `season_top3` / `season_n` | 같은 계절 성적 | 같은 계절 top3 비율 / 표본수 |
| `interval_days` + `interval_b_*` (8버킷) | 휴양 간격 | raw 일수 + 실측 ∩자(정점 28~35일) 반영용 구간 one-hot |

## 사람 (기수·조교사)

| 피처 | 무엇을 재나 | 산식/기준 |
|---|---|---|
| `jockey_career_qu` / `jockey_career_win` | 기수 통산 복승률/단승률 | jkpresult ÷ 100 |
| `jockey_recent_win` / `jockey_recent_n` | 기수 최근 90일 단승률 | 1착 비율 / 표본수 |
| `trainer_top3` / `trainer60_n` | 조교사 60일 top3율 | top3 비율 / 표본수 |
| `trainer_recent_top2` / `trainer_recent_n` | 조교사 90일 top2율 | top2 비율 / 표본수 |
| `chemistry_improvement` / `combo_n` | ⑯ 이 기수와의 궁합 | 말 전체 평균 착순 − 이 콤비 평균 착순 / 콤비 표본수 |

## 시장·혈통·기타

| 피처 | 무엇을 재나 | 산식/기준 |
|---|---|---|
| `recent_pop_top2` | 과거 인기 proxy | 최근 5전 인기 1~2위 비율. **오늘 배당은 의도적 제외** (라이브 조회 불가 + 시장천장 검증 종결) |
| `pedigree_dsa_mean` (+missing) | 혈통 지수 | API284 dsa 5개 지수 평균 |

## 조교 (trainingFeatures.ts) — prep 사이클 윈도우 [직전 경주일, 오늘)

| 피처 | 무엇을 재나 |
|---|---|
| `train_window_is_fallback` | 신마 등 직전 경주 없음 → 90일 윈도우 사용 플래그 |
| `train_has_data` / `train_count` / `train_count_per_week` | 조교 기록 유무 / 횟수 / 주당 횟수 |
| `train_days_since_last` | 마지막 조교 후 경과일 |
| `train_jockey_ridden_ratio` / `train_last_rider_is_jockey` | 기수 기승 조교 비율 / 마지막 조교 기수 기승 여부 (pr_gubun 기준) |
| `train_term_mean` / `train_term_last` / `train_term_slope` | 조교 강도(term) 평균/최근/추세 |
| `train_run_cnt_mean` | 회당 주행 횟수 평균 |
| `train_freq_slope` | 주별 조교 빈도 추세 |

> 참고: 조교 신호는 통제 A/B에서 흡수 판정(2026-06-19) — 피처로는 들어가나 한계기여 ~0.

## 의료 (medicalFeatures.ts) — as-of (경주일 이전 기록만)

| 피처 | 무엇을 재나 |
|---|---|
| `med_bled_asof` / `med_bled_days_since` | 출혈 이력 유무 / 경과일 |
| `med_fatigue_asof` / `med_fatigue_days_since` | 피로회복·수액 처치 유무("피로"·"수액" 텍스트 매칭) / 경과일 |

> 참고: 의료 신호도 한계기여 ~0 판정(2026-06-15) — 각주 수준.

## 의도적으로 안 넣는 것

- **오늘 `win_odds`**: 라이브 시점에 조회 불가 + 피처로 넣어도 부가가치 0 검증(2026-06-11 시장천장).
- **누적 수득상금 원본(`erng_sump`)**: 현재 스냅샷=미래 누수. as-of 버전(`earnings_asof_log`)만 사용.
- ⚠️ **`body_weight` 주의**: 오늘 마체중(wg_hr)은 결과와 함께 도착 → **사전 모드에선 결측(0+missing 없이 0 처리)**. 사후 학습 데이터엔 존재하므로 사전/사후 분포가 다른 회색지대 피처 (2026-06-10 마체중 +7.2%p가 라이브 누수로 보류된 그 논점). 사전 수집 방법 확보 전까지 기여 해석 주의.
