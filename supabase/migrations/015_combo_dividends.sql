-- ============================================
-- 015_combo_dividends.sql
-- 조합 확정배당 저장 (복승·복연승·쌍승·삼복승·삼쌍승)
--
-- 결과 sync(dailySync)가 경주 결과 저장 직후 API160_1/integratedInfo_1에서
-- 조합 확정배당을 받아 이 테이블에 멱등 upsert. 단승/연승은 race_entries에 이미
-- 있으므로 여기 저장 안 함. leg 순서는 API가 준 그대로(쌍승·삼쌍승 착순 순서 의미).
-- ============================================

CREATE TABLE IF NOT EXISTS combo_dividends (
  race_date    INT         NOT NULL,
  meet         INT         NOT NULL,           -- 1=서울, 3=부산경남
  rc_no        INT         NOT NULL,
  pool         VARCHAR(20) NOT NULL,           -- '복승식'|'복연승식'|'쌍승식'|'삼복승식'|'삼쌍승식'
  leg1         INT         NOT NULL,           -- 첫째 말 출주번호(chulNo)
  leg2         INT         NOT NULL,           -- 둘째 말
  leg3         INT         NOT NULL DEFAULT 0, -- 셋째 말(3마리 조합만, 없으면 0)
  odds         NUMERIC     NOT NULL,           -- 확정배당
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (race_date, meet, rc_no, pool, leg1, leg2, leg3)
);

-- ============================================
-- RLS (002_enable_anon_read.sql 관례)
-- 개인용 1인 앱: anon = 본인 → 읽기 허용, 쓰기는 service_role만(RLS 우회).
-- anon 쓰기 정책을 만들지 않으므로 anon 키로는 쓰기 불가.
-- ============================================
ALTER TABLE combo_dividends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read" ON combo_dividends;
CREATE POLICY "anon_read" ON combo_dividends FOR SELECT TO anon USING (true);

-- PostgREST가 새 정책 인식하도록 캐시 리로드
NOTIFY pgrst, 'reload schema';
