/**
 * Supabase → 로컬 DuckDB 전체 덤프 (npm run db:pull)
 *
 * 사용:
 *   npm run db:pull                        # 전체 테이블 새로고침
 *   npm run db:pull -- --table race_entries # 단일 테이블만
 *
 * ⚠️ Supabase egress 리셋(2026-06-23) 후 실행.
 * 원리: Supabase → 임시 JSON → DuckDB read_json_auto (타입 자동 추론)
 */
import 'dotenv/config';
import { DuckDBInstance } from '@duckdb/node-api';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TABLES = [
  'race_entries', 'races', 'predictions', 'horses', 'horse_results',
  'model_versions', 'weight_history', 'race_cards', 'jockey_stats',
  'training_logs', 'race_sectional_stats', 'race_par_times',
] as const;

// 뷰는 결과 행을 테이블로 굳혀 적재
const VIEWS = [
  'horse_sectional_ability',
  'horse_running_style_by_distance',
] as const;

const DB_PATH = 'data/local.duckdb';
const PAGE = 1000;

async function fetchAll(
  sb: ReturnType<typeof getSupabaseAdmin>,
  table: string
): Promise<Record<string, unknown>[]> {
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
  sb: ReturnType<typeof getSupabaseAdmin>,
  table: string
): Promise<void> {
  console.log(`  → ${table}`);
  const rows = await fetchAll(sb, table);

  if (rows.length === 0) {
    console.log(`    (빈 테이블, 스킵)`);
    return;
  }

  // 임시 JSON 파일 → DuckDB read_json_auto (타입 자동 추론)
  const tmp = join(tmpdir(), `duckpull_${table}.json`).replace(/\\/g, '/');
  writeFileSync(tmp, JSON.stringify(rows));

  try {
    await conn.run(`DROP TABLE IF EXISTS "${table}"`);
    await conn.run(`CREATE TABLE "${table}" AS SELECT * FROM read_json_auto('${tmp}')`);
  } finally {
    unlinkSync(tmp);
  }

  console.log(`    ✅ ${rows.length}행`);
}

async function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--table');
  const singleTable = idx >= 0 ? args[idx + 1] : null;

  if (!existsSync('data')) mkdirSync('data');

  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();
  const sb = getSupabaseAdmin();

  const targets = singleTable ? [singleTable] : [...TABLES, ...VIEWS];
  console.log(`🦆 db:pull 시작: ${targets.length}개 테이블 → ${DB_PATH}`);

  for (const table of targets) {
    await dumpTable(conn, sb, table);
  }

  // conn.close() / instance.close() 은 @duckdb/node-api에서 미지원 — GC 자동 해제
  console.log(`\n✅ db:pull 완료 → ${DB_PATH}`);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
