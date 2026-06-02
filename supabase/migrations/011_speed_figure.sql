-- ============================================
-- 011_speed_figure.sql
-- ⑳ 속도능력지수 항목 등록 + par-time 기준표 view
-- ============================================

-- 1. score_items 레지스트리에 신규 항목 등록 (append-only)
INSERT INTO score_items (item_id, name) VALUES
  ('20_speed_figure', '속도능력지수')
ON CONFLICT (item_id) DO NOTHING;

-- 2. race_par_times — 버킷별(경마장×거리×주로) 우승마 평균 완주시간
--    figure = par_time / 내 완주시간 의 분모. 전 기간 1회 계산(공유 베이스라 누수 없음).
DROP VIEW IF EXISTS race_par_times;
CREATE VIEW race_par_times AS
SELECT
  meet,
  rc_dist,
  track_type,
  ROUND(AVG(rc_time)::numeric, 2) AS par_time,
  COUNT(*) AS n_wins
FROM race_entries
WHERE ord = 1
  AND rc_time IS NOT NULL AND rc_time > 0
  AND rc_dist IS NOT NULL
  AND track_type IS NOT NULL
GROUP BY meet, rc_dist, track_type;

COMMENT ON VIEW race_par_times IS
  '버킷(meet×rc_dist×track_type)별 우승마(ord=1) 평균 완주시간. 속도능력지수 figure의 분모.';

NOTIFY pgrst, 'reload schema';
