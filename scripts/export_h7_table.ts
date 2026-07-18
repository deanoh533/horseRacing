/**
 * H7 교차표 정적 JSON 생성 — probe H9(scripts/probe_race_shape.ts 390~440행) SQL을 그대로
 * 복사해 로컬 DuckDB(READ_ONLY)에서 실행, buildH7Table 검증 후 client/src/data/h7_table.json 출력.
 * probe 원본은 수정하지 않는다. 갱신: npm run export:h7 (수동 — 재학습 사이클 등).
 * KRA API·Supabase 호출 0.
 * SET threads TO 1 — 윈도우 동률 병렬 배정 비결정성 고정(리뷰 발견).
 */
import { DuckDBInstance } from '@duckdb/node-api';
import { writeFileSync } from 'fs';
import { buildH7Table, type H7SqlRow } from '../src/engine/eval/h7Table.js';

// probe_race_shape.ts 상단 상수 그대로 (LEAD/CHASE/MIN_FIELD)
const LEAD = 0.25;
const CHASE = 0.55;
const MIN_FIELD = 5;

const inst = await DuckDBInstance.create('data/local.duckdb', { access_mode: 'READ_ONLY' });
const conn = await inst.connect();
await conn.run('SET threads TO 1');

async function q(sql: string): Promise<Record<string, unknown>[]> {
  const r = await conn.run(sql);
  const rows = await r.getRowObjects();
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])),
  );
}

// ⬇ probe_race_shape.ts の `const BASE`(40행~)를 그대로 복사 — 산식·필터 한 글자도 변경 없음.
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

// ⬇ H9 쿼리의 CTE 체인(par·dev·h·ranked·scored, probe_race_shape.ts 394~431행) 그대로 복사.
//   변경한 것은 최종 SELECT뿐: 버킷 CASE(432~436행)의 별칭을 gap_bucket/achieve_bucket으로,
//   ${pct(...)} 대신 0~1 소수 산식으로 바꿈.
const CTE = `WITH ${BASE},
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
)`;

const cellRows = await q(`${CTE}
SELECT CASE WHEN pred_gap <= 0.5 THEN 'a. ~0.5초' WHEN pred_gap <= 1.0 THEN 'b. ~1.0초'
            WHEN pred_gap <= 1.5 THEN 'c. ~1.5초' ELSE 'd. 1.5초+' END AS gap_bucket,
       CASE WHEN p_achieve < 0.30 THEN '1_낮음(~30%)'
            WHEN p_achieve < 0.70 THEN '2_중간(30~70%)'
            ELSE '3_높음(70%+)' END AS achieve_bucket,
       COUNT(*) AS starts,
       SUM(CASE WHEN ord = 1 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS win_rate,
       SUM(CASE WHEN ord <= 3 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS place_rate
FROM scored GROUP BY 1, 2 ORDER BY 1, 2`);

const metaRows = await q(`${CTE}
SELECT MIN(race_date) AS f, MAX(race_date) AS t FROM scored`);

const rows: H7SqlRow[] = cellRows.map((r) => ({
  gapBucket: String(r.gap_bucket),
  achieveBucket: String(r.achieve_bucket),
  starts: Number(r.starts),
  winRate: Number(r.win_rate),
  placeRate: Number(r.place_rate),
}));

const table = buildH7Table(rows, {
  generatedAt: new Date().toISOString().slice(0, 10),
  raceDateFrom: Number(metaRows[0]!.f),
  raceDateTo: Number(metaRows[0]!.t),
});

writeFileSync('client/src/data/h7_table.json', JSON.stringify(table, null, 2) + '\n', 'utf8');
console.log(`✅ h7_table.json 생성 — ${table.totalStarts.toLocaleString()}출주, ${table.raceDateFrom}~${table.raceDateTo}, 12칸`);
