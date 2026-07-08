/**
 * probe:shape — 경주 전개(race shape) 가설 5종 실측
 *
 * 배경: 시장엣지 종결 후 "공개데이터 활용 재검증" 트랙. 기존 모델은 구간값을
 * 독립 평균 피처로만 썼고, 초반 위치그룹 × 유지력 × 격차 × 필요속도의
 * 조건 조합은 검증한 적 없음 (docs/status/03-market-edge.md, 04-signals.md).
 *
 * H1 — 초반 200m 선두권(도주+선행 통합)의 우승 점유율·개별 승률/연승률 + 경계 민감도
 * H2 — 선두권의 S1F→G3F 위치 유지력과 착순
 * H3 — G3F(결승 600m 전) 시점 선두와의 시간차 구간별 역전 확률
 * H4 — 말별 종반 200m 속도 편차(경주 상대화)와 끝힘 (in-sample 주의)
 * H5 — 역전 필요 종반속도 대비 이력상 가능 속도(as-of, 동거리) → 실제 역전 여부
 * H6 — H4×H5 통합: 필요속도 "달성 확률"(이력 평균±편차의 문턱 넘기 확률, as-of)
 *      → 실제 역전률이 확률을 따라가는가 + "평균 나쁨×편차 큼 > 평균 나쁨×편차 작음" 직접 검증
 *
 * 데이터: data/local.duckdb (READ_ONLY) — KRA API·Supabase 호출 0.
 * 그룹 경계: 선두권 ≤ LEAD / 추격권 ≤ CHASE / 후미권 그 외 (초반 200m 순위 정규화 0=선두).
 */
import { DuckDBInstance } from '@duckdb/node-api';

const LEAD = 0.25;
const CHASE = 0.55;
const MIN_FIELD = 5; // 출주두수 미만 경주 제외 (그룹 나눔 무의미)

const inst = await DuckDBInstance.create('data/local.duckdb', { access_mode: 'READ_ONLY' });
const conn = await inst.connect();

async function q(sql: string): Promise<Record<string, unknown>[]> {
  const r = await conn.run(sql);
  const rows = await r.getRowObjects();
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])),
  );
}

// 공통 베이스: 구간값 통합(서울/부경) + 경주 내 상대화
// fin200/fin600 물리 범위 밖(기록 오류) 제거, 완주마만.
// DuckDB 버그 우회: 창함수 컬럼을 거른 층 위에 다시 창함수가 얹히면
// "invalid unordered_map key" 크래시 → CTE 강제 구체화로 차단
const BASE = `
base AS MATERIALIZED (
  SELECT race_date, meet, rc_no, hr_no, rc_dist, ord, rc_time,
         COALESCE(sj_s1f_ord, bu_s1f_ord) AS s1f_ord,
         COALESCE(sj_g3f_ord, bu_g3f_ord) AS g3f_ord,
         COALESCE(se_g3f_acc_time, bu_g3f_acc_time) AS g3f_acc,
         COALESCE(se_g1f_acc_time, bu_g1f_acc_time) AS g1f_acc,
         COUNT(*) OVER (PARTITION BY race_date, meet, rc_no) AS n,
         MIN(COALESCE(se_g3f_acc_time, bu_g3f_acc_time)) OVER (PARTITION BY race_date, meet, rc_no) AS g3f_min
  FROM race_entries
  WHERE ord IS NOT NULL AND ord > 0 AND rc_time IS NOT NULL AND rc_time > 0
),
enriched AS MATERIALIZED (
  SELECT *,
         (s1f_ord - 1.0) / (n - 1.0) AS s1f_ratio,
         (g3f_ord - 1.0) / (n - 1.0) AS g3f_ratio,
         g3f_acc - g3f_min AS g3f_gap,
         rc_time - g3f_acc AS fin600,
         rc_time - g1f_acc AS fin200,
         (rc_time - g1f_acc) - AVG(rc_time - g1f_acc) OVER (PARTITION BY race_date, meet, rc_no) AS fin200_rel,
         CASE WHEN (s1f_ord - 1.0) / (n - 1.0) <= ${LEAD} THEN '1_선두권'
              WHEN (s1f_ord - 1.0) / (n - 1.0) <= ${CHASE} THEN '2_추격권'
              ELSE '3_후미권' END AS grp
  FROM base
  WHERE n >= ${MIN_FIELD} AND s1f_ord IS NOT NULL
)`;

function pct(num: string, den = 'COUNT(*)'): string {
  return `ROUND(100.0 * ${num} / ${den}, 1)`;
}

console.log('━━━ H1. 초반 200m 그룹별 성적 + 우승/연승 점유율 ━━━');
console.table(await q(`
WITH ${BASE}
SELECT grp, COUNT(*) AS 출주,
       ${pct('SUM(CASE WHEN ord = 1 THEN 1 ELSE 0 END)')} AS 개별승률,
       ${pct('SUM(CASE WHEN ord <= 3 THEN 1 ELSE 0 END)')} AS 개별연승률,
       ${pct('SUM(CASE WHEN ord = 1 THEN 1 ELSE 0 END)', '(SELECT SUM(CASE WHEN ord = 1 THEN 1 ELSE 0 END) FROM enriched)')} AS 우승점유,
       ${pct('SUM(CASE WHEN ord <= 3 THEN 1 ELSE 0 END)', '(SELECT SUM(CASE WHEN ord <= 3 THEN 1 ELSE 0 END) FROM enriched)')} AS 연승점유
FROM enriched GROUP BY grp ORDER BY grp`));

console.log('─── H1 민감도: 선두권 경계를 흔들었을 때 (우승점유·개별연승률) ───');
for (const lead of [0.15, 0.25, 0.35]) {
  const [row] = await q(`
WITH ${BASE}
SELECT ${pct('SUM(CASE WHEN s1f_ratio <= ' + lead + ' AND ord = 1 THEN 1 ELSE 0 END)', 'SUM(CASE WHEN ord = 1 THEN 1 ELSE 0 END)')} AS 우승점유,
       ${pct('SUM(CASE WHEN s1f_ratio <= ' + lead + ' AND ord <= 3 THEN 1 ELSE 0 END)', 'SUM(CASE WHEN s1f_ratio <= ' + lead + ' THEN 1 ELSE 0 END)')} AS 개별연승률
FROM enriched`);
  console.log(`  선두권 ≤ ${lead}: 우승점유 ${row.우승점유}% · 개별연승률 ${row.개별연승률}%`);
}

console.log('\n━━━ H2. 선두권의 위치 유지력 (S1F 선두권 → G3F에도 선두권인가) ━━━');
console.table(await q(`
WITH ${BASE}
SELECT CASE WHEN g3f_ratio <= ${LEAD} THEN '유지' ELSE '이탈' END AS "G3F까지",
       COUNT(*) AS 출주,
       ${pct('SUM(CASE WHEN ord = 1 THEN 1 ELSE 0 END)')} AS 승률,
       ${pct('SUM(CASE WHEN ord <= 3 THEN 1 ELSE 0 END)')} AS 연승률
FROM enriched
WHERE grp = '1_선두권' AND g3f_ratio IS NOT NULL
GROUP BY 1 ORDER BY 1 DESC`));

console.log('━━━ H3. G3F 시점 선두와의 시간차별 역전 확률 (G3F 비선두 말) ━━━');
console.table(await q(`
WITH ${BASE}
SELECT grp,
       CASE WHEN g3f_gap <= 0.3 THEN 'a. ~0.3초'
            WHEN g3f_gap <= 0.6 THEN 'b. ~0.6초'
            WHEN g3f_gap <= 1.0 THEN 'c. ~1.0초'
            WHEN g3f_gap <= 1.5 THEN 'd. ~1.5초'
            WHEN g3f_gap <= 2.5 THEN 'e. ~2.5초'
            ELSE 'f. 2.5초+' END AS 격차,
       COUNT(*) AS 출주,
       ${pct('SUM(CASE WHEN ord = 1 THEN 1 ELSE 0 END)')} AS 역전승률,
       ${pct('SUM(CASE WHEN ord <= 3 THEN 1 ELSE 0 END)')} AS 연승률
FROM enriched
WHERE g3f_gap > 0 AND g3f_acc IS NOT NULL
GROUP BY grp, 2 ORDER BY grp, 2`));

console.log('━━━ H4. 종반 200m 속도 편차(말별, 경주 상대화)와 끝힘 ━━━');
console.log('⚠️ in-sample(통산 통계로 그 말의 출주 성적을 봄) — 존재 확인용, 피처 채택 시 as-of 재계산 필요');
console.table(await q(`
WITH ${BASE},
horse AS (
  SELECT hr_no, COUNT(*) AS c, AVG(fin200_rel) AS m, STDDEV_SAMP(fin200_rel) AS s
  FROM enriched WHERE fin200 BETWEEN 8 AND 25
  GROUP BY hr_no HAVING COUNT(*) >= 4
),
binned AS (
  SELECT hr_no, s, NTILE(5) OVER (ORDER BY m) AS 평균5분위 FROM horse
),
med AS (
  SELECT 평균5분위, MEDIAN(s) AS ms FROM binned GROUP BY 1
),
tiered AS (
  SELECT b.hr_no, b.평균5분위,
         CASE WHEN b.s <= m.ms THEN '편차小' ELSE '편차大' END AS 편차반
  FROM binned b JOIN med m USING (평균5분위)
)
SELECT t.평균5분위 AS "평균속도 5분위(1=빠름)", t.편차반,
       COUNT(*) AS 출주,
       ${pct('SUM(CASE WHEN e.ord <= 3 THEN 1 ELSE 0 END)')} AS 연승률
FROM enriched e JOIN tiered t USING (hr_no)
GROUP BY 1, 2 ORDER BY 1, 2`));

console.log('━━━ H5. 역전 필요속도 vs 이력상 가능속도 (as-of, 동일거리 직전 2회+) ━━━');
console.table(await q(`
WITH ${BASE},
leader AS (
  SELECT race_date, meet, rc_no, MIN(CASE WHEN g3f_gap = 0 THEN fin600 END) AS leader_fin600
  FROM enriched GROUP BY race_date, meet, rc_no
),
hist AS (
  SELECT *,
         MIN(fin600) OVER (PARTITION BY hr_no, rc_dist ORDER BY race_date
                           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_best_fin600,
         COUNT(*) OVER (PARTITION BY hr_no, rc_dist ORDER BY race_date
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_cnt
  FROM enriched WHERE fin600 BETWEEN 30 AND 60
)
SELECT CASE WHEN h.g3f_gap <= 0.5 THEN 'a. ~0.5초' WHEN h.g3f_gap <= 1.0 THEN 'b. ~1.0초'
            WHEN h.g3f_gap <= 2.0 THEN 'c. ~2.0초' ELSE 'd. 2.0초+' END AS 격차,
       CASE WHEN h.prior_best_fin600 <= l.leader_fin600 - h.g3f_gap THEN '가능' ELSE '불가능' END AS 필요속도,
       COUNT(*) AS 출주,
       ${pct('SUM(CASE WHEN h.ord = 1 THEN 1 ELSE 0 END)')} AS 역전승률,
       ${pct('SUM(CASE WHEN h.ord <= 3 THEN 1 ELSE 0 END)')} AS 연승률
FROM hist h JOIN leader l USING (race_date, meet, rc_no)
WHERE h.g3f_gap > 0 AND h.prior_cnt >= 2 AND l.leader_fin600 IS NOT NULL
GROUP BY 1, 2 ORDER BY 1, 2`));

// H6 공통: 말×거리 as-of 종반 600m 분포(평균·편차, 직전 3회+) + 필요속도와의 z
// 편차 하한 0.1초: 측정 노이즈보다 작은 편차는 z 폭발 방지용 클램프
// 달성확률 = 로지스틱 근사 Φ(z) ≈ 1/(1+e^(-1.702z))
const H6 = `
${BASE},
leader AS (
  SELECT race_date, meet, rc_no, MIN(CASE WHEN g3f_gap = 0 THEN fin600 END) AS leader_fin600
  FROM enriched GROUP BY race_date, meet, rc_no
),
hist AS (
  SELECT *,
         AVG(fin600) OVER (PARTITION BY hr_no, rc_dist ORDER BY race_date
                           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_mean,
         STDDEV_SAMP(fin600) OVER (PARTITION BY hr_no, rc_dist ORDER BY race_date
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_std,
         COUNT(*) OVER (PARTITION BY hr_no, rc_dist ORDER BY race_date
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_cnt
  FROM enriched WHERE fin600 BETWEEN 30 AND 60
),
scored AS (
  SELECT h.*, l.leader_fin600,
         l.leader_fin600 - h.g3f_gap AS required_fin600,
         (h.prior_mean - (l.leader_fin600 - h.g3f_gap)) AS mean_deficit,
         ((l.leader_fin600 - h.g3f_gap) - h.prior_mean) / GREATEST(h.prior_std, 0.1) AS z,
         1.0 / (1.0 + EXP(-1.702 * ((l.leader_fin600 - h.g3f_gap) - h.prior_mean) / GREATEST(h.prior_std, 0.1))) AS p_achieve
  FROM hist h JOIN leader l USING (race_date, meet, rc_no)
  WHERE h.g3f_gap > 0 AND h.prior_cnt >= 3 AND h.prior_std IS NOT NULL AND l.leader_fin600 IS NOT NULL
)`;

console.log('\n━━━ H6a. 필요속도 달성확률(예측) vs 실제 역전률 — 단조 검증 ━━━');
console.table(await q(`
WITH ${H6}
SELECT CASE WHEN p_achieve < 0.10 THEN 'a. ~10%'
            WHEN p_achieve < 0.30 THEN 'b. 10~30%'
            WHEN p_achieve < 0.60 THEN 'c. 30~60%'
            WHEN p_achieve < 0.90 THEN 'd. 60~90%'
            ELSE 'e. 90%+' END AS 달성확률구간,
       COUNT(*) AS 출주,
       ROUND(100.0 * AVG(p_achieve), 1) AS 예측평균,
       ${pct('SUM(CASE WHEN ord = 1 THEN 1 ELSE 0 END)')} AS 역전승률,
       ${pct('SUM(CASE WHEN ord <= 3 THEN 1 ELSE 0 END)')} AS 연승률
FROM scored GROUP BY 1 ORDER BY 1`));

console.log('━━━ H6b. 평균은 필요속도보다 느린 말만: 편차 큰 쪽이 정말 이기나 (말 B vs C) ━━━');
console.table(await q(`
WITH ${H6},
deficit AS (
  SELECT *, CASE WHEN mean_deficit <= 0.4 THEN 'a. 0~0.4초 부족'
                 WHEN mean_deficit <= 1.0 THEN 'b. 0.4~1.0초 부족'
                 ELSE 'c. 1.0초+ 부족' END AS 부족폭
  FROM scored WHERE mean_deficit > 0
),
med AS (SELECT 부족폭, MEDIAN(prior_std) AS ms FROM deficit GROUP BY 1)
SELECT d.부족폭,
       CASE WHEN d.prior_std <= m.ms THEN '편차小' ELSE '편차大' END AS 편차반,
       COUNT(*) AS 출주,
       ${pct('SUM(CASE WHEN d.ord = 1 THEN 1 ELSE 0 END)')} AS 역전승률,
       ${pct('SUM(CASE WHEN d.ord <= 3 THEN 1 ELSE 0 END)')} AS 연승률
FROM deficit d JOIN med m USING (부족폭)
GROUP BY 1, 2 ORDER BY 1, 2`));

console.log('\n━━━ H7. 격차 × 달성확률 교차표 — "이 말"의 우승/연승 확률 조회용 ━━━');
console.table(await q(`
WITH ${H6}
SELECT CASE WHEN g3f_gap <= 0.5 THEN 'a. ~0.5초' WHEN g3f_gap <= 1.0 THEN 'b. ~1.0초'
            WHEN g3f_gap <= 1.5 THEN 'c. ~1.5초' WHEN g3f_gap <= 2.5 THEN 'd. ~2.5초'
            ELSE 'e. 2.5초+' END AS 격차,
       CASE WHEN p_achieve < 0.30 THEN '1_낮음(~30%)'
            WHEN p_achieve < 0.70 THEN '2_중간(30~70%)'
            ELSE '3_높음(70%+)' END AS 달성확률,
       COUNT(*) AS 출주,
       ${pct('SUM(CASE WHEN ord = 1 THEN 1 ELSE 0 END)')} AS 승률,
       ${pct('SUM(CASE WHEN ord <= 3 THEN 1 ELSE 0 END)')} AS 연승률
FROM scored GROUP BY 1, 2 ORDER BY 1, 2`));

// H8: G3F 통과시간의 사전 예측 가능성 — 동일거리 as-of 이력만 사용
const H8 = `
${BASE},
hist AS MATERIALIZED (
  SELECT race_date, meet, rc_no, hr_no, n, g3f_acc, g3f_ord,
         AVG(g3f_acc) OVER (PARTITION BY hr_no, rc_dist ORDER BY race_date
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pred_all,
         AVG(g3f_acc) OVER (PARTITION BY hr_no, rc_dist ORDER BY race_date
                            ROWS BETWEEN 3 PRECEDING AND 1 PRECEDING) AS pred_r3,
         LAG(g3f_acc) OVER (PARTITION BY hr_no, rc_dist ORDER BY race_date) AS pred_last,
         COUNT(*) OVER (PARTITION BY hr_no, rc_dist ORDER BY race_date
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_cnt
  FROM enriched WHERE g3f_acc IS NOT NULL AND g3f_acc > 0
)`;

console.log('\n━━━ H8a. G3F 시간 예측 오차 — 동일거리 이력 (전체평균 / 최근3회 / 직전1회) ━━━');
for (const [label, col, minCnt] of [['전체평균', 'pred_all', 2], ['최근3회', 'pred_r3', 2], ['직전1회', 'pred_last', 1]] as const) {
  const [r] = await q(`
WITH ${H8}
SELECT COUNT(*) AS n,
       ROUND(AVG(ABS(${col} - g3f_acc)), 2) AS mae,
       ROUND(MEDIAN(ABS(${col} - g3f_acc)), 2) AS medae,
       ${pct(`SUM(CASE WHEN ABS(${col} - g3f_acc) <= 0.3 THEN 1 ELSE 0 END)`)} AS "≤0.3초",
       ${pct(`SUM(CASE WHEN ABS(${col} - g3f_acc) <= 0.5 THEN 1 ELSE 0 END)`)} AS "≤0.5초",
       ${pct(`SUM(CASE WHEN ABS(${col} - g3f_acc) <= 1.0 THEN 1 ELSE 0 END)`)} AS "≤1.0초"
FROM hist WHERE ${col} IS NOT NULL AND prior_cnt >= ${minCnt}`);
  console.log(`  ${label}: n=${r.n} · 평균오차 ${r.mae}초 · 중앙값 ${r.medae}초 · 0.3초내 ${r['≤0.3초']}% · 0.5초내 ${r['≤0.5초']}% · 1초내 ${r['≤1.0초']}%`);
}

console.log('\n━━━ H8b. 순서는 맞히나 — 예측 G3F로 세운 경주 내 순위 vs 실제 G3F 순위 ━━━');
console.table(await q(`
WITH ${H8},
ranked AS MATERIALIZED (
  SELECT race_date, meet, rc_no, g3f_ord,
         ROW_NUMBER() OVER (PARTITION BY race_date, meet, rc_no ORDER BY pred_all) AS rp,
         COUNT(*) OVER (PARTITION BY race_date, meet, rc_no) AS n_pred
  FROM hist WHERE pred_all IS NOT NULL AND prior_cnt >= 2 AND g3f_ord IS NOT NULL
),
per_race AS (
  SELECT race_date, meet, rc_no,
         CORR(rp, g3f_ord) AS rho,
         MAX(CASE WHEN rp = 1 AND g3f_ord = 1 THEN 1 ELSE 0 END) AS leader_hit,
         MAX(CASE WHEN rp = 1 AND g3f_ord <= 3 THEN 1 ELSE 0 END) AS leader_top3
  FROM ranked WHERE n_pred >= 5 GROUP BY 1, 2, 3
)
SELECT COUNT(*) AS 경주수,
       ROUND(AVG(rho), 3) AS 평균순위상관,
       ${pct('SUM(leader_hit)')} AS "예측선두=실제선두",
       ${pct('SUM(leader_top3)')} AS "예측선두가 G3F 3위내"
FROM per_race`));

console.log('\n━━━ H8c. 상대화 오차 — 경주 공통 페이스 성분 제거 후 (격차 예측에 유효한 오차) ━━━');
console.table(await q(`
WITH ${H8},
rel AS (
  SELECT (g3f_acc - AVG(g3f_acc) OVER w) - (pred_all - AVG(pred_all) OVER w) AS rel_err,
         COUNT(*) OVER w AS n_pred
  FROM hist WHERE pred_all IS NOT NULL AND prior_cnt >= 2
  WINDOW w AS (PARTITION BY race_date, meet, rc_no)
)
SELECT COUNT(*) AS n,
       ROUND(AVG(ABS(rel_err)), 2) AS 평균오차,
       ROUND(MEDIAN(ABS(rel_err)), 2) AS 중앙값,
       ${pct('SUM(CASE WHEN ABS(rel_err) <= 0.3 THEN 1 ELSE 0 END)')} AS "≤0.3초",
       ${pct('SUM(CASE WHEN ABS(rel_err) <= 0.5 THEN 1 ELSE 0 END)')} AS "≤0.5초",
       ${pct('SUM(CASE WHEN ABS(rel_err) <= 1.0 THEN 1 ELSE 0 END)')} AS "≤1.0초"
FROM rel WHERE n_pred >= 5`));

// H8d: 거리 보정 버전 — 모든 거리 이력을 "거리 표준(par, meet×dist 중앙값) 대비 편차"로
// 환산해 평균. ⚠️ par는 전기간 중앙값(in-sample) — probe 한정, 실전은 as-of par 필요.
console.log('\n━━━ H8d. 거리 보정 전체이력 vs 동일거리 평균 — 정확도·커버리지 비교 ━━━');
console.table(await q(`
WITH ${BASE},
par AS (
  SELECT meet, rc_dist, MEDIAN(g3f_acc) AS par
  FROM enriched WHERE g3f_acc > 0 GROUP BY 1, 2
),
dev AS (
  SELECT e.*, p.par, e.g3f_acc - p.par AS d
  FROM enriched e JOIN par p USING (meet, rc_dist) WHERE e.g3f_acc > 0
),
comb AS MATERIALIZED (
  SELECT race_date, meet, rc_no, g3f_acc,
         AVG(g3f_acc) OVER (PARTITION BY hr_no, rc_dist ORDER BY race_date
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pred_same,
         COUNT(*) OVER (PARTITION BY hr_no, rc_dist ORDER BY race_date
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS cnt_same,
         par + AVG(d) OVER (PARTITION BY hr_no ORDER BY race_date
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pred_par,
         COUNT(*) OVER (PARTITION BY hr_no ORDER BY race_date
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS cnt_all
  FROM dev
)
SELECT 방법, n, mae, 중앙값, "≤0.5초" FROM (
  SELECT '1_동일거리평균(기준)' AS 방법, COUNT(*) AS n,
         ROUND(AVG(ABS(pred_same - g3f_acc)), 2) AS mae,
         ROUND(MEDIAN(ABS(pred_same - g3f_acc)), 2) AS 중앙값,
         ${pct('SUM(CASE WHEN ABS(pred_same - g3f_acc) <= 0.5 THEN 1 ELSE 0 END)')} AS "≤0.5초"
  FROM comb WHERE cnt_same >= 2
  UNION ALL
  SELECT '2_거리보정 전체이력', COUNT(*),
         ROUND(AVG(ABS(pred_par - g3f_acc)), 2),
         ROUND(MEDIAN(ABS(pred_par - g3f_acc)), 2),
         ${pct('SUM(CASE WHEN ABS(pred_par - g3f_acc) <= 0.5 THEN 1 ELSE 0 END)')}
  FROM comb WHERE cnt_all >= 2
  UNION ALL
  SELECT '3_거리보정@동일표본', COUNT(*),
         ROUND(AVG(ABS(pred_par - g3f_acc)), 2),
         ROUND(MEDIAN(ABS(pred_par - g3f_acc)), 2),
         ${pct('SUM(CASE WHEN ABS(pred_par - g3f_acc) <= 0.5 THEN 1 ELSE 0 END)')}
  FROM comb WHERE cnt_same >= 2 AND cnt_all >= 2
) ORDER BY 방법`));

console.log('─── H8d 상대화(격차 유효) 오차 — 거리보정 전체이력 ───');
console.table(await q(`
WITH ${BASE},
par AS (
  SELECT meet, rc_dist, MEDIAN(g3f_acc) AS par
  FROM enriched WHERE g3f_acc > 0 GROUP BY 1, 2
),
dev AS (
  SELECT e.*, p.par, e.g3f_acc - p.par AS d
  FROM enriched e JOIN par p USING (meet, rc_dist) WHERE e.g3f_acc > 0
),
comb AS MATERIALIZED (
  SELECT race_date, meet, rc_no, g3f_acc,
         par + AVG(d) OVER (PARTITION BY hr_no ORDER BY race_date
                            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pred_par,
         COUNT(*) OVER (PARTITION BY hr_no ORDER BY race_date
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS cnt_all
  FROM dev
),
rel AS (
  SELECT (g3f_acc - AVG(g3f_acc) OVER w) - (pred_par - AVG(pred_par) OVER w) AS rel_err,
         COUNT(*) OVER w AS n_pred
  FROM comb WHERE pred_par IS NOT NULL AND cnt_all >= 2
  WINDOW w AS (PARTITION BY race_date, meet, rc_no)
)
SELECT COUNT(*) AS n,
       ROUND(AVG(ABS(rel_err)), 2) AS 평균오차,
       ROUND(MEDIAN(ABS(rel_err)), 2) AS 중앙값,
       ${pct('SUM(CASE WHEN ABS(rel_err) <= 0.3 THEN 1 ELSE 0 END)')} AS "≤0.3초",
       ${pct('SUM(CASE WHEN ABS(rel_err) <= 0.5 THEN 1 ELSE 0 END)')} AS "≤0.5초"
FROM rel WHERE n_pred >= 5`));

// H9: 완전 사전(pre-race) 버전 H7 — 격차·선두 종반기록·달성확률 전부 as-of 이력으로만.
// 파이프라인: 거리보정 G3F 예측(H8d 방식) → 예측 선두/격차 → 예측 필요속도 → 달성확률 → 실제 착순 대조.
// ⚠️ par만 in-sample 중앙값(probe 한정). 예측 선두 자신은 제외(H7과 동일하게 격차>0만).
console.log('\n━━━ H9. 사전 예측만으로 만든 H7 — 칸 분리가 살아남는가 ━━━');
console.table(await q(`
WITH ${BASE},
par AS (
  SELECT meet, rc_dist, MEDIAN(g3f_acc) AS par3, MEDIAN(fin600) AS par6
  FROM enriched WHERE g3f_acc > 0 AND fin600 BETWEEN 30 AND 60 GROUP BY 1, 2
),
dev AS (
  SELECT e.*, p.par3, p.par6, e.g3f_acc - p.par3 AS d3, e.fin600 - p.par6 AS d6
  FROM enriched e JOIN par p USING (meet, rc_dist)
  WHERE e.g3f_acc > 0 AND e.fin600 BETWEEN 30 AND 60
),
h AS MATERIALIZED (
  SELECT race_date, meet, rc_no, hr_no, ord, par3, par6,
         par3 + AVG(d3) OVER (PARTITION BY hr_no ORDER BY race_date
                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS pred_g3f,
         par6 + AVG(d6) OVER (PARTITION BY hr_no ORDER BY race_date
                              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS own_mean6,
         STDDEV_SAMP(d6) OVER (PARTITION BY hr_no ORDER BY race_date
                               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS own_std6,
         COUNT(*) OVER (PARTITION BY hr_no ORDER BY race_date
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior_cnt
  FROM dev
),
ranked AS MATERIALIZED (
  SELECT *,
         pred_g3f - MIN(pred_g3f) OVER wr AS pred_gap,
         FIRST_VALUE(own_mean6) OVER (PARTITION BY race_date, meet, rc_no ORDER BY pred_g3f
                                      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS leader_fin600_est,
         COUNT(*) OVER wr AS n_pred
  FROM h WHERE pred_g3f IS NOT NULL AND prior_cnt >= 2
  WINDOW wr AS (PARTITION BY race_date, meet, rc_no)
),
scored AS MATERIALIZED (
  SELECT *,
         1.0 / (1.0 + EXP(-1.702 * ((leader_fin600_est - pred_gap) - own_mean6) / GREATEST(own_std6, 0.1))) AS p_achieve
  FROM ranked
  WHERE pred_gap > 0 AND n_pred >= 5 AND prior_cnt >= 3 AND own_std6 IS NOT NULL
)
SELECT CASE WHEN pred_gap <= 0.5 THEN 'a. ~0.5초' WHEN pred_gap <= 1.0 THEN 'b. ~1.0초'
            WHEN pred_gap <= 1.5 THEN 'c. ~1.5초' ELSE 'd. 1.5초+' END AS 예측격차,
       CASE WHEN p_achieve < 0.30 THEN '1_낮음(~30%)'
            WHEN p_achieve < 0.70 THEN '2_중간(30~70%)'
            ELSE '3_높음(70%+)' END AS 달성확률,
       COUNT(*) AS 출주,
       ${pct('SUM(CASE WHEN ord = 1 THEN 1 ELSE 0 END)')} AS 승률,
       ${pct('SUM(CASE WHEN ord <= 3 THEN 1 ELSE 0 END)')} AS 연승률
FROM scored GROUP BY 1, 2 ORDER BY 1, 2`));

console.log('완료. 경계 조정은 파일 상단 LEAD/CHASE 상수.');
