# 게이트 3면화 (연승·fade·복승) — 설계

> 작성: 2026-06-15 | 브랜치: feat/duckdb-local-mirror
> 목표: 게이트B가 신호를 **'1순위 3착내(연승)' 한 면**으로만 판정해, fade·엑조틱에 강한 신호를 놓치는 문제를 해결. 같은 ablation에서 **3개 지표**를 내 진단 안전망을 만든다.

---

## 1. 배경 · 문제

게이트B(`src/engine/eval/gates.ts` `runGateB`)는 피처군을 ablation(빼고 재학습)해 **holdout 연승률(1순위 3착내) 개선량 1개**만 낸다. 이 한 면 때문에:
- 의료 신호(med_bleed +0.0%p, med_fatigue −0.9%p)가 연승엔 죽었지만, **fade(허당 인기마 회피)·엑조틱(여러 마리 정렬)엔 살아있을 가능성**을 못 본다.
- 앞으로 모든 신호가 같은 사각지대에 놓임.

사용자 통찰: "음수/0 기여를 다른 용도로 재해석" — 신호의 **가치 프로파일**을 한 면이 아니라 세 면으로 봐야 한다.

---

## 2. 비목표 (Non-goals)

- 별도 fade 점수·엑조틱 전용 모델은 만들지 않는다(진단 전용). 진단에서 가치 보이면 후속 과제.
- 엑조틱 **ROI**는 측정하지 않는다(이미 음성 확정 — 목적은 정렬력 평가, 배당 데이터 불필요).
- 채택 규칙·모델 구조·`benchmark_all.ts`는 바꾸지 않는다(연승 기준 채택 유지).
- 교차항(interaction)은 별도 과제.

---

## 3. 정의 (확정)

**place(연승, 기존):** holdout 각 경주에서 모델 1순위 말이 `ord ≤ 3`이면 성공. 성공률.

**fade(허당 인기마 회피):** holdout 각 경주에서
1. `winOdds`가 있는 말을 인기순(odds 오름차순)으로 정렬 → **인기 1~3위** 후보.
2. 그 중 **모델 점수가 가장 낮은 말**(모델이 가장 의심하는 인기마)을 고른다.
3. 그 말이 `ord > 3`(3착 밖, `ord < 50` 유효)이면 fade 성공.
→ "모델이 어떤 인기마가 무너질지 맞히나". winOdds 없는 경주·인기 후보 <2두는 제외.

**quinella(복승 top-2):** holdout 각 경주에서 모델 상위 2마리 집합이 실제 `ord=1`·`ord=2` 두 말을 **둘 다 포함**하면 성공(순서 무관). 유효 착순 2두 미만 경주 제외.

세 지표 모두 **with/without 모델의 holdout 성공률 차 = delta**.

---

## 4. 아키텍처 · 데이터 흐름

```
runGateB(races):
  gateTrain/gateHoldout 분할 (기존)
  allFeatures, trainX/Y (기존)
  modelAll = fitLogistic(...)                       (기존)
  base = metrics(scoreHoldout(modelAll, holdout, allFeatures))   ← place/fade/quinella 3개
  for itemId in itemIds:
    reducedFeatures, modelWithout (기존)
    without = metrics(scoreHoldout(modelWithout, holdout, reducedFeatures))
    placeDelta  = base.place    − without.place      (= 기존 delta, 채택 기준 유지)
    fadeDelta   = base.fade     − without.fade
    quinDelta   = base.quinella − without.quinella
  → GateBResult { itemId, include: placeDelta>0, placeDelta, fadeDelta, quinDelta, ... }
```

핵심: `modelAll`/`modelWithout`는 그대로(추가 학습 0). holdout을 **한 번 재점수**해서 세 지표를 같이 센다 → 비용 거의 안 늘고 모델·채택 무변경.

---

## 5. 컴포넌트 (분리·테스트 가능)

### 5.1 `src/engine/eval/gateMetrics.ts` (신규)
순수 함수 — holdout 점수 결과에서 세 지표 계산. 단위 테스트 대상.

```ts
export interface ScoredHorse { ord: number; winOdds: number | null; score: number; }
export type ScoredRace = ScoredHorse[];

/** 모델로 holdout 각 경주 말을 점수화(정렬 전 raw). */
export function scoreHoldout(
  model: LogisticModel, holdout: RaceRecord[], schema: string[]
): ScoredRace[];

export function placeHitRate(races: ScoredRace[]): number;   // 1순위 ord<=3
export function fadeHitRate(races: ScoredRace[]): number;     // 인기1~3 중 모델최저점 ord>3
export function quinellaHitRate(races: ScoredRace[]): number; // 모델top2 ⊇ 실제top2
```

- `ord >= 50`(취소마)·`ord` 없는 말은 각 지표에서 유효표본 판단 시 제외.
- 분모(n)는 각 지표가 계산 가능한 경주 수(fade는 winOdds·인기후보 충족 경주).

### 5.2 `src/engine/eval/gates.ts` (수정)
- `runGateB`: 기존 `placeRate` 클로저 → `gateMetrics`의 함수로 대체. base/without를 3지표로 계산.
- `GateBResult`에 `fadeDelta`·`quinDelta` 추가. `delta`는 `placeDelta`로 유지(하위호환: `include`·`benchmark_all` 그대로).

### 5.3 `src/engine/eval/report.ts` (수정)
- `printGateB`: 표를 `연승 │ fade │ 복승` 3열로. 정렬은 기존대로 placeDelta 내림차순.

---

## 6. 영향 · 하위호환

- `benchmark_all.ts`: `g.include`·`g.itemId`만 사용 → **무변경**(include는 placeDelta 기준 유지).
- `GateBResult.delta` 유지 → 기존 참조 안 깨짐.
- `--gate-only`로 빠르게 3열 표만 확인 가능.

---

## 7. 테스트 (TDD)

`gateMetrics.test.ts` — 합성 ScoredRace로 각 지표 검증:
- placeHitRate: 1순위가 ord 1 → 성공 / ord 5 → 실패.
- fadeHitRate: 인기 1~3(winOdds 저순) 중 모델최저점 말이 ord>3 → 성공 / ord≤3 → 실패. winOdds 없는 경주 제외.
- quinellaHitRate: 모델 top2가 {ord1,ord2} 포함 → 성공 / 한쪽만 → 실패.
- 빈 경주·유효표본 부족 시 분모 처리(0 division 안전).

`gates.ts`는 통합 동작을 benchmark 실행으로 확인(기존 패턴 — gates 단위테스트 없음).

---

## 8. 성공 기준

- `npm run benchmark`(또는 `--gate-only`) 리포트에 피처군별 **연승·fade·복승 3열**이 찍힌다.
- 의료 신호 재평가: med_bleed·med_fatigue의 fade·복승 delta가 보인다(연승 0이어도).
- 모델 연승 결과·채택 항목은 변경 전과 동일(진단만 추가, 모델 무변경 검증).
- 빠른 검증: gateMetrics 단위테스트 통과.
