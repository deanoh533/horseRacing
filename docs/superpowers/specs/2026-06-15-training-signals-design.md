# 조교 신호 (Training Signals) — 설계

> 작성: 2026-06-15 | 브랜치: `feat/duckdb-local-mirror` (또는 신규 `feat/training-signals`)
> 목표: 시장이 저평가하는 반공개 신호(조교 기록)를 추가해 **연승 적중률**의 시장격차(−7.4%p)를 좁힌다.

---

## 1. 배경 · 문제

공개 피처 21개로는 연승에서 시장(인기순)을 못 이기는 것이 6분기 롤링에서 강건하게 확인됐다
(`project_market_dominance_ceiling`). win_odds를 피처로 넣어도 부가가치 0. 베팅 ROI 트랙(벤터 혼합·복승
박스·쌍승)도 전부 음성. **남은 엣지는 시장이 아직 가격에 반영 못 한 새 신호**뿐이다.

조교 기록(`training_logs`)은 일반 베터가 해석하기 어려운 **반공개 신호**라 시장이 저평가할 여지가 있다.
현재 점수 모델은 조교사(사람)의 성적(`10_trainer_form` ρ=0.136, `10b_trainer_recent` ρ=0.144)만 쓰고,
**실제 훈련 세션 데이터(소요시간·반복·기승자·최근성)는 전혀 안 쓴다.**

### 타당성 검증 (2026-06-15, 본 세션)

- **KRA API18_1은 과거 조교기록을 제공한다** — probe 실측: 2024-05-22=661건, 2024-05-23=671건,
  2025-05-21=709건, 2026-05-20=726건. 산발적 `ERR`는 data.go.kr 게이트웨이의 일시적 502(다른
  엔드포인트도 동반 장애·동반 복구)일 뿐, 구조적 공백 아님.
- **현재 로컬 보유 조교 데이터는 6일치(2026-05-20~25)뿐** → 직전 60일 내 훈련기록 보유 출주마 2.8%.
  즉 **backfill 없이는 검증 불가**.
- 조교는 경주 *전* 이뤄지므로 `train_date < race_date`만 쓰면 **누수 0** (마체중 wg_hr의 라이브
  누수 문제와 대비되는 장점).

---

## 2. 비목표 (Non-goals)

- 베팅 ROI/엑조틱은 다루지 않는다 (정확도=연승 적중률 목표에 집중).
- win_odds·시장 정보는 피처에 넣지 않는다 (기존 원칙 유지).
- UI 표시는 범위 밖 (검증 통과 후 별도 결정).
- 조교사 성적 스코러(`10`/`10b`)는 건드리지 않는다 (이건 사람, 본 작업은 말의 훈련 세션).

---

## 3. 아키텍처 · 데이터 흐름

```
KRA API18_1 ──backfill──▶ data/training_logs_full.jsonl ──load──▶ 로컬 DuckDB training_logs
                                                                          │
race_date별 as-of 조인 (train_date < race_date)                          │
   collect 층(ReadClient)이 말별 조교이력을 ScoreEngineInput에 부착 ◀──────┘
                                                                          │
buildFeatures.ts: raw 피처로 add() (가치판단 없음, 모델이 학습)            │
                                                                          ▼
npm run benchmark: 게이트A(상관·중복제외) → 게이트B(롤링 다분기 연승 개선)
```

Supabase 쓰기는 2026-06-23까지 차단 → **backfill은 로컬에만 적재**하여 우회. 6/23 이후 선택적으로
Supabase `training_logs` upsert로 영구화.

---

## 4. 컴포넌트

### 4.1 Backfill 스크립트 — `scripts/backfill_training.ts` (신규)

- **입력:** `--from YYYYMMDD --to YYYYMMDD` (기본 2024-04-01 ~ 오늘), `--meet 1,3`
- **동작:** 날짜×경마장별로 `kra.getAllTrainingHistory({ meet, trDate })` 호출
- **502 견고화:** 날짜 단위 재시도(지수 백오프, 최대 N회). 끝까지 실패한 날짜는 `failed_dates` 목록에
  남기고 계속 진행 → 종료 후 재실행으로 보충(재개 가능: 이미 적재된 날짜는 skip)
- **적재처:** `data/training_logs_full.jsonl` (append, 날짜별 정렬·중복제거) → 로컬 DuckDB
  `training_logs` 테이블로 로드 (`sync_local_db.ts`의 `read_json_auto` 패턴 재사용)
- **로깅:** 날짜별 건수·실패·진행률. 대량 출력은 요약만.
- **완료 후:** 커버리지 재측정 스크립트로 "직전 60일 내 훈련기록 보유 출주마 비율" 출력

> ⚠️ KRA 호출량: ~750일 × 2경마장 × 페이지(≈8) ≈ 1.2만 호출. `pLimit(5)` + 502 재시도로 수십 분 예상.
> 사용자에게 위임 실행 가능(대용량·장시간).

### 4.2 As-of 조교이력 수집 — collect 층 (`src/engine/eval/collect.ts` + ReadClient)

- race별로 각 출주마의 `training_logs`에서 `train_date < race_date` 행을 조회(최근→과거 정렬)
- 윈도우 컷오프(예: 직전 90일)로 잘라 `ScoreEngineInput`에 새 필드로 부착:
  - `trainingHistory: { trainDate, trTerm, run1Cnt, run2Cnt, prGubun }[]` (as-of 정렬)
- 사전/사후 모드 동일 산식 원칙 유지 (둘 다 train_date 기준 as-of).

### 4.3 피처 추출 — `src/engine/features/buildFeatures.ts` (확장)

raw 측정값만 add() (가치판단·정규화 없음 — 모델이 학습). 데이터 없으면 해당 피처 미add 또는 0/중립.

| 가설 | raw 피처 | 비고 |
|---|---|---|
| ① 최근성·간격 | `train_days_since_last`, `train_count_14d`, `train_count_30d`, `train_count_60d` | 날짜만 필요 — 가장 견고 |
| ③ 기승자 격 | `train_jockey_ridden_ratio` (직전 N회 중 pr_gubun=기수 비율), `train_last_rider_is_jockey` | 범례: 이름=기수, 조=조교사, 관=주로조교, 생=교육생, 이름(트)=기수트랙라이더 |
| ② 강도 | `train_term_mean`, `train_term_last`, `train_run_cnt_mean` | ⚠️ `run1/2_cnt`·`tr_term` 의미 구현 중 KRA 매뉴얼/샘플로 확정 |
| ④ 추세 | `train_term_slope`, `train_freq_slope` (직전 2~3주, 기존 `slope()` 재사용) | ①②에서 파생 → 나중에 추가 |

- 윈도우(14/30/60d)는 직관 고정 대신 **여러 개를 raw로 내보내 게이트가 변별력으로 고르게** 한다.

### 4.4 검증 — `npm run benchmark` (기존 그대로)

- **게이트A** (`src/engine/eval/gates.ts`): 새 피처가 결과와 상관 있고, 기존 21피처와 |r|>0.5 중복이
  아닌지. 중복이면 보강 효과 없음 → 제외.
- **게이트B**: 새 피처 편입 모델 vs 미편입 모델의 **롤링 다분기 연승률** 개선. 챔피언·시장 격차 변화 측정.
- 통과 신호만 후보 모델로. 음성이면 깔끔히 기각(쌍승·마체중 전례).

---

## 5. 리스크 · 완화

| 리스크 | 완화 |
|---|---|
| 2024-06 이전 경주 조교 공백 → 피처 null | 롤링 게이트B가 데이터 있는 구간 위주로 자연 평가. backfill 후 커버리지 재측정으로 유효 구간 확인 |
| `run1/2_cnt`·`part`·`tr_term` 의미 불확실 | ① ③(날짜·pr_gubun)부터 검증 → ②(강도)는 의미 확정 후. 구현 중 KRA 매뉴얼/샘플 응답 확인 |
| 시장 천장(공개피처는 시장 못 이김, 6분기 강건) | 조교가 "충분히 반공개"라 시장 미반영이길 기대. **게이트B 음성이면 기각** — 가설이지 확정 아님 |
| KRA 502 산발 장애 | backfill 날짜 단위 재시도·재개. 실패 날짜만 보충 |
| Supabase 쓰기 차단(6/23) | backfill 로컬 적재로 우회. 6/23 이후 선택적 영구화 |

---

## 6. 성공 기준

- **최소:** backfill 완료 + 커버리지 ≥ (2024-06 이후 경주의) 80%, as-of 피처 추출이 누수 없이 동작,
  게이트A로 신호별 상관·중복 판정이 나옴.
- **목표:** 조교 피처 ≥1개가 게이트A·B 통과 → 후보 모델 연승률이 미편입 대비 개선 + 시장격차 축소.
- **음성도 성공:** 전 피처가 게이트B 음성이면 "조교 신호도 시장 못 이김"을 데이터로 확정하고 기각 기록
  (메모리·roadmap 갱신). 가설 검증 자체가 산출물.

---

## 7. 영향 받는 파일

- 신규: `scripts/backfill_training.ts`, (커버리지 재측정은 backfill 스크립트에 내장 또는 소형 별도)
- 확장: `src/engine/eval/collect.ts`(or ReadClient 조회), `src/engine/index.ts`(`ScoreEngineInput` 타입),
  `src/engine/features/buildFeatures.ts`, `src/engine/features/types.ts`(필요 시)
- 데이터: `data/training_logs_full.jsonl`, 로컬 DuckDB `training_logs`
- 문서: `docs/score_roadmap.md`(결과), `docs/accuracy_metrics.md`(검증 추가 시), CLAUDE.md 현황
