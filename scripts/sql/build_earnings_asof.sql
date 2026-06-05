-- 각 경주 행의 '그 경주 이전' 누적 수득상금 = 그 말의 과거(race_date <) rk_purse 합.
-- collect:prize로 rk_purse 채운 뒤 Supabase SQL Editor에서 1회 실행.
UPDATE race_entries r
SET erng_sump_asof = COALESCE((
  SELECT SUM(p.rk_purse)
  FROM race_entries p
  WHERE p.hr_no = r.hr_no
    AND p.race_date < r.race_date
    AND p.rk_purse IS NOT NULL
), 0)
WHERE r.hr_no IS NOT NULL;
