-- 각 경주 행의 '그 경주 이전' 누적 수득상금 = 그 말의 과거(race_date <) rk_purse 합.
-- collect:prize로 rk_purse 채운 뒤 Supabase SQL Editor에서 1회 실행.
--
-- ⚠️ 상관 서브쿼리(말별 과거 재스캔)는 38k행에서 O(n²)→타임아웃. 윈도우 함수로 한 번에.

-- 1) 인덱스 (윈도우 파티션·향후 쿼리 가속)
CREATE INDEX IF NOT EXISTS idx_race_entries_hrno_date ON race_entries (hr_no, race_date);

-- 2) 말별 race_date 순 누적합에서 자기 상금만 빼면 = 그 경주 이전 누적.
--    말은 하루 한 경주라 같은날 중복 사실상 없어 race_date < 와 동일. 첫 경주는 0.
WITH cum AS (
  SELECT race_date, meet, rc_no, pthr_no,
         COALESCE(SUM(rk_purse) OVER (
           PARTITION BY hr_no ORDER BY race_date
           RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ), 0) - COALESCE(rk_purse, 0) AS asof
  FROM race_entries
  WHERE hr_no IS NOT NULL
)
UPDATE race_entries r
SET erng_sump_asof = c.asof
FROM cum c
WHERE r.race_date = c.race_date
  AND r.meet = c.meet
  AND r.rc_no = c.rc_no
  AND r.pthr_no = c.pthr_no;
