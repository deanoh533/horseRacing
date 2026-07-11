/**
 * db:snapshot — predictions 스냅샷 (재학습·백필 등 대량 쓰기 전 안전장치)
 *
 * DATABASE_URL Postgres 직결(egress 무관)로 DB 안에 테이블 복사:
 *   CREATE TABLE predictions_snapshot_YYYYMMDD AS SELECT * FROM predictions
 *
 * Usage:
 *   npm run db:snapshot                 # 오늘 이름으로 생성 (이미 있으면 유지·종료)
 *   npm run db:snapshot -- --force      # 같은 날 스냅샷 교체
 *   npm run db:snapshot -- --prune 3    # 최신 3개만 남기고 오래된 스냅샷 삭제
 *
 * 복원 절차(수동 SQL)는 docs/pipeline_guide.md 참고.
 */
import 'dotenv/config';

export function snapshotTableName(now: Date = new Date()): string {
  const ymd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return `predictions_snapshot_${ymd}`;
}

/** 이름(=날짜) 내림차순 정렬 후 최신 keep개를 제외한 나머지 반환 */
export function tablesToPrune(names: string[], keep: number): string[] {
  return [...names].sort().reverse().slice(Math.max(keep, 0));
}

async function connectPg() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL 필요 (.env) — Supabase Postgres 직결 문자열');
  }
  const pgModule = (await import('pg')) as any;
  const { Client } = pgModule.default ?? pgModule;
  // ## → %23%23 URL 인코딩 (pg URL 파서 호환 — sync_local_db.ts와 동일)
  const connStr = process.env.DATABASE_URL.replace(/##/g, '%23%23');
  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  let prune = 0;
  const pruneIdx = args.indexOf('--prune');
  if (pruneIdx >= 0 && args[pruneIdx + 1]) {
    prune = parseInt(args[pruneIdx + 1]!, 10);
    if (!Number.isFinite(prune) || prune < 1) {
      console.error('❌ --prune N: N은 1 이상의 정수');
      process.exit(1);
    }
  }

  const table = snapshotTableName();
  const pg = await connectPg();
  console.log('🔌 Postgres 직접 연결 (DATABASE_URL)');

  try {
    const existing = await pg.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'predictions_snapshot_%'
       ORDER BY table_name`
    );
    const names: string[] = existing.rows.map((r: any) => r.table_name);

    if (names.includes(table)) {
      if (!force) {
        console.log(`ℹ️ ${table} 이미 존재 — 유지하고 종료 (교체하려면 --force)`);
        return;
      }
      await pg.query(`DROP TABLE "${table}"`);
      console.log(`♻️ 기존 ${table} 삭제 (--force)`);
    }

    await pg.query(`CREATE TABLE "${table}" AS SELECT * FROM predictions`);

    const counts = await pg.query(
      `SELECT (SELECT count(*) FROM predictions) AS src,
              (SELECT count(*) FROM "${table}") AS dst`
    );
    const { src, dst } = counts.rows[0];
    if (src !== dst) {
      console.error(`❌ 행수 불일치: predictions=${src} vs ${table}=${dst}`);
      process.exit(1);
    }
    console.log(`✅ ${table} 생성 완료 (${dst}행 = 원본 ${src}행)`);

    if (prune > 0) {
      const all = names.includes(table) ? names : [...names, table].sort();
      for (const victim of tablesToPrune(all, prune)) {
        await pg.query(`DROP TABLE "${victim}"`);
        console.log(`🗑 오래된 스냅샷 삭제: ${victim}`);
      }
    }
  } finally {
    await pg.end();
  }
}

const isMainModule = process.argv[1] && process.argv[1].includes('snapshot_predictions');
if (isMainModule) {
  main().catch((err) => {
    console.error('💥', err);
    process.exit(1);
  });
}
