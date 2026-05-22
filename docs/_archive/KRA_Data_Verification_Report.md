# 📊 KRA API 데이터 검증 보고서 v1.0

**작성일:** 2026-05-22  
**검증 대상:** PRD v3.0의 14개 점수 항목  
**테스트 데이터:** 부산경남 2026-05-17, 서울 2026-04-26 등

---

## 🎯 종합 결론

✅ **14개 항목 모두 데이터 수집 가능** (단, 일부 PRD 수정 필요)

| 항목 | 데이터 수집 | PRD 수정 필요 | 비고 |
|------|------------|---------------|------|
| ① 레이팅 | ✅ | ❌ | 실제 최대 ~108, PRD 140 유지 결정 |
| ② 최근 5경주 착순 | ✅ | ❌ | 클라이언트 필터링 필요 |
| ③ 거리 적합성 | ✅ | ❌ | rcDist 필터링 가능 |
| ④ 주로 적응 | ✅ | ❌ | track 필드 활용 |
| ⑤ 부담중량/마체중 | ✅ | ❌ | wgBudam, wgHr 확보 |
| ⑥ 기수 폼 | ✅ | ❌ | jkNo 필터링 |
| ⑦ 조교사 폼 | ✅ | ❌ | trNo 필터링 |
| ⑧ 경주 간격 | ⚠️ | ✅ | **ilsu 의미 변경 필요** |
| ⑨ 출발번호 | ✅ | ❌ | stOrd 확보 |
| ⑩ 나이×거리×성별 | ✅ | ❌ | age, sex, rcDist 확보 |
| ⑪ 혈통 (3대) | ✅ | ❌ | API284 + horseinfohi |
| ⑫ 계절 패턴 | ✅ | ❌ | rcDate 분류 |
| ⑬ 기수-말 궁합 | ✅ | ❌ | 조합 이력 추출 |
| ⑭ 배당률(인기도) | ⚠️ | ✅ | **인기도 직접 계산 필요** |

---

## 📡 발견된 KRA API 엔드포인트

| API | Endpoint | 용도 |
|-----|----------|------|
| API214_1 | `/B551015/API214_1/RaceDetailResult_1` | 경주 결과 (말 단위) |
| API4_3 | `/B551015/API4_3/raceResult_3` | 경주 기록 (동일 데이터) |
| racedetailresult | `/B551015/racedetailresult/getracedetailresult` | 경주별 상세 (stOrd 포함) |
| API284 | `/B551015/API284/HorseBloodBasicInfo` | 혈통 정보 (dsa* 지수) |
| horseinfohi | `/B551015/horseinfohi/gethorseinfohi` | 말 정보 (혈통, 신체특징) |

### 공통 파라미터
- `serviceKey`: 인증키 (환경변수로 분리 필수)
- `_type`: json
- `pageNo`, `numOfRows`: 페이지네이션
- `meet`: 1=서울, 2=제주, 3=부산경남
- `rc_date`: 경주일자 (YYYYMMDD)
- `rc_no`: 경주번호

---

## ⚠️ 중요한 발견 사항

### 1. hr_no / hr_name 필터링 불가 ⚠️

**문제:**
- API214_1, API4_3 모두 `hr_no`, `hr_name`, `hrno`, `hrNo` 파라미터를 받아도 **필터링하지 않음**
- 모든 검색 결과는 totalCount: 3690 (전체 데이터)으로 동일

**대응 전략:**
```
1. meet + rc_date로 데이터 수집 (페이지네이션)
2. 클라이언트 측에서 hrName으로 필터링
3. 로컬 DB(PostgreSQL)에 저장 후 SQL로 빠르게 조회
```

### 2. ilsu 필드 의미 ⚠️

**검증 결과:**
- 2026-05-17 부산경남: 전 경주 ilsu = 38
- 2026-04-26 서울: 전 경주 ilsu = 33
- **같은 날 모든 말이 동일한 값** → 휴식일수 아님!

**추정:**
- 경마장 운영 일수 또는 경마 개최일 카운터

**⑧ 경주 간격 항목 PRD 수정 필요:**
```
기존: ilsu 필드 직접 활용
변경: 말의 이력에서 직전 경주 날짜 추출 → 오늘 날짜와 차이 계산
```

### 3. 인기도(popularity) 필드 부재 ⚠️

**검증 결과:**
- API214_1 응답에 `popularity` 또는 `inkiOrd` 필드 없음
- `winOdds`(단승 배당률), `plcOdds`(연승 배당률)만 존재

**⑭ 배당률(인기도) 항목 PRD 수정 필요:**
```
기존: '인기도' 직접 활용
변경: 같은 경주 출전마 중 winOdds 정렬 → 인기 순위 계산
  - winOdds 오름차순 1번 → 1인기
  - winOdds 오름차순 2번 → 2인기
  - ...
```

### 4. 레이팅 실제 분포

```
서울 경마: 최대 ~108 (2026-04-26)
부산경남: 최대 ~80
일반적 범위: 0~100

분포 예시 (서울 2026-05-17):
  rating=0 (6등급): 17두
  rating=25~30: 19두
  rating=30~50: 다수
  rating=75~100: 약 14두
```

**결정:** PRD 만점 기준 140 유지 (실제로는 100점 만점 효과)

---

## 📋 14개 항목별 상세 검증 결과

### ① 레이팅 ✅
- **필드:** `rating` (API214_1)
- **타입:** integer (0~150 이론, 실제 0~108)
- **계산:** `rating / 140` (PRD 원본 유지)
- **이력없음:** 0점 처리 (6등급 미부여)

### ② 최근 5경주 착순 ✅
- **필드:** `ord` (API214_1)
- **수집 방법:** 
  1. 최근 730일 데이터 수집 (meet + rc_date 페이지네이션)
  2. hrName으로 필터링
  3. 최근 5경주 추출
- **계산:** 착순 배점(1=3/2=2/3=1) 합산 / 15

### ③ 거리 적합성 ✅
- **필드:** `rcDist`, `ord`
- **수집 방법:** 같은 거리(rcDist) 경주만 필터
- **계산:** 3위 이내 횟수 / 기준 경주 수

### ④ 주로 적응 ✅
- **필드:** `track` (예: "건조 (2%)", "다소불량", "불량")
- **수집 방법:** 같은 주로 상태 필터 후 평균 착순 비교
- **계산:** 향상도 = 전체평균착순 - 해당주로평균착순

### ⑤ 부담중량/마체중 ✅
- **필드:** `wgBudam`(integer), `wgHr`(string: "463(+3)")
- **파싱:** `wgHr`에서 "463"=마체중, "+3"=변화량 추출
- **계산:** PRD 원본 유지

### ⑥ 기수 폼 ✅
- **필드:** `jkNo`, `jkName`, `ord`
- **수집 방법:** 최근 30일 데이터 + jkNo 필터
- **계산:** 가중 점수 / (출전 횟수 × 3)
- **데이터 부족:** 5회 미만 → 중립값 0.5

### ⑦ 조교사 폼 ✅
- **필드:** `trNo`, `trName`, `ord`
- **수집 방법:** 최근 30일 데이터 + trNo 필터 (마방 전체)
- **계산:** 마방 전체 가중 점수 / (총 출전 × 3)
- **데이터 부족:** 10회 미만 → 중립값 0.5

### ⑧ 경주 간격 ⚠️ (PRD 수정)
- **❌ ilsu 필드 사용 불가** (말 단위 휴식일수 아님)
- **✅ 대안:** 말의 이력에서 직전 경주 날짜 - 오늘 날짜
- **계산 로직:**
```javascript
const prevRace = horseHistory.sort(by rcDate desc)[1]; // 가장 최근 직전 경주
const interval = today - prevRace.rcDate; // 일수 차이
// 구간별 점수: 14~27일=1, 28~35일=4, 36~60일=2, 61~90일=1, 90+=0
```

### ⑨ 출발번호 ✅
- **필드:** `stOrd` (racedetailresult)
- **차이:** `chulNo`(엔트리번호) ≠ `stOrd`(실제출발번호)
- **계산:** `(출전두수 - stOrd) / (출전두수 - 1)`
- **거리별 가중치:** 단거리 100%, 중거리 50%, 장거리 20%

### ⑩ 나이×거리×성별 ✅
- **필드:** `age`(integer), `sex`("거"/"암"/"수"), `rcDist`
- **거리 구간:** ≤1400=단거리, 1400~1600=중거리, ≥1800=장거리
- **계산:** PRD 임시 테이블 사용 (전문가 조언 대기)

### ⑪ 혈통 (3대) ✅
- **API1: API284** (`HorseBloodBasicInfo`)
  - `dsaBriVl`: 부마 가치
  - `dsaClcVl`: 종합 가치
  - `dsaIerVl`: 모마 가치
  - `dsaPrfVl`, `dsidxVl`: 기타 지수
- **API2: horseinfohi** (`gethorseinfohi`)
  - `sireHrnm`: 부마명
  - `damHrnm`: 모마명
  - 모부마 = 모마를 재조회한 후 sireHrnm
- **계산:** PRD 원본 (부마 50% + 모마 30% + 모부마 20%)

### ⑫ 계절 패턴 ✅
- **필드:** `rcDate` (예: 20260517)
- **시즌 분류:**
  - 여름: 4월~9월
  - 겨울: 10월~3월
- **계산:** 해당 시즌 3위 이내 비율

### ⑬ 기수-말 궁합 ✅
- **필드:** `jkNo` + `hrName` 조합
- **수집 방법:** 같은 말+기수 조합의 이력 필터
- **계산:** 향상도 × 신뢰도 계수 (이력 횟수)

### ⑭ 배당률(인기도) ⚠️ (PRD 수정)
- **❌ 직접 popularity 필드 없음**
- **✅ 대안:** 같은 경주의 winOdds 정렬로 인기 순위 계산
- **계산 로직:**
```javascript
// 한 경주의 모든 말 winOdds 정렬
const horses = race.horses.sort((a,b) => a.winOdds - b.winOdds);
// 정렬 후 인덱스가 곧 인기 순위
horses[0] → 1인기 (winOdds 최저)
horses[1] → 2인기
```

---

## 🔧 PRD v3.0 → v3.1 수정 사항

### 변경 1: ⑧ 경주 간격 계산 방법
**변경 전:**
> ilsu 필드를 활용 (휴식일수)

**변경 후:**
> 말의 경주 이력에서 직전 경주 날짜를 찾아 오늘 날짜와의 차이 계산
> - 이력 수집: API214_1로 최근 90일 데이터 + hrName 필터링

### 변경 2: ⑭ 배당률(인기도) 계산 방법
**변경 전:**
> 인기도 필드 직접 활용

**변경 후:**
> 같은 경주의 winOdds(단승 배당률)를 오름차순 정렬하여 인기 순위 계산
> - winOdds 최저 → 1인기
> - winOdds 다음 → 2인기

### 추가: 데이터 수집 전략
**원칙:** KRA API가 hr_no 필터링을 지원하지 않으므로
1. **로컬 DB 수집 전략:**
   - 매일 자동으로 KRA API에서 그날의 모든 경주 데이터 수집
   - PostgreSQL에 저장
   - SQL로 hrName, jkNo, trNo 등 빠르게 조회
   
2. **온보딩 시 일괄 수집:**
   - 과거 2년 데이터를 페이지네이션으로 일괄 수집
   - DB 저장 후 백테스트

---

## 🗄️ 권장 DB 스키마 (Phase 1 준비)

```sql
-- 경주 정보
CREATE TABLE races (
  race_date INT,           -- 20260517
  meet INT,                -- 1=서울, 3=부산경남
  rc_no INT,               -- 경주 번호
  rc_dist INT,             -- 거리
  rc_name VARCHAR(50),     -- 경주명
  track VARCHAR(50),       -- "건조 (2%)"
  weather VARCHAR(20),     -- "맑음"
  rc_day VARCHAR(10),      -- "일요일"
  age_cond VARCHAR(50),    -- 연령조건
  prize_cond VARCHAR(50),  -- 상금조건
  PRIMARY KEY (race_date, meet, rc_no)
);

-- 말의 경주 결과
CREATE TABLE horse_results (
  race_date INT,
  meet INT,
  rc_no INT,
  chul_no INT,             -- 엔트리 번호
  st_ord INT,              -- 실제 출발번호 (stOrd from racedetailresult)
  hr_no VARCHAR(10),       -- 마번
  hr_name VARCHAR(30),     -- 마명
  age INT,
  sex VARCHAR(5),
  rating INT,
  ord INT,                 -- 최종 착순
  rc_time DECIMAL(5,1),
  diff_unit VARCHAR(10),
  wg_budam INT,            -- 부담중량
  wg_hr_str VARCHAR(20),   -- "463(+3)" 원본
  wg_hr INT,               -- 463 (파싱)
  wg_hr_diff INT,          -- +3 (파싱)
  win_odds DECIMAL(6,2),
  plc_odds DECIMAL(6,2),
  jk_no VARCHAR(10),
  jk_name VARCHAR(20),
  tr_no VARCHAR(10),
  tr_name VARCHAR(20),
  PRIMARY KEY (race_date, meet, rc_no, hr_no),
  FOREIGN KEY (race_date, meet, rc_no) REFERENCES races
);

-- 말 정보 + 혈통
CREATE TABLE horses (
  hr_no VARCHAR(10) PRIMARY KEY,
  hr_name VARCHAR(30),
  birthday INT,
  foalg_dt DATE,
  sex VARCHAR(5),
  pcty_nm VARCHAR(20),     -- 산지
  spcs_nm VARCHAR(20),     -- 품종
  sire_hr_nm VARCHAR(30),  -- 부마
  dam_hr_nm VARCHAR(30),   -- 모마
  -- API284 dsa 지수들
  dsa_bri_vl INT,
  dsa_clc_vl INT,
  dsa_ier_vl INT,
  dsa_prf_vl INT,
  dsidx_vl INT
);

-- 가중치 히스토리
CREATE TABLE weight_history (
  id SERIAL PRIMARY KEY,
  period_start DATE,
  period_end DATE,
  race_count INT,
  weights JSONB,           -- { rating: 20, ... }
  correlations JSONB,      -- { rating: 0.62, ... }
  applied_at TIMESTAMP
);

-- 인덱스
CREATE INDEX idx_horse_results_hrname ON horse_results(hr_name);
CREATE INDEX idx_horse_results_jkno ON horse_results(jk_no);
CREATE INDEX idx_horse_results_trno ON horse_results(tr_no);
CREATE INDEX idx_horse_results_date ON horse_results(race_date);
```

---

## ✅ 다음 단계

### 1. PRD v3.1 업데이트
- ⑧ 경주 간격 계산 방법 변경
- ⑭ 배당률(인기도) 계산 방법 변경
- 데이터 수집 전략 추가

### 2. 프로젝트 초기 설정
```bash
mkdir -p src/{engine,api,db,config}
npm init -y
npm install express typescript pg dotenv simple-statistics
npm install -D @types/node @types/express ts-node nodemon
```

### 3. 환경 변수 설정 (.env)
```
KRA_API_KEY=a4f396a7b337db5ab5e319ea7b160624bf0dadf239b9aafab17224db33f23826
DATABASE_URL=postgresql://localhost:5432/kra_app
NODE_ENV=development
```

### 4. Phase 1 구현 시작
- KRA API 클라이언트 (`src/api/kraClient.ts`)
- DB 스키마 적용 (`src/db/schema.sql`)
- Score Engine 핵심 (`src/engine/scoreEngine.ts`)

---

**보고서 작성:** 2026-05-22  
**상태:** ✅ 14개 항목 모두 검증 완료. 2개 항목 PRD 수정 필요.
