-- ============================================
-- 005_kra_extension.sql
-- KRA 신규 API 테이블 추가 (P0b)
--   - sectional_records : 사실상 사용 안 함 — API214_1 응답에 이미 포함 (race_entries로 통합 예정)
--   - training_logs     : 일별 훈련 정보 (API18_1/dailyTraining_1) ← 검증됨
--   - jockey_stats      : 기수 통산 성적 (jkpresult/getjkpresult) ← 검증됨
--
-- 주의: 적용은 supabase db push 또는 supabase migration up 으로 수행
-- ============================================

-- ============================================
-- 1. sectional_records — 경주 후 구간별 통과기록
-- ============================================
-- [구독 필요 — 현재 403 Forbidden]
--   신청: https://www.data.go.kr/data/15057859/openapi.do
--   파라미터(포털 명세 확인): meet, rc_date, rc_no, hr_no, hr_name
--   ※ 단, API214_1 응답에 seG1fAccTime 등 구간데이터가 이미 포함됨.
CREATE TABLE IF NOT EXISTS sectional_records (
  race_date  INT NOT NULL,
  meet       INT NOT NULL,          -- 1=서울, 3=부산경남
  rc_no      INT NOT NULL,
  hr_no      VARCHAR(10) NOT NULL,  -- 말 번호

  hr_name    VARCHAR(30),
  chul_no    INT,                   -- 출주번호 (게이트)
  ord        INT,                   -- 착순 (90 이상=비주파 → null 처리)

  -- furlong 단위 누적 통과시간 (초, 소수점 2자리)
  bu_g1f_acc_time DECIMAL(5,2),
  bu_g2f_acc_time DECIMAL(5,2),
  bu_g3f_acc_time DECIMAL(5,2),
  bu_g4f_acc_time DECIMAL(5,2),
  bu_g6f_acc_time DECIMAL(5,2),
  bu_g8f_acc_time DECIMAL(5,2),
  bu_s1f_acc_time DECIMAL(5,2),

  -- 구간 순위
  bu_g1f_ord INT,
  bu_g2f_ord INT,
  bu_g3f_ord INT,
  bu_g4f_ord INT,
  bu_s1f_ord INT,

  fetched_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (race_date, meet, rc_no, hr_no)
);

CREATE INDEX IF NOT EXISTS idx_sectional_race
  ON sectional_records(race_date, meet, rc_no);
CREATE INDEX IF NOT EXISTS idx_sectional_horse
  ON sectional_records(hr_no);

ALTER TABLE sectional_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON sectional_records;
CREATE POLICY "anon_read" ON sectional_records
  FOR SELECT TO anon USING (true);

-- ============================================
-- 2. training_logs — 일별 훈련 정보
-- ============================================
-- 실제 응답 필드명 확인됨 (2026-05-20 probe):
--   chulGubun, hrName, hrNo, meet, part, partNo, prGubun, prNo,
--   run1Cnt, run2Cnt, spTime, stTime, trDate, trName, trTerm
CREATE TABLE IF NOT EXISTS training_logs (
  train_date INT    NOT NULL,        -- 훈련날짜 YYYYMMDD
  meet       INT    NOT NULL,        -- 경마장 코드 (1=서울, 3=부산경남)
  hr_no      VARCHAR(10) NOT NULL,   -- 말 번호
  part       INT    NOT NULL DEFAULT 1, -- 조교 회차 (같은 날 같은 말의 여러 조교)

  hr_name    VARCHAR(30),            -- 말명
  trar_nm    VARCHAR(20),            -- 조교사명
  part_no    INT,                    -- 조 번호
  chul_gubun VARCHAR(30),            -- 출전 구분 ("금주출전예정" 등)
  pr_gubun   VARCHAR(20),            -- 조교 구분
  pr_no      VARCHAR(20),            -- 조교 번호

  run1_cnt   INT,                    -- 1차 달린 횟수
  run2_cnt   INT,                    -- 2차 달린 횟수
  st_time    BIGINT,                 -- 시작 시각 (YYYYMMDDHHmmss)
  sp_time    BIGINT,                 -- 종료 시각 (YYYYMMDDHHmmss)
  tr_term    INT,                    -- 훈련 소요 시간 (초)

  fetched_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (train_date, meet, hr_no, part)
);

CREATE INDEX IF NOT EXISTS idx_training_date
  ON training_logs(train_date DESC);
CREATE INDEX IF NOT EXISTS idx_training_horse
  ON training_logs(hr_no, train_date DESC);
CREATE INDEX IF NOT EXISTS idx_training_trainer
  ON training_logs(trar_nm);

ALTER TABLE training_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON training_logs;
CREATE POLICY "anon_read" ON training_logs
  FOR SELECT TO anon USING (true);

-- ============================================
-- 3. jockey_stats — 기수 통산 성적
-- ============================================
-- 출처: jkpresult/getjkpresult (이미 구독, probe로 검증됨)
-- 실제 응답 필드:
--   meet, jkNo, jkName, raceCnttsum, firstCnt, secondCnt, thirdCnt,
--   winRateTsum, quRateTsum
-- 한 기수가 여러 meet에서 활동 가능 → PK는 (jcky_no, meet)
CREATE TABLE IF NOT EXISTS jockey_stats (
  jcky_no    VARCHAR(10) NOT NULL,   -- 기수 번호
  meet       INT NOT NULL,           -- 경마장 (1=서울, 3=부산경남)

  jcky_nm    VARCHAR(20),            -- 기수명
  race_cnt_t INT,                    -- 통산 출주 수 (raceCnttsum)
  first_cnt  INT,                    -- 통산 1위 횟수 (firstCnt)
  second_cnt INT,                    -- 통산 2위 횟수 (secondCnt)
  third_cnt  INT,                    -- 통산 3위 횟수 (thirdCnt)
  win_rate_t DECIMAL(5,2),           -- 통산 단승률 % (winRateTsum)
  qu_rate_t  DECIMAL(5,2),           -- 통산 입상률 % (quRateTsum)

  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (jcky_no, meet)
);

CREATE INDEX IF NOT EXISTS idx_jockey_name
  ON jockey_stats(jcky_nm);

ALTER TABLE jockey_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON jockey_stats;
CREATE POLICY "anon_read" ON jockey_stats
  FOR SELECT TO anon USING (true);

-- 스키마 리로드
NOTIFY pgrst, 'reload schema';
