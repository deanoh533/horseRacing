# 확률 재보정 (Platt/isotonic) — 설계

> 2026-06-16. §C7(캘리브레이션 평가축)의 명확한 후속 트리거 — 모델 확률의 **체계적 편향을 데이터로 교정**해 정직성↑.
> 관련: `docs/strategy/2026-06-16-market-edge-and-korean-winning-conditions.md` §C7 / 선행 스펙 `2026-06-16-calibration-axis-design.md` / [[project_market_edge_strategy]]

---

## 0. 쉬운 말 요약 (이게 전부)

**문제:** 모델이 이길 확률을 말할 때 버릇이 있다. §C7에서 발견 —
- 강한 본명(가장 높게 평가한 그룹): "25.6% 우승" → **실제 30.7%**. → **과소평가**(겸손).
- 가망 없는 롱샷(가장 낮은 그룹): "1.9% 우승" → **실제 1.0%**. → **과대평가**.
- 등수(누가 1등이냐)는 안 틀리지만 **확률 숫자 자체가 비뚤어짐**.

> ※ "그룹"이란? 모든 말을 모델 확률 순으로 줄 세워 **마릿수가 같게 10등분**(`reliabilityBins`). 한 마리만 보면 이겼나뿐이라 정직성 판단 불가 → 비슷한 확률을 받은 말을 모아 "예상 vs 실제"를 센다(날씨 예보 "비 30%라 한 날 100일 중 실제 30일 비 왔나"와 동일).

**고치는 법:** 모델이 부른 확률을 받아 **올바른 쪽으로 밀어주는 작은 변환기(보정자)**를 데이터로 만든다. ("25.6%라 할 땐 사실 30%니까 올려.") 두 방식을 만들어 비교.

**가장 중요 — 커닝 방지:** 보정자는 **과거 데이터로만 만들고 → 안 본 미래 데이터에서 효과 확인**(시간 순 분할). 같은 데이터로 만들고 채점하면 답 보고 푼 시험.

**이번 범위:** 고친 숫자를 제품/라이브에 **바로 넣지 않는다.** "고치면 진짜 좋아지나?"만 측정해 표로 본다. 좋아지면 다음에 라이브 연결(별도 작업), 안 좋아지면 정직한 음성 기록 후 종료 — 게이트 철학.

---

## 1. 목적

§C7 측정 결과: 모델 P(1착) ECE 0.017(꽤 정직)이나 시장 0.004(더 정직). 구체 편향 = **본명 과소확신·롱샷 과대확신**(매끈한 S자 형태). 재보정은 이 편향을 단조 변환으로 교정해 "정직한 확률 제품"(서비스로서의 캘리브레이션) 품질을 올린다. **시장을 이기는 게 아니라 모델 자신의 확률을 더 정직하게** 만드는 것.

**측정 전용 도구.** 모델 학습·DB·라이브 경로(predictRace/scorePredictor) 불변. 라이브 연결은 OOS 개선 확인 후 별도 작업.

## 2. 확정된 설계 결정 (brainstorm)

| # | 결정 |
|---|---|
| 범위 | **측정 먼저** — 재보정 효과를 OOS로 측정만. 라이브 연결은 후속(개선 확인 트리거 시). |
| 방법 | **Platt + Isotonic 둘 다 비교.** Platt=logit에 2-파라미터 로지스틱(매끈), Isotonic=PAV 단조회귀(유연). |
| 대상 | **P(1착) 주력**(편향 발견 지점) + **P(3착내) 보조**. |
| 누수 방어 | 보정자는 **train fold에서만 fit**(train 모델로 train 자체를 예측 → 매핑 학습) → test fold에 적용. 롤링 구조(`rollingBlocks`) 재사용. |
| 정규화 | P(1착)은 §C7과 동일하게 **경주내 정규화된 확률(normWin)을 입력**. 재보정 후 (a)재정규화 없이 + (b)재정규화 후 ECE 둘 다 출력(재정규화가 개선을 되돌리는지 확인). P(3착내)는 정규화 안 함. |

## 3. 데이터 흐름

```
collectRaces(2024~)  →  rollingBlocks(FIRST_TEST=2025Q1)
  각 블록 {train, test}:
    fitLogistic(train, yTop1)→P1모델 ; fitLogistic(train, yTop3)→P3모델
    [보정자 학습 — train fold로만]
      train 각 말: rawP = sigmoid(predictLogit(P1, x)); 경주내 정규화 → normTrainP
        쌍 (normTrainP, ord==1) 수집 → fitPlatt / fitIsotonic → cal_platt, cal_iso
      (P3도 동일하게 정규화 없이 cal 학습)
    [test fold 평가 — 안 본 데이터]
      test 각 말: normWin = 정규화(sigmoid(predictLogit(P1,x)))
        원본:      (normWin, ord==1)
        Platt:     (applyPlatt(cal_platt, normWin), ord==1)
        Isotonic:  (applyIsotonic(cal_iso, normWin), ord==1)
        +재정규화:  위 보정값을 경주내 다시 정규화한 쌍
      시장(참고): (정규화(1/winOdds), ord==1)  — 재보정 대상 아님
  → 방법별 쌍 풀링 + 분기별 보관
```
- 보정자는 fold마다 새로 학습(모델과 동일 train 창). 누수 0.
- `winOdds` 없는 말은 시장 계산서만 제외, 모델·보정 대상엔 포함.

## 4. 아키텍처 (부품 1책임)

**`src/engine/eval/calibration.ts`에 추가** (순수 함수, 단위테스트 대상):
- `fitPlatt(pairs: Pair[]): { a: number; b: number }` — logit(p)에 1차원 로지스틱 적합(경사하강 or 뉴턴). `p`는 [1e−9,1−1e−9] 클립 후 logit.
- `applyPlatt(cal: {a,b}, p: number): number` — `sigmoid(a·logit(p)+b)`. 단조 증가.
- `fitIsotonic(pairs: Pair[]): IsotonicModel` — PAV(pool-adjacent-violators)로 단조 비감소 계단. `IsotonicModel = { x: number[]; y: number[] }`(분기점·값).
- `applyIsotonic(cal: IsotonicModel, p: number): number` — 분기점 사이 선형보간, 경계는 끝값 클램프.
- `Pair`는 기존 타입 재사용.

**`scripts/recalibration_report.ts`** (CLI): §3 추출 → 보정자 학습/적용 → 방법별 ECE/Brier/logLoss 표. `npm run calib:recal`. (기존 `calib`는 순수 측정 유지 — 역할 분리.)

## 5. 출력 예 (모식)

```
=== 재보정 효과: P(1착) (롤링 OOS, N분기·M말) ===
방법              ECE     Brier   log-loss
원본            0.017   0.077   0.272
Platt           0.0xx   0.0xx   0.xxx
Isotonic        0.0xx   0.0xx   0.xxx
Platt(+재정규화)  0.0xx   0.0xx   0.xxx
Isotonic(+재정규화) 0.0xx  0.0xx  0.xxx
시장(참고)       0.004   0.072   0.249

=== 재보정 효과: P(3착내) ===
방법       ECE     Brier   log-loss
원본       0.020   ...
Platt      ...
Isotonic   ...

분기별 ECE(P1착)  [원본 / Platt / Isotonic]
  2025Q1: ... / ... / ...
```

## 6. 후속(라이브 연결) 트리거 — 결정 규칙

- **채택 후보** = OOS ECE 의미있게 하락(예: 0.017 → 0.010대) **AND** Brier·log-loss 비악화 **AND** 재정규화 후에도 개선 유지.
- Platt ≈ Isotonic이면 **Platt 선택**(2파라미터·소표본 안정·해석 쉬움). Isotonic만 크게 우수하면 비선형 편향 존재 신호.
- 미달이면 **정직한 음성** 기록(§C7 옆) → 라이브 연결 안 함, 종료.

## 7. 테스트 (TDD)

- `fitPlatt`: 알려진 (a,b)로 합성한 편향 데이터 → 계수 근사 복원. 완벽 보정 데이터 → a≈1,b≈0.
- `applyPlatt`: 단조 증가, p=0.5→sigmoid(b), 경계 클립.
- `fitIsotonic`: 출력 단조 비감소 보장(역전 입력도). 알려진 계단 복원.
- `applyIsotonic`: 분기점 사이 보간, 경계 클램프, 단조성.
- **개선 스모크**: 인위적으로 과소확신시킨 합성 데이터 → 재보정 후 ECE < 원본 ECE.
- 기존 calib 테스트 회귀 없음(`npm run test:run`).

## 8. 범위 밖 (YAGNI)

- 라이브 경로 연결 — OOS 개선 확인 후 별도 brainstorm.
- 추가 방법(beta calibration·temperature scaling) — Platt/isotonic으로 충분.
- 베팅 EV·복승/엑조틱 캘리브레이션 — 환급률 천장 별 트랙.
- Supabase 영구화 — 6/23 이후.

## 9. 성공 기준

`npm run calib:recal`이 OOS에서 원본 vs Platt vs Isotonic의 ECE/Brier/log-loss(P1착·P3착내, ±재정규화)를 표로 출력. 사람이 "재보정이 모델 확률을 더 정직하게 만드나, 만든다면 어느 방법으로"를 한눈에 판단 → §6 트리거로 라이브 연결 여부 결정.
