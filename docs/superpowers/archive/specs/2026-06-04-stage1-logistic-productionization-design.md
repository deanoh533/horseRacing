# B3 — Stage-1 로지스틱 라이브 프로덕션화 설계

> 작성: 2026-06-04 | 상태: 설계 승인됨, 구현 계획 대기
> 브랜치: `feat/score-learning-redesign`
> 관련: [[project-score-learning-redesign]] · [[weight-versioning-design]] · `2026-06-04-score-learning-redesign-design.md`

---

## 0. 한 줄 요약

오프라인에서 v1 대비 연승 +5%p 검증된 Stage-1 로지스틱 모델을 **라이브 예측 경로에 올려** 실제 예상지 순위를 구동한다. 피처 기여도를 21항목으로 묶어 `item_scores`에 채워 **설명력·UI 무수정** 유지. 라이브 전환 전 **파리티 + 섐도우 백테스트**로 라이브 경로 정확성을 검증.

---

## 1. 배경·목표

- 학습 재설계로 만든 로지스틱 P(top3) 모델이 오프라인(`exp:logistic`)에서 v1 +5.2%p(확장윈도우, 6분기) 우월. 그러나 **라이브 예측은 여전히 21항목 ScoreEngine(v1 가중치)** 사용 → 개선이 서비스에 미반영.
- 목표: 로지스틱을 `model_versions` 체계의 정식 버전으로 저장하고, 활성화 시 **라이브 `predictRace`가 로지스틱으로 순위 산출**. v1은 보존(롤백 가능).
- 범위 결정(2026-06-04): **라이브 순위 교체 + 설명력 유지**. (풀 UI 재설계·walkforward 로지스틱 통합·GBM 제외.)

## 2. 핵심 긴장과 해법

라이브 점수는 현재 **21항목 rawScore×weight** 합. 로지스틱은 **~60 피처** 기반(항목과 1:1 아님). 라이브로 올리되 21항목 설명력을 유지하려면:

- **총점(순위):** `predictLogit` = intercept + Σ coefᵢ·zᵢ.
- **항목 기여도:** 각 피처 기여 `coefᵢ·zᵢ`를 그 피처의 소속 항목으로 합산 → 항목별 기여도(부호 있음).
- **UI 무수정 어댑터:** 항목 기여도를 기존 `item_scores` 필드에 매핑 — `weight := |기여도|`(상위5 정렬 기준), `weightedScore := 기여도(부호)`, `rawScore := 0~1 정규화 표시값`. 현재 Col5Items가 그대로 상위 기여 항목을 렌더.

## 3. 컴포넌트

### 3.1 마이그레이션 `012_model_logistic.sql`
- `model_versions` += `model_type TEXT NOT NULL DEFAULT 'rho-legacy'`, `artifact JSONB`.
- 기존 행은 `rho-legacy`(weights 사용). 로지스틱 행은 `model_type='logistic'` + `artifact`에 `LogisticModel`(`{type,features[],means[],stds[],coef{},intercept}`) 저장. `weights`는 로지스틱 행에서 `{}`(미사용).
- 멱등(`ADD COLUMN IF NOT EXISTS`). `NOTIFY pgrst`.

### 3.2 `modelVersion.ts`
- `getActiveModelVersion` select에 `model_type, artifact` 추가. `ActiveModelVersion` 인터페이스 확장(`model_type: string; artifact: LogisticModel | null`).
- rho-legacy면 기존대로 `weights` 사용.

### 3.3 `featureItemMap.ts` (신규)
- 피처명 → 21항목 id 매핑 상수(`buildFeatures` 주석 그룹대로). 예: `rating_abs|rating_rel → 01_rating`, `style_*|x_{style}_{pace} → 19_running_style_pace`, `speed_ability_*|speed_ability_raw__missing → 20`(주: ⑳은 score_items seed에 없으면 추가).
- 공유 맥락 피처(`rc_dist`, `sex_*`, `pace_*`) → 가장 관련 항목 또는 `'context'` 버킷.
- `__missing`·`*_n`(표본수) 피처 → 해당 항목으로 귀속.
- 매핑 누락 피처는 `'context'`로 폴백(런타임 누락 0 보장).

### 3.4 `logisticScorer.ts` (신규)
- `scoreLogistic(model: LogisticModel, input: ScoreEngineInput): { total: number; itemScores: Record<ItemId, ItemScore> }`.
- `buildFeatures(input)` → `toVector(features, model.features)`(누락 0) → 피처별 기여 `coefᵢ·zᵢ` 계산 → `featureItemMap`으로 항목 합산 → `total = intercept + Σ`.
- `itemScores`는 기존 `ItemScore` 형태(어댑터): `{ itemId, itemName, rawScore, weight:|기여도|, weightedScore:기여도, status }`.

### 3.5 `scorePredictor.ts` `predictRace`
- 활성 버전 `model_type` 분기:
  - `'logistic'`: `const m = activeVersion.artifact; for each row → scoreLogistic(m, row.input)` → total·item_scores 저장, `model_version` 도장.
  - `'rho-legacy'`(기본): 기존 `new ScoreEngine(weights).calculateScores`.
- 그 외(저장·정렬·도장)는 공통 경로 유지.

### 3.6 `learn:logistic` 스크립트 (신규)
- `scripts/learn_logistic.ts` — 확정경주(ord not null) 전체를 `gatherRaceInputs`+`buildFeatures`로 학습행렬화(또는 기존 `training_matrix.jsonl` 재사용) → `fitLogistic` → `model_versions`에 `model_type='logistic'`·`artifact`·`is_active=false` 후보 삽입(label 예: `v4-logit`).
- 학습범위: **전 확정경주**(피처 as-of라 누수 없음). 하이퍼파라미터는 실험과 동일(`l2 0.02, iters 800, lr 0.2`).

### 3.7 promote (재사용)
- 기존 `promote_version.ts` 그대로(is_active 포인터 전환 + `actual_ord IS NULL` 미확정 예측만 `predictRace` 재생성). 로지스틱 분기는 §3.5가 처리하므로 promote 코드 변경 불필요(확인 필요: weights 가정 없는지).

## 4. 검증 (라이브 전환 전 필수)

### 4.1 파리티 테스트 — 라이브 경로 정확성
- 라이브 리스크: `gatherRaceInputs→buildFeatures→logisticScorer`가 오프라인(구운 행렬→predictLogit)과 **동일 점수**를 내야 함.
- `scripts/verify_logistic.ts` (또는 단위테스트): 과거 N경주에 대해 (a) `training_matrix.jsonl` 행 → `predictLogit`, (b) 라이브 경로 `scoreLogistic` 총점/순위를 대조. 부동소수 허용오차 내 **순위 100% 일치** 요구.
- 불일치 시 피처 재계산·매핑 버그 → 수정.

### 4.2 섐도우 백테스트 — 끝단 품질
- 후보 버전(is_active=false)으로 확정 테스트경주를 라이브 경로로 점수화 → top3/연승 적중률을 **v1 저장 예측 대비** 비교(같은 경주 집합).
- 오프라인 +5%p가 라이브에서도 재현되는지 확인. 재현 안 되면 promote 보류.

### 4.3 판정
- 파리티 통과(순위 일치) + 섐도우에서 v1 대비 우월 → **사람이 promote 결정**. 둘 중 하나라도 실패 → 보류·디버그.

## 5. 정직성·범위

- 라이브 예측 `model_version` 도장 → 과거 동결 유지(promote는 미확정만 재생성).
- **본 B3:** 마이그레이션 + 라이브 로지스틱 분기 + 어댑터 + learn:logistic + 검증(파리티·섐도우). UI는 어댑터로 무수정.
- **제외:** 부호 기여도 전용 UI 재설계, walkforward 로지스틱 통합, GBM, calibration.
- **무관:** Stage 2 복연승 트랙(KRA 복구 대기) 독립.

## 6. 열린 항목(구현 시 확정)

- `score_items`에 `20_speed_figure` 시드 존재 확인(없으면 추가) — 매핑 대상.
- `ItemScore` 타입에 어댑터 필드가 다 있는지(`rawScore/weight/weightedScore`) 확인 — 있으면 타입 변경 불필요.
- 학습행렬 재사용 vs 신규 추출: 라이브 학습은 전 확정경주 필요 → `training_matrix.jsonl`(2024~) 재사용 가능하면 사용, 아니면 `extract:matrix`로 갱신.
