# 점수 학습 재설계 — Spearman ρ → P(top3) 챔피언전

> 작성: 2026-06-04 | 상태: 설계 승인됨, 구현 계획 대기
> 브랜치: `feat/score-learning-redesign`
> 관련 메모리: [[weight-versioning-design]] · [[project-market-benchmark]] · [[project-speed-figure]]

---

## 0. 한 줄 요약

항목 점수 학습을 **항목별 Spearman ρ → 정규화 가중치**(휴리스틱)에서 **전체 동시 학습 P(top3)**(로지스틱·GBM 챔피언전)로 바꾼다. 동시에 각 항목에서 **사람이 손으로 넣은 가치판단(임계값·맵·multiplier)을 걷어내고 raw 측정값**을 모델에 넘긴다. 사람은 후보를 많이 제안하고, 모델(규제)이 선택한다.

---

## 1. 배경·문제 정의

### 1.1 현재 학습의 두 약점

1. **목적함수 불일치.** 현재 `weightLearner.ts`는 항목별 Spearman ρ(전체 출전마 순위 일치도)를 재서 가중치로 쓴다. 그러나 실제 게임은 **맨 위 1~3마리(단·복·연승) 적중**이다. ρ는 7등↔8등을 1등↔2등과 동등하게 취급 → 베팅 목표와 어긋난다. (Kendall τ·무가중 Pairwise도 같은 full-rank 약점)

2. **항목별 따로 → 결합 휴리스틱.** ρ를 항목마다 독립 측정하고 `weight = 양수 ρ 정규화`로 합친다. 항목이 서로 겹쳐도(공선성) 각자 신용을 받아 **중복 가산**된다. 상호작용(예: 도주마×짧은거리)도 못 잡는다.

### 1.2 더 위층의 문제 — feature에 박힌 사람 가치판단 (Stage 0 감사)

21개 스코어러를 전수 감사한 결과, 거의 모든 항목이 raw 사실을 **손으로 고른 상수**로 미리 0~1 점수화하고 있다. 이 "가치판단"은 틀릴 수 있고(실제로 ⑲ SCORE_MAP은 실측에서 역전 확인됨), 학습이 아무리 좋아도 입력이 오염되면 소용없다.

**두 종류의 해석 구분:**
- **ⓐ 측정/집계 (정당, 유지):** raw에서 사실 계산. 예: "이 거리 승률", "최근 평균 착순", "par 대비 비율".
- **ⓑ 가치판단 (의심, 제거→모델 학습):** 그 사실이 승리와 어떻게 연결되는지에 대한 사람 이론. 예: 임계값 계단함수, SCORE_MAP, ×1.5 multiplier, α=0.5, "음수니까 봉인", "없으면 0.5".

### 1.3 시장 벤치마크 충격 (관련 맥락)

모델이 인기1위(win_odds 최저)에 연승 ~11%p 뒤지고, 엇갈릴 때 ~22%p 더 틀린다. 가장 강한 단일 신호인 **오늘 win_odds가 점수에 아예 없다**(⑰는 "과거 인기 횟수"라는 약한 proxy를 쓸 뿐). → 본 설계는 시장을 **모델과 독립된 벤치마크**로 두고(아래 2.5), value 추출은 Stage 2로 분리한다.

---

## 2. 설계 결정 (확정)

| # | 결정 | 선택 | 근거 |
|---|---|---|---|
| 1 | 최종 목표 | **단계적**: Stage 1 top3 적중 → Stage 2 시장 대비 ROI | 모델이 top을 잘 잡은 뒤에 value를 얹는다 |
| 2 | 학습 단위 | 항목별 ρ → **전체 동시 학습** P(top3) | 공선성·상호작용 처리, 목적 정렬 |
| 3 | 라벨 | **P(top3), label=(ord≤3) 단일** | 한 모델로 단/복/연 정렬. 단승 처지면 그때 P(win) 분할(YAGNI) |
| 4 | feature | **raw 측정값**(ⓑ 제거) + 비단조 버킷 + 표본수 + 결측표시 | 사람=가설 생성, 모델=선택 |
| 5 | 봉인 | **해제** (④⑦⑲⑬② 포함 전부 투입) | 로지스틱/GBM이 부호·채택 결정 |
| 6 | win_odds | **모델 feature 제외** (벤치마크·Stage2 전용) | 모델=시장 독립 의견. 넣으면 Stage2 value 무의미(순환참조) |
| 7 | 모델 | **챔피언전**: 로지스틱(+버킷) vs GBM vs v1 | 설명력 vs 예측력을 철학 아닌 실측치로 결정 |
| 8 | 평가 | 연승·단승·묶음 교집합 + **ROI** | 베팅 목표 직접 측정. 앞 3개는 기존, ROI 추가 |
| 9 | 스택 | GBM **학습만 Python**, 추론은 TS | 라이브/예측 경로는 순수 TS 유지 |

### 2.5 win_odds 처리 (결정 6 상세)

- 모델 feature에서 **완전 제외**. 모델은 말·기수·조교사·구간능력·거리적성 등 "실력 신호"만으로 독립 의견 생성.
- win_odds는 (a) walkforward 시장 벤치마크, (b) Stage 2에서 모델 P(top3) vs 시장 내재확률 비교로 value 추출 — 두 용도로만.
- ⑰ "과거 인기 횟수" feature는 오늘 odds와 다른 약한 이력 proxy → 후보로 유지하되 모델이 채택 여부 결정.

---

## 3. 아키텍처

```
        예전                          재설계 후
┌──────────────┐            ┌──────────────────────┐
│ 항목 ⓐraw    │            │ 항목 ⓐraw 측정값      │  ← ⓑ 산식 제거
│  →[ⓑ산식]→점수│            │  (+비단조 버킷,표본수) │
├──────────────┤            ├──────────────────────┤
│ 항목별 ρ 따로 │            │ 전체 동시 학습         │  ← holistic
│ →정규화 가중치│            │ 로지스틱 vs GBM        │
├──────────────┤            ├──────────────────────┤
│ walkforward   │            │ walkforward 4지표      │  ← ROI 추가
│ (연/단/묶음)  │            │ +ROI, v1 vs 두 후보    │
└──────────────┘            └──────────────────────┘
```

재사용(거의 그대로): `model_versions` 버전체계, `predictions.model_version` 도장, `promote_version`(미확정 재생성·과거 동결), 분기 홀드아웃 walkforward, 롤백.

### 3.1 컴포넌트와 인터페이스

1. **Feature 빌더** (`src/engine/features/buildFeatures.ts`, 신규, 순수함수)
   - 입력: 한 마리의 raw 컨텍스트(말 이력·기수·조교사·구간·거리적성·간격 등, **win_odds 제외**).
   - 출력: `{ name: string; value: number }[]` (연속형 raw + 비단조 버킷 더미 + 표본수 + 결측표시).
   - de-bias 매핑은 §4 표를 따른다. 버킷 경계는 데이터 probe로 확정(구현 1차 과업).

2. **로지스틱 학습기** (`src/engine/models/logistic.ts`, 신규, 순수함수+테스트)
   - z-표준화 → L2 규제 경사하강 → 계수 β(절편 포함).
   - 출력: `{ type:'logistic', means, stds, coef: Record<feature,number>, intercept }`.

3. **GBM 학습기** (`scripts/train_gbm.py`, 신규) + **TS 추론** (`src/engine/models/gbmInfer.ts`, 신규)
   - Python LightGBM이 학습 → 트리를 JSON 덤프 → TS가 트리 순회로 추론.
   - 출력 아티팩트: `{ type:'gbm', trees: [...], featureNames }`.

4. **스코어러** (`src/engine/scoreModel.ts`, 신규)
   - 공통 인터페이스: `score(features) → { logodds, contributions: Record<feature,number> }`.
   - 로지스틱: `contribution = β·z`. GBM: `contribution = SHAP`(또는 1차는 gain 기반 근사 후 SHAP).
   - 경주 내 정렬은 `logodds`(또는 P) 내림차순.

5. **학습 엔트리** (`learn_candidate.ts` 확장)
   - `--model logistic|gbm` 로 후보 학습 → `model_versions` 비활성 후보 저장(model_type 포함).

6. **walkforward** (`walkforward_eval.ts` 확장)
   - 챔피언(v1) + 후보(로지스틱·GBM)를 같은 feature로 채점. **ROI 블록 추가**(win_odds 이미 조인됨).

7. **엔진 통합** (`scorePredictor.ts` 수정)
   - 활성 버전의 model_type에 따라 로지스틱/GBM 스코어러 선택. `item_scores`에 항목별 raw 사실 + 기여도 저장(가법 분해).

### 3.2 데이터 모델 변경

- `model_versions`: `model_type text` 추가('logistic'|'gbm'|'rho-legacy'). `weights`(jsonb)에 로지스틱 계수, 또는 `artifact`(jsonb) 신규 컬럼에 GBM 트리. (마이그레이션 `011_model_artifact.sql`)
- `predictions.item_scores`: 항목별 `{ rawFact, contribution }` 구조로 확장(기존 `rawScore/weight/weightedScore`와 병존 또는 대체 — 구현 시 결정).

---

## 4. Stage 0 감사 — 항목별 de-bias 매핑

| 항목 | ⓑ 제거할 가치판단 | ⓐ 모델에 줄 raw |
|---|---|---|
| ① 레이팅 | percentile vs /140 선택 | 절대 rating + 경주내 상대순위 |
| ② 마체중 | 구간(≤2→1.0…)·추세±0.15·계절+0.1 | 최근 변화량 + 추세기울기 + 월·성 **(U자→버킷)** |
| ③ 착순추세 | ORD_MAP·가중[.4…]·기세±5·안정±5 | 최근 착순들 + slope + stdev |
| ④ 구간시간 | timeToScore 구간·0.6/0.4·conf | 전체단축초 + 막판단축초 |
| ⑤ 후반순위 | 0.6/0.4·×0.7~1.3·가중 | 구간별 position_ratio 변화 |
| ⑥ 거리적성 | 1−ratio(부호)·fallback맵 | avg_finish_ratio + 표본수 |
| ⑦ 주로적응 | 5단계 계단 | overall−sameTrack 향상도 + 표본수 |
| ⑧ 부담중량 | α=0.5·선형정규화 | budam−raceAvg + ord 따로 |
| ⑨ 기수통산 | winBonus×0.2·cap | qu_rate + win_rate |
| ⑨b 기수최근 | (깨끗) | 90일 단승률 + 표본수 |
| ⑩ 조교통산 | ×0.2·<20컷 | top3율 + top1율 + 표본수 |
| ⑩b 조교최근 | (깨끗) | 90일 top2율 + 표본수 |
| ⑪ 경주간격 | 구간(28~35만점…) | 일수 **(∩자→버킷)** |
| ⑫ 출발번호 | 거리weight구간·×1.5/×0.5 | relativePos + rcDist + 성향(교차) |
| ⑬ 나이거리성 | AGE_DIST_MATRIX·×1.1/×0.9 | age + dist + sex (교차) |
| ⑭ 혈통 | avg/10 | dsa 지수 raw (대부분 결측) |
| ⑮ 계절 | (깨끗) | 같은시즌 top3율 + 표본수 |
| ⑯ 궁합 | mapImprovement·TRUST_MAP | 향상도 + 조합횟수 |
| ⑰ 배당 | "과거 인기 횟수" | 과거 인기 proxy 유지(약함) / **오늘 odds는 제외** |
| ⑱ 수득상금 | 5구간 계단 | log(누적상금) |
| ⑲ 성향×페이스 | **SCORE_MAP(역전)** | avgPosRatio + stddev + paceType (교차) |
| ⑳ 속도지수 | LO/HI 선형맵 | abilityRaw (par 대비) |

**교차 원칙:**
- 비단조(⑪·②) → 데이터기반 버킷 더미. 경계만 두고 값은 학습.
- 표본수(count)를 동반 feature로 → 작은표본 자동 할인.
- 결측 → 결측표시 feature + 모집단 기저율(임의 0.5 폐지).
- 중복(③⑥⑦⑮⑯ = 과거착순 슬라이스)은 규제가 정리하므로 그대로 둠.

---

## 5. 설명력 보존

- **항목 가중치**: β(로지스틱) / SHAP 전역중요도(GBM). z-표준화로 |β| 비교 가능.
- **말×항목 점수**: βᵢ·zᵢ / SHAP — 가법 분해(합 = 총점, waterfall).
- UI는 "raw 사실 + 기여도(부호 있음)" 분리 표시 → 기존보다 정직. 버킷/교차항은 항목당 1줄로 묶어 집계.
- 공선성 주의: 단일 계수는 "한계 중요도"(짝꿍이 신용 가져감). 개념 단독 중요도는 묶음/permutation으로 별도 산출.

---

## 6. 평가 (walkforward 확장)

- 스코어보드 = **연승(Top3)·단승(Winner)·상위3 묶음 교집합 + ROI**.
- ROI = Σ(적중 시 win_odds 배당 − 1) / 베팅수, 단일마 1순위 픽 기준 + 묶음 기준. (분산 큼 → 참고지표, 노이즈경고 병기)
- 기존 분기 홀드아웃·시장 벤치마크·불일치·순위별·노이즈경고 유지.
- v1 챔피언 vs 로지스틱 후보 vs GBM 후보 3자 비교 출력.

---

## 7. 테스트 (TDD)

- `buildFeatures` — 입력별 feature 산출 단위테스트(결측·버킷 경계·표본수).
- `logistic.fit` — 알려진 합성 데이터로 계수 회복 검증.
- `gbmInfer` — Python 덤프 트리 1개에 대한 추론 결과가 LightGBM 예측과 일치.
- `scoreModel` — 기여도 합 = logodds (가법 분해 불변식).
- ROI 계산 단위테스트.
- walkforward는 읽기전용 회귀(스냅샷).

---

## 8. 단계·범위

- **본 스펙 범위 = Stage 0(감사 확정·feature셋) + Stage 1(챔피언전)**.
  - Stage 0: §4 매핑을 코드로, 버킷 경계 probe 확정.
  - Stage 1: feature 빌더·두 학습기·스코어러·스키마·learn:candidate·walkforward·엔진 통합·(최소) UI 기여도 표시.
- **Stage 2 (별도 스펙)**: 보정확률(출전마수 보정) + win_odds 내재확률 대비 value 베팅 레이어. 본 스펙에서 제외.

---

## 9. 위험·미해결

- **GBM Python 도입** — 이 repo 첫 Python. 학습 전용·오프라인 스크립트로 한정, 추론은 TS. CI/배포(Vercel client-only)에는 무영향.
- **버킷 경계** — 데이터 probe로 정하되 과적합 주의(분기 홀드아웃으로 견제).
- **비단조를 로지스틱이 못 잡는 잔여분** — 챔피언전에서 GBM이 그 격차를 드러낼 것(설계 목적).
- **item_scores 구조 변경** — 사전/사후 화면·/versions·Col5Items 영향. UI 마이그레이션 범위는 구현 계획에서 분해.
- **표본 안정성** — 분기별 n이 작아 ROI는 노이즈 큼. 누적·다분기 일관성으로 판단.
