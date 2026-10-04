/**
 * 주행심사 결과 수집 (마사회 홈페이지).
 *   npm run sync:gate                                   # 최근분(목록 1페이지) — 매일 캐치업 잡
 *   npm run sync:gate -- --from 20220101 --to 20261004  # 백필(날짜 훑기, 재실행 시 이어받기)
 * 실패(요청 실패·목록 비어 있음)가 있으면 종료코드 1. 누락(편성두수 대비)은 경고만.
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { createGateClient, type GateTestRow } from '../src/kra/gateTest.js';
import { backfillGateTests, parseBackfillRange, syncRecentGateTests, type GateStore } from '../src/sync/gateTestSync.js';

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

function supabaseStore(): GateStore {
  const sb = getSupabaseAdmin();
  return {
    async existing(from, to) {
      const out: Array<{ test_date: number; meet: number; trno: number }> = [];
      const PAGE = 1000;
      for (let off = 0; ; off += PAGE) {
        const { data, error } = await sb.from('gate_tests')
          .select('test_date, meet, trno')
          .gte('test_date', from).lte('test_date', to)
          .order('test_date').order('meet').order('trno').order('hr_no')
          .range(off, off + PAGE - 1);
        if (error) throw error;
        out.push(...((data ?? []) as typeof out));
        if (!data || data.length < PAGE) return out;
      }
    },
    async upsert(rows: GateTestRow[]) {
      const { error } = await sb.from('gate_tests').upsert(rows, { onConflict: 'test_date,meet,trno,hr_no' });
      if (error) throw error;
    },
  };
}

const USAGE = '사용: npm run sync:gate  (최근분) | npm run sync:gate -- --from YYYYMMDD --to YYYYMMDD  (백필)';

async function main(): Promise<void> {
  const parsed = parseBackfillRange(arg('--from'), arg('--to'));
  if (parsed === null) {
    console.error(USAGE);
    process.exit(2);
  }
  const range = parsed === 'recent' ? null : parsed;
  const client = createGateClient();
  const store = supabaseStore();
  const t0 = Date.now();
  const rep = range
    ? await backfillGateTests(client, store, range.from, range.to, { log: console.log })
    : await syncRecentGateTests(client, store, { log: console.log });
  console.log(`\n주행심사 ${range ? '백필' : '최근분'}: ${rep.rounds}회차 ${rep.rows}행 저장 · 파싱 제외 ${rep.skippedRows}행 · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  if (rep.shortfalls.length) console.warn(`⚠️ 편성두수 대비 누락 ${rep.shortfalls.length}건:\n  ${rep.shortfalls.join('\n  ')}`);
  if (rep.failures.length) {
    console.error(`❌ 실패 ${rep.failures.length}건 (다시 실행하면 이어서 받음):\n  ${rep.failures.join('\n  ')}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
