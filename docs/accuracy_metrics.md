# 📈 지표 관리 · 검증 · 적중률 계산법

> "이 모델이 얼마나 잘 맞히는가" + "새 신호가 실제로 기여하는가"를 측정하는 통합 문서.  
> 산식: [scripts/accuracy_stats.ts](../scripts/accuracy_stats.ts)
>
> ⚠️ **문서 갱신 규칙:** 새 검증 방법·학습 방법·지표 도구가 추가될 때마다 이 문서와
> [score_roadmap.md](score_roadmap.md)를 함께 갱신한다. 코드만 추가하고 문서 미갱신 금지.

---

## 1. 측정 대상

`predictions` 테이블의 `actual_ord IS NOT NULL` 행만 카운트 (= 경기 후 결과가 들어온 경주만).

```
predictions를 (race_date, meet, rc_no)로 그룹핑
→ 한 경주 = 한 그룹 (출전마 N마리의 예측 row가 같이 묶임)
→ pred1 = predicted_rank == 1 인 row 한 개
```

---

## 2. 4가지 지표

### ① 단승 (Win)
**예측 1위 = 실제 1위**

```
단승 적중 = pred1.actual_ord == 1
```
가장 엄격. 평균 10마 경주에서 무작위 기대 ≈ 10%.

---

### ② 연승 (Place — 2위 안)
**예측 1위가 실제 1~2위에 들어옴**

```
연승 적중 = pred1.actual_ord ∈ {1, 2}
```

---

### ③ 복승 (Show — 3위 안)
**예측 1위가 실제 1~3위에 들어옴**

```
복승 적중 = pred1.actual_ord ∈ {1, 2, 3}
```
경마 복승식 베팅 정의와 일치.

---

### ④ TOP3 교집합
**예측 TOP3와 실제 TOP3가 얼마나 겹치는가**

```
predTop3 = predicted_rank ≤ 3 인 말들
actTop3  = actual_ord ≤ 3 인 말들
intersection = |predTop3 ∩ actTop3|   # 0~3 (마릿수)

평균 교집합 = Σ intersection / 경주 수
적중률 %   = (평균 교집합 / 3) × 100
```
1마는 우연일 수 있지만 2~3마 겹치면 모델의 변별력 있음을 시사.

---

## 3. 출력 형식

```
적중률 (전체 N 경주 / 유효 M 경주)
  단승  예측1위=실제1위         : a/M = X.X%
  연승  예측1위∈실제1~2위       : b/M = Y.Y%
  복승  예측1위∈실제1~3위       : c/M = Z.Z%

예측 TOP3 ↔ 실제 TOP3 교집합 평균: K.KK마 (3마 중)
  → 평균 적중률: W.W%

참고: 평균 출전마 H.H마, 랜덤 단승 기대 R.R%
```

---

## 4. 실행

```
npx tsx scripts/accuracy_stats.ts
```

→ 콘솔에 위 형식으로 출력. DB 미변경.

---

## 5. 기준 비교 (랜덤 대비)

평균 출전마 `H`마 가정 시 무작위 기대값:

| 지표 | 랜덤 기대 |
|---|---|
| 단승 | 1/H |
| 연승 | 2/H |
| 복승 | 3/H |
| TOP3 교집합 | 3·3/H = 9/H 마 (= 30% if H=10) |

→ 모델이 가치 있으려면 모든 지표가 랜덤 기대를 **유의미하게** 초과해야 함.

---

## 6. 가중치 학습과의 관계

### 현재 학습/검증 레이어 전체

```
┌──────────────────────────────────────────────────────┐
│  레이어 1: 신호 후보 검증 (Gate A → B)                 │
│                                                      │
│  Gate A: probe:corr                                  │
│    → 후보 피처 ↔ 기존 피처 Pearson |r|                │
│    → |r| > 0.5 = 중복 의심 (통과는 됨, 보강인지 확인)   │
│                                                      │
│  Gate B: backtest:box --label top2                   │
│    → 5분기 holdout별 연승률 개선량                     │
│    → 5분기 중 ≥3 양수 = 채택 / <3 = 탈락(노이즈)      │
└──────────────────────────────────────────────────────┘
           ↓ 채택된 신호만
┌──────────────────────────────────────────────────────┐
│  레이어 2: 멀티모델 학습 (npm run benchmark)           │
│                                                      │
│  TRAIN: 2024-01-01 ~ 2025-12-31                      │
│  TEST:  2026-01-01 ~ 현재                            │
│                                                      │
│  Spearman  — rawScore 21개, ρ 가중치                  │
│  Logistic  — buildFeatures 60개, top2 라벨            │
│  GBDT      — buildFeatures 60개                      │
│  시장배당  — 베이스라인                                 │
│                                                      │
│  출력: 단/연/복승 × 분기별 ASCII 리포트                  │
└──────────────────────────────────────────────────────┘
           ↓ 챔피언 모델
┌──────────────────────────────────────────────────────┐
│  레이어 3: 승격 + 운영 검증                             │
│                                                      │
│  npm run promote -- --id N                           │
│  npm run benchmark     (롤링 분기 + 시장 진단)          │
│  accuracy_stats.ts     (운영 적중률 모니터링)          │
└──────────────────────────────────────────────────────┘
```

> **✅ 통합 완료 (2026-06-14):** 레이어 2(benchmark)가 **롤링 확장 윈도우**로 동작하며,
> 옛 walkforward의 깊은 시장 진단(불일치·순위별·상위3 묶음)과 챔피언 대결을 흡수했다.
> `walkforward_eval.ts`는 삭제됨 — `npm run benchmark` 하나로 일원화.
> 분기마다 9모델 재학습(확장윈도우) + 저장된 챔피언(`model_versions`) 대결 + 시장 비교.
> CLI: `--gate-only`(게이트만) / `--no-gate`(롤링만) / `--champion <id>`(챔피언 지정).
> 코드: `src/engine/eval/{collect,gates,models,score,rolling,market,champion,report}.ts`.
> 상세 → 롤링 벤치마크 통합 설계(설계 raw: git 이력)

**신호 채택 후 문서화 체크리스트:**
- [ ] `score_roadmap.md` §1 마스터 상태표에 ρ·가중치·상태 기록
- [ ] 이 문서 §9 변경 이력에 날짜·결과·결정 기록
- [ ] CLAUDE.md `⚠️ 현재 실행 상태` 섹션 갱신

---

## 7. Gate A/B 판정 기준 (표준)

| 게이트 | 도구 | 통과 조건 | 탈락 조건 |
|---|---|---|---|
| A | `probe:corr` | 기존 피처와 |r| ≤ 0.5, 또는 중복이어도 정보 보강 확인 | 완전 중복(|r|≈1.0) + 부가정보 없음 |
| B | `backtest:box --label top2` | 5분기 중 ≥3 분기에서 연승률 개선량 > 0 | 5분기 중 < 3 분기 양수 (노이즈) |

**주의:** 마체중(`wg_hr`)은 게이트B +7.2%p 통과했지만 경기 후 수집=라이브 누수 → 보류.  
라이브 클린 확인 필수 (사전 API 가용 여부).

---

## 8. 향후 추가하면 좋은 지표 (백로그)

- **Brier score** — 확률 캘리브레이션 (점수가 확률 비례하면)
- **Log loss** — 동일 목적, 다른 형태
- **출전마수별 적중률** — 8마/12마/16마 등 사이즈 효과 분리
- **경마장별 적중률** — 서울/부경 분리
- **등급별 적중률** — 1~6등급별 변별력 차이

---

## 8.5 선별 적중률 (Selective Picks, 2026-06-25)

전체 경주를 다 맞히는 대신, **보정 연승확률 `p_top3`가 높은 마만 골라(선별)** 강추/주목 라벨을 붙이고
그 부분집합의 적중률을 본다. "부분집합 적중률↑·커버리지↓·위험0" 트랙(C).

- **티어 임계값** (단일출처 `client/src/config/selective_picks.json`): 강추 `p_top3≥0.72` · 주목 `[0.62, 0.72)` (배타 구간).
  → `npm run probe:picks` 곡선(임계값별 적중률·커버리지)으로 **목표 연승 적중률을 데이터로 역산**해 정함.
- **지표**: 티어별 (건수 · 연승 적중률[actual_ord 1~3] · 단승 적중률[=1, 부수] · 커버리지[≥1픽 경주/전체] · 리프트[티어연승 − 베이스라인]).
- **실측(사후 38,518행)**: 강추 357건 연승 73.1%·커버 8.9% / 주목 1,207건 연승 65.4%·커버 26.8% (베이스라인 연승 28.4%).
- **검증 도구**: `npm run probe:picks`(곡선·`--track` 상시 추적, 로컬 DuckDB egress 0) + 웹 통계 "선별 적중률" 섹션(같은 config·같은 로직).
- ⚠️ probe 곡선의 적중률은 임계값을 뽑은 데이터와 같은 구간(in-sample) → 표본 큰 구간(수백~수천 건)일수록 신뢰. 0.85↑(≤10건)는 과소적합 위험으로 비채택.

---

## 8.6 v7 라이브 적중률 판정 (2026-07-11, L-001)

기존 지표(§1~§8.5)는 모두 `predictions.actual_ord`가 **가중치 재학습 시 전체 재계산될 수 있는** 값이라는
전제 위에서 계산됐다. v7 라이브 성능을 정직하게 판정하려면 "수요일에 실제로 뭘 찍었는가"가 이후에
덮어써지지 않아야 한다 — 이를 위해 `dailySync`의 predictions 쓰기 전략을 바꿨다
(설계: `docs/superpowers/specs/2026-07-11-v7-live-tracking-design.md`).

- **쓰기 전략:** predictions은 수요일(raceCardSync)에 한 번만 INSERT, 이후 `predicted_rank`·`total_score`·
  `p_top3`·`p_win`·`item_scores` 등 예측값 필드는 절대 재계산하지 않는다. 금요일 결과 도착 시
  `dailySync`는 `predictions.actual_ord`만 UPDATE(결과 기록 전용)하고, `race_entries.ord`도 별도로 채운다.
  예측이 없는 경주(수요일 실패 등)만 `forcePrecompetition:true`로 사전 모드 보충 INSERT.
- **판정 도구:** `npm run probe:v7-accuracy -- --from YYYYMMDD --to YYYYMMDD` — predictions × race_entries(ord)를
  클라이언트에서 조인해(`race_entries.ord`가 원본, `predictions.actual_ord`에 의존하지 않는 독립 검증) 강추(`p_top3≥0.72`)/
  주목(`[0.62,0.72)`)/전체 3개 티어를 `model_version`별로 집계. §8.5 선별 적중률과 같은 임계값(단일출처
  `client/src/config/selective_picks.json`)을 쓰지만, 대상 표본이 다르다 — §8.5는 사후(과거) 전체 표본,
  이 판정은 **v7이 실제로 라이브 운영 중 낸 예측만** 대상으로 한다.
  - 순수 판정 로직: `src/engine/eval/v7Accuracy.ts` (`joinResults`/`computeTiers`/`computeTiersByVersion`, 테스트 동일 디렉터리)
  - DB 조회·CLI: `scripts/probe_v7_accuracy.ts`
  - ⚠️ DuckDB 미러가 기본 소스 — 최신 결과를 보려면 실행 전 `npm run db:pull` 선행 필요
- **TODO.md L-001과의 관계:** 원래 계획은 `prediction_logs` 불변 로그 테이블을 신설하는 것이었으나, 기존
  `predictions` 테이블의 쓰기 경로만 바꿔 같은 효과(사전 예측 불변 보존)를 얻는 방식으로 대체 구현했다 —
  새 테이블·스키마 변경 없음.

---

## 9. 변경 이력

| 날짜 | 변경 내용 |
|---|---|
| 2026-05-27 | 초안: 4개 지표 정의 + 랜덤 기대값 기준 |
| 2026-05-28 | §6 가중치 학습과의 관계 추가 (Spearman vs 적중률 분리 원칙) |
| 2026-06-10 | Gate A/B 2단계 검증 표준 확립 (probe:corr + backtest:box, 다분기 기준) |
| 2026-06-11 | PL 모델 폐기, Logistic 확정. class_move 채택(B +2.2%p, 5분기 4/5 강건) |
| 2026-06-12 | §6 확장: Gate A/B → 멀티모델 → 승격 3레이어 통합 정리. 문서 갱신 규칙 추가 |
| 2026-06-25 | §8.5 선별 적중률(Selective Picks) 추가 — 강추/주목 티어·probe:picks·임계값 데이터 확정 |
| 2026-07-11 | §8.6 v7 라이브 적중률 판정 추가 — predictions 보존 전략(L-001) + probe:v7-accuracy |
