# 🏆 KRA 한국 경마 분석 앱 - PRD v3.1 (데이터 검증 반영)

**최종 확정일:** 2026-05-22  
**버전:** v3.2 (v3.1 + 배포 아키텍처 변경)  
**기술 스택:** React + Node.js + Supabase PostgreSQL  
**배포:** Vercel (프론트+백엔드) + Supabase (DB) — **완전 무료!**

---

## 📋 v3.0 → v3.1 변경 사항

| 변경 # | 항목 | 변경 내용 |
|--------|------|-----------|
| 1 | ⑧ 경주 간격 | **`ilsu` 필드 사용 불가 → 말 이력 기반 직접 계산** |
| 2 | ⑭ 배당률 | **`popularity` 필드 없음 → `winOdds` 정렬로 인기 순위 계산** |
| 3 | API 엔드포인트 | **5개 KRA API 정확한 endpoint 추가** |
| 4 | 데이터 수집 전략 | **`hr_no` 필터링 불가 → PostgreSQL 로컬 캐싱** |
| 5 | DB 스키마 | **검증된 필드 기반 완성된 스키마 추가** |

---

## 1️⃣ 서비스 개요

### 1-1. 목표
경마 경주 예측 정확도를 **데이터 기반 + 자동 학습**으로 극대화

### 1-2. 핵심 기능
- **14개 항목 점수 엔진** → 경주별 말(馬) 순위 예측 (0~100점)
- **스피어만 상관계수** → 항목별 예측력 자동 측정
- **점진적 가중치 진화** → 3개월 단위 재학습
- **온보딩 백테스트** → 첫 실행 시 과거 2년 데이터로 초기화

### 1-3. 타겟 사용자
- 경마 분석가, 베팅 애호가
- 데이터 기반 의사결정을 원하는 사람

---

## 2️⃣ KRA API 엔드포인트 (검증 완료) ⭐ NEW

| API | URL | 용도 | 주요 필드 |
|-----|-----|------|----------|
| **API214_1** | `/B551015/API214_1/RaceDetailResult_1` | 경주 결과 | rating, ord, wgBudam, wgHr, winOdds 등 |
| **API4_3** | `/B551015/API4_3/raceResult_3` | 경주 기록 | (API214_1과 동일 데이터) |
| **racedetailresult** | `/B551015/racedetailresult/getracedetailresult` | 상세 성적 | **stOrd**(실제 출발번호) |
| **API284** | `/B551015/API284/HorseBloodBasicInfo` | 혈통 정보 | dsaBriVl, dsaClcVl, dsaIerVl |
| **horseinfohi** | `/B551015/horseinfohi/gethorseinfohi` | 말 정보 | sireHrnm(부마), damHrnm(모마) |

### 공통 파라미터
- `serviceKey`: 인증키 (⚠️ .env로 분리)
- `_type=json`
- `pageNo`, `numOfRows`: 페이지네이션
- `meet`: 1=서울, 2=제주, 3=부산경남
- `rc_date`: 경주일자 (YYYYMMDD)
- `rc_no`: 경주번호

### ⚠️ 중요 제약사항
- **`hr_no`, `hr_name` 필터링 불가**: API가 무시함
- **해결책**: PostgreSQL에 데이터 캐싱 후 SQL로 필터링

---

## 3️⃣ 전체 예측 흐름 (8단계)

```
STEP 1. 경주 선택
  └─ 날짜 + 경마장 선택 → DB 조회 또는 KRA API 호출

STEP 2. 출전마 데이터 수집
  └─ DB에서 출전마 정보 + 과거 이력 조회

STEP 3. Score Engine 실행
  └─ 14개 항목 점수 계산 (원점수 0~1.0 × 가중치)

STEP 4. 사용자 현장 정보 입력 (선택)
  └─ 조교상태·컨디션·날씨 → 표시용 점수만 수정

STEP 5. AI 보정 (선택)
  └─ Claude API → 예측 점수 미세 조정

STEP 6. 예측 결과 표시
  └─ 순위 + 확률(1위/2위/3위) + 신뢰도 표시

STEP 7. 경주 후 결과 저장
  └─ 실제 착순 입력 → 프로그램 예측과 비교

STEP 8. 백테스트 & 가중치 진화
  └─ 스피어만 상관계수 계산 → 가중치 자동 조정
```

---

## 4️⃣ 데이터 수집 전략 ⭐ NEW

### 4-1. 일일 데이터 수집 (Daily Sync)

```javascript
// 매일 새벽 자동 실행 (cron job)
async function dailySync() {
  const yesterday = formatDate(new Date() - 1day);
  
  for (const meet of [1, 3]) { // 서울, 부산경남 (제주 제외)
    // 1. 모든 경주 데이터 페이지네이션 수집
    let pageNo = 1;
    while (true) {
      const data = await callAPI('API214_1', {
        meet, rc_date: yesterday, pageNo, numOfRows: 100
      });
      if (data.body.items.item.length === 0) break;
      
      // 2. PostgreSQL에 저장
      await saveHorseResults(data.body.items.item);
      pageNo++;
    }
    
    // 3. racedetailresult (stOrd 보강)
    await syncRaceDetailResults(meet, yesterday);
  }
}
```

### 4-2. 온보딩 일괄 수집 (Bulk Sync)

```javascript
// 최초 실행 시: 과거 2년 데이터 일괄 수집
async function onboardingSync() {
  const startDate = subtract(today, 730days);
  const endDate = today;
  
  const dates = generateDateList(startDate, endDate);
  
  for (const date of dates) {
    await dailySync(date); // 각 날짜별 수집
    
    // 진행률 업데이트 (UI)
    updateProgress(dates.indexOf(date) / dates.length);
  }
}
```

### 4-3. 혈통 정보 캐싱

```javascript
// 말 등장 시점에 혈통 정보 한 번만 수집
async function syncHorseInfo(hr_no) {
  if (await isInDB(hr_no)) return; // 캐시 히트
  
  // API284: 혈통 지수
  const blood = await callAPI('API284/HorseBloodBasicInfo', { hr_no });
  
  // horseinfohi: 부마/모마
  const info = await callAPI('horseinfohi/gethorseinfohi', { hrno: hr_no });
  
  // 모부마 = 모마를 다시 조회
  const damInfo = await callAPI('horseinfohi/gethorseinfohi', { 
    hr_name: info.damHrnm 
  });
  
  await saveHorseInfo({
    hr_no,
    sireHrnm: info.sireHrnm,
    damHrnm: info.damHrnm,
    damSireHrnm: damInfo.sireHrnm, // 모부마
    ...blood
  });
}
```

---

## 5️⃣ 14개 점수 항목 (v3.1 업데이트)

### ① 레이팅 (20점) ✅ (변경 없음)
- 필드: `rating` (API214_1)
- 계산: `rating / 140`
- 이력없음: 0점 (6등급 미부여)

### ② 최근 5경주 착순 (15점) ✅
- 데이터: DB에서 hrName으로 필터링
- 계산: 착순 배점(1=3/2=2/3=1) 합산 / 15

### ③ 거리 적합성 (10점) ✅
- 필드: `rcDist`
- 데이터: 같은 거리 경주만 필터링
- 계산: 3위 이내 횟수 / 기준 경주 수

### ④ 주로 적응 (10점) ✅
- 필드: `track` (예: "건조 (2%)")
- 데이터: 같은 주로 상태 필터링
- 계산: 향상도 (전체평균 - 해당주로평균)

### ⑤ 부담중량/마체중 (5점) ⏸ 전문가
- 필드: `wgBudam`(integer), `wgHr`(string: "463(+3)")
- **파싱 필요**: `wgHr`에서 463(체중)과 +3(변화) 추출
```javascript
function parseWgHr(wgHr) {
  const match = wgHr.match(/(\d+)\(([+-]?\d+)\)/);
  return {
    weight: parseInt(match[1]),
    diff: parseInt(match[2])
  };
}
// "463(+3)" → { weight: 463, diff: 3 }
```

### ⑥ 기수 폼 (12점) ✅
- 필드: `jkNo`, `jkName`, `ord`
- 데이터: 최근 30일 + jkNo 필터링
- 계산: 가중 점수 / (출전 횟수 × 3)
- 데이터 부족: 5회 미만 → 중립값 0.5

### ⑦ 조교사 폼 (8점) ✅
- 필드: `trNo`, `trName`, `ord`
- 데이터: 최근 30일 + trNo 필터링 (마방 전체)
- 계산: 마방 가중 점수 / (총 출전 × 3)
- 데이터 부족: 10회 미만 → 중립값 0.5

### ⑧ 경주 간격 (4점) 🔧 **변경됨** ⭐
**v3.0:** `ilsu` 필드 직접 사용  
**v3.1:** 말 이력에서 직전 경주 날짜 추출

```javascript
async function calculateRaceInterval(hrName, todayRcDate) {
  // 1. DB에서 해당 말의 최근 경주 조회 (오늘 제외)
  const prevRace = await db.query(`
    SELECT rc_date FROM horse_results 
    WHERE hr_name = $1 AND rc_date < $2
    ORDER BY rc_date DESC 
    LIMIT 1
  `, [hrName, todayRcDate]);
  
  if (!prevRace) return null; // 데뷔전
  
  // 2. 일수 차이 계산
  const today = parseDate(todayRcDate);
  const previous = parseDate(prevRace.rc_date);
  const interval = differenceInDays(today, previous);
  
  // 3. 구간별 점수
  if (interval < 14) return 0;        // 너무 짧음
  if (interval <= 27) return 1;
  if (interval <= 35) return 4;        // 최적 (만점)
  if (interval <= 60) return 2;
  if (interval <= 90) return 1;
  return 0;                            // 90일 초과
}
```

**⚠️ ilsu 필드 의미:** 경마장 운영일 카운터 (말 단위 휴식일수 아님)

### ⑨ 출발번호 (3점) ✅ (변경 없음)
- 필드: `stOrd` (racedetailresult)
- 계산: `(출전두수 - stOrd) / (출전두수 - 1)`
- 거리별 가중치:
  - 단거리(≤1400m): 100% 반영
  - 중거리(1400~1600m): 50% 수렴
  - 장거리(≥1800m): 20% 수렴

### ⑩ 나이×거리×성별 (3점) ⏸ 전문가
- 필드: `age`, `sex`("거"/"암"/"수"), `rcDist`
- 거리 구간:
  - 단거리: 1000~1400m
  - 중거리: 1400~1600m
  - 장거리: 1600~1900m
  - 최장거리: 2000m+
- 임시 테이블 적용 (전문가 조언 대기)

### ⑪ 혈통 (3대) (5점) ⏸ 전문가
- **데이터 소스 2개:**
  1. API284 (`HorseBloodBasicInfo`):
     - `dsaBriVl`: 부마 가치
     - `dsaClcVl`: 종합 가치
     - `dsaIerVl`: 모마 가치
  2. horseinfohi:
     - `sireHrnm`: 부마명
     - `damHrnm`: 모마명
     - 모부마는 모마 재조회로 획득
- 계산: 부마 50% + 모마 30% + 모부마 20%

### ⑫ 계절 패턴 (5점) ✅
- 필드: `rcDate` (예: 20260517)
- 시즌 분류:
  - 여름: 4~9월
  - 겨울: 10~3월
- 계산: 해당 시즌 3위 이내 비율

### ⑬ 기수-말 궁합 (4점) ✅
- 데이터: DB에서 hrName + jkNo 조합 이력
- 계산: 향상도 × 신뢰도 계수
- 신뢰도:
  - 1회: 0.5
  - 2회: 0.7
  - 3회: 0.85
  - 4회: 0.95
  - 5회+: 1.0

### ⑭ 배당률(인기도) (10점) 🔧 **변경됨** ⭐
**v3.0:** `popularity` 필드 직접 사용  
**v3.1:** `winOdds` 정렬로 인기 순위 계산

```javascript
function calculatePopularity(race) {
  // 1. 한 경주의 모든 말을 winOdds 오름차순 정렬
  const sorted = [...race.horses].sort((a, b) => a.winOdds - b.winOdds);
  
  // 2. 인기 순위 = 정렬 순서 (0-based + 1)
  const popularityMap = {};
  sorted.forEach((horse, idx) => {
    popularityMap[horse.hrName] = idx + 1; // 1인기, 2인기, ...
  });
  
  return popularityMap;
}

// ⑭ 점수 계산
async function calculatePopScore(hrName, todayRcDate) {
  // 1. 최근 5경주 조회
  const recent5 = await db.query(`
    SELECT * FROM horse_results 
    WHERE hr_name = $1 AND rc_date < $2
    ORDER BY rc_date DESC 
    LIMIT 5
  `, [hrName, todayRcDate]);
  
  if (recent5.length === 0) return 0; // 시장 인정 없음
  
  // 2. 각 경주에서 1~2인기였는지 확인
  let count = 0;
  for (const race of recent5) {
    const popularity = await getRacePopularity(race.rc_date, race.meet, race.rc_no);
    if (popularity[hrName] <= 2) count++;
  }
  
  return count / 5; // 원점수 0~1.0
}
```

---

## 6️⃣ DB 스키마 (PostgreSQL) ⭐ NEW

```sql
-- 경주 정보
CREATE TABLE races (
  race_date INT NOT NULL,            -- 20260517
  meet INT NOT NULL,                 -- 1=서울, 3=부산경남
  rc_no INT NOT NULL,                -- 경주 번호
  rc_dist INT,                       -- 거리(m)
  rc_name VARCHAR(50),               -- 경주명
  rc_day VARCHAR(10),                -- "일요일"
  track VARCHAR(30),                 -- "건조 (2%)"
  weather VARCHAR(20),               -- "맑음"
  age_cond VARCHAR(50),              -- "연령오픈"
  prize_cond VARCHAR(50),            -- "R0~0"
  chaksun1 BIGINT,                   -- 1착 상금
  chaksun2 BIGINT,
  chaksun3 BIGINT,
  PRIMARY KEY (race_date, meet, rc_no)
);

-- 말의 경주 결과
CREATE TABLE horse_results (
  race_date INT NOT NULL,
  meet INT NOT NULL,
  rc_no INT NOT NULL,
  chul_no INT NOT NULL,              -- 엔트리 번호
  st_ord INT,                        -- 실제 출발번호 (racedetailresult)
  hr_no VARCHAR(10) NOT NULL,        -- 마번
  hr_name VARCHAR(30) NOT NULL,      -- 마명
  age INT,
  sex VARCHAR(5),                    -- "거"/"암"/"수"
  rating INT,
  rank_str VARCHAR(20),              -- "국6등급"
  ord INT,                           -- 최종 착순
  rc_time DECIMAL(5,1),
  diff_unit VARCHAR(10),
  wg_budam INT,                      -- 부담중량
  wg_hr_str VARCHAR(20),             -- "463(+3)" 원본
  wg_hr INT,                         -- 463
  wg_hr_diff INT,                    -- +3
  win_odds DECIMAL(6,2),
  plc_odds DECIMAL(6,2),
  jk_no VARCHAR(10),
  jk_name VARCHAR(20),
  tr_no VARCHAR(10),
  tr_name VARCHAR(20),
  popularity INT,                     -- 인기 순위 (계산값)
  PRIMARY KEY (race_date, meet, rc_no, hr_no),
  FOREIGN KEY (race_date, meet, rc_no) REFERENCES races
);

-- 말 정보 + 혈통
CREATE TABLE horses (
  hr_no VARCHAR(10) PRIMARY KEY,
  hr_name VARCHAR(30),
  birthday INT,                      -- 20230505
  foalg_dt DATE,
  sex VARCHAR(5),
  pcty_nm VARCHAR(20),               -- 산지 "한국"
  spcs_nm VARCHAR(20),               -- 품종 "더러브렛"
  sire_hr_nm VARCHAR(30),            -- 부마 (sireHrnm)
  dam_hr_nm VARCHAR(30),             -- 모마 (damHrnm)
  dam_sire_hr_nm VARCHAR(30),        -- 모부마 (모마의 부마)
  -- API284 dsa 지수들
  dsa_bri_vl INT,
  dsa_clc_vl INT,
  dsa_ier_vl INT,
  dsa_prf_vl INT,
  dsa_coi_rt INT,
  dsidx_vl INT,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- 기수 정보 (마스터)
CREATE TABLE jockeys (
  jk_no VARCHAR(10) PRIMARY KEY,
  jk_name VARCHAR(20),
  meet INT
);

-- 조교사 정보 (마스터)
CREATE TABLE trainers (
  tr_no VARCHAR(10) PRIMARY KEY,
  tr_name VARCHAR(20),
  meet INT
);

-- 가중치 히스토리
CREATE TABLE weight_history (
  id SERIAL PRIMARY KEY,
  period_start DATE,
  period_end DATE,
  race_count INT,
  weights JSONB NOT NULL,            -- {rating: 20, recentWins: 15, ...}
  correlations JSONB NOT NULL,       -- {rating: 0.62, recentWins: 0.71, ...}
  optimal_weights JSONB,             -- 이상치 가중치 (참고)
  applied_at TIMESTAMP DEFAULT NOW()
);

-- 예측 결과
CREATE TABLE predictions (
  id SERIAL PRIMARY KEY,
  race_date INT,
  meet INT,
  rc_no INT,
  hr_name VARCHAR(30),
  predicted_score DECIMAL(5,2),      -- 0~100점
  predicted_rank INT,                -- 예측 순위
  item_scores JSONB,                 -- {rating: 14.0, recentWins: 9.0, ...}
  actual_ord INT,                    -- 실제 착순 (사후 입력)
  created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_horse_results_hrname ON horse_results(hr_name);
CREATE INDEX idx_horse_results_jkno ON horse_results(jk_no);
CREATE INDEX idx_horse_results_trno ON horse_results(tr_no);
CREATE INDEX idx_horse_results_date ON horse_results(race_date DESC);
CREATE INDEX idx_horse_results_dist ON horse_results(rc_dist);
CREATE INDEX idx_predictions_race ON predictions(race_date, meet, rc_no);
```

---

## 7️⃣ 스피어만 상관계수 & 가중치 자동 조정 (v3.0 유지)

### 7-1. 스피어만 상관계수 핵심 공식
```
r = 1 - (6 × d²합계) / (n × (n²-1))
  - n: 출전 두수
  - d: (예측 순위 - 실제 착순)
```

### 7-2. 적정 가중치 역산
```
각 항목별 상관계수 합계 = totalCorr
적정 가중치_i = (corr_i / totalCorr) × 100점
```

### 7-3. 점진적 수렴
```
새 가중치 = (현재 가중치 + 적정 가중치) / 2
```

### 7-4. 워크포워드 백테스트
- 과거 2년: 7개 구간 (기초 6개월 + 검증 6×3개월)
- 매 3개월마다 가중치 재조정

---

## 8️⃣ UI/UX (v3.0 유지)

6개 탭:
1. **Tab 1: 예측** - 경주 선택 + 출전마 점수 표시
2. **Tab 2: 결과 입력** - 실제 착순 입력 + 비교
3. **Tab 3: 통계** - 상관계수 차트
4. **Tab 4: 가중치 히스토리** - 시계열 변화
5. **Tab 5: AI 힌트** - Claude API 가중치 제안
6. **Tab 6: 설정** - API 키 + 온보딩

---

## 9️⃣ 개발 단계별 계획

### Phase 1: KRA API 클라이언트 + DB 셋업 ⭐ 우선
```
src/
├── api/
│   ├── kraClient.ts          // 5개 API 클라이언트
│   └── types.ts              // 응답 타입 정의
├── db/
│   ├── schema.sql            // PostgreSQL 스키마
│   ├── seedData.ts           // 초기 데이터
│   └── queries.ts            // 쿼리 모음
└── sync/
    ├── dailySync.ts          // 일일 데이터 수집
    └── onboardingSync.ts     // 온보딩 일괄 수집
```

### Phase 2: Score Engine
```
src/
└── engine/
    ├── scoreEngine.ts         // 14개 항목 통합
    ├── scoreItems/            // 10개 확정 항목
    ├── errorAnalysis.ts       // 스피어만 상관계수
    └── weightAdjuster.ts      // 가중치 조정
```

### Phase 3: REST API & 백테스트
```
src/
└── api/
    ├── routes/
    │   ├── predict.ts
    │   ├── backtest.ts
    │   └── weights.ts
    └── server.ts              // Express 서버
```

### Phase 4: 프론트엔드
```
client/
├── src/
│   ├── pages/
│   │   ├── Predict.tsx
│   │   ├── Results.tsx
│   │   ├── Stats.tsx
│   │   ├── History.tsx
│   │   ├── AIHints.tsx
│   │   └── Settings.tsx
│   └── components/
└── public/
```

### Phase 5: 배포
- Vercel: 프론트
- Railway: 백엔드 + PostgreSQL

---

## 🔟 .env 환경 변수 설정

```bash
# .env (절대 git에 커밋하지 말 것!)
KRA_API_KEY=발급받은_인증키
DATABASE_URL=postgresql://localhost:5432/kra_app
PORT=3000
NODE_ENV=development

# Claude API (Phase 3+)
ANTHROPIC_API_KEY=
```

---

## 1️⃣1️⃣ 주의사항 (v3.0 유지)

⚠️ **전문가 조언 필요 항목**
- ⑤ 부담중량/마체중
- ⑩ 나이×거리×성별
- ⑪ 혈통

⚠️ **데이터 한계**
- 과거 ≠ 미래
- 특수경주 제외
- 3개월 단위 재계산으로 트렌드 반영

⚠️ **검증된 제약 (v3.1 신규)**
- `hr_no` 파라미터 필터링 불가 → DB 캐싱 필수
- `ilsu` 필드는 휴식일수 아님 → 말 이력 기반 계산
- `popularity` 필드 없음 → winOdds 정렬 계산

---

## ✅ 다음 단계 (Phase 1 시작)

1. ✅ KRA API 검증 완료
2. ✅ PRD v3.1 업데이트 완료
3. ⏭️ **프로젝트 초기 설정**
4. ⏭️ **KRA API 클라이언트 구현**
5. ⏭️ **DB 스키마 적용**
6. ⏭️ **데이터 수집 스크립트**
7. ⏭️ **Score Engine 구현**

---

**문서 작성:** 2026-05-22  
**버전:** KRA PRD v3.1  
**상태:** ✅ 검증 완료 + PRD 업데이트 완료
