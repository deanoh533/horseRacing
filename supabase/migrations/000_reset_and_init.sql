-- ============================================
-- KRA Analyzer - 깨끗한 초기화 + 스키마 적용
-- 한 번에 실행 (DROP → CREATE → INSERT)
-- ============================================

-- Step 1: 모든 기존 테이블 삭제
DROP TABLE IF EXISTS sync_logs CASCADE;
DROP TABLE IF EXISTS ai_usage CASCADE;
DROP TABLE IF EXISTS user_settings CASCADE;
DROP TABLE IF EXISTS horse_insights CASCADE;
DROP TABLE IF EXISTS race_insights CASCADE;
DROP TABLE IF EXISTS predictions CASCADE;
DROP TABLE IF EXISTS weight_history CASCADE;
DROP TABLE IF EXISTS trainers CASCADE;
DROP TABLE IF EXISTS jockeys CASCADE;
DROP TABLE IF EXISTS horses CASCADE;
DROP TABLE IF EXISTS horse_results CASCADE;
DROP TABLE IF EXISTS races CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Step 2: 테이블 생성

-- 경주 정보
CREATE TABLE races (
  race_date INT NOT NULL,
  meet INT NOT NULL,
  rc_no INT NOT NULL,
  rc_dist INT,
  rc_name VARCHAR(50),
  rc_day VARCHAR(10),
  track VARCHAR(30),
  track_type VARCHAR(10),
  weather VARCHAR(20),
  age_cond VARCHAR(50),
  prize_cond VARCHAR(50),
  chaksun1 BIGINT,
  chaksun2 BIGINT,
  chaksun3 BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (race_date, meet, rc_no)
);

-- 말의 경주 결과
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
  rank_rise INT DEFAULT 0,
  ord INT,
  rc_time DECIMAL(5,1),
  diff_unit VARCHAR(10),
  rc_dist INT,
  track VARCHAR(30),
  track_type VARCHAR(10),
  wg_budam INT,
  wg_hr_str VARCHAR(20),
  wg_hr INT,
  wg_hr_diff INT,
  wg_jk INT,
  win_odds DECIMAL(6,2),
  plc_odds DECIMAL(6,2),
  popularity INT,
  jk_no VARCHAR(10),
  jk_name VARCHAR(20),
  tr_no VARCHAR(10),
  tr_name VARCHAR(20),
  bu_g1f_acc_time DECIMAL(5,2),
  bu_g2f_acc_time DECIMAL(5,2),
  bu_g3f_acc_time DECIMAL(5,2),
  bu_g4f_acc_time DECIMAL(5,2),
  bu_g6f_acc_time DECIMAL(5,2),
  bu_g8f_acc_time DECIMAL(5,2),
  bu_s1f_acc_time DECIMAL(5,2),
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

-- 말 정보 + 혈통
CREATE TABLE horses (
  hr_no VARCHAR(10) PRIMARY KEY,
  hr_name VARCHAR(30) NOT NULL,
  eng_hr_name VARCHAR(50),
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
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_horses_name ON horses(hr_name);
CREATE INDEX idx_horses_sire ON horses(sire_hr_nm);

-- 기수/조교사
CREATE TABLE jockeys (
  jk_no VARCHAR(10) PRIMARY KEY,
  jk_name VARCHAR(20),
  meet INT,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trainers (
  tr_no VARCHAR(10) PRIMARY KEY,
  tr_name VARCHAR(20),
  meet INT,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- 가중치 히스토리
CREATE TABLE weight_history (
  id SERIAL PRIMARY KEY,
  period_start DATE,
  period_end DATE,
  race_count INT,
  weights JSONB NOT NULL,
  correlations JSONB NOT NULL,
  optimal_weights JSONB,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- 예측 결과
CREATE TABLE predictions (
  id SERIAL PRIMARY KEY,
  race_date INT,
  meet INT,
  rc_no INT,
  hr_name VARCHAR(30),
  total_score DECIMAL(5,2),
  predicted_rank INT,
  win_probability DECIMAL(5,2),
  place_probability DECIMAL(5,2),
  show_probability DECIMAL(5,2),
  item_scores JSONB,
  is_dark_horse BOOLEAN DEFAULT FALSE,
  actual_ord INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_predictions_race ON predictions(race_date, meet, rc_no);
CREATE INDEX idx_predictions_horse ON predictions(hr_name);

-- AI 인사이트 캐싱 (배치)
CREATE TABLE race_insights (
  race_date INT NOT NULL,
  meet INT NOT NULL,
  rc_no INT NOT NULL,
  insight_type VARCHAR(20) NOT NULL,
  insight_text TEXT NOT NULL,
  prompt_hash VARCHAR(64),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (race_date, meet, rc_no, insight_type)
);

-- AI 인사이트 캐싱 (Lazy)
CREATE TABLE horse_insights (
  race_date INT NOT NULL,
  meet INT NOT NULL,
  rc_no INT NOT NULL,
  hr_name VARCHAR(30) NOT NULL,
  indicator_id VARCHAR(30) NOT NULL,
  insight_text TEXT NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (race_date, meet, rc_no, hr_name, indicator_id)
);

CREATE INDEX idx_horse_insights_expires ON horse_insights(expires_at);

-- 사용자 설정
CREATE TABLE user_settings (
  id INT PRIMARY KEY DEFAULT 1,
  insight_indicators JSONB,
  ai_enabled BOOLEAN DEFAULT TRUE,
  ai_monthly_limit DECIMAL(6,2) DEFAULT 5.00,
  ai_daily_limit DECIMAL(6,2) DEFAULT 0.20,
  theme VARCHAR(10) DEFAULT 'dark',
  language VARCHAR(5) DEFAULT 'ko',
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- AI 사용량 추적
CREATE TABLE ai_usage (
  id SERIAL PRIMARY KEY,
  call_type VARCHAR(20),
  input_tokens INT,
  output_tokens INT,
  cost_usd DECIMAL(10,6),
  model VARCHAR(30),
  called_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_date ON ai_usage(called_at DESC);

-- 동기화 로그
CREATE TABLE sync_logs (
  id SERIAL PRIMARY KEY,
  sync_type VARCHAR(20),
  start_date INT,
  end_date INT,
  races_synced INT,
  horses_synced INT,
  errors JSONB,
  status VARCHAR(20),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 트리거: updated_at 자동 갱신
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_races_updated_at BEFORE UPDATE ON races
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Step 3: 기본 사용자 설정 삽입
INSERT INTO user_settings (id, insight_indicators) VALUES (
  1,
  '["03_recent_form", "06_distance_fitness", "09_jockey_form", "16_jockey_horse_chemistry"]'::jsonb
);

-- Step 4: PostgREST 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
