# 캘리브레이션 평가축 — 설계

> 2026-06-16. 두 천장 위 방법론 전환 (a) "서비스로서의 캘리브레이션" — 평가축을 rank적중 → 확률 정직성으로 확장.
> 관련: `docs/strategy/2026-06-16-market-edge-and-korean-winning-conditions.md` A4(a)·A5-1 / [[project_market_edge_strategy]]

## 1. 목적

베팅 ROI로 시장을 이기는 건 두 천장으로 불가. 그러나 **확률의 정직성(calibration)**은 별개 질문이다: 모델이 "P(1착)=20%"라 한 말들이 실제 20% 우승하는가? rank 적중(누가 1등)과 다른 축이다. 이 도구는 모델 확률의 정직성을 **시장(배당 함의확률)과 나란히** 측정해, "우리가 군중보다 정직한 확률을 주는가"(제품 가치 = 최고의 분석가)를 공정하게 답한다.

**읽기 전용 측정 도구.** 모델·DB·라이브 경로 불변. 모델 *재보정*(Platt/isotonic)은 범위 밖(후속).

## 2. 확정된 설계 결정 (brainstorm Q1~Q4)

| # | 결정 |
|---|---|
| Q1 대상 | **C**: P(1착)=모델 vs 시장 비교 (핵심) + P(3착내)=모델 단독(보너스, 시장 P3 미제공) |
| Q2 지표 | **4개 전부**: 신뢰도 곡선 · ECE · Brier · log-loss |
| Q3 공정성 | **Out-of-sample** — 모델이 안 본 경주로만 채점 |
| Q4 OOS 방법 | **A 롤링 재학습** — 분기마다 이전 데이터로 학습→그 분기 예측. `model_versions`에 학습창 컬럼 없어 메타 의존 불가 → 롤링이 OOS 확실 보장. `rollingBlocks` 재사용 |

## 3. 데이터 흐름

```
collectRaces(2024~)  →  rollingBlocks(FIRST_TEST=2025Q1)
   각 블록 {train, test}:
     fitLogistic(train, yTop1) → P1모델 ;  fitLogistic(train, yTop3) → P3모델
     test 각 말:
       modelWinP   = predictLogit(P1, x) ;  경주내 정규화(합=1)
       modelTop3P  = predictLogit(P3, x)         (정규화 안 함 — 독립 이진확률)
       marketWinP  = (1/winOdds) ;  경주내 정규화(오버라운드 제거)
       winOutcome  = (ord==1) ;  top3Outcome = (ord<=3)
   → 쌍 수집: {quarterKey, modelWinP, modelTop3P, marketWinP, winOutcome, top3Outcome}
```
- 학습 피처 스키마: `buildSchema` 후 `__missing` 제거(전체 항목, gate 비의존 — "모델 레시피" 대표).
- `winOdds` 없는 말은 marketWinP 계산서 제외(분모서도 빠짐). 모델 확률은 전 말 대상.
- 정규화: 경주 내 합으로 나눔. 합이 0이면 그 경주 스킵(방어).

## 4. 아키텍처 (부품 1책임)

- **`src/engine/eval/calibration.ts`** (순수, 단위테스트 대상):
  - `reliabilityBins(pairs: {p:number; y:number}[], nBins=10): Bin[]` — 등개수 분위 bin. `Bin = {avgPred, actualRate, n}`.
  - `ece(bins: Bin[]): number` — Σ (n/total)·|avgPred − actualRate|.
  - `brier(pairs): number` — mean((p−y)²).
  - `logLoss(pairs): number` — −mean(y·ln p + (1−y)·ln(1−p)), p∈[1e−9, 1−1e−9].
  - `formatCalibration(...)`: 신뢰도 표(P1착 모델 vs 시장 나란히 + P3착내 모델) + 요약(각 ECE/Brier/logLoss) + 분기별 ECE 행. ASCII.
- **`scripts/calibration_report.ts`** (CLI/통합): OOS 추출(§3) → calibration.ts 호출 → 출력. `npm run calib`.

## 5. 등개수(분위) bin 선택 이유

경마 확률은 작은 값에 쏠림(P1착 대부분 <0.2). 고정폭 bin([0,0.1,..])은 저구간에 표본이 몰려 해상도 저하. **등개수 분위 bin**(각 bin 동일 표본수)이 전 구간 해상도 확보. bin별 평균예측을 함께 출력해 해석 가능.

## 6. 출력 예 (모식)

```
=== P(1착) 신뢰도: 모델 vs 시장 (OOS, 9분기 풀링) ===
bin │ 모델예측 모델실제  n  │ 시장예측 시장실제  n
 1  │   0.03    0.02   N  │   0.03    0.02   N
...
요약            모델      시장
 ECE           0.0xx     0.0xx
 Brier         0.0xx     0.0xx
 log-loss      0.xxx     0.xxx

=== P(3착내) 신뢰도: 모델 단독 ===
... (모델만)

분기별 ECE(P1착): 2025Q1 .. 2026Q2  [모델 / 시장]
```
판정: 모델 ECE/Brier/logLoss가 시장과 비슷하거나 낮으면 "정직성 경쟁력 有". 크게 높으면 과신/과소.

## 7. 테스트 (TDD)

- `reliabilityBins`: 합성 쌍(완벽 보정 → 각 bin avgPred≈actualRate), 분위 분할 정확.
- `ece`: 알려진 bin 입력 → 손계산 값.
- `brier`: 알려진 쌍 → 손계산(예: p=0.5,y=1 → 0.25).
- `logLoss`: 알려진 쌍 → 손계산, 클립 동작(p=0,y=1이 무한대 아님).
- `formatCalibration`: 스모크(모델·시장 행 존재).

## 8. 범위 밖 (YAGNI)

- 모델 재보정(Platt/isotonic) — 측정서 과신 확인되면 후속 별 작업.
- 베팅 EV·복승/엑조틱 캘리브레이션 — 환급률 천장 별 트랙.
- 신뢰도 곡선 그래프 이미지 — ASCII 표로 충분(기존 리포트 관례).

## 9. 성공 기준

`npm run calib`이 OOS 9분기에서 P(1착) 모델 vs 시장 신뢰도 표 + ECE/Brier/logLoss + P(3착내) 모델 표 + 분기별 ECE를 출력. 사람이 "모델 확률이 시장만큼 정직한가"를 한눈에 판단 가능. (모델이 시장보다 정직=제품 차별점 근거 / 과신=재보정 후속 트리거.)
