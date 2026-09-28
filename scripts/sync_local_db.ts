/**
 * Supabase → 로컬 DuckDB 미러 동기화 (npm run db:pull)
 *
 * 사용:
 *   npm run db:pull                         # 전체 (증분)
 *   npm run db:pull -- --table race_entries # 단일 테이블
 *   npm run db:pull -- --full               # 증분 무시하고 전량
 *
 * DATABASE_URL이 있으면 Postgres 직접 연결(egress 무관 + 증분 가능),
 * 없으면 supabase-js REST API 경유(전량만).
 *
 * 증분 설계: docs/superpowers/specs/2026-09-29-db-pull-incremental-design.md
 * 핵심 — 원천의 날짜별 내용 해시를 `_sync_state`에 저장해두고 다음 실행에서
 * "원천 지금 vs 원천 그때"를 비교한다. 미러에서 해시를 재계산하면 Postgres와
 * DuckDB의 행 표기 차이 때문에 영원히 전부 "바뀜"이 된다.
 */
import 'dotenv/config';
import { DuckDBInstance } from '@duckdb/node-api';
import { mkdirSync, existsSync } from 'node:fs';
import {
  TABLE_SPECS, ALL_TARGETS, isIncremental, type IncrementalSpec,
} from '../src/db/mirror/tableSpecs.js';
import {
  buildFingerprintSql, buildRowsByDatesSql, diffFingerprints, type Fingerprint,
} from '../src/db/mirror/fingerprint.js';
import { decideSyncPlan, FULL_REASON_LABEL } from '../src/db/mirror/syncPlan.js';
import {
  ensureSyncStateTable, readFingerprints, FULL_TABLE_DATE_KEY,
} from '../src/db/mirror/syncState.js';
import {
  applyIncremental, applyFullReload, tableExistsInMirror, writeRowsJson, removeTmp,
} from '../src/db/mirror/load.js';

const DB_PATH = 'data/local.duckdb';
/** REST 폴백 전용 — PostgREST 기본 1000행 상한 때문에 페이징이 필수다 */
const REST_PAGE = 1000;

// ── 원천 읽기 ────────────────────────────────────────────────────

/**
 * 직결은 페이징하지 않는다. OFFSET은 건너뛸 행을 매번 처음부터 세고 버리므로
 * training_logs 376k를 1000행씩 377회 받으면 누적 7,100만 행을 헛스캔한다.
 */
async function queryPg(
  pgClient: any, sql: string, params: unknown[] = []
): Promise<Record<string, unknown>[]> {
  const res = await pgClient.query(sql, params);
  return res.rows;
}

/** REST 폴백 — 1000행 상한을 페이지네이션으로 넘는다(이 저장소가 이미 겪은 함정) */
async function fetchAllRest(table: string): Promise<Record<string, unknown>[]> {
  const { getSupabaseAdmin } = await import('../src/db/supabase.js');
  const sb = getSupabaseAdmin();
  const all: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += REST_PAGE) {
    const { data, error } = await sb.from(table).select('*').range(offset, offset + REST_PAGE - 1);
    if (error) throw new Error(`${table} fetch 오류: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as Record<string, unknown>[]));
    if (data.length < REST_PAGE) break;
  }
  return all;
}

async function fetchAllRows(
  pgClient: any, table: string
): Promise<Record<string, unknown>[]> {
  return pgClient ? queryPg(pgClient, `SELECT * FROM "${table}"`) : fetchAllRest(table);
}

/** 원천의 날짜별 지문. 직결일 때만 가능. */
async function fetchFingerprints(
  pgClient: any, table: string, spec: IncrementalSpec
): Promise<Fingerprint[]> {
  const rows = await queryPg(pgClient, buildFingerprintSql(table, spec));
  return rows.map((r: any) => ({
    dateKey: Number(r.d),
    rowCount: Number(r.n),   // count(*)는 bigint → pg가 문자열로 준다
    hash: String(r.h),
  }));
}

// ── 테이블 한 개 동기화 ──────────────────────────────────────────

async function fullReload(
  conn: any, pgClient: any, table: string, fingerprints: Fingerprint[], label: string
): Promise<void> {
  const rows = await fetchAllRows(pgClient, table);
  const tmp = writeRowsJson(table, rows);
  try {
    if (rows.length === 0) {
      console.log(`(빈 테이블, 스킵) ${label}`);
      return;
    }
    // 전량인데 증분 대상이면 받아둔 지문을, 아니면 date_key=-1 한 줄(신선도용)
    const fps = fingerprints.length > 0
      ? fingerprints
      : [{ dateKey: FULL_TABLE_DATE_KEY, rowCount: rows.length, hash: 'full' }];
    await applyFullReload({
      conn, table, rowsJsonPath: tmp,
      // REST 폴백은 _sync_state를 건드리지 않는다 (spec §5.6)
      fingerprints: pgClient ? fps : [],
      syncedAtIso: new Date().toISOString(),
    });
    console.log(`✅ ${rows.length}행  [전량 — ${label}]`);
  } finally {
    removeTmp(tmp);
  }
}

async function syncOne(
  conn: any, pgClient: any, table: string, forced: boolean
): Promise<void> {
  process.stdout.write(`  → ${table} ... `);
  const spec = TABLE_SPECS[table];
  if (!spec) throw new Error(`알 수 없는 테이블: ${table} (src/db/mirror/tableSpecs.ts 확인)`);

  // 증분 불가(전량 전용 테이블·뷰) 또는 REST 폴백이면 바로 전량
  if (!isIncremental(spec) || !pgClient) {
    await fullReload(conn, pgClient, table, [], !pgClient ? 'REST 폴백' : '전량 대상');
    return;
  }

  const source = await fetchFingerprints(pgClient, table, spec);
  const stored = await readFingerprints(conn, table);
  const plan = decideSyncPlan({
    forced,
    directConnection: true,
    tableExistsInMirror: await tableExistsInMirror(conn, table),
    hasStoredFingerprints: stored.length > 0,
    sourceDateCount: source.length,
    diff: diffFingerprints(source, stored),
  });

  if (plan.kind === 'skip') {
    console.log(`⏭️  바뀐 날짜 없음 (${source.length}일 확인)`);
    return;
  }
  if (plan.kind === 'full') {
    await fullReload(conn, pgClient, table, source, FULL_REASON_LABEL[plan.reason]);
    return;
  }

  const rows = plan.load.length > 0
    ? await queryPg(pgClient, buildRowsByDatesSql(table, spec), [plan.load])
    : [];
  const tmp = writeRowsJson(table, rows);
  const loadedFps = source.filter((f) => plan.load.includes(f.dateKey));

  try {
    await applyIncremental({
      conn, table, dateCol: spec.dateCol,
      load: plan.load, remove: plan.remove, rowsJsonPath: tmp,
      fingerprints: loadedFps, syncedAtIso: new Date().toISOString(),
    });
    const parts = [`${rows.length}행 / ${plan.load.length}일 교체`];
    if (plan.remove.length > 0) parts.push(`${plan.remove.length}일 삭제`);
    console.log(`✅ ${parts.join(' · ')}  [증분]`);
  } catch (e) {
    // 타입 추론 불일치 등 — 조용히 넘어가지 않는다 (spec §8.1)
    console.warn(`\n    ⚠️ 증분 적재 실패 → 전량으로 폴백: ${(e as Error).message}`);
    process.stdout.write(`  → ${table} (재시도) ... `);
    await fullReload(conn, pgClient, table, source, '증분 실패 폴백');
  } finally {
    removeTmp(tmp);
  }
}

// ── 진입점 ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--table');
  const singleTable = idx >= 0 ? args[idx + 1] : null;
  const forced = args.includes('--full');

  if (!existsSync('data')) mkdirSync('data');

  let pgClient: any = null;
  if (process.env.DATABASE_URL) {
    const pgModule = (await import('pg')) as any;
    const { Client, types } = pgModule.default ?? pgModule;
    // NUMERIC(1700)을 string이 아닌 number로 — supabase-js REST와 같게
    types.setTypeParser(1700, (v: string) => parseFloat(v));
    // ## → %23%23 URL 인코딩 (pg URL 파서 호환)
    const connStr = process.env.DATABASE_URL.replace(/##/g, '%23%23');
    pgClient = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
    await pgClient.connect();
    console.log('🔌 Postgres 직접 연결 (DATABASE_URL) — 증분 가능');
  } else {
    console.log('🔌 supabase-js REST API 경유 — 전량만 (증분은 직결에서만)');
  }

  const instance = await DuckDBInstance.create(DB_PATH);
  const conn = await instance.connect();
  await ensureSyncStateTable(conn);

  const targets = singleTable ? [singleTable] : ALL_TARGETS;
  console.log(`🦆 db:pull 시작: ${targets.length}개 대상 → ${DB_PATH}${forced ? ' (--full)' : ''}\n`);

  const started = Date.now();
  for (const table of targets) {
    await syncOne(conn, pgClient, table, forced);
  }

  if (pgClient) await pgClient.end();
  // conn.close() / instance.close() 은 @duckdb/node-api에서 미지원 — GC 자동 해제.
  // ⚠️ 그래서 이 프로세스가 끝난 뒤에도 잠깐 파일을 쥔다. 직후 다른 명령을 이어 돌리면
  //    잠금 에러가 날 수 있다(몇 초 뒤 재시도).
  console.log(`\n✅ db:pull 완료 (${((Date.now() - started) / 1000).toFixed(1)}초) → ${DB_PATH}`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
