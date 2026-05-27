/**
 * 008 마이그레이션 적용 + 검증 (일회성)
 *
 * Supabase JS client는 raw DDL 못 돌리므로 pg로 직접 연결.
 * DATABASE_URL은 .env에서 가져옴 (특수문자 비밀번호로 따옴표 감싸진 상태).
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

async function main() {
  const sqlPath = path.resolve('supabase/migrations/008_running_style_metrics.sql');
  const sql = fs.readFileSync(sqlPath, 'utf-8');

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 없음');

  // DATABASE_URL의 비밀번호 # 문자가 URL fragment로 해석되는 문제 회피
  // postgresql://user:password@host:port/database 패턴 파싱
  const match = url.match(/^postgresql:\/\/([^:]+):(.+)@([^:]+):(\d+)\/(.+)$/);
  if (!match) throw new Error('DATABASE_URL 파싱 실패: ' + url.substring(0, 30));
  const [, user, password, host, port, database] = match;

  console.log('📥 DB 연결... host=' + host);
  const client = new Client({
    user,
    password,
    host,
    port: Number(port),
    database,
  });
  await client.connect();
  console.log('✅ 연결 완료');

  try {
    console.log('\n🔧 008 마이그레이션 적용...');
    await client.query(sql);
    console.log('✅ 적용 완료\n');

    // ============================================
    // 검증 ①: horse_sectional_ability 신규 컬럼
    // ============================================
    const r1 = await client.query(`
      SELECT
        COUNT(*) AS total_horses,
        COUNT(avg_position_ratio) AS with_ratio,
        COUNT(stddev_position_ratio) AS with_stddev,
        COUNT(front_run_success_rate) AS with_success,
        ROUND(AVG(avg_position_ratio)::numeric, 3) AS mean_ratio,
        ROUND(AVG(stddev_position_ratio)::numeric, 3) AS mean_stddev,
        ROUND(AVG(front_run_success_rate)::numeric, 2) AS mean_success
      FROM horse_sectional_ability;
    `);
    console.log('=== ① horse_sectional_ability 신규 컬럼 ===');
    console.table(r1.rows);

    // ============================================
    // 검증 ②: 분류 비율
    // ============================================
    const r2 = await client.query(`
      WITH classified AS (
        SELECT
          CASE
            WHEN stddev_position_ratio >= 0.35 THEN '0: 자유마'
            WHEN avg_position_ratio <= 0.15 THEN '1: 도주마'
            WHEN avg_position_ratio <= 0.35 THEN '2: 선행마'
            WHEN avg_position_ratio <= 0.65 THEN '3: 선입마'
            ELSE '4: 추입마'
          END AS style
        FROM horse_sectional_ability
        WHERE avg_position_ratio IS NOT NULL
      )
      SELECT
        style,
        COUNT(*) AS horses,
        ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct
      FROM classified
      GROUP BY style
      ORDER BY style;
    `);
    console.log('\n=== ② 분류 비율 (자유마 우선 판정) ===');
    console.table(r2.rows);

    // ============================================
    // 검증 ③: 거리별 view
    // ============================================
    const r3 = await client.query(`
      SELECT
        dist_category,
        COUNT(*) AS rows,
        COUNT(DISTINCT hr_name) AS unique_horses,
        ROUND(AVG(avg_position_ratio)::numeric, 3) AS mean_ratio,
        ROUND(AVG(stddev_position_ratio)::numeric, 3) AS mean_stddev
      FROM horse_running_style_by_distance
      GROUP BY dist_category
      ORDER BY dist_category;
    `);
    console.log('\n=== ③ horse_running_style_by_distance ===');
    console.table(r3.rows);

    // ============================================
    // 검증 ④: front_run_success_rate 분포
    // ============================================
    const r4 = await client.query(`
      SELECT
        CASE
          WHEN front_run_success_rate IS NULL THEN '0: 데이터 없음 (선행 안 함)'
          WHEN front_run_success_rate >= 0.7 THEN '1: 매우 높음 (≥70%)'
          WHEN front_run_success_rate >= 0.5 THEN '2: 높음 (50-70%)'
          WHEN front_run_success_rate >= 0.3 THEN '3: 보통 (30-50%)'
          ELSE '4: 낮음 (<30%)'
        END AS success_bucket,
        COUNT(*) AS horses
      FROM horse_sectional_ability
      GROUP BY success_bucket
      ORDER BY success_bucket;
    `);
    console.log('\n=== ④ front_run_success_rate 분포 ===');
    console.table(r4.rows);
  } finally {
    await client.end();
    console.log('\n🔌 DB 연결 종료');
  }
}

main().catch((err) => {
  console.error('💥', err.message ?? err);
  process.exit(1);
});
