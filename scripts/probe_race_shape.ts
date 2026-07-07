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

console.log('완료. 경계 조정은 파일 상단 LEAD/CHASE 상수.');
