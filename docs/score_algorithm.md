# 🎯 18 판단항목 알고리즘 정의

> 이 문서는 종합점수를 만드는 **18개 항목 각각의 알고리즘 정의**와
> **알고리즘을 수정하는 방법**을 정리합니다. 알고리즘은 계속 개선됩니다.

---

## 1. 종합점수가 만들어지는 흐름

```
입력 (race_entries + 과거이력)
   ↓
buildEngineInput()      ← scorePredictor.ts:107
   ↓
ScoreEngine.calculateScores(input)
   ↓
18개 항목 함수가 각각 raw 점수 [0, 1] 반환
   ↓
weightedScore = raw × ITEM_WEIGHTS[id]
   ↓
total = Σ weightedScore  → 0 ~ 100점
```

핵심 파일:
- 가중치 정의: [src/types/index.ts](../src/types/index.ts) `ITEM_WEIGHTS`
- 엔진: [src/engine/index.ts](../src/engine/index.ts)
- 입력 준비: [src/engine/scorePredictor.ts](../src/engine/scorePredictor.ts)
- 항목 알고리즘: [src/engine/scoreItems/01_rating.ts](../src/engine/scoreItems/01_rating.ts) ~ `18_earnings.ts`

---

## 2. 18 항목 개요

| # | ID | 항목 | 비중 | 상태 | 핵심 입력 |
|---|---|---|---|---|---|
| ① | `01_rating` | 레이팅 | 17.54 | 구현 | `ratg` |
| ② | `02_weight_change` | 마체중 변화 | 4.21 | 구현 | 과거 `wg_hr_diff[]`, `gndr`, 월 |
| ③ | `03_recent_form` | 착순 추세 | 4.21 | 구현 | 과거 5경주 `ord[]` |
| ④ | `04_sectional_time` | 구간 시간 단축 | 2.37 | 구현 | 과거 `rcTime`, lastFurlong ⚠️ |
| ⑤ | `05_late_position` | 후반 구간 순위 | 2.37 | 구현 | startOrd, finishOrd ⚠️ |
| ⑥ | `06_distance_fitness` | 거리 적성 | 8.77 | 구현 | 같은 거리 `ord[]` |
| ⑦ | `07_track_adaptation` | 주로 적응 | 8.77 | 구현 | 전체 `ord[]`, 같은 주로 `ord[]` |
| ⑧ | `08_burden_weight` | 부담중량 | 4.39 | **전문가 대기** | 과거 부담중량 + 경주 평균 |
| ⑨ | `09_jockey_form` | 기수 폼 | 10.53 | 구현 | 기수 30일 `ord[]` |
| ⑩ | `10_trainer_form` | 조교사 폼 | 7.02 | 구현 | 조교사 60일 `ord[]` |
| ⑪ | `11_race_interval` | 경주 간격 | 3.51 | 구현 | 직전 경주와의 days |
| ⑫ | `12_starting_position` | 출발번호 | 2.63 | 구현 | `pthr_no`, 총 두수, 거리 |
| ⑬ | `13_age_distance_gender` | 나이×거리×성 | 2.63 | **전문가 대기** | `ag`, `gndr`, `rc_dist` |
| ⑭ | `14_pedigree` | 혈통 | 4.39 | **전문가 대기** | API284 dsa* 지수 |
| ⑮ | `15_seasonal_pattern` | 계절 패턴 | 4.39 | 구현 | 같은 계절 과거 `ord[]` |
| ⑯ | `16_jockey_horse_chemistry` | 기수-말 궁합 | 3.51 | 구현 | 말 전체 + 조합 `ord[]` |
| ⑰ | `17_market_odds` | 배당률(인기도) | 8.77 | 구현 | 과거 5경주 인기 순위 |
| ⑱ | `18_earnings` | 수득상금 | 8.77 | 구현 | `erng_sump` |

**비중 합계 = 100.00**, ITEM_WEIGHTS는 학습으로 매번 갱신됨.

⚠️ ④⑤는 입력값이 현재 미연결 — [troubleshooting.md](troubleshooting.md) 참고.

---

## 3. 항목별 알고리즘 (정식 구현 15개)

### ① 레이팅 (`01_rating`)

```
score = min(1.0, rating / 140)
rating = 0 → 0 (6등급 미부여)
```
이론적 최대 140 기준.

---

### ② 마체중 변화 (`02_weight_change`)

```
baseScore = |latest| ≤ 2 → 1.0
          | ≤ 5 → 0.8
          | ≤ 9 → 0.4
          | else → 0.1

trendBonus = ±0.15 (연속 같은 방향 변화)
seasonalBonus = +0.1 (암말 봄/수말·거세마 여름 자연 감소)
```

---

### ③ 착순 추세 (`03_recent_form`)

가중평균 + 기세 + 안정성 보너스.
```
ORD_SCORE = {1:100, 2:80, 3:60, 4:40, 5:20, 6+:0}
WEIGHTS   = [0.1, 0.1, 0.15, 0.25, 0.4]    # 과거 → 최신

weightedAvg = Σ(score × weight) / Σweight
momentum    = slope 기반 ±5 (선형 회귀)
stability   = stdev 기반 ±5

total = (weightedAvg + momentum + stability) / 100
```

---

### ④ 구간 시간 단축 (`04_sectional_time`)

```
같은 거리/주로 우선, 부족 시 같은 거리만 (confidence 0.7)
totalImprove = pastAvg(rcTime) - recent(rcTime)
lastImprove  = pastAvg(lastFurlong) - recent(lastFurlong)
total = (timeToScore(totalImprove, 0.5) × 0.6 +
         timeToScore(lastImprove, 0.3)  × 0.4) × confidence
```

> ⚠️ `lastFurlong` 입력이 현재 항상 0 — race_entries `rc_time - se_g1f_acc_time`로 계산 필요. [troubleshooting.md](troubleshooting.md) 참고.

---

### ⑤ 후반 구간 순위 (`05_late_position`)

```
ORD_MAP  = {1:100, 2:80, 3:60, 4:40, 5:20}
finishScore = ORD_MAP[finishOrd]
changeBonus: 추월 +50~+100, 유지 +30, 후퇴 -30~-100

score = finishScore × 0.8 + changeBonus × 0.2
```

> ⚠️ `positions: []` 빈 배열로 들어감 — race_entries `sj_*_ord`(서울) / `bu_*_ord`(부경)로 채워야 함.

---

### ⑥ 거리 적성 (`06_distance_fitness`)

```
같은 거리 정확 매칭만
ORD_VALUE = {1:3, 2:2, 3:1, 4+:0}
score = Σ(value) / (n × 3)
```

---

### ⑦ 주로 적응 (`07_track_adaptation`)

전체 평균 ord와 같은 주로 평균 ord 비교 — 향상도 점수화.

---

### ⑧ 부담중량 (`08_burden_weight`) — 전문가 대기

```
부담 극복 지수 = (경주 평균 부담 - 내 부담) / 평균
임시: 본인 부담 ↓ + ord 좋음 → 가점
```
정식 산식은 전문가 자문 필요.

---

### ⑨ 기수 폼 (`09_jockey_form`)

```
최근 30일 기수의 모든 경주
top3Rate = (1-3등 횟수) / 전체
top1Bonus = (1등 횟수 / 전체) × 0.2
score = min(1.0, top3Rate + top1Bonus)
5경주 미만 → 0.5
```
"안정성 > 간헐 우승" 노하우 반영.

---

### ⑩ 조교사 폼 (`10_trainer_form`)

⑨와 같은 패턴, 60일 기준.

---

### ⑪ 경주 간격 (`11_race_interval`)

직전 경주와의 일수 → 21~35일 최적, 너무 짧거나 길면 감점.

---

### ⑫ 출발번호 (`12_starting_position`)

`pthr_no`, 총 두수, 거리 조합. 내선·외선 거리별 유불리.

---

### ⑬ 나이×거리×성별 (`13_age_distance_gender`) — 전문가 대기

조합 적합도. 정식 산식 필요.

---

### ⑭ 혈통 (`14_pedigree`) — 전문가 대기

API284의 `dsaBriVl`, `dsaClcVl`, `dsaIerVl`, `dsaPrfVl`, `dsidxVl` 활용.
지금은 임시 가중평균.

---

### ⑮ 계절 패턴 (`15_seasonal_pattern`)

같은 계절(봄/여름/가을/겨울) 과거 경주의 ord 분포로 적성 측정.

---

### ⑯ 기수-말 궁합 (`16_jockey_horse_chemistry`)

```
향상도 = 말 전체 평균 - 조합 평균
신뢰도 = 조합 횟수별 (1회=0.5, 5회+=1.0)
score = 0.5 + (improvementScore - 0.5) × trust
```

---

### ⑰ 배당률 (`17_market_odds`)

```
최근 5경주에서 (인기 ≤ 2) 비율
이력 없음 → 0
```
당일 win_odds는 사용 안 함 (사전 모드에서 가용 불가).

---

### ⑱ 수득상금 (`18_earnings`)

상금 누적액 → 로그 정규화 (구체 산식은 파일 참조).

---

## 4. 알고리즘을 수정하는 절차

알고리즘은 ① 학습으로 가중치만 변경, ② 산식 자체 수정 두 가지 길이 있습니다.

### A. 가중치만 갱신 (Spearman 학습)

```
npx tsx scripts/learn_weights_once.ts        # dry-run, 미리보기
npx tsx scripts/apply_learned_weights.ts     # 적용 + 히스토리 저장
```

### B. 산식 자체 수정

수정 대상은 항상 한 파일 안에 캡슐화되어 있습니다.

```
src/engine/scoreItems/NN_xxx.ts              ← 알고리즘
src/engine/scoreItems/NN_xxx.test.ts         ← 단위 테스트
```

**수정 순서:**
1. `NN_xxx.test.ts`에 새로운 케이스 추가 (예상 점수 명시)
2. 알고리즘 수정 → 테스트 통과 확인
3. 입력값이 새로 필요하면:
   - `src/engine/index.ts`의 `ScoreEngineInput`에 필드 추가
   - `src/engine/scorePredictor.ts`의 `buildEngineInput`에서 채우기
   - 항목 함수에서 사용
4. 전체 backfill:
   ```
   npx tsx scripts/backfill_predictions.ts
   ```
5. 적중률 변화 확인:
   ```
   npx tsx scripts/accuracy_stats.ts
   ```
6. 가중치 재학습:
   ```
   npx tsx scripts/apply_learned_weights.ts
   ```

### C. 전문가 자문으로 새 산식 받았을 때

⑧⑬⑭처럼 `EXPERT_PENDING` 표시된 항목은 산식이 임시입니다.
새 산식을 받으면:

1. `src/engine/index.ts`의 `EXPERT_PENDING` Set에서 제거
2. `NN_xxx.ts` 알고리즘 교체 + 테스트 작성
3. 위 §B 4~6단계 진행

---

## 5. 입력 데이터 가용 범위 (사전/사후)

| 항목 | 사전 가용? | 사후 가용? | 비고 |
|---|---|---|---|
| ① 레이팅 | ✅ | ✅ | 출마표에 포함 |
| ② 마체중 변화 | ✅ | ✅ | 과거 wg_hr_diff |
| ③ 착순 추세 | ✅ | ✅ | 과거 5경주 |
| ④ 구간 시간 | ⚠️ | ⚠️ | lastFurlong 미연결 |
| ⑤ 후반 순위 | ⚠️ | ⚠️ | positions 빈 배열 |
| ⑥ 거리 적성 | ✅ | ✅ | 과거 같은 거리 ord |
| ⑦ 주로 적응 | ✅ | ✅ | 과거 ord |
| ⑧ 부담중량 | ✅ | ✅ | 출마표 burd_wgt |
| ⑨ 기수 폼 | ✅ | ✅ | 기수 30일 |
| ⑩ 조교사 폼 | ✅ | ✅ | 조교사 60일 |
| ⑪ 경주 간격 | ✅ | ✅ | 과거 경주 날짜 |
| ⑫ 출발번호 | ✅ | ✅ | pthr_no = 게이트 |
| ⑬ 나이×거리×성 | ✅ | ✅ | 정적 정보 |
| ⑭ 혈통 | ✅ | ✅ | API284 사전 fetch |
| ⑮ 계절 패턴 | ✅ | ✅ | 과거 ord |
| ⑯ 기수-말 궁합 | ✅ | ✅ | 과거 조합 ord |
| ⑰ 배당률 | ✅ | ✅ | **과거 popularity만** (당일 X) |
| ⑱ 수득상금 | ✅ | ✅ | erng_sump |

자세한 차이는 → [prediction_mode.md](prediction_mode.md)

---

## 6. 가중치 봉인 (sealed)

`src/engine/weightLearner.ts`의 `SEALED_ITEMS`에 넣으면 학습 대상에서 제외(가중치 0 강제).
과거에는 `12_starting_position`이 봉인되어 있었지만 현재는 봉인 해제 상태.
