# 🚀 KRA 경마 분석 앱 - 셋업 가이드 (Supabase + Vercel)

**최종 아키텍처:** 완전 무료 ✅

```
┌─────────────────────────────────────┐
│  프론트엔드: React (Vercel)          │
├─────────────────────────────────────┤
│  백엔드: Vercel Serverless Functions │
├─────────────────────────────────────┤
│  DB: Supabase PostgreSQL (500MB)    │
└─────────────────────────────────────┘
```

---

## 📋 셋업 순서

### 1️⃣ Supabase 프로젝트 생성 (5분)

**Step 1: 가입**
```
1. https://supabase.com 접속
2. "Start your project" 클릭
3. GitHub 계정으로 로그인 ✅ (이미 있음)
```

**Step 2: 프로젝트 생성**
```
1. "New Project" 클릭
2. 프로젝트 정보 입력:
   - Name: kra-horse-racing
   - Database Password: (강력한 비밀번호 - 저장 필수!)
   - Region: Northeast Asia (Seoul) ← 한국 선택
   - Pricing Plan: Free
3. "Create new project" 클릭
4. ⏳ 2분 대기 (DB 프로비저닝)
```

**Step 3: 연결 정보 확인**
```
프로젝트 대시보드 → Project Settings → API:
  - Project URL: https://xxxx.supabase.co
  - anon public key: eyJxxxx... (프론트 사용)
  - service_role key: eyJxxxx... (백엔드 사용, 비공개!)

Project Settings → Database:
  - Connection string: postgresql://postgres:[PASSWORD]@xxxx.supabase.co:5432/postgres
```

### 2️⃣ Supabase 스키마 적용 (3분)

**Step 1: SQL Editor 사용**
```
1. Supabase 대시보드 → SQL Editor
2. "New query" 클릭
3. 우리 DB 스키마 붙여넣기 (아래 참조)
4. "Run" 클릭
```

**스키마 SQL (KRA_PRD_v3.1_Final.md 참조):**
```sql
-- 1. 경주 정보
CREATE TABLE races (
  race_date INT NOT NULL,
  meet INT NOT NULL,
  rc_no INT NOT NULL,
  rc_dist INT,
  rc_name VARCHAR(50),
  rc_day VARCHAR(10),
  track VARCHAR(30),
  weather VARCHAR(20),
  age_cond VARCHAR(50),
  prize_cond VARCHAR(50),
  chaksun1 BIGINT,
  chaksun2 BIGINT,
  chaksun3 BIGINT,
  PRIMARY KEY (race_date, meet, rc_no)
);

-- 2. 말의 경주 결과
CREATE TABLE horse_results (
  race_date INT NOT NULL,
  meet INT NOT NULL,
  rc_no INT NOT NULL,
  chul_no INT NOT NULL,
  st_ord INT,
  hr_no VARCHAR(10) NOT NULL,
  hr_name VARCHAR(30) NOT NULL,
  age INT,
  sex VARCHAR(5),
  rating INT,
  rank_str VARCHAR(20),
  ord INT,
  rc_time DECIMAL(5,1),
  diff_unit VARCHAR(10),
  wg_budam INT,
  wg_hr_str VARCHAR(20),
  wg_hr INT,
  wg_hr_diff INT,
  win_odds DECIMAL(6,2),
  plc_odds DECIMAL(6,2),
  jk_no VARCHAR(10),
  jk_name VARCHAR(20),
  tr_no VARCHAR(10),
  tr_name VARCHAR(20),
  popularity INT,
  PRIMARY KEY (race_date, meet, rc_no, hr_no),
  FOREIGN KEY (race_date, meet, rc_no) REFERENCES races(race_date, meet, rc_no)
);

-- 3. 말 정보 + 혈통
CREATE TABLE horses (
  hr_no VARCHAR(10) PRIMARY KEY,
  hr_name VARCHAR(30),
  birthday INT,
  foalg_dt DATE,
  sex VARCHAR(5),
  pcty_nm VARCHAR(20),
  spcs_nm VARCHAR(20),
  sire_hr_nm VARCHAR(30),
  dam_hr_nm VARCHAR(30),
  dam_sire_hr_nm VARCHAR(30),
  dsa_bri_vl INT,
  dsa_clc_vl INT,
  dsa_ier_vl INT,
  dsa_prf_vl INT,
  dsa_coi_rt INT,
  dsidx_vl INT,
  last_updated TIMESTAMP DEFAULT NOW()
);

-- 4. 기수/조교사 마스터
CREATE TABLE jockeys (
  jk_no VARCHAR(10) PRIMARY KEY,
  jk_name VARCHAR(20),
  meet INT
);

CREATE TABLE trainers (
  tr_no VARCHAR(10) PRIMARY KEY,
  tr_name VARCHAR(20),
  meet INT
);

-- 5. 가중치 히스토리
CREATE TABLE weight_history (
  id SERIAL PRIMARY KEY,
  period_start DATE,
  period_end DATE,
  race_count INT,
  weights JSONB NOT NULL,
  correlations JSONB NOT NULL,
  optimal_weights JSONB,
  applied_at TIMESTAMP DEFAULT NOW()
);

-- 6. 예측 결과
CREATE TABLE predictions (
  id SERIAL PRIMARY KEY,
  race_date INT,
  meet INT,
  rc_no INT,
  hr_name VARCHAR(30),
  predicted_score DECIMAL(5,2),
  predicted_rank INT,
  item_scores JSONB,
  actual_ord INT,
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

### 3️⃣ Vercel 배포 (3분)

**Step 1: 가입**
```
1. https://vercel.com 접속
2. "Sign Up" → GitHub 계정으로 로그인
```

**Step 2: 프로젝트 연결**
```
1. "Add New" → "Project"
2. GitHub 저장소 선택: deanoh533/horseRacing
3. 자동 감지된 설정 확인 (Next.js / Vite 등)
4. 환경 변수 설정 (아래 참조)
5. "Deploy" 클릭
```

**Step 3: 환경 변수 설정**
```
Vercel 대시보드 → Settings → Environment Variables:

KRA_API_KEY=a4f396a7b337db5ab5e319ea7b160624bf0dadf239b9aafab17224db33f23826
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJxxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxxx...
DATABASE_URL=postgresql://postgres:[PW]@xxxx.supabase.co:5432/postgres
```

---

## 📦 프로젝트 구조 (권장)

```
kra-horse-racing/
├── api/                        # Vercel Serverless Functions
│   ├── predict.ts              # POST /api/predict
│   ├── backtest.ts             # POST /api/backtest
│   ├── weights.ts              # GET /api/weights
│   └── sync.ts                 # POST /api/sync (데이터 수집)
├── src/                        # 핵심 비즈니스 로직
│   ├── engine/
│   │   ├── scoreEngine.ts
│   │   ├── scoreItems/
│   │   ├── errorAnalysis.ts
│   │   └── weightAdjuster.ts
│   ├── kra/
│   │   ├── kraClient.ts        # 5개 API 클라이언트
│   │   └── types.ts
│   ├── db/
│   │   ├── supabase.ts         # Supabase 클라이언트
│   │   └── queries.ts          # 쿼리 모음
│   └── sync/
│       ├── dailySync.ts
│       └── onboardingSync.ts
├── client/                     # React 프론트엔드
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Predict.tsx
│   │   │   ├── Results.tsx
│   │   │   ├── Stats.tsx
│   │   │   ├── History.tsx
│   │   │   ├── AIHints.tsx
│   │   │   └── Settings.tsx
│   │   ├── components/
│   │   ├── api/                # API 클라이언트 (백엔드 호출)
│   │   └── store/              # 상태 관리
│   └── package.json
├── .env                        # 환경변수 (gitignore 필수!)
├── .env.example                # 환경변수 템플릿
├── .gitignore
├── package.json
├── tsconfig.json
└── vercel.json                 # Vercel 설정
```

---

## 🛠️ 초기 패키지 설치

```bash
# 백엔드 + 프론트엔드 통합 (Vercel Functions 방식)
npm init -y

# 핵심 의존성
npm install @supabase/supabase-js
npm install axios
npm install simple-statistics
npm install date-fns
npm install dotenv

# TypeScript
npm install -D typescript @types/node ts-node

# React (프론트)
npm install react react-dom
npm install -D @types/react @types/react-dom

# 차트 & UI
npm install chart.js react-chartjs-2
npm install ag-grid-react

# 개발 도구
npm install -D nodemon jest @types/jest
```

---

## 🔐 .env 파일

```bash
# .env (git에 커밋 금지!)

# KRA API
KRA_API_KEY=a4f396a7b337db5ab5e319ea7b160624bf0dadf239b9aafab17224db33f23826

# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://postgres:[PW]@xxxx.supabase.co:5432/postgres

# Claude API (Phase 3+)
ANTHROPIC_API_KEY=

# 환경
NODE_ENV=development
PORT=3000
```

---

## 🚀 다음 단계

### Phase 1: 프로젝트 초기 설정
- [ ] 1. GitHub 저장소 정리
- [ ] 2. Supabase 프로젝트 생성
- [ ] 3. DB 스키마 적용
- [ ] 4. Vercel 프로젝트 생성
- [ ] 5. 환경변수 설정

### Phase 2: KRA API 클라이언트
- [ ] 1. `src/kra/kraClient.ts` 구현
- [ ] 2. 5개 API 호출 함수
- [ ] 3. 에러 처리 + 재시도 로직
- [ ] 4. Rate limiting

### Phase 3: 데이터 수집
- [ ] 1. `src/sync/onboardingSync.ts` - 과거 2년 일괄
- [ ] 2. `src/sync/dailySync.ts` - 일일 자동
- [ ] 3. Supabase 저장 로직

### Phase 4: Score Engine
- [ ] 1. 10개 확정 항목 구현
- [ ] 2. 스피어만 상관계수
- [ ] 3. 가중치 조정 로직

### Phase 5: API & UI
- [ ] 1. Vercel Functions (예측 API)
- [ ] 2. React UI (6개 탭)
- [ ] 3. 차트 & 통계 표시

---

**문서 작성:** 2026-05-22  
**상태:** ✅ 셋업 가이드 완료, 코딩 준비 완료
