# Multi-Model Benchmark 설계

> 작성: 2026-06-12  
> 브랜치: feat/duckdb-local-mirror 위에서 구현

---

## 1. 목적

새 ScoreItem을 추가할 때마다 **단일 명령 하나**로:
1. 그 항목이 logistic/GBDT/PL에 넣기 적합한지 **2단계 게이트**로 자동 판단
2. 모든 예측 방법의 성과를 한눈에 비교

조건:
- Supabase 호출 0회 (DuckDB 로컬 미러 직접 사용)
- `training_matrix.jsonl` 파일 불필요 (DuckDB에서 직접 피처 추출)
- 게이트 미통과 항목은 에러 없이 Spearman에만 포함, 포함/미포함 내역 출력

---

## 2. 실행 방법

```bash
npm run benchmark
```

---

## 3. 전체 흐름

```
DuckDB 로컬 미러
  (race_entries + races + horses + jockey_stats 등)
         │
         ▼
gatherRaceInputs(DuckDB ReadClient)  ← Supabase 0 호출
  → ScoreEngineInput (전 경주마)
         │
         ├─ ScoreEngine.calculateScores() → rawScore 21개  [Spearman용]
         └─ buildFeatures()              → raw 피처 60+개  [Logistic/GBDT/PL용]
         │
─────────────────────────────────────────────────
 [게이트 A] 새 피처 상관계수 점검 (probe_feature_corr 로직 재활용)
  - buildFeatures 피처 × 기존 피처 Pearson |r| 계산
  - |r|>0.5 인 피처:
      "⚠️ [피처명] 기존 [피처명]과 상관 r=0.xx
         → 상관이 높아도 독립 정보를 가질 수 있음 (예: 전체경주기록 ↔ 후반200m).
           포함 여부는 게이트 B(연승률 개선량)가 최종 판단."
  - 자동 탈락 없음. 게이트 A는 참고용 경고만.
─────────────────────────────────────────────────
         │
─────────────────────────────────────────────────
 [게이트 B] 연승률 개선량 검증
  - holdout: 2025-Q4 (학습 2024-01 ~ 2025-09)
  - 항목별로 "포함 logistic" vs "미포함 logistic" 학습 후 holdout 연승률 비교
  - 개선량 > 0: "✅ [항목명] +x.x%p → logistic/GBDT/PL 포함"
  - 개선량 ≤ 0: "⚠️ [항목명] -x.x%p → Spearman에만 포함"
─────────────────────────────────────────────────
         │
         ▼
 [본 학습] TRAIN: 2024-01-01 ~ 2025-12-31
  Spearman:  rawScore 21개 × actual_ord → ρ → weights
  Logistic:  게이트B 통과 피처 × top1/top2/top3  ×3 모델
  GBDT:      게이트B 통과 피처 × top1/top2/top3  ×3 모델
  PL:        게이트B 통과 피처 × ord 랭킹        ×1 모델
         │
         ▼
 [테스트] TEST: 2026-01-01 ~ 현재 (분기별 파티션)
  각 경주 → 각 방법으로 1순위 예측 → actual_ord
  단승(ord=1) / 연승(ord≤3) / 복승(top2조합) 집계
         │
         ▼
 ASCII 비교표 출력 (분기별 상세 + 전체 요약)
```

---

## 4. 비교 대상 방법

| 방법 | 학습 라벨 | 피처 공간 |
|------|---------|---------|
| 시장 배당 (벤치마크) | — | win_odds 오름차순 |
| Spearman (rho-legacy) | ord 상관계수 | ScoreEngine 21개 **rawScore** |
| Logistic (top1 학습) | binary: ord=1 | buildFeatures **게이트B 통과 피처** |
| Logistic (top2 학습) | binary: ord≤2 | buildFeatures 게이트B 통과 피처 |
| Logistic (top3 학습) | binary: ord≤3 | buildFeatures 게이트B 통과 피처 |
| GBDT (top1 학습) | binary: ord=1 | buildFeatures 게이트B 통과 피처 |
| GBDT (top2 학습) | binary: ord≤2 | buildFeatures 게이트B 통과 피처 |
| GBDT (top3 학습) | binary: ord≤3 | buildFeatures 게이트B 통과 피처 |
| Plackett-Luce | 전체 ord 랭킹 우도 | buildFeatures 게이트B 통과 피처 |

> **새 ScoreItem 추가 시 3군데 동기화:**
> 1. `scoreItems/2x_xxx.ts` — rawScore 계산 (Spearman용, 필수)
> 2. `buildFeatures.ts` — 세부 raw 피처 추가 (Logistic용, 선택)
> 3. `featureItemMap.ts` — 피처명 → 항목 ID 매핑 등록 (선택)
>
> 2·3을 하지 않으면 해당 항목은 Spearman에만 포함됨. 에러 없음, 경고 출력.

---

## 5. 출력 형태

### 5-A. 게이트 결과 요약 (리포트 상단)

```
=== 항목 포함 현황 ===

항목                   │ Spearman │ Logistic/GBDT/PL │ 게이트A       │ 게이트B
───────────────────────┼──────────┼──────────────────┼───────────────┼────────
01_rating              │    ✅    │        ✅        │ -             │ +1.2%p
20_speed_figure        │    ✅    │        ✅        │ -             │ +0.8%p
21_새항목              │    ✅    │        ⚠️ 제외   │ r=0.71(경고)  │ -0.3%p
...
```

### 5-B. 분기별 상세표

```
=== 연승률 (1순위 예측마가 3착이내) ===

방법                  │ 2026-Q1 │ 2026-Q2 │ ...
──────────────────────┼─────────┼─────────┼
시장 배당             │  60.3%  │  59.1%  │
Spearman              │  xx.x%  │  xx.x%  │
Logistic (top1)       │  xx.x%  │  xx.x%  │
Logistic (top2)       │  xx.x%  │  xx.x%  │
Logistic (top3)       │  xx.x%  │  xx.x%  │
GBDT     (top1)       │  xx.x%  │  xx.x%  │
GBDT     (top2)       │  xx.x%  │  xx.x%  │
GBDT     (top3)       │  xx.x%  │  xx.x%  │
Plackett-Luce         │  xx.x%  │  xx.x%  │
```

단승률(ord=1), 복승률(top2 조합) 동일 형태로 반복 출력.

### 5-C. 전체 요약표

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

`gatherRaceInputs`의 DB 타입을 `ReadClient` 인터페이스로 추상화.

```typescript
// 변경 전
export async function gatherRaceInputs(sb: SupabaseClient, ...)

// 변경 후  
import type { ReadClient } from '../db/localDb.js';
export async function gatherRaceInputs(db: SupabaseClient | ReadClient, ...)
```

### 6-2. `scripts/benchmark_all.ts` 신규 작성

```typescript
async function main() {
  const db = getLocalDb();   // DuckDB ReadClient

  // 전 확정경주 피처 추출 (DuckDB 직접, 파일 불필요)
  const allInputs = await collectAllRaces(db, 20240101, 99991231);

  // 게이트 A: 상관계수 점검 (probe_feature_corr 로직 재활용)
  const gateAWarnings = runGateA(allInputs);
  printGateAWarnings(gateAWarnings);

  // 게이트 B: holdout(2025-Q4) 연승률 개선량
  const gateBResult = runGateB(allInputs);   // 항목별 포함/제외 결정
  // gateBResult: Map<항목id, { include: boolean; delta: number }>

  // 피처 공간 확정 (게이트B 통과 항목만)
  const approvedFeatures = getApprovedFeatures(gateBResult);

  // 본 학습: TRAIN 2024~2025
  const trainInputs = allInputs.filter(r => r.raceDate < 20260101);
  const models = trainAllModels(trainInputs, approvedFeatures);

  // 테스트: 2026
  const testInputs = allInputs.filter(r => r.raceDate >= 20260101);
  const results = evaluate(testInputs, models);

  printReport(gateBResult, results);
}
```

### 6-3. `package.json` 추가

```json
"benchmark": "tsx scripts/benchmark_all.ts"
```

---

## 7. 의존성 및 재활용

| 모듈 | 용도 | 재활용/신규 |
|------|------|---------|
| `src/db/localDb.ts` | DuckDB ReadClient | 재활용 |
| `src/engine/scorePredictor.ts` | `gatherRaceInputs` (ReadClient 추상화 후) | 수정 |
| `src/engine/features/buildFeatures.ts` | 60개 raw 피처 추출 | 재활용 |
| `src/engine/features/featureItemMap.ts` | 피처 ↔ 항목 매핑 | 재활용 |
| `src/engine/features/alignFeatures.ts` | 피처 벡터 정렬 | 재활용 |
| `src/engine/models/logistic.ts` | fitLogistic | 재활용 |
| `src/engine/models/gbdt.ts` | fitGBDT | 재활용 |
| `src/engine/models/plackettLuce.ts` | fitPL | 재활용 |
| `src/engine/weightLearner.ts` | Spearman ρ | 재활용 |
| `scripts/archive/probe_feature_corr.ts` | 게이트 A 로직 (`pearson` 함수) | 로직 재활용 |
| `src/engine/analysis/boxBacktest.ts` | 게이트 B `settleBox` | 재활용 |

---

## 8. 한계 및 주의

| 항목 | 내용 |
|------|------|
| db:pull 필요 | DuckDB 미러가 최신이어야 함. 경기 결과 반영 후 `npm run db:pull` 실행 필요. |
| 게이트 B 판단 기준 | 연승률 개선량 > 0 기준. holdout이 작으면 노이즈 가능. 최소 n=50경주 권장. |
| 복승 근사 | 복승은 1·2위 2마리 조합. 각 말을 독립 점수화해서 상위 2마리 선택. 정확한 조합 확률 모델 아님. |
| 게이트 A 자동탈락 없음 | \|r\|>0.5 경고는 참고용. 상관이 높아도 marginal 기여가 있으면 포함됨. 최종 판단은 게이트 B. 예: 전체경주기록 ↔ 후반200m는 상관 높지만 각각 다른 정보(전체속도 vs 추격력). |
| Spearman 라벨 불변 | Spearman은 학습 라벨 변경 없음. 단승/연승/복승은 평가 기준만 다름. |
