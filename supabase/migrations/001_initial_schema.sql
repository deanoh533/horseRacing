-- ============================================
-- KRA Analyzer 초기 스키마 (v5.1 - 17개 항목)
-- 작성일: 2026-05-22
-- ============================================

-- ============================================
-- 1. 경주 정보
-- ============================================
CREATE TABLE IF NOT EXISTS races (
  race_date INT NOT NULL,            -- 20260517
  meet INT NOT NULL,                 -- 1=서울, 3=부산경남
  rc_no INT NOT NULL,                -- 경주 번호
  rc_dist INT,                       -- 거리 (m)
  rc_name VARCHAR(50),
  rc_day VARCHAR(10),                -- "일요일"
  track VARCHAR(30),                 -- "건조 (2%)"
  track_type VARCHAR(10),            -- "건조" (추출)
  weather VARCHAR(20),               -- "맑음"
  age_cond VARCHAR(50),
  prize_cond VARCHAR(50),
  chaksun1 BIGINT,
  chaksun2 BIGINT,
  chaksun3 BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (race_date, meet, rc_no)
);

-- ============================================
-- 2. 말의 경주 결과
-- ============================================
CREATE TABLE IF NOT EXISTS horse_results (
  race_date INT NOT NULL,
  meet INT NOT NULL,
  rc_no INT NOT NULL,
  chul_no INT NOT NULL,              -- 엔트리 번호
  st_ord INT,                        -- 실제 출발번호 (racedetailresult)
  hr_no VARCHAR(10) NOT NULL,
  hr_name VARCHAR(30) NOT NULL,
  age INT,
  sex VARCHAR(5),                    -- "거"/"암"/"수"
  rating INT,
  rank_str VARCHAR(20),              -- "국6등급"
  rank_rise INT DEFAULT 0,           -- 미사용 (저장만)
  ord INT,                           -- 최종 착순
  rc_time DECIMAL(5,1),
  diff_unit VARCHAR(10),
  rc_dist INT,                       -- 거리 (비정규화, 빠른 조회용)
  track VARCHAR(30),                 -- 주로 (비정규화, 빠른 조회용)
  track_type VARCHAR(10),            -- "건조" 등 추출값
  wg_budam INT,                      -- 부담중량
  wg_hr_str VARCHAR(20),             -- "463(+3)"
  wg_hr INT,                         -- 463 (파싱)
  wg_hr_diff INT,                    -- +3
  wg_jk INT,                         -- 기수 체중
  win_odds DECIMAL(6,2),
  plc_odds DECIMAL(6,2),
  popularity INT,                    -- 인기 순위 (winOdds 정렬 후 계산)
  jk_no VARCHAR(10),
  jk_name VARCHAR(20),
  tr_no VARCHAR(10),
  tr_name VARCHAR(20),

  -- 구간별 시간 (펄롱별)
  bu_g1f_acc_time DECIMAL(5,2),
  bu_g2f_acc_time DECIMAL(5,2),
  bu_g3f_acc_time DECIMAL(5,2),
  bu_g4f_acc_time DECIMAL(5,2),
  bu_g6f_acc_time DECIMAL(5,2),
  bu_g8f_acc_time DECIMAL(5,2),
  bu_s1f_acc_time DECIMAL(5,2),

  -- 구간별 순위
  bu_g1f_ord INT,
  bu_g2f_ord INT,
  bu_g3f_ord INT,
  bu_g4f_ord INT,
  bu_s1f_ord INT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (race_date, meet, rc_no, hr_no),
  FOREIGN KEY (race_date, meet, rc_no) REFERENCES races(race_date, meet, rc_no)
);

CREATE INDEX idx_horse_results_hrname ON horse_results(hr_name);
CREATE INDEX idx_horse_results_jkno ON horse_results(jk_no);
CREATE INDEX idx_horse_results_trno ON horse_results(tr_no);
CREATE INDEX idx_horse_results_date ON horse_results(race_date DESC);
CREATE INDEX idx_horse_results_dist ON horse_results(rc_dist);
CREATE INDEX idx_horse_results_track ON horse_results(track);

-- ============================================
-- 3. 말 정보 + 혈통
-- ============================================
CREATE TABLE IF NOT EXISTS horses (
  hr_no VARCHAR(10) PRIMARY KEY,
  hr_name VARCHAR(30) NOT NULL,
  eng_hr_name VARCHAR(50),
  birthday INT,
  foalg_dt DATE,
  sex VARCHAR(5),
  pcty_nm VARCHAR(20),               -- 산지
  spcs_nm VARCHAR(20),               -- 품종
  sire_hr_nm VARCHAR(30),            -- 부마
  dam_hr_nm VARCHAR(30),             -- 모마
  dam_sire_hr_nm VARCHAR(30),        -- 모부마

  -- API284 혈통 지수
  dsa_bri_vl INT,
  dsa_clc_vl INT,
  dsa_ier_vl INT,
  dsa_prf_vl INT,
  dsa_coi_rt INT,
  dsidx_vl INT,

  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_horses_name ON horses(hr_name);
CREATE INDEX idx_horses_sire ON horses(sire_hr_nm);

-- ============================================
-- 4. 기수/조교사 마스터
-- ============================================
CREATE TABLE IF NOT EXISTS jockeys (
  jk_no VARCHAR(10) PRIMARY KEY,
  jk_name VARCHAR(20),
  meet INT,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trainers (
  tr_no VARCHAR(10) PRIMARY KEY,
  tr_name VARCHAR(20),
  meet INT,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 5. 가중치 히스토리 (학습 결과)
-- ============================================
CREATE TABLE IF NOT EXISTS weight_history (
  id SERIAL PRIMARY KEY,
  period_start DATE,
  period_end DATE,
  race_count INT,
  weights JSONB NOT NULL,           -- {item_1: 17.5, item_2: 4.21, ...}
  correlations JSONB NOT NULL,      -- {item_1: 0.62, ...}
  optimal_weights JSONB,            -- 시스템 제안 (참고)
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 6. 예측 결과
-- ============================================
CREATE TABLE IF NOT EXISTS predictions (
  id SERIAL PRIMARY KEY,
  race_date INT,
  meet INT,
  rc_no INT,
  hr_name VARCHAR(30),
  total_score DECIMAL(5,2),         -- 종합 점수 (0-100)
  predicted_rank INT,
  win_probability DECIMAL(5,2),
  place_probability DECIMAL(5,2),
  show_probability DECIMAL(5,2),
  item_scores JSONB,                -- {item_1: 17.0, item_2: 4.0, ...}
  is_dark_horse BOOLEAN DEFAULT FALSE,
  actual_ord INT,                   -- 실제 착순 (사후 자동 입력)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_predictions_race ON predictions(race_date, meet, rc_no);
CREATE INDEX idx_predictions_horse ON predictions(hr_name);

-- ============================================
-- 7. AI 인사이트 캐싱 (배치)
-- ============================================
CREATE TABLE IF NOT EXISTS race_insights (
  race_date INT NOT NULL,
  meet INT NOT NULL,
  rc_no INT NOT NULL,
  insight_type VARCHAR(20) NOT NULL, -- 'summary', 'dark_horse', 'top1_analysis'
  insight_text TEXT NOT NULL,
  prompt_hash VARCHAR(64),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (race_date, meet, rc_no, insight_type)
);

-- ============================================
-- 8. AI 인사이트 캐싱 (Lazy, 24h TTL)
-- ============================================
CREATE TABLE IF NOT EXISTS horse_insights (
  race_date INT NOT NULL,
  meet INT NOT NULL,
  rc_no INT NOT NULL,
  hr_name VARCHAR(30) NOT NULL,
  indicator_id VARCHAR(30) NOT NULL, -- '03_recent_form', etc.
  insight_text TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (race_date, meet, rc_no, hr_name, indicator_id)
);

CREATE INDEX idx_horse_insights_expires ON horse_insights(expires_at);

-- ============================================
-- 9. 사용자 설정 (인사이트 4개 선택 등)
-- ============================================
CREATE TABLE IF NOT EXISTS user_settings (
  id INT PRIMARY KEY DEFAULT 1,     -- 개인 도구라 단일 사용자
  insight_indicators JSONB DEFAULT '["03_recent_form", "06_distance_fitness", "09_jockey_form", "16_jockey_horse_chemistry"]',
  ai_enabled BOOLEAN DEFAULT TRUE,
  ai_monthly_limit DECIMAL(6,2) DEFAULT 5.00,
  ai_daily_limit DECIMAL(6,2) DEFAULT 0.20,
  theme VARCHAR(10) DEFAULT 'dark',
  language VARCHAR(5) DEFAULT 'ko',
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- 기본 설정 자동 삽입
INSERT INTO user_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ============================================
-- 10. AI 사용량 추적
-- ============================================
CREATE TABLE IF NOT EXISTS ai_usage (
  id SERIAL PRIMARY KEY,
  call_type VARCHAR(20),            -- 'race_summary', 'horse_insight', etc.
  input_tokens INT,
  output_tokens INT,
  cost_usd DECIMAL(10,6),
  model VARCHAR(30),                -- 'claude-haiku-4-5'
  called_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_date ON ai_usage(called_at DESC);

-- ============================================
-- 11. 동기화 로그
-- ============================================
CREATE TABLE IF NOT EXISTS sync_logs (
  id SERIAL PRIMARY KEY,
  sync_type VARCHAR(20),            -- 'daily', 'onboarding', 'manual'
  start_date INT,
  end_date INT,
  races_synced INT,
  horses_synced INT,
  errors JSONB,
  status VARCHAR(20),               -- 'success', 'partial', 'failed'
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================
-- 트리거: updated_at 자동 갱신
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_races_updated_at BEFORE UPDATE ON races
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
