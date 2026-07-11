# 🔄 데이터 흐름 (전체 파이프라인)

> **역할: 흐름 SSOT** (데이터가 어떻게 이동하나). 구조는 [architecture](architecture.md), 명령어는 [pipeline_guide](pipeline_guide.md).

> 최종 업데이트: 2026-07-11 (dailySync predictions 쓰기 전략 변경 — 사전 예측 보존 + actual_ord만 UPDATE, L-001)

---

## 큰 그림

```
┌──────────────────────────────────────────────────────────────────────┐
│                        KRA 공공데이터 API                              │
│  API214_1(결과) · API26_2(출전표) · API18_1(조교) · jkpresult(기수)   │
└───────────────────────┬──────────────────────────────────────────────┘
                        │ (수동 실행 — 로컬 스크립트)
          ┌─────────────┼──────────────┐
          ▼             ▼              ▼
    raceCardSync   dailySync     trainingSync / jockeySync
          │             │
          ▼             ▼
┌─────────────────────────────────┐
│         Supabase (PostgreSQL)   │
│  race_entries · races           │
│  predictions · weight_history   │
│  training_logs · jockey_stats   │
└──────────────────┬──────────────┘
                   │ npm run db:pull (6/23 이후)
                   ▼
┌──────────────────────────────────┐
│      DuckDB 로컬 미러 (data/*.db) │
│      (egress 없이 오프라인 분석)   │
└──────┬───────────────────────────┘
       │
  ┌────┴────────────────────────────────────────────┐
  │                                                  │
  ▼                                                  ▼
ScoreEngine (사전 예측)                      npm run benchmark
  │                                          (Multi-Model 비교)
  ▼                                                  │
predictions (upsert)                   ┌─────────────┼─────────────┐
  │                                    ▼             ▼             ▼
  ▼                              Gate A          Gate B        9개 모델
Vercel (React UI)              (Pearson 중복)  (연승률 개선)  (Spearman/
  출전마 비교 화면                                             Logit/GBDT)
  예측 1·2·3위 표시                                                │
                                                         ASCII 리포트
```

---

## 1단계: API 수집 (KRA → Supabase)

### 1-1. 출전표 발표 (수요일 일괄, 경기 D-2~D-4)

```bash
npm run sync:cards -- --date YYYYMMDD
# src/sync/raceCardSync.ts
```

| 호출 API | 응답 → 저장 |
|---|---|
| `API26_2` (출전표, 서울+부경 동시) | `race_entries` (사전 컬럼), `races` INSERT |

`race_entries.ord = NULL` → 사전 모드. 웹에서 즉시 출전마 표시 가능.

### 1-2. 경기 결과 도착 (금~일 밤)

```bash
npm run sync -- --date YYYYMMDD
# src/sync/dailySync.ts
```

| 호출 API | 응답 → 저장 |
|---|---|
| `API214_1` (경기 결과, 구간기록 포함) | `race_entries` (결과 컬럼 UPDATE), `races` UPDATE |
| `racedetailresult` (상세 결과) | — |

**2026-07-11부터 predictions 쓰기 전략 변경 (L-001, v7 라이브 추적):**
결과 저장 후 predictions을 재계산(upsert)하지 않는다. 수요일(raceCardSync)의 사전 예측을 보존하기 위해
- 이미 예측이 있는 경주 → `predictions.actual_ord`만 UPDATE (예측값 필드는 불변)
- 예측이 없는 경주(수요일 실패 등) → `forcePrecompetition:true`로 사전 모드 계산해 보충 INSERT 후 `actual_ord` UPDATE
- 백필 경로(`skipPredictions=true`)는 이 단계 전체를 건너뜀 (egress 보호)

상세: [prediction_mode.md §8](prediction_mode.md) · [accuracy_metrics.md §8.6](accuracy_metrics.md) · 설계 `docs/superpowers/specs/2026-07-11-v7-live-tracking-design.md`.

### 1-3. 보조 수집 (필요 시)

```bash
npx tsx src/sync/trainingSync.ts   # 조교 기록 (API18_1)
npx tsx src/sync/jockeySync.ts     # 기수 통산성적 (jkpresult)
```

---

## 2단계: 로컬 미러 (Supabase → DuckDB)

> **배경:** Supabase egress 한도(2026-06-23 리셋) 소진 → 로컬 복사본으로 0-egress 분석

```bash
npm run db:pull    # Supabase → data/local.db 전체 덮어쓰기
```

이후 모든 분석·벤치마크 스크립트는 `getLocalDb()`로 DuckDB만 읽음.
Supabase 쓰기(`dailySync`, `apply_learned_weights`)는 여전히 네트워크 필요.

---

## 3단계: 점수화 (ScoreEngine)

```
gatherRaceInputs(db, raceDate, meet, rcNo)
  → race_entries + races + jockey_stats + training_logs JOIN
  → 말별 입력 행 반환

ScoreEngine.score(rows)
  → 21개 항목별 raw_score (0~1)
  → ITEM_WEIGHTS 가중 합산 → total_score
  → 순위 정렬 → predicted_rank
```

같은 `predictRace()` 함수가 `ord NULL/유무`로 자동 분기:

| ord | 모드 | 용도 |
|---|---|---|
| NULL | 사전 | 베팅 전 화면 예측 |
| 1·2·3… | 사후 | 백테스트·학습 |

---

## 4단계: 지표 관리 / 새 신호 검증 (Gate A → B)

새 피처 후보가 생겼을 때 표준 2단계 절차:

```
Gate A: probe:corr
  → 후보 피처 ↔ 기존 피처 Pearson |r|
  → |r| > 0.5 = 중복 의심 (정보 보강인지 확인)
  → PASS: Gate B로 진행

Gate B: backtest:box --label top2
  → holdout 구간(최근 5분기)별 연승률 개선량 측정
  → 5분기 중 ≥3에서 양수 = 채택
  → 5분기 중 <3 = 탈락 (노이즈)
```

채택된 피처는 `score_roadmap.md` 마스터 상태표 + `accuracy_metrics.md` 에 기록.

---

## 5단계: 멀티모델 학습 (benchmark)

```bash
npm run benchmark
# scripts/benchmark_all.ts
# TRAIN: 2024-01-01 ~ 2025-12-31
# TEST:  2026-01-01 ~ 현재
```

9개 모델을 동시에 학습·평가:

| 모델 | 피처 공간 | 설명 |
|---|---|---|
| Spearman | rawScore 21개 | 기존 Spearman ρ 가중치 |
| Logistic | buildFeatures 60개 | 로지스틱 회귀 (top2 라벨) |
| GBDT | buildFeatures 60개 | Gradient Boosted Decision Trees |
| PL | buildFeatures 60개 | Plackett-Luce (참고용) |
| 시장 배당 | win_odds | 베이스라인 |
| …(변형 조합) | — | 앙상블·하이브리드 후보 |

출력: 단승/연승/복승 적중률 × 분기별 ASCII 리포트

---

## 6단계: 가중치 승격

```bash
npm run promote -- --id N   # model_versions 테이블에서 id=N을 활성으로
npm run benchmark            # 롤링 분기 검증 + 시장 진단 (구 walkforward 흡수)
```

> **✅ 통합 완료 (2026-06-14):** 옛 walkforward는 benchmark로 흡수·삭제됨. benchmark가
> 롤링 확장윈도우로 분기별 강건성·시장 진단(불일치·순위별·묶음)·챔피언 대결을 한 도구에서 처리한다.
> 상세 → 롤링 벤치마크 통합 설계(설계 raw: git 이력)

현재 활성: id=6 (v6-class-move, logistic) — 롤링 연승 61.4% (시장 68.8%, −7.4%p)

---

## 7단계: UI 반영 (Vercel)

```
client/src/pages/
  Dashboard.tsx    — 날짜별 경주 카드 (race_date + meet)
  RaceDetail.tsx   — 예측 1·2·3위 + 항목 점수
  RaceEntries.tsx  — 출전마 상세 비교 (PRD v6.1)
  HorseDetail.tsx  — 말 상세
```

main push → Vercel 자동 배포 (`horse-racing-xi-one.vercel.app`)

---

## DB 테이블 의존성

> 테이블·PK·채움 주체 표는 **구조 SSOT** [architecture.md §5 데이터 모델](architecture.md#5-데이터-모델-db)에 둡니다 (중복 방지).
> 위 단계별 흐름에서 각 테이블이 언제 채워지는지는 본문 1~7단계 참조.

---

## 운영 시나리오

> 주간 운영 명령 시퀀스는 복사하지 않습니다 — **시점(언제)** 은 [data_lifecycle.md §3 운영 시나리오](data_lifecycle.md#3-운영-시나리오-일주일), **명령어(무엇을)** 는 [pipeline_guide.md §7 전체 명령어](pipeline_guide.md#7-전체-명령어-정리)가 정본.

---

## 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-25 | 초안: 2-모드 + 운영 시나리오 정리 |
| 2026-05-26 | race_entries 통합 완료로 전면 재작성 |
| 2026-06-12 | DuckDB 로컬 미러 + Gate A/B + Multi-Model Benchmark 반영 전면 재작성 |
