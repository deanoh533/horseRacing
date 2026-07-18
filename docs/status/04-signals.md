# 신호발굴 — 진행 상황
> 마지막 업데이트: 2026-07-15 · 관련 메모리: [[project_feature_gate_findings]], [[project_training_signals]], [[project_gate_multimetric]], [[project_medical_signals]], [[feedback_no_human_compression]], [[project_race_shape_track]]

## 페이스 조건부 성적 (pace_fit·pace_sens·pace_fit_n) — ❌ 기각 (2026-07-15)
환경(예상 페이스)이 변할 때 말의 과거 전적을 페이스 버킷별로 직접 쪼갠 조작화(⑲ 성향×페이스 간접추정과 다른 각도). 스펙 [2026-07-15](../superpowers/specs/2026-07-15-pace-conditional-form-design.md).
- 게이트A는 진단 전용(판정 없음): pace_fit 최대 |r|=0.227(vs pace_hot), pace_sens 최대 |r|=0.226(vs recent_ord_std) — 중복 경고 없음.
- **게이트B = 통제 A/B(사전등록 유일 판정)**: 같은 스펙(v7-shape 챔피언, 2024-01~ 학습, 2025Q1~2026Q2 6분기 롤링), `--exclude pace_form` vs `--include pace_form` 외 완전 동일.
- 판정 지표 Logistic(t3) 연승(분기별, ON−OFF):

  | 분기 | OFF | ON | Δ |
  |---|---|---|---|
  | 2025-Q1 | 52.5% | 52.8% | +0.3%p |
  | 2025-Q2 | 58.8% | 61.0% | +2.2%p |
  | 2025-Q3 | 54.8% | 55.5% | +0.7%p |
  | 2025-Q4 | 58.6% | 58.2% | −0.4%p |
  | 2026-Q1 | 58.8% | 58.5% | −0.3%p |
  | 2026-Q2 | 60.0% | 60.9% | +0.9%p |
  | 전체 | 57.2% | 57.8% | +0.6%p |

- **평균 Δ = +0.57%p(6분기 단순평균) < 사전등록 합격선 +1.0%p → 기각.** 양수 분기는 4/6(과반 조건은 충족)이나 AND 조건의 평균 기준 미달.
- 참고: 사전등록 시점엔 "5분기"를 가정했으나 실행 시점(2026-07-15) 기준 기본 롤링 윈도우가 6분기(2025Q1~2026Q2)로 산출됨 — 판정 규칙은 그대로 적용(변경 없음).
- 해석: 환경 조건부 실전 성적 자체는 신호가 있으나(2/6분기 제외 대체로 양수 방향), 표본 분할로 인한 노이즈가 커 문턱을 못 넘김. shape_d6_best와 마찬가지로 raw 후보 각도이지 흡수 확정은 아님 — 재조작화(예: 버킷 2개로 축소, shrinkage k 재조정) 여지는 있으나 우선순위 낮음.
- 코드 정리: `buildFeatures.ts`의 pace_fit/pace_sens/pace_fit_n 노출 라인(add 3줄+missingFlag 2줄) 제거, `buildFeatures.test.ts` 해당 케이스 제거. **`paceForm.ts`·`pacePar.ts`·`asOfHorseStats` 집계는 유지**(다음 조작화 재사용, 재학습 오염 없음).
- 로그: `.superpowers/sdd/pace_off.log`·`pace_on.log`.

## shape_d6_best (종반 600m 역대 최고) — ❌ 기각 (2026-07-14)
7/10 부경 6R 분석에서 발굴한 후보(우승마 투혼파이터: 종반 평균은 들쭉날쭉하나 피크는 필드 1위 — 평균에 묻히는 "한 방" 능력 가설).
- 구현: `horseShapeStats.bestD6`(par 대비 d6 최솟값) → `shape_d6_best` 피처. 행렬 46,203행 재추출.
- 게이트A: 기존 최대 |r|=0.719 (rating_abs·speed_ability_raw) — 능력 지표와 강한 중복 경고.
- **게이트B: 연승 60.8→60.6% (Δ−0.2%p), 분기 1/5 양수 → 기각.** 피크 능력 정보는 레이팅·속도지수가 이미 담고 있음 확인.
- 코드는 raw 후보로 잔류(기각 전례와 동일 — 라이브 모델 스키마 밖이라 무영향).

## 경주 전개 shape_signal t3 사전등록 판정 (2026-07-09) — ✅ 채택
t2 미채택 후 사전등록한 t3 후속 검증(스펙 `docs/superpowers/specs/2026-07-09-race-shape-t3-prereg.md`)이 **무오염 신선 구간(2024H2)에서 합격**.
- 구성: 학습 2022-01~(백필 +4,110경주, G3F 커버리지 100% 검증), 시험 2024Q3·Q4(874경주), par cutoff 20240701, 게이트B holdout 2024Q2.
- **판정 Logistic(t3) 연승: OFF 58.2% → ON 60.3% = Δ +2.1%p ≥ +0.5%p ✓, 2분기 모두 양수(+1.7/+2.4) ✓ → 채택.**
- 참고 진단 전 모델 방향 일치: GBDT(t3) +5.6%p · Logistic(t2) +1.1%p · PL +0.6%p. 흥미: 학습구간이 2022~로 길어지자 t2도 양수(+1.1%p — t2 판정 때 학습 2024만으로는 +0.2%p).
- 인프라: benchmark `--from/--to/--first-test/--gate-holdout` 파라미터화(무플래그=기존 동작 불변).
- 로그: `.superpowers/sdd/t3_off.log`·`t3_on.log`.
- **라이브 반영 완료 (2026-07-10)**: v7-shape(id=7, 학습행렬 2022~ 82,716행·피처 108) 학습 → 검증 벤치 v7 61.9% vs v6 61.6%(시험분기 포함 in-sample이라 격차 눌림, 새너티 통과) → **promote 활성 전환** → Platt 재적합(renormWin=false, platt3 a=1.057·b=0.047 거의 항등) → probe:picks 임계(0.72/0.62) 유효 재확인(0.75↑ 74.6%·0.70↑ 68.5%). 미확정 예측 재생성은 대상 없음(주말 출마표 미동기화·6/27-28은 정직한 v6 사전기록 보존). 상세는 [02-model-benchmark](02-model-benchmark.md).

## 경주 전개 shape_signal 통제 A/B (2026-07-09) — 판정 미채택(t2), t3로 후속 → 상단 채택 ⏸
probe H1~H9([[project_race_shape_track]])에서 발굴한 전개 피처 2종(`shape_pred_gap`·`shape_p_achieve`, as-of par 편차 기반)을 구현하고 사전 확정 합격선으로 통제 A/B (스펙 `docs/superpowers/specs/2026-07-08-race-shape-features-design.md`).
- **판정 지표 Logistic(t2) 연승**: OFF 58.5% → ON 58.7% = **Δ +0.2%p < 합격선 +0.5%p → 미채택** (분기 4/6 양수는 충족했으나 AND 조건 미달). 게이트B도 자율 판정에서 제외.
- **참고 진단 — top3 라벨 계열 일관 양수**: Logistic(t3) 57.9→59.4 (**+1.5%p**, 분기 5/6 양수) · GBDT(t3) 55.2→57.3 (+2.1%p). 신호의 출처가 연승(3착내) 역학이라 도메인 정합 — 단 판정 지표 사후 변경 금지 원칙에 따라 **후속 검증 후보**로만 기록 (하려면 t3 지표로 새로 사전등록).
- 코드는 자산으로 유지: 피처는 게이트B 자율 제외 + 챔피언 동결이라 **라이브 무영향(휴면)**. 재실험은 `npm run benchmark -- --include shape_signal` / `--exclude shape_signal`.
- 로그: `.superpowers/sdd/ab_off.log`·`ab_on.log` (2026-07-09, cutoff par 20250101).

## 현재 상태
2단계 게이트 방법론: A=`probe:corr`(후보↔기존 |r|>0.5 중복제외) → B=`backtest:box`(holdout 복승박스 ROI, 다분기 표준). 게이트B는 holdout 3지표(연승·fade·복승) 동시 측정.
- **채택: 등급이동 `class_move`** — 다분기 +3.9%p(4/5분기 강건), prize_cond 사전가용 → 라이브 클린.
- **채택: 전개 `shape_signal`** — t3 사전등록 판정 통과(2024H2 신선 구간 Δ+2.1%p, 위 섹션). 라이브 반영은 promote 사이클 대기.

## 다음 후보·남음
- 🔲 조교 *다른* 조작화 (강도·간격 등 recent_form이 못 담는 각도) — 단 흡수 입증 후라 기대↓
- 🔲 마체중 직전수집 (D1) — `wg_hr` 경기후수집=라이브누수 회피할 사전수집 경로 필요
- 🔲 전개 트랙 잔여 후보 (스펙 §7 범위 밖, [2026-07-08 스펙](../superpowers/specs/2026-07-08-race-shape-features-design.md)):
  - 초반 위치그룹(선두권/추격권/후미권) 피처 — H1·H2 실측이 "격차가 위치를 대체"라 해서 밀림, 흡수 가능성 높아 기대↓
  - 페이스 모델(출마표 도주마 수 → 접전 예측) = TODO F-001. 경주 단위 컨텍스트 — shape 역전능력과 상호작용 잠재력
  - 사후 리뷰 도구(F-005) — 모델 무변경(UI/도구), 재학습 동결 기간에 적합 → [06-ui](06-ui.md)

## 종결·기각 (요약)
- ❌ 페이스 조건부 성적 pace_form 기각 (2026-07-15) — 통제 A/B Logistic(t3) 연승 Δ+0.57%p<+1.0%p, 4/6분기 양수(과반은 충족·평균 미달). buildFeatures 노출 제거, 집계 인프라(paceForm.ts·pacePar.ts)는 유지 (상단 섹션).
- ✅ 전개 shape_signal t2 미채택 → t3 사전등록 재검증 **채택** (2026-07-09) — t2 Δ+0.2%p 미달이었으나 2024H2 신선 구간 t3 판정 Δ+2.1%p 합격. [[project_race_shape_track]]
- ❌ 조교 train_signal 흡수 확정 (2026-06-19) — 게이트B +1.8%p였으나 통제 A/B(같은 스펙 ON/OFF) Δ−0.12% = 흡수. ⚠️ **승격 판정은 통제 A/B로**(게이트B 한계기여 과대보고 의심). [[project_training_signals]]
- ❌ 의료 신호 기각 (2026-06-15) — 출혈·피로치료 게이트B 한계기여 ~0. [[project_medical_signals]]
- ❌ shape_d6_best 기각 (2026-07-14) — 종반 피크 능력, 게이트B Δ−0.2%p·1/5분기. 레이팅·속도지수에 흡수 (상단 섹션).
- ❌ z-score·구간6·경쟁강도3·장구·기수변경·class_dropped 탈락 (2026-06-10).
- ⏸ 마체중 게이트B +7.2%p 보류 — `wg_hr` 라이브 누수.

## 참고
- 문서: [feature_hypotheses.md](../feature_hypotheses.md) (가설 카탈로그)
