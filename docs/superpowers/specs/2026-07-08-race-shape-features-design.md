# 경주 전개(race shape) 피처 2종 — 설계 스펙

> 2026-07-08 · 상태: 사용자 승인
> 근거 probe: `npm run probe:shape` (H1~H9, 커밋 dca0317~a5307d7) · 트랙 문서: docs/status/04-signals.md

## 1. 배경·목표

시장격파 종결 후 "공개데이터 활용 재검증" 트랙의 첫 산출물. probe 실측으로 확인된 사전(pre-race) 신호를 기존 로지스틱 모델의 피처로 추가하고, 통제 A/B로 채택 판정한다.

- **H7 (실측 격차)**: G3F(결승 600m 전) 격차 × 필요속도 달성확률 교차표가 승률을 코너 간 8배 가름.
- **H9 (전부 as-of 재현)**: 모든 재료를 경주 전 값으로만 계산해도 12칸 전부 양방향 단조 유지, 행 내 분리 1.9~2.7배, 코너 간 승률 4.8배(17.8% vs 3.7%).
- **관문**: 기존 피처(late_200m_speed_mean 등 종반속도 평균 성분)에 흡수될 위험. 채택은 통제 A/B로만 판정(조교 신호 교훈: 게이트B 한계기여 +1.8%p도 통제 A/B에선 0이었음).

## 2. 피처 정의 (핵심 2종, id: `shape_signal`)

### 2.1 재료 — 말별 as-of 전개 통계

과거 각 경주 i (그 말의 **전체 이력**, 오늘 이전만):

```
fin600_i = rc_time_i − g3f_acc_i          # 종반 600m 시간, 유효범위 30~60초
d3_i = g3f_acc_i − par3(meet_i, dist_i)   # G3F 누적시간의 거리표준 대비 편차
d6_i = fin600_i − par6(meet_i, dist_i)    # 종반 600m의 거리표준 대비 편차
```

말별 통계 (유효 G3F 이력 경주 수 = n):
- `mean_d3`, `mean_d6` — n ≥ 2 필요 (예측 선두의 `mean_d6`도 이 기준이면 사용 가능)
- `std_d6` — n ≥ 3 필요, 하한 0.1초 클램프(측정 노이즈 미만 편차의 z 폭발 방지)

이력 범위는 전체(최근 5회 아님) — H8d 실측: 전체평균이 최근3회·직전1회보다 정확(오차 MAE 0.78 vs 0.81 vs 0.93초). G3F 페이스는 폼이 아닌 습관.

### 2.2 오늘 경주에서의 피처 계산 (경주 단위)

출주마 중 `mean_d3` 보유(n≥2) 말들을 대상으로:

```
예측 선두 L = argmin(mean_d3)
shape_pred_gap_h = mean_d3_h − mean_d3_L          # 예측 선두는 0
필요기록_h = mean_d6_L − shape_pred_gap_h
z_h = (필요기록_h − mean_d6_h) / max(std_d6_h, 0.1)
shape_p_achieve_h = 1 / (1 + exp(−1.702 · z_h))   # 로지스틱 근사 Φ(z)
```

- **오늘 경주의 par는 두 피처에서 수학적으로 상쇄**(같은 경주 내 차이라서) → par 조회는 과거 경주 환산(d3, d6)에만 필요.
- 예측 선두 본인: pred_gap = 0, z = 0 → p_achieve = 0.5 (산식 일관 원칙, 예외 분기 없음).
- `shape_p_achieve`는 절대 확률이 아니라 순위 재료(H6a: 예측 97% 구간 실제 승률 13% — "선두를 잡을 속도" ≠ "우승"). 보정은 모델 학습이 담당.

### 2.3 결측 규칙

| 조건 | 처리 |
|---|---|
| 말의 유효 G3F 이력 < 2회 | 두 피처 모두 미추가 (기존 `__missing` 관례가 처리) |
| 2회 (std 불가) | `shape_pred_gap`만 추가, `shape_p_achieve` 미추가 |
| 경주에 mean_d3 보유 말 < 2마리 | 그 경주 전원 두 피처 미추가 (격차 정의 불가) |
| 제주(meet 2) 등 구간기록 없는 이력 | 해당 경주만 제외(자연 결측) |

## 3. par 산출 (누수 차단)

par(meet × rc_dist) = 해당 조합의 `g3f_acc` 중앙값(par3), `fin600` 중앙값(par6).

- **벤치마크/A/B**: walk-forward 각 회차의 **학습구간 데이터만으로** 계산 — 미래 정보 0. 순수 함수 `buildParTable(rows) → ParTable`로 구현해 학습 파이프라인에서 호출.
- **라이브**: `npm run build:par` 스크립트가 DuckDB 로컬 미러 전체 과거로 `data/par_times.json` 생성 → 예측 시 로드. 라이브 시점엔 미래가 없으므로 자동 정직. 재생성 주기는 출마표 동기화 시(수·목·금).
- probe(H8d~H9)의 in-sample par와 달라지므로 A/B 결과가 probe 수치와 다를 수 있음 — 정상.

## 4. 구현 구조 (구현 위치: 예측 엔진 내부 — 사전/사후 동일 산식)

1. **데이터 플럼빙**: 말 이력 조회(scorePredictor 배치)에 `se_g3f_acc_time`/`bu_g3f_acc_time` 컬럼 추가. G3F 누적 = meet 1이면 se_, 3이면 bu_ (기존 calcLastFurlong 패턴).
2. **경주 단위 사전패스**: `scorePredictor`에 allRaceRatings와 같은 방식의 race-level 패스 추가 — 출주마 전원의 shape 통계(mean_d3/mean_d6/std_d6) 계산 → 예측 선두 결정 → 말별 `shapePredGap`/`shapePAchieve`를 `ScoreEngineInput`에 주입. par 테이블은 이 층에 주입(벤치마크=학습구간 산출물, 라이브=JSON).
3. **buildFeatures**: 주입값을 그대로 `add('shape_pred_gap', …)`, `add('shape_p_achieve', …)` (계산 없음 — raw 공급 원칙).
4. **featureItemMap**: `base.startsWith('shape_') → 'shape_signal'` (train_signal 선례) — 게이트 ablation 자동 대상.

## 5. 판정 (사전 확정 — 결과 보고 변경 금지)

- **방법**: 같은 벤치마크 스펙에서 `shape_signal` ON/OFF 통제 A/B. 지표 = 챔피언 모델 1순위 연승(3착내) 적중률 Δ.
- **합격선**: **Δ ≥ +0.5%p 그리고 분기별 Δ 과반 양수 → 채택.** 미달 → 기각/보류.
- 결과는 채택/기각 무관하게 docs/status/04-signals.md + docs/history/modeling-history.md에 기록.
- 참고 진단(판정엔 미사용): 게이트 3면(연승·fade·복승), 로지스틱 계수(흡수 여부 해석).

## 6. 테스트 (TDD — 테스트 먼저)

- **단위 (산식)**: 알려진 이력 → 기대 mean_d3/pred_gap/z/p_achieve 값. par 상쇄 성질(오늘 par를 바꿔도 두 피처 불변). std 하한. 예측 선두 0/0.5. 결측 규칙 4케이스.
- **단위 (par)**: buildParTable — 학습구간 행만 반영, meet×dist 중앙값.
- **통합**: benchmark 1회 실행 → 두 피처가 매트릭스에 등장하고 `shape_signal`로 집계.
- **회귀**: 기존 전체 테스트(318+) 통과, `npm run build` 타입체크 통과.

## 7. 범위 밖 (이번 사이클에서 하지 않음)

- 예측 초반그룹(선두권/추격권/후미권) 피처, 페이스 모델(출마표의 도주마 수)
- UI 노출, 사후 리뷰 도구(길 B), H7 교차표 서비스화
- 채택 시의 promote/버전 승격 절차 (A/B 통과 후 별도 진행)

## 8. 참고

- probe 산식·수치: `scripts/probe_race_shape.ts` (H6·H9 산식이 본 스펙의 원형)
- 선례: 조교 신호 통제 A/B(기각), class_move(채택), train_signal/med_* 피처 id 패턴
- 메모리: project_race_shape_track / 관련 상태: docs/status/04-signals.md
