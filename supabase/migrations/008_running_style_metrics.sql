-- ============================================
-- 008_running_style_metrics.sql
-- 주행 성향 분류용 지표 추가 (Step 4 Phase 1)
--
-- ChatGPT 도메인 인사이트 + 우리 데이터(3,551마 분포 검증) 기반:
--   - position_ratio = (s1f_ord - 1) / (field_size - 1)
--     → 출전두수 다른 경주 비교 가능
--   - stddev_position_ratio: 자유마 판정 (≥ 0.35 → 10%)
--   - front_run_success_rate: 출발 상위 30% → 결승 상위 30% 비율
--
-- 추가 view: horse_running_style_by_distance (거리 카테고리별)
-- ============================================

-- 기존 view DROP (CASCADE로 의존 view도 같이)
DROP VIEW IF EXISTS horse_sectional_ability CASCADE;
DROP VIEW IF EXISTS race_sectional_stats CASCADE;
DROP VIEW IF EXISTS horse_running_style_by_distance CASCADE;

-- ============================================
-- View 1: horse_sectional_ability (확장)
--   기존 컬럼 유지 + position_ratio 기반 신규 컬럼 추가
-- ============================================
CREATE VIEW horse_sectional_ability AS
WITH field_sizes AS (
  SELECT race_date, meet, rc_no, COUNT(*) AS field_size
  FROM race_entries
  WHERE ord IS NOT NULL
  GROUP BY race_date, meet, rc_no
),
enriched AS (
  SELECT
    re.hr_name,
    re.race_date,
    re.meet,
    re.rc_time,
    re.ord,
    re.bu_s1f_acc_time, re.se_s1f_acc_time,
    re.bu_g3f_acc_time, re.se_g3f_acc_time,
    re.bu_g1f_acc_time, re.se_g1f_acc_time,
    re.bu_g3f_ord, re.sj_g3f_ord,
    COALESCE(re.bu_s1f_ord, re.sj_s1f_ord) AS s1f_ord_unified,
    COALESCE(re.bu_g1f_ord, re.sj_g1f_ord) AS g1f_ord_unified,
    fs.field_size,
    CASE
      WHEN fs.field_size >= 2 AND COALESCE(re.bu_s1f_ord, re.sj_s1f_ord) IS NOT NULL
        THEN (COALESCE(re.bu_s1f_ord, re.sj_s1f_ord)::numeric - 1) / (fs.field_size - 1)
      ELSE NULL
    END AS position_ratio,
    CASE
      WHEN fs.field_size >= 2 AND re.ord IS NOT NULL
        THEN (re.ord::numeric - 1) / (fs.field_size - 1)
      ELSE NULL
    END AS finish_ratio
  FROM race_entries re
  LEFT JOIN field_sizes fs
    ON re.race_date = fs.race_date AND re.meet = fs.meet AND re.rc_no = fs.rc_no
  WHERE re.ord IS NOT NULL
    AND re.rc_time IS NOT NULL AND re.rc_time > 0
)
SELECT
  hr_name,
  COUNT(*) AS races,

  -- [기존 컬럼 유지]
  ROUND(AVG(NULLIF(COALESCE(bu_s1f_acc_time, se_s1f_acc_time), 0))::numeric, 2) AS avg_s1f,
  MIN(NULLIF(COALESCE(bu_s1f_acc_time, se_s1f_acc_time), 0)) AS best_s1f,

  ROUND(AVG(rc_time - NULLIF(COALESCE(bu_g3f_acc_time, se_g3f_acc_time), 0))::numeric, 2) AS avg_last_600m,
  MIN(rc_time - NULLIF(COALESCE(bu_g3f_acc_time, se_g3f_acc_time), 0)) AS best_last_600m,

  ROUND(AVG(rc_time - NULLIF(COALESCE(bu_g1f_acc_time, se_g1f_acc_time), 0))::numeric, 2) AS avg_last_200m,
  MIN(rc_time - NULLIF(COALESCE(bu_g1f_acc_time, se_g1f_acc_time), 0)) AS best_last_200m,

  ROUND(AVG(NULLIF(s1f_ord_unified, 0))::numeric, 1) AS avg_s1f_rank,
  ROUND(AVG(NULLIF(COALESCE(bu_g3f_ord, sj_g3f_ord), 0))::numeric, 1) AS avg_g3f_rank,
  ROUND(AVG(NULLIF(g1f_ord_unified, 0))::numeric, 1) AS avg_g1f_rank,

  ROUND(
    (AVG(NULLIF(s1f_ord_unified, 0)) -
     AVG(NULLIF(g1f_ord_unified, 0)))::numeric, 1
  ) AS surge_score,

  ROUND(AVG(ord)::numeric, 1) AS avg_ord,

  -- [신규: position_ratio 기반 — Step 4 Phase 1]
  -- 출전두수로 정규화한 출발 위치 (0=1등, 1=꼴등)
  ROUND(AVG(position_ratio)::numeric, 3) AS avg_position_ratio,
  -- 스타일 안정성 (≥ 0.35 → 자유마)
  ROUND(STDDEV(position_ratio)::numeric, 3) AS stddev_position_ratio,
  -- 선행 유지율: 출발 상위 30%였을 때 결승 상위 30% 비율
  ROUND(
    AVG(
      CASE
        WHEN position_ratio <= 0.3 AND finish_ratio <= 0.3 THEN 1.0
        WHEN position_ratio <= 0.3 THEN 0.0
        ELSE NULL
      END
    )::numeric, 2
  ) AS front_run_success_rate
FROM enriched
GROUP BY hr_name
HAVING COUNT(*) >= 3;

COMMENT ON VIEW horse_sectional_ability IS
  '마별 통산 구간 능력치 v2. avg_position_ratio + stddev + success_rate로 주행 성향 분류 가능.';

-- ============================================
-- View 2: race_sectional_stats (기존 유지)
-- ============================================
CREATE VIEW race_sectional_stats AS
SELECT
  re.race_date, re.meet, re.rc_no,
  r.rc_dist, r.track_type,
  COUNT(*) AS horses,
  MIN(re.rc_time - NULLIF(COALESCE(re.bu_g3f_acc_time, re.se_g3f_acc_time), 0)) AS best_last_600m,
  ROUND(AVG(re.rc_time - NULLIF(COALESCE(re.bu_g3f_acc_time, re.se_g3f_acc_time), 0))::numeric, 2) AS avg_last_600m,
  MIN(re.rc_time - NULLIF(COALESCE(re.bu_g1f_acc_time, re.se_g1f_acc_time), 0)) AS best_last_200m,
  ROUND(AVG(re.rc_time - NULLIF(COALESCE(re.bu_g1f_acc_time, re.se_g1f_acc_time), 0))::numeric, 2) AS avg_last_200m,
  MIN(NULLIF(COALESCE(re.bu_s1f_acc_time, re.se_s1f_acc_time), 0)) AS best_s1f,
  ROUND(AVG(NULLIF(COALESCE(re.bu_s1f_acc_time, re.se_s1f_acc_time), 0))::numeric, 2) AS avg_s1f
FROM race_entries re
LEFT JOIN races r
  ON re.race_date = r.race_date AND re.meet = r.meet AND re.rc_no = r.rc_no
WHERE re.ord IS NOT NULL AND re.rc_time IS NOT NULL AND re.rc_time > 0
GROUP BY re.race_date, re.meet, re.rc_no, r.rc_dist, r.track_type;

COMMENT ON VIEW race_sectional_stats IS
  '경주별 페이스 통계.';

-- ============================================
-- View 3: horse_running_style_by_distance (Step 4 Phase 3)
--   거리 카테고리별 같은 말의 주행 성향
--   거리 버킷: short (<1400m) / middle (1400-1800m) / long (>1800m)
-- ============================================
CREATE VIEW horse_running_style_by_distance AS
WITH field_sizes AS (
  SELECT race_date, meet, rc_no, COUNT(*) AS field_size
  FROM race_entries
  WHERE ord IS NOT NULL
  GROUP BY race_date, meet, rc_no
),
enriched AS (
  SELECT
    re.hr_name,
    re.rc_dist,
    CASE
      WHEN re.rc_dist < 1400 THEN 'short'
      WHEN re.rc_dist <= 1800 THEN 'middle'
      WHEN re.rc_dist > 1800 THEN 'long'
      ELSE 'unknown'
    END AS dist_category,
    re.ord,
    re.rc_time,
    fs.field_size,
    CASE
      WHEN fs.field_size >= 2 AND COALESCE(re.bu_s1f_ord, re.sj_s1f_ord) IS NOT NULL
        THEN (COALESCE(re.bu_s1f_ord, re.sj_s1f_ord)::numeric - 1) / (fs.field_size - 1)
      ELSE NULL
    END AS position_ratio,
    CASE
      WHEN fs.field_size >= 2 AND re.ord IS NOT NULL
        THEN (re.ord::numeric - 1) / (fs.field_size - 1)
      ELSE NULL
    END AS finish_ratio
  FROM race_entries re
  LEFT JOIN field_sizes fs
    ON re.race_date = fs.race_date AND re.meet = fs.meet AND re.rc_no = fs.rc_no
  WHERE re.ord IS NOT NULL
    AND re.rc_time IS NOT NULL AND re.rc_time > 0
    AND re.rc_dist IS NOT NULL
)
SELECT
  hr_name,
  dist_category,
  COUNT(*) AS races,
  ROUND(AVG(position_ratio)::numeric, 3) AS avg_position_ratio,
  ROUND(STDDEV(position_ratio)::numeric, 3) AS stddev_position_ratio,
  ROUND(AVG(finish_ratio)::numeric, 3) AS avg_finish_ratio,
  ROUND(AVG(ord)::numeric, 1) AS avg_ord
FROM enriched
WHERE dist_category != 'unknown'
GROUP BY hr_name, dist_category
HAVING COUNT(*) >= 2;

COMMENT ON VIEW horse_running_style_by_distance IS
  '거리 카테고리별 마별 주행 성향. short(<1400m), middle(1400-1800m), long(>1800m). 2경주 이상.';

NOTIFY pgrst, 'reload schema';
