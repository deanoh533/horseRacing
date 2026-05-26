-- ============================================
-- 006_race_entries_sectional.sql
-- race_entries에 서울 구간기록 + 코너 진입 컬럼 추가
--
-- 배경: API214_1 응답에 서울/부경 양쪽 구간기록이 모두 들어있지만
--       기존 race_entries는 부경(bu_*) 컬럼만 갖고 있어서 서울 구간기록이
--       날아가던 상태. 마별 능력치 분석 위해 서울 컬럼 + 코너(_3c, _4c)
--       진입 시간을 추가한다.
-- ============================================

ALTER TABLE race_entries
  -- 서울 구간 누적시간 (서울 경주만 채워짐, 부경은 null)
  ADD COLUMN IF NOT EXISTS se_g1f_acc_time DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS se_g3f_acc_time DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS se_s1f_acc_time DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS se_1c_acc_time  DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS se_2c_acc_time  DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS se_3c_acc_time  DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS se_4c_acc_time  DECIMAL(5,2),

  -- 서울 구간 순위
  ADD COLUMN IF NOT EXISTS sj_g1f_ord INT,
  ADD COLUMN IF NOT EXISTS sj_g3f_ord INT,
  ADD COLUMN IF NOT EXISTS sj_s1f_ord INT,
  ADD COLUMN IF NOT EXISTS sj_1c_ord  INT,
  ADD COLUMN IF NOT EXISTS sj_2c_ord  INT,
  ADD COLUMN IF NOT EXISTS sj_3c_ord  INT,
  ADD COLUMN IF NOT EXISTS sj_4c_ord  INT;

-- 과거 데이터 backfill은 별도 스크립트 (dailySync를 과거 날짜로 재실행) 필요.
-- 컬럼만 먼저 추가하고, 새 sync부터 자동 채워짐.

NOTIFY pgrst, 'reload schema';
