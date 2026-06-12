# Multi-Model Benchmark 설계

> 작성: 2026-06-12  
> 브랜치: feat/duckdb-local-mirror 위에서 구현

---

## 1. 목적

새 피처(항목)를 추가할 때마다 **단일 명령 하나**로 모든 예측 방법의 성과를 비교할 수 있는 백테스트 CLI.

- Supabase 호출 0회 (DuckDB 로컬 미러만 사용)
- backfill 없이 즉시 실행 가능 (ScoreEngine을 DuckDB 위에서 직접 실행)
- 단승·연승·복승 × 분기별 전체 비교표 출력

---

## 2. 실행 방법

```bash
npm run benchmark
```

---

## 3. 데이터 흐름

```
[Step 0] featureItemMap 정합성 검증 (에러 시 즉시 중단)
  - buildFeatures()가 내보내는 모든 피처명 → featureItemMap 등록 여부 확인
  - 모든 ScoreItem ID → 매핑된 피처 최소 1개 존재 여부 확인
  - 누락 시: "⚠️ 미매핑 피처: xxx (featureItemMap.ts 업데이트 필요)" 출력 후 종료
         │
         ▼
DuckDB 로컬 미러
  (race_entries + races + horses + jockey_stats 등)
         │
         ▼
gatherRaceInputs(duckdb ReadClient, ...)  ← Supabase 0 호출
  → ScoreEngineInput (경주마별)
         │
         ├─ ScoreEngine.calculateScores(input) → rawScore 21개  [Spearman용]
         └─ buildFeatures(input)               → raw 피처 60+개 [Logistic/GBDT/PL용]
         │
    ┌────┴─────────────────────────────────────────┐
    │ TRAIN: 2024-01-01 ~ 2025-12-31               │
    │  Spearman: rawScore × actual_ord → ρ → weights│
    │  Logistic: buildFeatures 60개 × top1/2/3  ×3  │
    │  GBDT:     buildFeatures 60개 × top1/2/3  ×3  │
    │  PL:       buildFeatures 60개 × ord 랭킹  ×1  │
    └──────────────────────────────────────────────┘
         │
    ┌────┴────────────────────────────────────────────┐
    │ TEST: 2026-01-01 ~ 현재 (분기별 파티션)          │
    │  각 경주 → 각 방법으로 1순위 예측 → actual_ord  │
    │  단승(ord=1) / 연승(ord≤3) / 복승(top2조합) 집계│
    └────────────────────────────────────────────────┘
         │
         ▼
    ASCII 비교표 출력 (분기별 + 전체 요약)
```

---

## 4. 비교 대상 방법 (11개 줄)

| 방법 | 학습 라벨 | 피처 공간 |
|------|---------|---------|
| 시장 배당 (벤치마크) | — | win_odds 오름차순 |
| Spearman (rho-legacy) | ord 상관계수 | ScoreEngine 21개 **rawScore** |
| Logistic (top1 학습) | binary: ord=1 | buildFeatures **60개 raw 피처** |
| Logistic (top2 학습) | binary: ord≤2 | buildFeatures 60개 raw 피처 |
| Logistic (top3 학습) | binary: ord≤3 | buildFeatures 60개 raw 피처 |
| GBDT (top1 학습) | binary: ord=1 | buildFeatures 60개 raw 피처 |
| GBDT (top2 학습) | binary: ord≤2 | buildFeatures 60개 raw 피처 |
| GBDT (top3 학습) | binary: ord≤3 | buildFeatures 60개 raw 피처 |
| Plackett-Luce | 전체 ord 랭킹 우도 | buildFeatures 60개 raw 피처 |

> **피처 공간이 두 종류:**
> - Spearman: `ScoreEngine.calculateScores().items[*].rawScore` (항목 단위 집약값)
> - Logistic/GBDT/PL: `buildFeatures(ScoreEngineInput)` (세분화된 raw 측정값)
>
> **새 ScoreItem 추가 시 3군데 반드시 동기화:**
> 1. `scoreItems/2x_xxx.ts` — rawScore 계산 로직
> 2. `buildFeatures.ts` — 세부 raw 피처 추가
> 3. `featureItemMap.ts` — 피처명 → 항목 ID 매핑 등록
>
> Step 0 검증이 이 3군데 정합성을 자동으로 확인함.

---

## 5. 출력 형태

### 5-A. 분기별 상세표 (단승률)

```
=== 단승률 (1순위 예측마가 1착) ===

방법                  │ 2026-Q1 │ 2026-Q2 │ ...
──────────────────────┼─────────┼─────────┼
시장 배당             │  28.1%  │  27.5%  │
Spearman              │  xx.x%  │  xx.x%  │
Logistic (top1)       │  xx.x%  │  xx.x%  │
Logistic (top2)       │  xx.x%  │  xx.x%  │
Logistic (top3)       │  xx.x%  │  xx.x%  │
GBDT     (top1)       │  xx.x%  │  xx.x%  │
GBDT     (top2)       │  xx.x%  │  xx.x%  │
GBDT     (top3)       │  xx.x%  │  xx.x%  │
Plackett-Luce         │  xx.x%  │  xx.x%  │
```

연승률(ord≤3), 복승률(top2 조합) 동일 형태로 반복 출력.

### 5-B. 전체 요약표

```
=== 전체 요약 (2026년) ===

방법                  │ 단승율 │ 연승율 │ 복승율 │ n경주
──────────────────────┼────────┼────────┼────────┼──────
시장 배당             │ 28.1%  │ 60.3%  │ 38.5%  │  415
Spearman              │ xx.x%  │ xx.x%  │ xx.x%  │  415
Logistic (top1)       │ xx.x%  │ xx.x%  │ xx.x%  │  415
...
```

---

## 6. 구현 계획

### 6-1. `src/engine/scorePredictor.ts` 수정 (필수)

`gatherRaceInputs`의 DB 타입을 `SupabaseClient`에서 `ReadClient` 인터페이스로 추상화.

```typescript
// 변경 전
export async function gatherRaceInputs(sb: SupabaseClient, ...)

// 변경 후
import type { ReadClient } from '../db/localDb.js';
export async function gatherRaceInputs(db: SupabaseClient | ReadClient, ...)
```

기존 Supabase 호출부는 그대로 유지 (ReadClient가 동일 인터페이스 구현).

### 6-2. `scripts/benchmark_all.ts` 신규 작성

```typescript
async function main() {
  // Step 0: featureItemMap 정합성 검증
  verifyFeatureMap();   // 불일치 시 throw

  const db = getLocalDb();   // DuckDB ReadClient

  // TRAIN: 2024~2025 ScoreEngineInput 수집 후 두 피처 행렬 추출
  const trainInputs = await collectAllRaces(db, 20240101, 20251231);
  const rawScores  = extractRawScores(trainInputs);    // Spearman용 (21개)
  const featureVec = extractBuildFeatures(trainInputs); // Logistic/GBDT/PL용 (60개+)

  // 9개 모델 학습
  const models = {
    spearman: learnSpearman(rawScores),
    logisticTop1: fitLogistic(featureVec.X, featureVec.labels.top1, featureVec.schema),
    logisticTop2: fitLogistic(featureVec.X, featureVec.labels.top2, featureVec.schema),
    logisticTop3: fitLogistic(featureVec.X, featureVec.labels.top3, featureVec.schema),
    gbdtTop1: fitGBDT(featureVec.X, featureVec.labels.top1, featureVec.schema),
    gbdtTop2: fitGBDT(featureVec.X, featureVec.labels.top2, featureVec.schema),
    gbdtTop3: fitGBDT(featureVec.X, featureVec.labels.top3, featureVec.schema),
    pl: fitPL(toPlRaces(featureVec), featureVec.schema),
  };

  // TEST: 2026 분기별 평가
  const testInputs = await collectAllRaces(db, 20260101, 99991231);
  const results = evaluate(testInputs, models);

  printReport(results);
}
```

### 6-3. `package.json` 추가

```json
"benchmark": "tsx scripts/benchmark_all.ts"
```

---

## 7. 의존성

- `src/db/localDb.ts` — DuckDB `ReadClient` (feat/duckdb-local-mirror 구현 완료 전제)
- `src/engine/features/buildFeatures.ts` — `buildFeatures(ScoreEngineInput)`
- `src/engine/features/featureItemMap.ts` — `featureToItem()` (Step 0 검증)
- `src/engine/features/alignFeatures.ts` — `buildSchema`, `toVector`
- `src/engine/models/logistic.ts` — `fitLogistic`, `predictLogit`
- `src/engine/models/gbdt.ts` — `fitGBDT`, `predictGBDT`
- `src/engine/models/plackettLuce.ts` — `fitPL`, `predictPL`
- `src/engine/weightLearner.ts` — Spearman ρ 계산
- `src/engine/scorePredictor.ts` — `gatherRaceInputs` (ReadClient 추상화 후)
- `src/engine/index.ts` — `ScoreEngine`

---

## 8. 한계 및 주의

| 항목 | 내용 |
|------|------|
| db:pull 필요 | DuckDB 미러가 최신이어야 함. 경기 결과 반영 후 `npm run db:pull` 실행 필요. |
| 복승 근사 | 복승은 1·2위 2마리 조합. 각 방법이 각 말을 독립 점수화해서 상위 2마리 선택. 정확한 조합 확률 모델 아님. |
| 피처 공간 2개 | Spearman=rawScore(21개), Logistic/GBDT/PL=buildFeatures(60개+). 두 공간이 달라 직접 비교 불가. |
| Spearman 라벨 불변 | Spearman은 학습 라벨 변경 없음. 단승/연승/복승은 평가 기준만 다름. |
| Step 0 검증 범위 | featureItemMap 등록 여부만 확인. 피처 로직 자체의 정확성은 검증 범위 밖. |
