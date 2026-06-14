import 'dotenv/config';
import { getKRAClient } from '../src/kra/client.js';
import { toTrainingRow, type TrainingLogRow } from '../src/sync/transformer.js';
import { DuckDBInstance } from '@duckdb/node-api';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MeetCode } from '../src/types/index.js';

const DB_PATH = 'data/local.duckdb';
const JSONL_PATH = 'data/training_logs_full.jsonl';

export function enumerateDates(from: number, to: number): number[] {
  const d = (y: number) => new Date(Date.UTC(Math.floor(y / 10000), Math.floor((y % 10000) / 100) - 1, y % 100));
  const out: number[] = [];
  let cur = d(from); const end = d(to);
  while (cur <= end) {
    out.push(cur.getUTCFullYear() * 10000 + (cur.getUTCMonth() + 1) * 100 + cur.getUTCDate());
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function dedupTrainingRows(rows: TrainingLogRow[]): TrainingLogRow[] {
  const m = new Map<string, TrainingLogRow>();
  for (const r of rows) m.set(`${r.train_date}-${r.meet}-${r.hr_no}-${r.part}`, r);
  return [...m.values()];
}

async function fetchDateMeet(kra: any, meet: MeetCode, trDate: number, tries = 5): Promise<TrainingLogRow[] | null> {
  for (let i = 1; i <= tries; i++) {
    try {
      const recs = await kra.getAllTrainingHistory({ meet, trDate });
      return recs.map(toTrainingRow);
    } catch (e) {
      if (i === tries) return null;
      await new Promise((r) => setTimeout(r, 1500 * i)); // 지수 백오프(502 대응)
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const argOf = (k: string, def: number) => { const i = args.indexOf(k); return i >= 0 ? parseInt(args[i + 1]!, 10) : def; };
  const today = new Date();
  const todayNum = today.getUTCFullYear() * 10000 + (today.getUTCMonth() + 1) * 100 + today.getUTCDate();
  const from = argOf('--from', 20240401);
  const to = argOf('--to', todayNum);
  const meetsArg = args.indexOf('--meet');
  const meets: MeetCode[] = meetsArg >= 0 ? args[meetsArg + 1]!.split(',').map((s) => parseInt(s, 10) as MeetCode) : [1, 3];

  const kra = getKRAClient();
  const dates = enumerateDates(from, to);
  console.log(`backfill: ${from}~${to} (${dates.length}일) × meets ${meets.join(',')}`);

  const all: TrainingLogRow[] = [];
  const failed: string[] = [];
  let done = 0;
  for (const trDate of dates) {
    for (const meet of meets) {
      const rows = await fetchDateMeet(kra, meet, trDate);
      if (rows === null) { failed.push(`${trDate}-${meet}`); }
      else all.push(...rows);
    }
    if (++done % 50 === 0) console.log(`  ...${done}/${dates.length}일, 누적 ${all.length}행, 실패 ${failed.length}`);
  }

  const deduped = dedupTrainingRows(all);
  writeFileSync(JSONL_PATH, deduped.map((r) => JSON.stringify(r)).join('\n'));
  console.log(`jsonl 기록: ${deduped.length}행 → ${JSONL_PATH}`);

  const tmp = join(tmpdir(), 'backfill_training.json').replace(/\\/g, '/');
  writeFileSync(tmp, JSON.stringify(deduped));
  const inst = await DuckDBInstance.create(DB_PATH);
  const conn = await inst.connect();
  await conn.run('DROP TABLE IF EXISTS training_logs');
  await conn.run(`CREATE TABLE training_logs AS SELECT * FROM read_json_auto('${tmp}')`);
  console.log(`DuckDB training_logs 적재 완료`);

  if (failed.length) console.log(`⚠️ 실패 ${failed.length}건(재실행으로 보충): ${failed.slice(0, 20).join(', ')}${failed.length > 20 ? ' …' : ''}`);
}

const isMain = process.argv[1] && process.argv[1].includes('backfill_training');
if (isMain) main().catch((e) => { console.error('💥', e); process.exit(1); });
