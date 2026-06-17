# Benter 2단계 합성 — 설계 (스펙)

> 작성: 2026-06-17 · 브랜치: `feat/duckdb-local-mirror`
> 선행 맥락: [[project_market_edge_strategy]] §C9, `docs/strategy/2026-06-16-market-edge-and-korean-winning-conditions.md`
> 두 천장(공개 피처 단독·시장) 종결 후 **유일하게 안 해본 깨끗한 실험**.

---

## 한 줄 요약

경주마다 시장확률과 모델확률을 `P(i 우승) ∝ exp(a·ln 시장확률ᵢ + b·ln 모델확률ᵢ)`로 합쳐
a·b를 우승 우도 최대화로 적합하고, **OOS에서 합성이 시장 단독보다 우승을 더 잘 맞히나**(예측오차 ↓ + b>0)를 측정한다.

## 왜 이 실험인가 (질문 자체가 다르다)

기존 3번의 시장+모델 결합은 모두 엉성했다:
1. 나이브 z-score 블렌드 — 약한 모델을 강한 시장과 동등 가중 → 끌려내려감.
2. `win_odds`를 60피처 중 하나로 — 규제로 소멸, 부가가치 0.
3. 벤터 블렌드(베팅 ROI) — 환급률 벽 때문에 ROI로 판정, 순수 예측 정확도로 본 게 아님.

이번 질문은 **"모델 단독이 시장을 이기나"가 아니라 "모델이 시장 *위에* 직교 정보를 더하나"**.
시장을 강한 베이스로 두고(softmax 정규화) 모델 가중치 b가 살아남는지 본다.
- `b≈0` + 개선 없음 → 모델은 시장에 더할 게 없다(완전 종결).
- `b>0` + 합성 예측오차 ↓ → 시장이 못 본 직교 정보 존재. 첫 진짜 돌파.

---

## 결정 사항 (브레인스토밍 확정)

| 항목 | 결정 | 비고 |
|---|---|---|
| 합성 수학 | **조건부 로짓** (경주 내 softmax) | 벤터 원형. 풀링 이진 로지스틱은 경쟁구조 상실 → 기각 |
| 모델 소스 | **여러 모델 스캔** (logistic·GBDT·PL) | 어느 모델이 직교 정보를 더하는지 동시 비교 |
| 판정 기준 | **정보 기여** | b가 분기 걸쳐 유의하게 >0 AND 합성 NLL < 시장 NLL. 단/연승은 보조 병기 |
| 시장확률 | `win_odds` 역수의 경주 내 정규화 | 사후 확정 단승배당 = 출주 시점 시장 합의. 결과 누수 없음(확인됨) |

---

## 컴포넌트

### ① 입력 데이터 — `collect.ts` 재사용 (신규 수집 0)
- `collectRaces(db, from, to)` → `RaceRecord[]`. 각 `HorseRecord`는 `features`·`ord`·`winOdds` 보유.
- **필터**: 우승마(ord=1) 존재 + 유효 `winOdds`(>0) 가진 말 ≥3두인 경주만.
- 서울·부경 둘 다. 누수 없음 — `win_odds`=확정 단승배당(베팅 물량 반영, 결과 아님), 모델 피처는 as-of.

### ② 두 확률 만들기 — 경주 내 합=1 정규화
- **시장확률ᵢ** = (1/winOddsᵢ) / Σⱼ(1/winOddsⱼ) — 공제율(overround) 제거.
- **모델확률ᵢ** = 모델 P(1착)ᵢ / Σⱼ(모델 P(1착)ⱼ) — logistic·GBDT·PL 각각.
  - 모델 P(1착)은 기존 `fitLogistic`/`fitGBDT`/`fitPL`의 top1 출력에서 가져온다.

### ③ 합성 적합기 — 신규 `src/engine/eval/benter.ts`
- `fitBenter(trainRaces, modelProbFn) → { a, b }`
  - 목적함수: 경주단위 조건부 우도. 경주 r에서 우승마 w에 대해 `−ln( exp(a·lnMₖₜ+b·lnMod) / Σⱼ exp(...) )` 합.
  - 2-파라미터 경사하강(`fitPlatt`과 동형: iters·lr·초기 a=1,b=0). `ln(0)` 방어 클립.
- `combinedProbs(race, {a,b}, modelProbFn) → number[]` — 경주 내 합성확률(합=1).
- `marketProbs(race) → number[]` · `modelProbsFor(race, model) → number[]` — 정규화 헬퍼.

### ④ OOS 프로토콜 — `rolling.ts` 확장윈도우 재사용
- `rollingBlocks(races, firstTest)` 로 분기 블록.
- 각 블록: train으로 (모델 학습 `trainAllModels` + a·b 적합) → test 분기에서 평가.
- 전 분기 결과 풀링. **a·b는 train에서만 적합 → OOS 누수 0.**

### ⑤ 측정·판정 — 모델 3종 각각
- **주 판정축**: 경주단위 우승 NLL(−ln 우승마확률의 평균)
  - 합성 NLL vs 시장단독 NLL vs 모델단독 NLL.
  - b 값과 분기별 추세(부호 안정성).
- **보조**: 단승(1순위픽 1착 적중)·연승(1순위픽 3착내) — 합성·시장·모델 순위별.
- **돌파 판정**: b가 분기 걸쳐 유의하게 >0 AND 합성 NLL < 시장 NLL.
  - b≈0 + 개선 없음 → 완전 종결.

### ⑥ 산출물
- 스크립트 `scripts/benter_twostage.ts` → `npm run benter`.
- ASCII 리포트: 모델 3종 × { a, b, NLL(합성/시장/모델), 단승, 연승 } + 분기별 b 추세.
- 단위 테스트 `src/engine/eval/benter.test.ts`:
  - 적합기 수렴(합성 데이터로 알려진 a,b 회수).
  - 정규화: 시장·모델·합성 확률 각 경주 합=1.
  - `combinedProbs` 합=1, b=0이면 시장확률과 동일.

---

## 모듈 경계

| 유닛 | 역할 | 의존 |
|---|---|---|
| `benter.ts` | 확률 정규화 + 적합기 + 합성 | `types.ts`, `models.ts`(predict) |
| `benter_twostage.ts` | 데이터 수집·롤링·평가·리포트 오케스트레이션 | `collect`·`rolling`·`models`·`benter`·`report` |
| `benter.test.ts` | 적합기·정규화 단위 검증 | `benter.ts` |

기존 `market.ts`·`calibration.ts`·`rolling.ts`는 **무변경**(읽기 재사용).

---

## 비범위 (YAGNI)

- 베팅 ROI·환급률 계산 — 이번은 *예측 정확도* 판. 베팅 트랙은 [[project_benter_blend]]에서 음성 확정됨.
- 연승 전용(top3) 합성 모델 — 우승확률 순위로 3착내 적중을 보조 측정하므로 불필요.
- Platt 라이브 연결·model_versions 스키마 영구화 — 별도 과제(6/23 이후).
- 엑조틱 시장 — 별도 방법론 가지.

## 리스크 / 주의

- **b 유의성**: 분기 수가 적으면 b 부호가 흔들릴 수 있음 → 분기별 b를 모두 출력해 안정성 육안 확인.
- **모델확률 0 처리**: `ln(0)` 방어 클립(1e-9). 정규화 분모 0 방어.
- **odds 결측 경주**: 유효 odds <3두 경주 제외 → 표본 줄어듦, n 리포트.
