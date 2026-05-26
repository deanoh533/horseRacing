-- ============================================
-- 004_race_entries.sql
-- race_cards + horse_results → race_entries 통합
--
-- 목표:
--   경기 전 출마정보(race_cards)와 경기 후 결과(horse_results)를
--   race_entries 한 테이블로 통합.
--   수요일 출주표 fetch → races + race_entries 사전 채움
--   경기 후 → race_entries 결과 컬럼 UPDATE
-- ============================================

-- ============================================
-- 1. race_entries 테이블 생성
-- ============================================
CREATE TABLE IF NOT EXISTS race_entries (
  race_date INT NOT NULL,
  meet      INT NOT NULL,          -- 1=서울, 3=부산경남
  rc_no     INT NOT NULL,
  pthr_no   INT NOT NULL,          -- 출주마번호 (= 게이트 번호 = chul_no)

  -- [사전 정보 — 수요일 출주표 fetch 시 채워짐] --
  hr_name   VARCHAR(30) NOT NULL,
  ag        INT,                    -- 연령
  gndr      VARCHAR(5),             -- 성별
  prds      VARCHAR(20),            -- 생산지
  burd_wgt  DECIMAL(4,1),           -- 부담중량
  ratg      INT,                    -- 레이팅

  jcky_no   VARCHAR(10),            -- 기수 번호 (jockeys 테이블 FK, 경기 후 채워짐)
  jcky_nm   VARCHAR(20),            -- 기수명
  trar_no   VARCHAR(10),            -- 조교사 번호 (trainers 테이블 FK, 경기 후 채워짐)
  trar_nm   VARCHAR(20),            -- 조교사명
  owner_nm  VARCHAR(30),

  rc_dist   INT,                     -- 경주 거리 (races 테이블에서 JOIN, 사후 채워짐)
  track_type VARCHAR(10),            -- 주로 종류 (races 테이블에서 JOIN)

  erng_sump BIGINT,                 -- 수득상금 통산
  erng_loy  BIGINT,                 -- 수득상금 최근 1년
  erng_lsm  BIGINT,                 -- 수득상금 최근 6개월

  sump_rcod_fplc INT,
  sump_rcod_splc INT,
  sump_rcod_tplc INT,
  sump_rcod_sum  INT,

  loy_rcod_fplc INT,
  loy_rcod_splc INT,
  loy_rcod_tplc INT,
  loy_rcod_sum  INT,

  asis_equip1   VARCHAR(50),
  asis_equip2   VARCHAR(50),
  asis_equip3   VARCHAR(50),
  asis_equip4   VARCHAR(50),
  asis_equip5   VARCHAR(50),

  latst_bledg1     VARCHAR(100),
  latst_bledg2     VARCHAR(100),
  latst_trea1_txt  VARCHAR(200),
  latst_trea2_txt  VARCHAR(200),

  -- [사후 정보 — 경기 후 UPDATE] --
  hr_no     VARCHAR(10),            -- 말 번호 (horses 테이블 FK)
  ord       INT,                    -- 최종 착순 (null = 미완주/취소/경기 전)
  rc_time   DECIMAL(5,1),
  diff_unit VARCHAR(10),
  wg_hr     INT,                    -- 경기 직전 마체중
  wg_hr_diff INT,
  wg_jk     INT,                    -- 기수 체중
  win_odds  DECIMAL(6,2),
  plc_odds  DECIMAL(6,2),
  popularity INT,

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

  fetched_at  TIMESTAMPTZ DEFAULT NOW(),
  result_at   TIMESTAMPTZ,          -- 결과 UPDATE 시각

  PRIMARY KEY (race_date, meet, rc_no, pthr_no)
);

CREATE INDEX IF NOT EXISTS idx_race_entries_race   ON race_entries(race_date, meet, rc_no);
CREATE INDEX IF NOT EXISTS idx_race_entries_horse  ON race_entries(hr_name);
CREATE INDEX IF NOT EXISTS idx_race_entries_date   ON race_entries(race_date DESC);
CREATE INDEX IF NOT EXISTS idx_race_entries_jockey ON race_entries(jcky_no);
CREATE INDEX IF NOT EXISTS idx_race_entries_trainer ON race_entries(trar_no);

-- RLS: anon 읽기 허용
ALTER TABLE race_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON race_entries;
CREATE POLICY "anon_read" ON race_entries FOR SELECT TO anon USING (true);

-- ============================================
-- 2. race_cards → race_entries 이관 (사전 정보)
-- ============================================
INSERT INTO race_entries (
  race_date, meet, rc_no, pthr_no,
  hr_name, ag, gndr, prds, burd_wgt, ratg,
  jcky_nm, trar_nm, owner_nm,
  erng_sump, erng_loy, erng_lsm,
  sump_rcod_fplc, sump_rcod_splc, sump_rcod_tplc, sump_rcod_sum,
  loy_rcod_fplc,  loy_rcod_splc,  loy_rcod_tplc,  loy_rcod_sum,
  asis_equip1, asis_equip2, asis_equip3, asis_equip4, asis_equip5,
  latst_bledg1, latst_bledg2, latst_trea1_txt, latst_trea2_txt,
  fetched_at
)
SELECT
  race_date, meet, rc_no, pthr_no,
  hr_name, ag, gndr, prds, burd_wgt, ratg,
  jcky_nm, trar_nm, owner_nm,
  erng_sump, erng_loy, erng_lsm,
  sump_rcod_fplc, sump_rcod_splc, sump_rcod_tplc, sump_rcod_sum,
  loy_rcod_fplc,  loy_rcod_splc,  loy_rcod_tplc,  loy_rcod_sum,
  asis_equip1, asis_equip2, asis_equip3, asis_equip4, asis_equip5,
  latst_bledg1, latst_bledg2, latst_trea1_txt, latst_trea2_txt,
  fetched_at
FROM race_cards
ON CONFLICT (race_date, meet, rc_no, pthr_no) DO NOTHING;

-- ============================================
-- 3. horse_results → race_entries 결과 컬럼 UPDATE
--    (race_cards가 있는 경주: hr_name 기준 매칭)
-- ============================================
UPDATE race_entries re
SET
  hr_no      = hr.hr_no,
  jcky_no    = hr.jk_no,
  trar_no    = hr.tr_no,
  ord        = hr.ord,
  rc_time    = hr.rc_time,
  diff_unit  = hr.diff_unit,
  wg_hr      = hr.wg_hr,
  wg_hr_diff = hr.wg_hr_diff,
  wg_jk      = hr.wg_jk,
  win_odds   = hr.win_odds,
  plc_odds   = hr.plc_odds,
  popularity = hr.popularity,
  bu_g1f_acc_time = hr.bu_g1f_acc_time,
  bu_g2f_acc_time = hr.bu_g2f_acc_time,
  bu_g3f_acc_time = hr.bu_g3f_acc_time,
  bu_g4f_acc_time = hr.bu_g4f_acc_time,
  bu_g6f_acc_time = hr.bu_g6f_acc_time,
  bu_g8f_acc_time = hr.bu_g8f_acc_time,
  bu_s1f_acc_time = hr.bu_s1f_acc_time,
  bu_g1f_ord = hr.bu_g1f_ord,
  bu_g2f_ord = hr.bu_g2f_ord,
  bu_g3f_ord = hr.bu_g3f_ord,
  bu_g4f_ord = hr.bu_g4f_ord,
  bu_s1f_ord = hr.bu_s1f_ord,
  result_at  = NOW()
FROM horse_results hr
WHERE re.race_date = hr.race_date
  AND re.meet      = hr.meet
  AND re.rc_no     = hr.rc_no
  AND re.hr_name   = hr.hr_name;

-- ============================================
-- 4. race_cards 없는 과거 경주 INSERT
--    (horse_results만 있는 경우 — 과거 백테스트 데이터)
-- ============================================
INSERT INTO race_entries (
  race_date, meet, rc_no, pthr_no,
  hr_name, ag, gndr, burd_wgt, ratg,
  jcky_no, jcky_nm, trar_no, trar_nm,
  hr_no, ord, rc_time, diff_unit,
  wg_hr, wg_hr_diff, wg_jk,
  win_odds, plc_odds, popularity,
  bu_g1f_acc_time, bu_g2f_acc_time, bu_g3f_acc_time,
  bu_g4f_acc_time, bu_g6f_acc_time, bu_g8f_acc_time, bu_s1f_acc_time,
  bu_g1f_ord, bu_g2f_ord, bu_g3f_ord, bu_g4f_ord, bu_s1f_ord,
  result_at
)
SELECT
  hr.race_date, hr.meet, hr.rc_no, hr.chul_no,
  hr.hr_name, hr.age, hr.sex, hr.wg_budam, hr.rating,
  hr.jk_no, hr.jk_name, hr.tr_no, hr.tr_name,
  hr.hr_no, hr.ord, hr.rc_time, hr.diff_unit,
  hr.wg_hr, hr.wg_hr_diff, hr.wg_jk,
  hr.win_odds, hr.plc_odds, hr.popularity,
  hr.bu_g1f_acc_time, hr.bu_g2f_acc_time, hr.bu_g3f_acc_time,
  hr.bu_g4f_acc_time, hr.bu_g6f_acc_time, hr.bu_g8f_acc_time, hr.bu_s1f_acc_time,
  hr.bu_g1f_ord, hr.bu_g2f_ord, hr.bu_g3f_ord, hr.bu_g4f_ord, hr.bu_s1f_ord,
  NOW()
FROM horse_results hr
LEFT JOIN race_entries re
  ON  re.race_date = hr.race_date
  AND re.meet      = hr.meet
  AND re.rc_no     = hr.rc_no
  AND re.hr_name   = hr.hr_name
WHERE re.pthr_no IS NULL
ON CONFLICT (race_date, meet, rc_no, pthr_no) DO NOTHING;

-- ============================================
-- 5. races 테이블에 race_entries 기반 경주 insert
--    (수요일부터 races 채워지도록)
-- ============================================
INSERT INTO races (race_date, meet, rc_no)
SELECT DISTINCT race_date, meet, rc_no
FROM race_entries
ON CONFLICT (race_date, meet, rc_no) DO NOTHING;

-- ============================================
-- 6. race_entries.rc_dist / track_type 채우기
--    (races 테이블에 이미 있는 경우 JOIN UPDATE)
-- ============================================
UPDATE race_entries re
SET
  rc_dist    = r.rc_dist,
  track_type = r.track_type
FROM races r
WHERE re.race_date = r.race_date
  AND re.meet      = r.meet
  AND re.rc_no     = r.rc_no
  AND r.rc_dist IS NOT NULL;

-- ============================================
-- 완료 알림
-- ============================================
NOTIFY pgrst, 'reload schema';
