# 섀도 실험실(/lab) + 로지스틱 학습 방식 실험 — 설계

> 작성 2026-09-18 · 상태: 설계 승인 대기(사용자 검토) · 브랜치 `feat/shadow-lab`
> 관련: [02-model-benchmark](../../status/02-model-benchmark.md) · [prediction_mode.md](../../prediction_mode.md) · v7 라이브 추적 스펙(2026-07-11)

## 1. 목적

라이브 모델(v7)의 예측과 **별개로** 실험 버전 모델들의 예측을 저장·결과기록·비교하는 구조를 만든다.
이 위에서 로지스틱 학습 방식 개선 실험(수렴 점검·설정값 튜닝·상위3 조건부 로짓)을 돌려
합격 후보를 라이브와 같은 경주로 나란히 검증한다.

**비목표:** 승격 자동화(승격은 기존 `promote` 명령만), 실험 버전의 선별 배지·Platt 보정, 차트.

## 2. 결정 사항 (사용자 합의 2026-09-18)

| # | 결정 |
|---|---|
| D1 | 실험 예측은 **웹 `/lab` 비교 화면**에서 본다. 기존 화면(출마정보·예상지·`/picks`·통계)은 라이브 전용 유지 |
| D2 | **앞으로 쌓기 + 학습 종료일 이후 과거 채우기.** 학습 기간 안 경주는 채우지 않는다(답 본 시험) |
| D3 | 과거 채우기 신뢰성은 **누수 점검 테스트**로 확인 후 연다 |
| D4 | 실험 버전은 **여러 개 동시에** 돌린다 |
| D5 | 저장은 **별도 테이블 `shadow_predictions`** (기존 `predictions`에 섞지 않음) |
| D6 | 기존 `/lab`(옛 가중치 실험실, 로지스틱 전환 후 무의미)을 **새 화면으로 교체**. 주소·"개인 도구" 진입점 유지 |
| D7 | 적중 지표는 이름이 아니라 **규칙**으로 정의(§6). 문서 이름 불일치는 TODO로 분리 |

## 3. 데이터 모델 (마이그레이션 018)

### 3.1 `model_versions` 확장
- `is_shadow BOOLEAN NOT NULL DEFAULT false` — 실험 중 표시.
- CHECK: `NOT (is_active AND is_shadow)` — 라이브와 실험 동시 불가.
- `train_until INT NULL` — 학습 데이터 마지막 경주일(YYYYMMDD). **과거 채우기 하한의 근거.** 실험 버전 등록 시 필수(스크립트가 강제).

### 3.2 `shadow_predictions` (신규)
| 컬럼 | 비고 |
|---|---|
| race_date, meet, rc_no, hr_name | 경주·말 |
| model_version INT → model_versions(id) | |
| total_score, predicted_rank | 랭킹 |
| p_top3 NULL | 보정 없으면 NULL 허용 |
| actual_ord NULL | 결과 도착 시 채움 |
| source TEXT CHECK IN ('live','backfill') | 사전 저장 / 과거 채우기 |
| computed_at TIMESTAMPTZ DEFAULT now() | |

- PK: `(race_date, meet, rc_no, hr_name, model_version)`.
- RLS: anon 읽기 / service_role 쓰기 (combo_dividends와 동일 패턴).
- `item_scores`는 저장하지 않는다(YAGNI — 비교 화면은 순위만 필요, 행 수·egress 절약).

## 4. 쓰기 경로

### 4.1 공통 채점 함수 분리 (`src/engine/scorePredictor.ts`)
- 현재 `predictRace()` = `gatherRaceInputs()` + 활성 버전 채점. 이를
  `scoreRaceRows(rows, version)`(순수 채점·순위)로 분리하고 `predictRace()`는 이를 호출하도록 리팩터.
- **라이브 출력은 바이트 단위 불변**(기존 테스트 + 리팩터 전후 동일성 테스트).
- 입력 수집(`gatherRaceInputs`)은 경주당 1회, 채점만 버전 수만큼. 단 버전의 `artifact.shape_par_cutoff`가 라이브와 다르면 해당 버전용으로 재수집(기본은 동일 → 재수집 없음).
- 모델 유형: `logistic` 및 신규 `pl-top3`(§7 E2) 모두 계수·평균·표준편차 구조라 같은 선형 채점 경로 사용.

### 4.2 앞으로 쌓기 (`raceCardSync.ts`)
- 라이브 예측 INSERT 직후, `is_shadow=true` 버전마다 채점 → 해당 경주의 `shadow_predictions(source='live')` 행을 버전별 delete 후 insert.
- 결과 도착 가드(L-001)를 그대로 따른다 — 결과가 있는 경주는 섀도도 스킵.
- **실패 격리:** 섀도 단계 예외는 경고 로그만, 라이브 싱크 결과·`--fail-on-empty` 판정에 영향 없음.

### 4.3 결과 기록 (`dailySync.ts`)
- `predictions.actual_ord` UPDATE 직후 같은 (경주·말) 키로 `shadow_predictions.actual_ord` UPDATE. 실패 격리 동일.
- 폴러·캐치업은 dailySync 경유이므로 자동 포함.

### 4.4 과거 채우기 (`npm run shadow:backfill`, 사용자 실행)
- 인자: `--version <id> --from <YYYYMMDD> [--to]`.
- **`from ≤ train_until`이면 거부**(에러 종료). 기본 from = train_until 다음 날.
- 로컬 미러(DuckDB)에서 읽고 `forcePrecompetition: true`로 채점, Supabase에는 쓰기만(`source='backfill'`, actual_ord는 미러의 ord로 즉시 채움).
- 이미 `source='live'` 행이 있는 경주는 건너뛴다(사전 저장본 우선).

## 5. 누수 점검 (과거 채우기 개방 조건)

- `npm run shadow:leak-check`: v7의 **보존된 수요일 사전 예측**(predictions, 2026-07-11 이후) 경주 표본에 대해,
  같은 경주를 과거 채우기 경로(미러 + `forcePrecompetition`)로 v7 재채점 → `total_score` 비교.
- 합격: 표본 전 경주에서 순위 완전 일치, 점수 차 |Δ| < 1e-6.
- **불일치 시:** 과거 채우기 스크립트는 `--force-unverified` 없이는 실행 거부. 원인(예: 경기 후 채워지는 `wg_hr` 계열, 출마 취소 반영 차이)을 찾아 막은 뒤 재점검.
- 알려진 정상 차이(수요일 이후 출전 취소로 필드가 바뀐 경주)는 판정에서 제외하고 건수를 보고한다.

## 6. `/lab` 화면 (기존 Lab.tsx 교체)

### 6.1 지표 (규칙 정의 — 라이브·실험 동일 코드)
| 표시명 | 규칙 |
|---|---|
| 단승 | 예측 1순위가 실제 1착 |
| 연승 | 예측 1순위가 실제 3착 안 |
| 복승 | 예측 1·2순위 두 마리 = 실제 1·2착 두 마리(순서 무관) |
| TOP3 겹침 | 예측 상위3과 실제 상위3의 겹친 마릿수 평균(0~3) |

### 6.2 구성
- **성적표:** 버전별 1행(라이브 v7 + 실험 버전들). 경주 수·4지표·라이브 대비 차이.
  - **같은 경주끼리만 집계**(라이브와 해당 버전 둘 다 예측 + 결과 있는 경주).
  - 차이 옆 **흔들림 폭** 표시: 연승 차이의 대략적 95% 범위(대응 비교 기준 ±1.96·√(불일치 경주 비율/n) 근사)와 "이 정도는 운으로도 생김" 안내.
  - 필터: 출처(사전/과거채우기/전체), 기간, 경마장.
- **경주별 목록:** 라이브 1~3순위 / 각 실험 버전 1~3순위 / 실제 1~3착, 적중 ✅. "엇갈린 경주만" 필터.
- 데이터: React Query 훅 신설(`useShadowPredictions` 등), `predictions`·`shadow_predictions`·결과를 기간 단위로 읽음. 기간 기본값 최근 4주(egress 절약).

## 7. 학습 방식 실험 (오프라인, `benchmark` 롤링)

| # | 실험 | 방법 |
|---|---|---|
| E0 | 수렴 점검 | `fitLogistic`에 손실 기록 옵션 추가. 800회 vs 3000회 비교, 마지막 100회 손실 변화율 보고 |
| E1 | 설정값 튜닝 | l2 ∈ {0.001, 0.005, 0.02, 0.05, 0.1} × (E0 결과 반복 수). **튜닝은 게이트 holdout 분기에서만**, 시험 분기로 고르지 않음 |
| E2 | 상위3 조건부 로짓 (`pl-top3`) | Plackett-Luce를 1~3착 단계까지만 우도에 넣는 부분 PL 신규 구현(`src/engine/models/plTop3.ts`). E1 방식으로 튜닝. 공정 비교 위해 전체 PL도 튜닝해 재실행 |

**판정 규칙 (사전등록 — 실험 전 확정):**
- 기준선 **v8a** = 현재 방식(로지스틱 l2 0.02·800회) + 같은 최신 학습 데이터. 데이터 증가 효과와 방식 효과 분리.
- 합격 = 규칙 지표 **연승(1순위 3착 안)** 평균 Δ ≥ **+1.0%p** AND 분기 **과반 양수** (vs v8a, 6분기 롤링).
- 참고 진단(판정 무관): 단승·복승·TOP3 겹침, 로그손실.

**`/lab` 연결:** v8a + 합격 후보를 `learn:logistic`(또는 신규 `learn:pl-top3`)로 학습 → `is_shadow=true`, `train_until` 기록 → 누수 점검 합격 후 과거 채우기 → 이후 앞으로 쌓기.

**동결 관계:** 실험 버전은 승격이 아니므로 L-003 동결과 충돌 없음. O-004(10월 초 v7 판정) 그대로. 승격은 오프라인 판정 + `/lab` 누적 성적 둘 다 통과한 후보만 기존 절차로.

## 8. 테스트

- 리팩터 동일성: `predictRace` 리팩터 전후 출력 동일(기존 scorePredictor 테스트 + 스냅샷).
- `scoreRaceRows`: 다중 버전 채점·순위.
- 과거 채우기 하한 가드: `from ≤ train_until` 거부.
- raceCardSync/dailySync: 섀도 실패가 라이브 경로에 전파되지 않음.
- 지표 함수: 4규칙 단위 테스트(특히 복승 순서무관, 동착·결측 처리).
- `pl-top3`: 소형 합성 데이터에서 우도 감소·계수 부호 복원.
- 흔들림 폭 계산 단위 테스트.

## 9. 작업 순서 (계획 단계에서 태스크화)

1. 마이그레이션 018 + 타입
2. `scoreRaceRows` 분리 리팩터 (라이브 불변 검증)
3. raceCardSync·dailySync 섀도 쓰기 + 실패 격리
4. 누수 점검 스크립트
5. 과거 채우기 스크립트
6. `/lab` 교체 (지표 함수·훅·화면)
7. E0·E1 실험 → E2 구현·실험 → 판정 기록
8. 후보 등록·과거 채우기 (누수 점검 합격 후) — KRA 호출 없음, DB 쓰기는 사용자 확인 후
9. 문서: pipeline_guide·data_flow·status 02/06·accuracy_metrics

## 10. 위험

- **egress:** `/lab` 조회 기간 기본 4주, `item_scores` 미저장으로 억제.
- **Supabase 쓰기 비용:** 버전 3개 × 주당 ~200경주 × ~10마 ≈ 주 6천 행 — 무시 가능.
- **누수 점검 불합격:** 과거 채우기 보류, 앞으로 쌓기만으로 진행(한 분기 대기).
- **E2 기대치 낮음:** 전체 PL은 2026-06-11 로지스틱에 패배. 부분 PL은 끝순위 노이즈 제거 가설일 뿐 — 불합격도 정상 결과로 기록.
