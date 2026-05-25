-- ============================================
-- 003_race_cards.sql
-- 경기 전 출주표 (API314 서울 / API316 부산경남)
--
-- 운영 흐름:
--   - 수~목요일: 다음 주말 경주 출주표 발표 → fetch + insert
--   - 금~일요일: 출주표 기반 Score Engine 사전 예측
--   - 경기 후: 결과(horse_results) sync → 적중률 비교
-- ============================================

CREATE TABLE IF NOT EXISTS race_cards (
  race_date INT NOT NULL,
  meet INT NOT NULL,                  -- 1=서울, 3=부산경남
  rc_no INT NOT NULL,
  pthr_no INT NOT NULL,               -- 출주마번호 (= chul_no = 발주 게이트)

  hr_name VARCHAR(30) NOT NULL,
  ag INT,                              -- 연령
  gndr VARCHAR(5),                     -- 성별
  prds VARCHAR(20),                    -- 생산지 (한/외)
  burd_wgt DECIMAL(4,1),               -- 부담중량
  ratg INT,                            -- 레이팅

  jcky_nm VARCHAR(20),                 -- 기수명
  trar_nm VARCHAR(20),                 -- 조교사명
  owner_nm VARCHAR(30),                -- 마주명

  -- 수득상금 (강한 시그널)
  erng_sump BIGINT,                    -- 통산
  erng_loy BIGINT,                     -- 최근 1년
  erng_lsm BIGINT,                     -- 최근 6개월

  -- 통산 전적
  sump_rcod_fplc INT,                  -- 1위 수
  sump_rcod_splc INT,                  -- 2위 수
  sump_rcod_tplc INT,                  -- 3위 수
  sump_rcod_sum INT,                   -- 총 출전 수

  -- 최근 1년 전적
  loy_rcod_fplc INT,
  loy_rcod_splc INT,
  loy_rcod_tplc INT,
  loy_rcod_sum INT,

  -- 보조장구 (안대 등) — 변화 감지용
  asis_equip1 VARCHAR(50),
  asis_equip2 VARCHAR(50),
  asis_equip3 VARCHAR(50),
  asis_equip4 VARCHAR(50),
  asis_equip5 VARCHAR(50),

  -- 건강 위험 (음수 시그널)
  latst_bledg1 VARCHAR(100),           -- 폐출혈 최근 1
  latst_bledg2 VARCHAR(100),
  latst_trea1_txt VARCHAR(200),        -- 진료 1 (날짜 + 증상)
  latst_trea2_txt VARCHAR(200),

  fetched_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (race_date, meet, rc_no, pthr_no)
);

CREATE INDEX IF NOT EXISTS idx_race_cards_race ON race_cards(race_date, meet, rc_no);
CREATE INDEX IF NOT EXISTS idx_race_cards_horse ON race_cards(hr_name);
CREATE INDEX IF NOT EXISTS idx_race_cards_date ON race_cards(race_date);

-- RLS: anon 읽기 허용
ALTER TABLE race_cards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON race_cards;
CREATE POLICY "anon_read" ON race_cards FOR SELECT TO anon USING (true);

NOTIFY pgrst, 'reload schema';
