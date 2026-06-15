import 'dotenv/config';
import { getKRAClient } from '../src/kra/client.js';
import { toTrainingRow, type TrainingLogRow } from '../src/sync/transformer.js';
import { DuckDBInstance } from '@duckdb/node-api';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MeetCode } from '../src/types/index.js';

const DB_PATH = 'data/local.duckdb';
const JSONL_PATH = 'data/training_logs_full.jsonl';
const DONE_PATH = 'data/training_logs_done.json'; // 완료한 date-meet 원장 (빈 날 포함 → 재실행 skip)

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

/** 완료 원장 키 (date-meet). 빈 날도 기록해 재실행 시 재호출 방지. */
export function doneKey(trDate: number, meet: number): string {
  return `${trDate}-${meet}`;
}

class QuotaError extends Error {}

async function fetchDateMeet(kra: any, meet: MeetCode, trDate: number, tries = 5): Promise<TrainingLogRow[] | null> {
  for (let i = 1; i <= tries; i++) {
    try {
      const recs = await kra.getAllTrainingHistory({ meet, trDate });
      return recs.map(toTrainingRow);
    } catch (e: any) {
      if (e?.response?.status === 429) throw new QuotaError('API token quota exceeded'); // 재시도 무의미 → 즉시 중단
      if (i === tries) return null; // 502 등 일시 장애: 실패로 두고 다음 재실행에 보충
      await new Promise((r) => setTimeout(r, 1500 * i)); // 지수 백오프
    }
  }
  return null;
}

function reloadDuckDB(rows: TrainingLogRow[]): Promise<void> {
  const tmp = join(tmpdir(), 'backfill_training.json').replace(/\\/g, '/');
  writeFileSync(tmp, JSON.stringify(rows));
  return (async () => {
    const inst = await DuckDBInstance.create(DB_PATH);
    const conn = await inst.connect();
    await conn.run('DROP TABLE IF EXISTS training_logs');
    await conn.run(`CREATE TABLE training_logs AS SELECT * FROM read_json_auto('${tmp}')`);
  })();
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

  // ── 재개: 기존 jsonl·완료원장 로드 ──
  const existingRows: TrainingLogRow[] = existsSync(JSONL_PATH)
    ? readFileSync(JSONL_PATH, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as TrainingLogRow)
    : [];
  const doneSet: Set<string> = new Set(
    existsSync(DONE_PATH) ? (JSON.parse(readFileSync(DONE_PATH, 'utf8')) as string[]) : []
  );

  // 대체 키: --key-env KRA_API_KEY_FRIEND → .env의 해당 변수를 KRA_API_KEY로 주입(셸 히스토리 노출 X).
  // getKRAClient() 첫 호출 전에 설정해야 함.
  const keyEnvIdx = args.indexOf('--key-env');
  if (keyEnvIdx >= 0) {
    const v = args[keyEnvIdx + 1]!;
    const k = process.env[v];
    if (!k) { console.error(`환경변수 ${v} 없음 — .env에 ${v}=<키> 추가 필요`); process.exit(1); }
    process.env.KRA_API_KEY = k;
    console.log(`🔑 대체 키 사용: ${v}`);
  }

  const kra = getKRAClient();
  const dates = enumerateDates(from, to);
  console.log(`backfill: ${from}~${to} (${dates.length}일) × meets ${meets.join(',')}`);
  console.log(`재개: 기존 ${existingRows.length}행, 완료 ${doneSet.size} date-meet`);

  const fresh: TrainingLogRow[] = [];
  const failed: string[] = [];
  let quotaHit = false;
  let processed = 0, skipped = 0;

  outer:
  for (const trDate of dates) {
    for (const meet of meets) {
      const key = doneKey(trDate, meet);
      if (doneSet.has(key)) { skipped++; continue; }
      let rows: TrainingLogRow[] | null;
      try {
        rows = await fetchDateMeet(kra, meet, trDate);
      } catch (e) {
        if (e instanceof QuotaError) { quotaHit = true; break outer; }
        throw e;
      }
      if (rows === null) failed.push(key);
      else { fresh.push(...rows); doneSet.add(key); } // 빈 날(0행)도 완료로 기록
    }
    if (++processed % 50 === 0) console.log(`  ...${processed}/${dates.length}일, 신규 ${fresh.length}행, skip ${skipped}, 실패 ${failed.length}`);
  }

  // ── 저장 (쿼터 중단이어도 진행분 보존) ──
  const merged = dedupTrainingRows([...existingRows, ...fresh]);
  writeFileSync(JSONL_PATH, merged.map((r) => JSON.stringify(r)).join('\n'));
  writeFileSync(DONE_PATH, JSON.stringify([...doneSet]));
  await reloadDuckDB(merged);

  console.log(`\njsonl ${merged.length}행 (신규 ${fresh.length}) → ${JSONL_PATH}`);
  console.log(`완료 원장 ${doneSet.size} date-meet → ${DONE_PATH}`);
  console.log(`DuckDB training_logs 적재 완료 (${merged.length}행)`);
  if (quotaHit) console.log(`\n⛔ API 쿼터 소진 — 중단. 쿼터 리셋(보통 다음날) 후 같은 명령 재실행하면 skip하고 이어서 진행.`);
  if (failed.length) console.log(`⚠️ 비쿼터 실패 ${failed.length}건(재실행 보충): ${failed.slice(0, 20).join(', ')}${failed.length > 20 ? ' …' : ''}`);
  if (!quotaHit && !failed.length) console.log(`\n✅ 요청 범위 완료.`);
}

const isMain = process.argv[1] && process.argv[1].includes('backfill_training');
if (isMain) main().catch((e) => { console.error('💥', e); process.exit(1); });
