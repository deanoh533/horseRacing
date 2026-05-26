# 📈 적중률 계산법

> "이 모델이 얼마나 잘 맞히는가"를 측정하는 4개 지표.
> 산식: [scripts/accuracy_stats.ts](../scripts/accuracy_stats.ts)

---

## 1. 측정 대상

`predictions` 테이블의 `actual_ord IS NOT NULL` 행만 카운트 (= 경기 후 결과가 들어온 경주만).

```
predictions를 (race_date, meet, rc_no)로 그룹핑
→ 한 경주 = 한 그룹 (출전마 N마리의 예측 row가 같이 묶임)
→ pred1 = predicted_rank == 1 인 row 한 개
```

---

## 2. 4가지 지표

### ① 단승 (Win)
**예측 1위 = 실제 1위**

```
단승 적중 = pred1.actual_ord == 1
```
가장 엄격. 평균 10마 경주에서 무작위 기대 ≈ 10%.

---

### ② 연승 (Place — 2위 안)
**예측 1위가 실제 1~2위에 들어옴**

```
연승 적중 = pred1.actual_ord ∈ {1, 2}
```

---

### ③ 복승 (Show — 3위 안)
**예측 1위가 실제 1~3위에 들어옴**

```
복승 적중 = pred1.actual_ord ∈ {1, 2, 3}
```
경마 복승식 베팅 정의와 일치.

---

### ④ TOP3 교집합
**예측 TOP3와 실제 TOP3가 얼마나 겹치는가**

```
predTop3 = predicted_rank ≤ 3 인 말들
actTop3  = actual_ord ≤ 3 인 말들
intersection = |predTop3 ∩ actTop3|   # 0~3 (마릿수)

평균 교집합 = Σ intersection / 경주 수
적중률 %   = (평균 교집합 / 3) × 100
```
1마는 우연일 수 있지만 2~3마 겹치면 모델의 변별력 있음을 시사.

---

## 3. 출력 형식

```
적중률 (전체 N 경주 / 유효 M 경주)
  단승  예측1위=실제1위         : a/M = X.X%
  연승  예측1위∈실제1~2위       : b/M = Y.Y%
  복승  예측1위∈실제1~3위       : c/M = Z.Z%

예측 TOP3 ↔ 실제 TOP3 교집합 평균: K.KK마 (3마 중)
  → 평균 적중률: W.W%

참고: 평균 출전마 H.H마, 랜덤 단승 기대 R.R%
```

---

## 4. 실행

```
npx tsx scripts/accuracy_stats.ts
```

→ 콘솔에 위 형식으로 출력. DB 미변경.

---

## 5. 기준 비교 (랜덤 대비)

평균 출전마 `H`마 가정 시 무작위 기대값:

| 지표 | 랜덤 기대 |
|---|---|
| 단승 | 1/H |
| 연승 | 2/H |
| 복승 | 3/H |
| TOP3 교집합 | 3·3/H = 9/H 마 (= 30% if H=10) |

→ 모델이 가치 있으려면 모든 지표가 랜덤 기대를 **유의미하게** 초과해야 함.

---

## 6. 가중치 학습과의 관계

Spearman 학습은 적중률을 **직접** 최대화하지 않습니다.

- Spearman ρ는 *항목별 raw_score 순위 vs 실제 ord 순위*를 비교 → 항목의 "예측력" 측정
- 적중률은 *총합 점수 1위가 실제 어디였는가*를 측정 (집계 결과)
- 가중치를 ρ에 비례해 배분 → 결과적으로 적중률이 따라 오름 (가정)

→ 적중률은 **검증 지표**, Spearman은 **학습 신호**. 둘은 분리.

검증·학습 권장 순서:
```
1. backfill_predictions.ts        # 모든 predictions 재계산
2. accuracy_stats.ts              # 현 상태 적중률 측정 (baseline)
3. learn_weights_once.ts          # 학습 미리보기
4. apply_learned_weights.ts       # 적용
5. accuracy_stats.ts              # 변경 후 적중률 측정
```

---

## 7. 향후 추가하면 좋은 지표 (백로그)

- **Brier score** — 확률 캘리브레이션 (점수가 확률 비례하면)
- **Log loss** — 동일 목적, 다른 형태
- **출전마수별 적중률** — 8마/12마/16마 등 사이즈 효과 분리
- **경마장별 적중률** — 서울/부경 분리
- **등급별 적중률** — 1~6등급별 변별력 차이
