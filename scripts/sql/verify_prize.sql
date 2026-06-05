-- 정합 게이트: 말별 SUM(rk_purse 전체) vs erng_sump(현재 통산 스냅샷).
-- 허용오차 ±5% 내 일치 비율을 본다. 일치율 낮으면 rsutRkPurse 정의 재조사.
WITH per_horse AS (
  SELECT hr_no,
         SUM(rk_purse) AS sum_purse,
         MAX(erng_sump) AS snap_erng,
         COUNT(*) AS n
  FROM race_entries
  WHERE hr_no IS NOT NULL AND rk_purse IS NOT NULL
  GROUP BY hr_no
)
SELECT
  COUNT(*) AS horses,
  ROUND(AVG(CASE WHEN snap_erng > 0
            AND ABS(sum_purse - snap_erng) <= 0.05 * snap_erng THEN 1.0 ELSE 0.0 END), 3) AS match_rate_5pct,
  ROUND(AVG(CASE WHEN snap_erng > 0 THEN sum_purse::numeric / snap_erng END), 3) AS avg_ratio
FROM per_horse;
