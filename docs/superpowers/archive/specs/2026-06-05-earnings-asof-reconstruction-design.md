# 1a — API156 진짜 as-of 수득상금 복원 Design

> 작성: 2026-06-05 · 브랜치 `feat/score-learning-redesign`
> 관련: `reference-earnings-asof-leak`, `project-score-learning-redesign`, 선행 `2026-06-05-earnings-asof-class-signal-design.md`

## 1. 배경

`race_entries.erng_sump`(수득상금)은 말 단위 **현재 스냅샷**이 전 과거 행에 박혀 있어 백테스트 미래누수. 선행 작업(1b)에서 `earnings_log` 제거 + 과거 ord 기반 **클래스 신호**(career_*)로 대체했으나, 재측정 결과 **clean 로지스틱 vs leaky v1 = +1.1%p(노이즈)** — 클래스 proxy는 사라진 우위를 회복하지 못함. 즉 누수 earnings의 "정보"가 클래스로 재구성되지 않음.

**API156/raceRsutDtl** 점검에서 **`rsutRkPurse`(경주별 획득 상금)** 발견 → 과거 합산하면 **진짜 as-of 누적 수득상금**을 누수 없이 복원 가능. 이걸 로지스틱에 추가해 "깨끗한 진짜 earnings가 신호로 살아있나"를 측정한다.

## 2. 목표 / 범위

1. API156 `rsutRkPurse` 수집 → `race_entries.rk_purse`(신규).
2. 자기조인으로 **경주 이전 시점 누적 수득상금**을 `race_entries.erng_sump_asof`(신규)에 미리 계산·저장(누수 없음).
3. 로지스틱 피처에 `earnings_asof_log` 추가(**클래스 신호 career_* 유지** — 둘 다, L2가 선택).
4. 재측정(`extract:matrix` → `exp:logistic`)으로 진짜 earnings의 깨끗한 예측력 측정.

**비목표(범위 밖):** v1 ⑱·`erng_sump` 무수정(v1 동결 유지) / predictions 재backfill / clean-vs-clean 완전비교(후속, 이 컬럼으로 길만 열어둠) / API156의 함수율·날씨 등 다른 필드(별 트랙).

## 3. 아키텍처 결정

- **저장 = race_entries 신규 컬럼** (`rk_purse`, `erng_sump_asof`). per-entry 값이라 자연스럽고 조인·쿼리 용이. (대안기각: 별도테이블=조인복잡 / 파일=쿼리불가)
- **as-of = 미리 계산된 컬럼** (런타임 SUM 쿼리 아님). 자기조인 UPDATE 한 번으로 전 행 채움 → buildEngineInput은 `erng_sump`처럼 **읽기만**. (대안기각: 런타임 fetchAsOfEarnings = 말마다 N쿼리 느림 / asOfHorseStats limit-60 피기백 = 60경주 초과 말 undercount, earnings는 통산이라 전 과거 합산 필요)
- **erng_sump 비파괴** = 새 컬럼에 as-of 저장, 원본 오염값 보존(검증·비교용) + v1 동결 유지. 라이브 행도 자연 작동(과거 전부 합 = 사실상 맞는 값).

## 4. 컴포넌트

### 4.1 마이그레이션 `013_earnings_asof.sql`
```sql
ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS rk_purse BIGINT;
ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS erng_sump_asof BIGINT;
NOTIFY pgrst, 'reload schema';
```
(순수 추가형·멱등. 사용자가 Supabase 적용.)

### 4.2 수집 스크립트 `collect:prize` (`scripts/collect_prize.ts`)
- API156 `raceRsutDtl`를 `(race_dt × rccrs_cd)` 단위로 순회(race_entries의 distinct 날짜·경마장). `rccrs_cd`: 서울=1, 부경=3(meet 매핑 확인 단계 포함).
- 각 item `rsutRkPurse`("16,500,000") 콤마 제거 → BIGINT 파싱. `pthrHrno`·`schdRaceNo`(예 "1R"→1)·`raceDt`로 `(race_date, meet, rc_no, hr_no)` 매칭 → `rk_purse` UPDATE.
- **fetch에 타임아웃(AbortController, 예: 15s) + bounded 재시도(backoff, 최대 4회)** — collect:combo의 무한대기 버그(fetch 타임아웃 없음) 교훈 반영.
- 진행 로그 50건마다. 매칭 실패/0건 경주는 ⚠️ 카운트.
- **매칭키 검증(구현 첫 단계):** API156 `pthrHrno` 포맷이 `race_entries.hr_no`와 일치하는지(선행 0 등) 소량 probe로 확인 후 본수집.

### 4.3 as-of 빌드 `build:earnings-asof` (`scripts/build_earnings_asof.ts`)
```sql
UPDATE race_entries r
SET erng_sump_asof = COALESCE((
  SELECT SUM(p.rk_purse) FROM race_entries p
  WHERE p.hr_no = r.hr_no AND p.race_date < r.race_date AND p.rk_purse IS NOT NULL
), 0);
```
- 한 번 실행으로 전 행 채움. `rk_purse` 없는 과거(미수집)는 0 기여 → 수집 완료 후 실행 전제.
- (Supabase RPC/SQL 직접 실행 또는 스크립트에서 페이지 단위 UPDATE — 구현 시 결정.)

### 4.4 검증 게이트 `verify:prize` (`scripts/verify_prize.ts`)
- 말별 `SUM(rk_purse 전체)` vs `erng_sump`(현재 통산 스냅샷) 비교. 허용오차(예: ±5% 또는 절대 소액) 내 일치 비율 리포트.
- 불일치 크면 `rsutRkPurse` 정의 재조사(부가상금 포함/제외, 특정 경주 누락 등). **통과 게이트** — 일치율 충분해야 피처 신뢰.

### 4.5 피처 통합
- `scorePredictor.ts` race_entries select에 `erng_sump_asof` 추가 → `buildEngineInput` 반환에 `earningsAsof: e.erng_sump_asof ?? undefined`.
- `index.ts` `ScoreEngineInput`에 `earningsAsof?: number | null` 추가.
- `buildFeatures.ts`: `if (input.earningsAsof != null) add('earnings_asof_log', Math.log1p(input.earningsAsof));` + `missingFlag('earnings_asof_log', input.earningsAsof != null)`. **career_* 유지(제거 안 함).**
- `featureItemMap.ts`: `earnings_asof_log: '18_earnings'` 추가.
- v1·erng_sump·calculateEarningsScore 무수정.

### 4.6 재측정 (사용자 실행)
`npm run extract:matrix` → `npm run exp:logistic -- --walkforward`. 비교: 로지스틱(clean 클래스+진짜earnings) vs leaky v1. 진짜 earnings가 클래스 위에 예측력을 더하는지 = `earnings_asof_log` 계수·연승 변화로 판정(사람).

## 5. 데이터 흐름
```
API156 rsutRkPurse → race_entries.rk_purse
   → (자기조인 UPDATE) → race_entries.erng_sump_asof
   → buildEngineInput(select) → input.earningsAsof
   → buildFeatures: earnings_asof_log = log1p(...)   [career_* 병존]
```
라이브·학습행렬 공유. 학습행렬은 피처 baked → 수집·asof 빌드 후 재추출 필요.

## 6. 테스트
- **콤마 파싱** 단위테스트: `"16,500,000"` → `16500000`, 빈/이상값 → null.
- **rc_no 파싱**: `"1R"` → `1`.
- **as-of 누수차단**: 자기조인 로직이 `race_date < r.race_date`만 합산(같은/이후 경주 제외) — 소형 픽스처로 검증(스크립트 순수함수 분리 or SQL 결과 점검).
- **buildFeatures**: `earningsAsof` 주면 `earnings_asof_log` 출력·`log1p` 일치, 결측 시 `__missing=1`. career_* 동시 존재 확인.
- **featureItemMap**: `earnings_asof_log` → `'18_earnings'`.
- **검증 게이트**(verify:prize): sum≈erng_sump 일치율 — 데이터 정합(코드테스트 아닌 운영 게이트).

## 7. 리스크 / 주의
- **API156 커버리지:** 2024~2026 전 경주에 rsutRkPurse 있는지 미확인 → verify:prize 일치율로 드러남. 갭 크면 부분수집·보정 검토.
- **매칭키 hr_no 포맷** 불일치 가능 → 4.2 첫 단계 probe로 확정.
- **rsutRkPurse 정의** ≠ KRA 수득상금일 위험(부가상금 등) → verify:prize 게이트가 1차 방어.
- **수집 무게:** ~3600 경주 × API156 호출 = 수분~십수분. 사용자 실행(토큰·DB 위임 원칙). fetch 타임아웃 필수.
- **erng_sump_asof 라이브 정확성:** 오늘 경주 행은 과거 전부 합 = 맞음. 단 rk_purse 미수집 과거가 있으면 과소 → 수집 완전성에 의존(verify로 확인).
