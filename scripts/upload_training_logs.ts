/**
 * 로컬 JSONL(data/training_logs_full.jsonl) → Supabase training_logs upsert
 *
 * KRA 재호출 없음 — 이미 받아 쌓아둔 JSONL을 라이브 DB로 올린다.
 * DATABASE_URL(Postgres 직결) 필수 — egress 무관·배치 INSERT로 빠름.
 *
 * 사용:
 *   npx tsx scripts/upload_training_logs.ts                 # 전체 upsert
 *   npx tsx scripts/upload_training_logs.ts --jsonl <path>  # 다른 JSONL
 *   npx tsx scripts/upload_training_logs.ts --batch 2000    # 배치 크기
 *   npx tsx scripts/upload_training_logs.ts --dry-run       # 적재 없이 행수만
 */
import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import type { TrainingLogRow } from '../src/sync/transformer.js';

const JSONL_PATH = 'data/training_logs_full.jsonl';

// Supabase training_logs 컬럼 순서 (005_kra_extension.sql). fetched_at은 DEFAULT NOW() → 제외.
export const TRAINING_COLS = [
  'train_date', 'meet', 'hr_no', 'part',
  'hr_name', 'trar_nm', 'part_no', 'chul_gubun', 'pr_gubun', 'pr_no',
  'run1_cnt', 'run2_cnt', 'st_time', 'sp_time', 'tr_term',
] as const;

const PK_COLS = ['train_date', 'meet', 'hr_no', 'part'] as const;

/** TrainingLogRow → 컬럼 순서 값 배열. part null→1(PK NOT NULL), hr_no 7자리 pad. */
export function normalizeRow(r: TrainingLogRow): (string | number | null)[] {
  const get = (k: string): string | number | null => {
    switch (k) {
      case 'hr_no': return String(r.hr_no).padStart(7, '0');
      case 'part': return r.part ?? 1;
      default: {
        const v = (r as Record<string, unknown>)[k];
        return v === undefined ? null : (v as string | number | null);
      }
    }
  };
  return TRAINING_COLS.map(get);
}

/** PK(train_date,meet,hr_no,part) 기준 dedup — coalesce 후 키로, 마지막 행 우선. */
export function dedupByPk(rows: TrainingLogRow[]): TrainingLogRow[] {
  const m = new Map<string, TrainingLogRow>();
  for (const r of rows) {
    const key = `${r.train_date}-${r.meet}-${String(r.hr_no).padStart(7, '0')}-${r.part ?? 1}`;
    m.set(key, r);
  }
  return [...m.values()];
}

/** N행 배치 upsert SQL — $1..$(N*ncol) placeholder + ON CONFLICT DO UPDATE(PK 제외). */
export function buildUpsertSql(rowCount: number): string {
  const ncol = TRAINING_COLS.length;
  const tuples: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const ph = TRAINING_COLS.map((_, j) => `$${i * ncol + j + 1}`).join(',');
    tuples.push(`(${ph})`);
  }
  const updateSet = TRAINING_COLS
    .filter((c) => !PK_COLS.includes(c as typeof PK_COLS[number]))
    .map((c) => `${c}=EXCLUDED.${c}`)
    .join(',');
  return `INSERT INTO training_logs (${TRAINING_COLS.join(',')}) VALUES ${tuples.join(',')} ` +
    `ON CONFLICT (${PK_COLS.join(',')}) DO UPDATE SET ${updateSet}`;
}

function loadJsonl(path: string): TrainingLogRow[] {
  if (!existsSync(path)) throw new Error(`JSONL 없음: ${path}`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TrainingLogRow);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const argOf = (k: string, def: string): string => {
    const i = args.indexOf(k);
    return i >= 0 && args[i + 1] ? args[i + 1]! : def;
  };
  const jsonlPath = argOf('--jsonl', JSONL_PATH);
  const batch = parseInt(argOf('--batch', '1000'), 10);
  const dryRun = args.includes('--dry-run');

  const raw = loadJsonl(jsonlPath);
  const rows = dedupByPk(raw);
  console.log(`📄 ${jsonlPath}: ${raw.length}행 로드 → dedup 후 ${rows.length}행`);

  if (dryRun) {
    console.log('🧪 dry-run — 적재 생략');
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL 없음 — Postgres 직결 필수 (egress 절약). .env 확인.');
    process.exit(1);
  }

  const pgModule = (await import('pg')) as any;
  const { Client } = pgModule.default ?? pgModule;
  const connStr = process.env.DATABASE_URL.replace(/##/g, '%23%23');
  const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('🔌 Postgres 직접 연결 (DATABASE_URL)');

  let done = 0;
  try {
    for (let i = 0; i < rows.length; i += batch) {
      const slice = rows.slice(i, i + batch);
      const sql = buildUpsertSql(slice.length);
      const params = slice.flatMap(normalizeRow);
      await client.query(sql, params);
      done += slice.length;
      if (done % 20000 === 0 || done === rows.length) {
        console.log(`  ...${done}/${rows.length}행 upsert`);
      }
    }
  } finally {
    await client.end();
  }
  console.log(`✅ training_logs upsert 완료 — ${done}행`);
}

const isMain = process.argv[1] && process.argv[1].includes('upload_training_logs');
if (isMain) {
  main().catch((e) => {
    console.error('오류:', e);
    process.exit(1);
  });
}
