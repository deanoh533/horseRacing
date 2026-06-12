/**
 * Supabase → 로컬 DuckDB 전체 덤프 (npm run db:pull)
 *
 * 사용:
 *   npm run db:pull                        # 전체 테이블 새로고침
 *   npm run db:pull -- --table race_entries # 단일 테이블만
 *
 * DATABASE_URL이 있으면 Postgres 직접 연결(egress 무관),
 * 없으면 supabase-js REST API 경유.
 */
import 'dotenv/config';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TABLES = [
  'race_entries', 'races', 'predictions', 'horses',
  'model_versions', 'weight_history', 'jockey_stats',
  'training_logs', 'race_sectional_stats', 'race_par_times',
] as const;

// 뷰는 결과 행을 테이블로 굳혀 적재
const VIEWS = [
  'horse_sectional_ability',
  'horse_running_style_by_distance',
] as const;

const DB_PATH = 'data/local.duckdb';
const PAGE = 1000;

// ── Postgres 직접 연결 경유 (DATABASE_URL 사용) ──────────────────
async function fetchAllPg(
  pgClient: any,
  table: string
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    const res = await pgClient.query(
      `SELECT * FROM "${table}" LIMIT $1 OFFSET $2`,
      [PAGE, offset]
    );
    if (res.rows.length === 0) break;
    all.push(...res.rows);
    if (res.rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ── supabase-js REST API 경유 (폴백) ────────────────────────────
async function fetchAllRest(table: string): Promise<Record<string, unknown>[]> {
  const { getSupabaseAdmin } = await import('../src/db/supabase.js');
  const sb = getSupabaseAdmin();
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select('*')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table} fetch 오류: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function dumpTable(
  conn: any,
  pgClient: any,
  table: string
): Promise<void> {
  process.stdout.write(`  → ${table} ... `);
  const rows = pgClient
    ? await fetchAllPg(pgClient, table)
    : await fetchAllRest(table);

  if (rows.length === 0) {
    console.log(`(빈 테이블, 스킵)`);
    return;
  }

  const tmp = join(tmpdir(), `duckpull_${table}.json`).replace(/\\/g, '/');
  writeFileSync(tmp, JSON.stringify(rows));

  try {
    await conn.run(`DROP TABLE IF EXISTS "${table}"`);
    await conn.run(`CREATE TABLE "${table}" AS SELECT * FROM read_json_auto('${tmp}')`);
  } finally {
    unlinkSync(tmp);
  }

  console.log(`✅ ${rows.length}행`);
}

async function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--table');
  const singleTable = idx >= 0 ? args[idx + 1] : null;

  if (!existsSync('data')) mkdirSync('data');

  // DATABASE_URL이 있으면 pg 직접 연결, 없으면 null(supabase-js 폴백)
  let pgClient: any = null;
  if (process.env.DATABASE_URL) {
    const { Client } = await import('pg') as any;
    // ## → %23%23 URL 인코딩 (pg URL 파서 호환)
    const connStr = process.env.DATABASE_URL.replace(/##/g, '%23%23');
    pgClient = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
    await pgClient.connect();
    console.log('🔌 Postgres 직접 연결 (DATABASE_URL)');
  } else {
    console.log('🔌 supabase-js REST API 경유');
  }

  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();

  const targets = singleTable ? [singleTable] : [...TABLES, ...VIEWS];
  console.log(`🦆 db:pull 시작: ${targets.length}개 테이블 → ${DB_PATH}\n`);

  for (const table of targets) {
    await dumpTable(conn, pgClient, table);
  }

  if (pgClient) await pgClient.end();
  // conn.close() / instance.close() 은 @duckdb/node-api에서 미지원 — GC 자동 해제
  console.log(`\n✅ db:pull 완료 → ${DB_PATH}`);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
