-- ============================================
-- 007_sectional_views.sql (재설계 v2)
-- 구간기록 기반 분석 view — 거리-무관 차이값 기반
--
-- 컬럼 의미 (검증됨, 2026-05-26):
--   bu_s1f_acc_time:  출발 후 200m 통과시간 (~14초, 거리 무관)
--   bu_g3f_acc_time:  결승선 -600m 지점의 누적시간 (거리 의존)
--   bu_g1f_acc_time:  결승선 -200m 지점의 누적시간 (거리 의존)
--   rc_time - g3f:    마지막 600m 시간 (~40초, 거리 무관) ← 추격력
--   rc_time - g1f:    마지막 200m 시간 (~14초, 거리 무관) ← 결승선 가속
--
-- 따라서 통산 능력치 비교는 누적시간 단순 평균이 아닌 "차이값" 기반.
-- ============================================

-- 기존 view 컬럼 구조가 다르면 DROP 후 재생성
DROP VIEW IF EXISTS horse_sectional_ability;
DROP VIEW IF EXISTS race_sectional_stats;

-- ============================================
-- View 1: horse_sectional_ability (재설계)
--   거리 무관 메트릭만 사용 → 어떤 거리에서 뛴 말이든 동일 척도로 비교 가능
-- ============================================
CREATE VIEW horse_sectional_ability AS
SELECT
  hr_name,
  COUNT(*) AS races,

  -- ① 출발 가속 (200m 통과 시간, 작을수록 빠름)
  ROUND(AVG(NULLIF(COALESCE(bu_s1f_acc_time, se_s1f_acc_time), 0))::numeric, 2) AS avg_s1f,
  MIN(NULLIF(COALESCE(bu_s1f_acc_time, se_s1f_acc_time), 0)) AS best_s1f,

  -- ② 막판 600m 시간 (= rc_time - g3f)
  ROUND(AVG(rc_time - NULLIF(COALESCE(bu_g3f_acc_time, se_g3f_acc_time), 0))::numeric, 2) AS avg_last_600m,
  MIN(rc_time - NULLIF(COALESCE(bu_g3f_acc_time, se_g3f_acc_time), 0)) AS best_last_600m,

  -- ③ 막판 200m 시간 (= rc_time - g1f, 결승선 가속)
  ROUND(AVG(rc_time - NULLIF(COALESCE(bu_g1f_acc_time, se_g1f_acc_time), 0))::numeric, 2) AS avg_last_200m,
  MIN(rc_time - NULLIF(COALESCE(bu_g1f_acc_time, se_g1f_acc_time), 0)) AS best_last_200m,

  -- ④ 구간 순위 평균 (낮을수록 선두권)
  ROUND(AVG(NULLIF(COALESCE(bu_s1f_ord, sj_s1f_ord), 0))::numeric, 1) AS avg_s1f_rank,
  ROUND(AVG(NULLIF(COALESCE(bu_g3f_ord, sj_g3f_ord), 0))::numeric, 1) AS avg_g3f_rank,
  ROUND(AVG(NULLIF(COALESCE(bu_g1f_ord, sj_g1f_ord), 0))::numeric, 1) AS avg_g1f_rank,

  -- ⑤ 추격 패턴: 출발 순위 - 결승선 순위 (양수 = 추격형, 음수 = 선행형)
  ROUND(
    (AVG(NULLIF(COALESCE(bu_s1f_ord, sj_s1f_ord), 0)) -
     AVG(NULLIF(COALESCE(bu_g1f_ord, sj_g1f_ord), 0)))::numeric, 1
  ) AS surge_score,

  -- ⑥ 평균 착순 (참고)
  ROUND(AVG(ord)::numeric, 1) AS avg_ord
FROM race_entries
WHERE ord IS NOT NULL
  AND rc_time IS NOT NULL AND rc_time > 0
GROUP BY hr_name
HAVING COUNT(*) >= 3;

COMMENT ON VIEW horse_sectional_ability IS
  '마별 통산 구간 능력치 (거리-무관 차이값 기반). best_last_600m=막판 추격력, best_s1f=출발 가속력, surge_score 양수=추격형';

-- ============================================
-- View 2: race_sectional_stats (재설계)
--   경주별 페이스 — 한 경주는 거리 일정하니까 차이값이 더 의미 있음
-- ============================================
CREATE VIEW race_sectional_stats AS
SELECT
  re.race_date, re.meet, re.rc_no,
  r.rc_dist, r.track_type,
  COUNT(*) AS horses,

  -- 그 경주의 막판 600m 빠른 말 시간/평균
  MIN(re.rc_time - NULLIF(COALESCE(re.bu_g3f_acc_time, re.se_g3f_acc_time), 0)) AS best_last_600m,
  ROUND(AVG(re.rc_time - NULLIF(COALESCE(re.bu_g3f_acc_time, re.se_g3f_acc_time), 0))::numeric, 2) AS avg_last_600m,

  -- 막판 200m
  MIN(re.rc_time - NULLIF(COALESCE(re.bu_g1f_acc_time, re.se_g1f_acc_time), 0)) AS best_last_200m,
  ROUND(AVG(re.rc_time - NULLIF(COALESCE(re.bu_g1f_acc_time, re.se_g1f_acc_time), 0))::numeric, 2) AS avg_last_200m,

  -- 출발 200m
  MIN(NULLIF(COALESCE(re.bu_s1f_acc_time, re.se_s1f_acc_time), 0)) AS best_s1f,
  ROUND(AVG(NULLIF(COALESCE(re.bu_s1f_acc_time, re.se_s1f_acc_time), 0))::numeric, 2) AS avg_s1f
FROM race_entries re
LEFT JOIN races r
  ON re.race_date = r.race_date AND re.meet = r.meet AND re.rc_no = r.rc_no
WHERE re.ord IS NOT NULL AND re.rc_time IS NOT NULL AND re.rc_time > 0
GROUP BY re.race_date, re.meet, re.rc_no, r.rc_dist, r.track_type;

COMMENT ON VIEW race_sectional_stats IS
  '경주별 페이스. best_last_600m이 작을수록 막판 추격이 빠른 경주.';

NOTIFY pgrst, 'reload schema';
