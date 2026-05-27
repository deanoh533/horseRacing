/**
 * Step 2 검증 — ⑤ 알고리즘 확장 후 stddev·평균 변화 확인
 *
 * 비교 포인트:
 *   - Step 1 직후: ④ stddev 0.230 / ⑤ stddev 0.223
 *   - Step 2 후: 위 두 값이 어떻게 변했는가
 *
 * 추가 검증:
 *   - 주행 성향별 ⑤ 평균 점수 (front_run_success_rate multiplier 효과)
 *   - 출전두수별 ⑤ 평균 (position_ratio 정규화 효과)
 */
import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 없음');
  const match = url.match(/^postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)$/);
  if (!match) throw new Error('DATABASE_URL 파싱 실패');
  const [, user, password, host, port, database] = match;
  const client = new Client({ user, password, host, port: Number(port), database });
  await client.connect();
  console.log('✅ DB 연결\n');

  try {
    // ============================================
    // ① ④⑤ stddev 변화 (Step 1 vs Step 2)
    // ============================================
    const r1 = await client.query(`
      SELECT
        items.key AS item,
        ROUND(AVG((items.value->>'rawScore')::numeric), 3) AS mean,
        ROUND(STDDEV((items.value->>'rawScore')::numeric), 3) AS stddev,
        COUNT(*) AS n
      FROM predictions p
           CROSS JOIN LATERAL jsonb_each(p.item_scores) items
      WHERE race_date >= 20260101
        AND items.key IN ('04_sectional_time', '05_late_position')
      GROUP BY items.key
      ORDER BY items.key;
    `);
    console.log('=== ① ④⑤ 항목 raw_score 분포 (2026년 한정) ===');
    console.log('Step 1 직후 비교: ④ stddev 0.230 / ⑤ stddev 0.223');
    console.table(r1.rows);

    // ============================================
    // ② 주행 성향별 ⑤ 점수 평균 (multiplier 효과 확인)
    //   선행 후보 말 (출발 평균 ratio ≤ 0.3) 중
    //   front_run_success_rate 높은 말 vs 낮은 말 비교
    // ============================================
    const r2 = await client.query(`
      WITH horse_style AS (
        SELECT
          hr_name,
          avg_position_ratio,
          stddev_position_ratio,
          front_run_success_rate,
          CASE
            WHEN stddev_position_ratio >= 0.35 THEN '0_자유마'
            WHEN avg_position_ratio <= 0.15 THEN '1_도주마'
            WHEN avg_position_ratio <= 0.35 THEN '2_선행마'
            WHEN avg_position_ratio <= 0.65 THEN '3_선입마'
            ELSE '4_추입마'
          END AS style
        FROM horse_sectional_ability
        WHERE avg_position_ratio IS NOT NULL
      )
      SELECT
        hs.style,
        COUNT(*) AS predictions,
        ROUND(AVG((items.value->>'rawScore')::numeric), 3) AS mean_late_pos,
        ROUND(STDDEV((items.value->>'rawScore')::numeric), 3) AS stddev_late_pos
      FROM predictions p
           CROSS JOIN LATERAL jsonb_each(p.item_scores) items
      JOIN horse_style hs ON hs.hr_name = p.hr_name
      WHERE race_date >= 20260101
        AND items.key = '05_late_position'
      GROUP BY hs.style
      ORDER BY hs.style;
    `);
    console.log('\n=== ② 주행 성향별 ⑤ 점수 평균 (2026년 예측 기준) ===');
    console.table(r2.rows);

    // ============================================
    // ③ 선행 후보 말의 front_run_success_rate 버킷별 ⑤ 점수
    //   multiplier 효과 직접 확인:
    //   success 0% → ×0.7, success 100% → ×1.3 효과가 보여야 함
    // ============================================
    const r3 = await client.query(`
      WITH front_horses AS (
        SELECT
          hr_name,
          front_run_success_rate,
          CASE
            WHEN front_run_success_rate IS NULL THEN '0_NULL'
            WHEN front_run_success_rate >= 0.7 THEN '1_매우높음(≥70%)'
            WHEN front_run_success_rate >= 0.5 THEN '2_높음(50-70%)'
            WHEN front_run_success_rate >= 0.3 THEN '3_보통(30-50%)'
            ELSE '4_낮음(<30%)'
          END AS success_bucket
        FROM horse_sectional_ability
        WHERE avg_position_ratio IS NOT NULL
          AND avg_position_ratio <= 0.3  -- 선행 후보만
      )
      SELECT
        fh.success_bucket,
        COUNT(*) AS predictions,
        ROUND(AVG((items.value->>'rawScore')::numeric), 3) AS mean_late_pos
      FROM predictions p
           CROSS JOIN LATERAL jsonb_each(p.item_scores) items
      JOIN front_horses fh ON fh.hr_name = p.hr_name
      WHERE race_date >= 20260101
        AND items.key = '05_late_position'
      GROUP BY fh.success_bucket
      ORDER BY fh.success_bucket;
    `);
    console.log('\n=== ③ 선행 후보 말의 success_rate 버킷별 ⑤ 점수 (multiplier 효과) ===');
    console.log('  → success 높을수록 mean 높아야 정상 (×0.7 ~ ×1.3)');
    console.table(r3.rows);

    // ============================================
    // ④ 출전두수 분포 + position_ratio 정규화 효과
    //   같은 출발 1등이어도 5마/14마는 score 달라야 X
    //   동일해야 정상 (정규화 효과)
    // ============================================
    const r4 = await client.query(`
      WITH races_fs AS (
        SELECT race_date, meet, rc_no, COUNT(*) AS field_size
        FROM race_entries WHERE ord IS NOT NULL
        GROUP BY race_date, meet, rc_no
      )
      SELECT
        rfs.field_size,
        COUNT(*) AS predictions,
        ROUND(AVG((items.value->>'rawScore')::numeric), 3) AS mean_late_pos
      FROM predictions p
           CROSS JOIN LATERAL jsonb_each(p.item_scores) items
      JOIN races_fs rfs
        ON rfs.race_date = p.race_date AND rfs.meet = p.meet AND rfs.rc_no = p.rc_no
      WHERE p.race_date >= 20260101
        AND items.key = '05_late_position'
      GROUP BY rfs.field_size
      ORDER BY rfs.field_size;
    `);
    console.log('\n=== ④ 출전두수별 ⑤ 점수 (정규화 효과) ===');
    console.log('  → 출전두수가 달라도 평균이 비슷해야 정규화 성공');
    console.table(r4.rows);

    // ============================================
    // ⑤ 총점(total_score) 분포 변화 (전체)
    // ============================================
    const r5 = await client.query(`
      SELECT
        ROUND(MIN(total_score)::numeric, 1) AS min,
        ROUND(AVG(total_score)::numeric, 1) AS mean,
        ROUND(STDDEV(total_score)::numeric, 1) AS stddev,
        ROUND(MAX(total_score)::numeric, 1) AS max,
        COUNT(*) AS n
      FROM predictions
      WHERE race_date >= 20260101;
    `);
    console.log('\n=== ⑤ 총점 분포 (2026년) ===');
    console.table(r5.rows);
  } finally {
    await client.end();
    console.log('\n🔌 종료');
  }
}

main().catch((err) => {
  console.error('💥', err.message ?? err);
  process.exit(1);
});
