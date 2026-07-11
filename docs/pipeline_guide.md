# 파이프라인 가이드 — 데이터 흐름 · 스크립트 · 명령어

> **역할: 명령어/실행 SSOT**. 구조는 [architecture](architecture.md), 흐름은 [data_flow](data_flow.md).

> 작성: 2026-06-12  
> 목적: API 수집→가공→학습→예측 전체 흐름을 한 문서에서 파악.  
>
> ⚠️ **문서 갱신 규칙:** 새 스크립트·학습방법·검증방법·DB 변경 시 이 문서도 함께 갱신.

---

## 1. 4개 데이터 소스 — 언제 무엇을 쓰나

```
                 새 경기 있을 때       분석·학습 할 때        웹앱 보여줄 때
KRA API    ─────────▶ 수집 전용          (안 씀)               (안 씀)
Supabase   ─────────▶ 쓰기(저장)        (egress 주의)         ◀── 읽기
DuckDB     ─────────  (안 씀)      ◀── 모든 분석·학습        (안 씀)
매트릭스   ─────────  (안 씀)      ◀── 모델 학습 입력         (안 씀)
```

### KRA API — 수집 전용

- **언제:** 출전표 발표일(수~목), 경기 결과 도착일(금~일 밤)
- **뭘 받음:** 출전표·경기결과·구간기록·조교·기수성적
- **어디로 감:** 바로 Supabase INSERT/UPDATE
- **파일:** `src/kra/client.ts` (`KRAClient`)

### Supabase — 저장 원천 + 웹 서비스

| 방향 | 누가 | 예시 |
|---|---|---|
| 쓰기 | sync 스크립트 | race_entries INSERT/UPDATE |
| 쓰기 | apply_learned_weights | weight_history INSERT, predictions UPDATE |
| 쓰기 | promote_version | model_versions is_active 변경 |
| 읽기 | Vercel 프론트엔드 | 출전마 화면, 예측 점수 |

- **주의:** egress(데이터 전송량) 한도 있음. 대량 분석 쿼리는 DuckDB 사용.
- **6/23 리셋** 이후 egress 복구 예정.

### DuckDB — Supabase 복사본, 오프라인 분석 전용

```bash
npm run db:pull               # 전체 테이블 복사 (Supabase → data/local.duckdb)
npm run db:pull -- --table X  # 단일 테이블만
```

- **파일:** `data/local.duckdb` (로컬 전용, git 제외)
- **어댑터:** `src/db/localDb.ts` — supabase-js API를 그대로 흉내냄
- `ReadClient` 인터페이스를 공유해서 코드 변경 없이 Supabase ↔ DuckDB 교체 가능

```typescript
// 자동 분기: DB_SOURCE=supabase면 Supabase, 없으면 DuckDB
export async function getReadClient(): Promise<ReadClient>
```

**db:pull이 복사하는 테이블:**
`race_entries`, `races`, `predictions`, `horses`, `model_versions`, `weight_history`,
`jockey_stats`, `training_logs`, `race_sectional_stats`, `race_par_times`,
`horse_sectional_ability`(뷰), `horse_running_style_by_distance`(뷰)

### 매트릭스 — JSONL 파일, 모델 학습 입력

- **파일:** `data/training_matrix.jsonl` (로컬 전용, git 제외)
- **만들기:** `npm run extract:matrix` (DuckDB → JSONL, 1회 추출 후 반복 재사용)
- **db:pull 후 재추출 필요** (새 데이터 반영)

**한 행의 구조:**
```json
{
  "race_date": 20260601, "meet": 1, "rc_no": 5, "hr_name": "마사춘향",
  "ord": 2, "win_odds": 3.8, "top3": 1, "top2": 1,
  "features": [
    { "name": "rating_abs", "value": 87 },
    { "name": "dist_finish_ratio", "value": 0.72 },
    ...  // 60개
  ]
}
```

---

## 2. 라이브 예측 흐름 (사전/사후)

```
predictRace(db, rcDate, meet, rcNo)
  ↓
gatherRaceInputs()        ← DuckDB or Supabase (ReadClient)
  → race_entries JOIN jockey_stats JOIN training_logs JOIN ...
  → ScoreEngineInput 조립

getActiveModelVersion()   ← model_versions 테이블 (is_active=true)
  ↓
  model_type='rho-legacy' → ScoreEngine.calculateScores() (Spearman 가중치)
  model_type='logistic'   → scoreLogistic() (LogisticModel artifact)
  ↓
total_score + predicted_rank + item_scores
  ↓
predictions 테이블 upsert (Supabase)
```

**현재 활성 모델:** id=5, label='logit-20260611', type='logistic'  
→ `scoreLogistic()` 경로 사용 중. `buildFeatures()` → 로지스틱 점수 → 21항목으로 기여도 묶음.

**사전/사후 자동 분기:**
```
race_entries.ord = NULL  → 사전 모드 (출전표 기반, 베팅 전 예측)
race_entries.ord = 1~N   → 사후 모드 (결과 포함, 백테스트·학습)
```

---

## 3. 스코어 엔진 구조

```
ScoreEngine.calculateScores(input: ScoreEngineInput)
  ↓
  21개 scoreItems 함수 호출 (src/engine/scoreItems/*.ts)
  ↓
  각 항목 rawScore (0~1)
  ↓
  ITEM_WEIGHTS 가중 합산 → total_score (0~100)
  ↓
  HorseScoreResult { total, items: { [itemId]: { rawScore, weight, ... } } }
```

**두 경로:**
- `ScoreEngine` → Spearman 경로 (`rho-legacy`)
- `scoreLogistic()` → 로지스틱 경로 (현재 라이브)
  - `buildFeatures(input)` → 60개 원시 피처
  - `featureToItem(name)` → 21개 항목별 기여도 묶음
  - 출력 형식은 ScoreEngine과 동일 (UI 공유)

---

## 4. 세 가지 핵심 분석 스크립트

### benchmark_all.ts (`npm run benchmark`)

**DuckDB 직접 읽기.** 가장 무거운 전체 파이프라인.

```
DuckDB → collectRaces()
  ↓ gatherRaceInputs() × 전체 경주
  ↓ ScoreEngine.calculateScores() → rawScores (Spearman용)
  ↓ buildFeatures() → features (Logistic/GBDT용)
  ↓
Gate A: 피처 간 Pearson r 경고 (|r|>0.5)
  ↓
Gate B: holdout(2025-Q4) 연승률 개선량으로 항목 포함/탈락  (1회, 롤링과 분리)
  ↓
rollingBlocks() — 분기 확장윈도우 (2024 부트스트랩, 2025-Q1부터 테스트)
  ↓ 분기마다 trainAllModels() 재학습 (spearman·logistic·gbdt·pl)
  ↓ 저장된 챔피언(model_versions) + 시장(win_odds)과 함께 채점
  ↓
롤링 연승율 표 + 시장 깊은 진단(불일치·순위별·상위3 묶음)
```

CLI: `--gate-only`(게이트만) · `--no-gate`(롤링만) · `--champion <id>`(챔피언 지정).
코드: `src/engine/eval/{collect,gates,models,score,rolling,market,champion,report}.ts` (얇은 `scripts/benchmark_all.ts` 오케스트레이터).
DuckDB 직접 쓰는 이유: `ScoreEngine.calculateScores()`(rawScores)와 `buildFeatures()`(features) 둘 다 필요하기 때문.

### backtest_box.ts (`npm run backtest:box`)

**매트릭스 파일 읽기.** 복승 3마리 박스 베팅 특화.

```
data/training_matrix.jsonl → train / holdout 분리
  ↓
baseline vs baseline+후보 두 버전 학습
  ↓
holdout에서:
  예측 상위 3마리 박스 베팅 시뮬
  복승 배당 파일 있으면 ROI 계산
  ↓
출력: 박스 적중률 / ROI% / Brier
```

주요 옵션:
```bash
--candidate class_move      # 신규 후보 효과 격리 검증
--label top2                # top2 라벨 기준 (기본 top3)
--model both                # logistic + PL 둘 다 비교
--split 20250101            # train/holdout 분리 날짜
```

다분기 버전: `npm run backtest:box:quarters` (5분기 연속 → 3/5 이상 양수 = 채택 기준)

### probe_feature_corr.ts (`npm run probe:corr`)

**매트릭스 파일 읽기.** Gate A 진단 전용.

```
data/training_matrix.jsonl → 전체 피처 로드
  ↓
신규 후보 × 기존 전체 피처 Pearson r 계산
  ↓
|r| > 0.5 경고 + 상위 5개 상관 피처 표시
```

```bash
npm run probe:corr -- --new class_move,dist_change
# 출력 예:
# ▸ class_move → ✅ 새 정보(|r|≤0.5) [기존 최대 |r|=0.203]
```

경고 = 자동 탈락 아님. 사람이 판단 후 Gate B 진행.

### ~~walkforward_eval.ts~~ → benchmark에 통합 (2026-06-14)

> **✅ 삭제됨.** 옛 walkforward의 롤링 검증·시장 진단·챔피언 대결은 모두 `npm run benchmark`로
> 흡수됐다. benchmark가 DuckDB 위에서 롤링 확장윈도우로 분기별 강건성을 채점한다.
> 아래 `benchmark_all.ts` 항목 참조.

---

## 5. DuckDB 직접 vs 매트릭스 — 왜 나뉘나

| 스크립트 | 읽는 곳 | 이유 |
|---|---|---|
| `benchmark_all` | DuckDB 직접 | rawScores(Spearman용) + features(Logistic용) 둘 다 필요 |
| `backtest_box` | 매트릭스 | features만 필요, 빠른 반복 가능 |
| `probe:corr` | 매트릭스 | features만 필요, 빠른 반복 가능 |
| `learn_logistic` | 매트릭스 | 동일 |
| `apply_learned_weights` | Supabase | 읽기+쓰기 모두 필요 (weight_history, predictions 갱신) |

---

## 6. 모델 버전 관리 (model_versions)

```
model_versions 테이블
  id | label              | model_type   | weights | artifact      | is_active
  1  | v1-rho-legacy      | rho-legacy   | {...}   | null          | false
  5  | logit-20260611     | logistic     | {}      | LogisticModel | true  ← 현재
```

- `is_active=true` 행이 라이브 예측에 사용됨
- `model_type='logistic'` → `artifact`에 LogisticModel JSON 저장 → `scoreLogistic()` 사용
- `model_type='rho-legacy'` → `weights`의 Spearman 가중치 사용 → `ScoreEngine` 사용

```bash
npm run promote -- --id N   # id=N을 is_active로 변경
```

---

## 7. 전체 명령어 정리

### 수집 (KRA API → Supabase)

```bash
npm run sync:cards -- --date YYYYMMDD   # 출전표 (API26_2)
npm run sync -- --date YYYYMMDD         # 경기 결과 (API214_1)
npm run sync:training                   # 조교 기록 (API18_1)
npm run sync:jockey                     # 기수 통산성적 (jkpresult)
```

### 로컬 미러 (Supabase → DuckDB)

```bash
npm run db:pull                         # 전체 테이블 복사
npm run db:pull -- --table race_entries # 단일 테이블만
```

### 과거 결과 백필 (학습구간 확장)

```bash
npm run backfill:results -- --from 20220101 --to 20240523   # KRA 쿼터 소비 — 사용자 직접 실행. rate limit 시 다음날 재실행(멱등)
npm run db:pull                                             # 백필 후 로컬 미러 갱신
```

### 매트릭스 관리

```bash
npm run extract:matrix                  # DuckDB → data/training_matrix.jsonl
npm run extract:matrix -- --from 20240101 --to 20991231 --out data/training_matrix.jsonl
```

### 신호 검증 (Gate A → B)

```bash
npm run probe:corr -- --new feat1,feat2         # Gate A: 피처 상관 진단
npm run backtest:box -- --candidate feat1       # Gate B: 단일 분기
npm run backtest:box:quarters -- --candidate feat1  # Gate B: 5분기 (표준)
npm run backtest:box -- --label top2 --model both   # top2 + logistic/PL 비교
```

### 경주 전개(race shape) 가설 실측

```bash
npm run probe:shape    # 초반 200m 위치그룹 × 유지력 × G3F 격차 × 필요속도 가설 5종 (DuckDB 로컬, 그룹 경계는 스크립트 상단 LEAD/CHASE)
```

### 모델 학습 (benchmark 계열)

```bash
npm run benchmark                         # 9개 모델 전체 (DuckDB 직접)
npm run benchmark -- --include <itemId>   # 게이트 무관 강제 포함 (통제 A/B ON, 예: shape_signal)
npm run benchmark -- --exclude <itemId>   # 강제 제외 (통제 A/B OFF)
npm run learn:logistic                    # 매트릭스로 로지스틱만
npm run refresh:logistic                  # 재학습
npm run verify:logistic                   # 검증
```

### Spearman 가중치 (기존 경로)

```bash
npx tsx scripts/learn_weights_once.ts    # 미리보기 (DB 수정 안 함)
npx tsx scripts/apply_learned_weights.ts # 실제 적용 (Supabase 쓰기)
```

### 검증 + 승격

```bash
npm run benchmark                         # 롤링 분기 검증 + 챔피언 대결 + 시장 진단
npm run benchmark -- --champion 3         # 특정 model_versions id를 챔피언으로 비교
npm run promote -- --id N                 # 모델 활성화 (Supabase 쓰기)
npm run backfill                          # predictions 전체 재계산
npm run backfill -- --date YYYYMMDD       # 특정 날짜만
```

### 정확도 확인

```bash
npx tsx scripts/accuracy_stats.ts        # 운영 적중률 (단/연/복승)
npm run probe:v7-accuracy -- --from YYYYMMDD --to YYYYMMDD  # v7 라이브 판정(강추/주목/전체, model_version별)
```

**v7 라이브 판정 (`probe:v7-accuracy`):** predictions(수요일 사전 예측, 무변경) × race_entries(금요일 결과 ord)를
클라이언트 조인해 강추(`p_top3≥0.72`)/주목(`[0.62,0.72)`)/전체 티어별 연승(3착내) 적중률을 계산한다.
읽기전용, DuckDB 미러 우선(`getReadClient()`). **DuckDB가 기본 소스이므로 최신 결과를 보려면 먼저
`npm run db:pull -- --table predictions`와 `npm run db:pull -- --table race_entries`(또는 전체 `npm run db:pull`)로
갱신해야 한다** — 안 하면 지난 미러 시점 데이터로 판정된다. 순수 판정 로직은
`src/engine/eval/v7Accuracy.ts`(테스트: 동일 디렉터리 `.test.ts`), DB 조회·CLI 출력은
`scripts/probe_v7_accuracy.ts`.

---

## 8. 신호 발굴 표준 절차

```
1. buildFeatures.ts에 신호 추가 (raw 측정값만, 판단·정규화 금지)
2. npm run extract:matrix              매트릭스 재추출 (DuckDB 필요)
3. npm run probe:corr -- --new 신호명  Gate A: 상관 진단
4. npm run backtest:box:quarters -- --candidate 신호명  Gate B: 5분기 (3/5 양수 = 채택)
5. 채택 확정 시 score_roadmap.md 마스터 상태표 + accuracy_metrics.md §9 변경 이력 갱신
6. npm run benchmark                   9개 모델 전체 재비교
7. npm run promote -- --id N           챔피언 모델 활성화
```

**채택/탈락 기준:**

| 게이트 | 도구 | 통과 | 탈락 |
|---|---|---|---|
| A | `probe:corr` | |r|≤0.5 (경고만, 자동탈락 X) | |r|≈1.0 + 정보 없음 |
| B | `backtest:box:quarters` | 5분기 중 ≥3 양수 | <3 양수 (노이즈) |

**라이브 클린 필수:** 피처가 경기 후에만 수집되면(예: `wg_hr`) = 사전 예측 누수 = 보류.

---

## 9. 변경 이력

| 날짜 | 변경 내용 |
|---|---|
| 2026-06-12 | 초안: 4개 데이터 소스 · 라이브 예측 흐름 · 3개 핵심 스크립트 · 전체 명령어 정리 |
| 2026-07-11 | `probe:v7-accuracy` 추가 (v7 라이브 적중률 판정, L-001 predictions 보존 전략과 함께 도입) |
