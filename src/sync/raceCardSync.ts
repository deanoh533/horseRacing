/**
 * 출주표 sync (API314 서울 / API316 부산경남)
 *
 * 운영 사용:
 *   - 매주 수~목요일: 다음 주말 (금/토/일) 경주 출주표 fetch
 *   - 각 경주마다 rcNo 1~12 시도 (없으면 skip)
 *   - race_entries + races 동시 채움 → 웹에서 사전 표시 가능
 *
 * CLI:
 *   tsx src/sync/raceCardSync.ts --date 20260530
 *   tsx src/sync/raceCardSync.ts --date 20260530 --meet 1
 */
import { getKRAClient } from '@kra/client.js';
import { getSupabaseAdmin } from '@db/supabase.js';
import { toRaceEntryRow } from './transformer.js';
import type { MeetCode } from '@app-types/index.js';

const MAX_RC_NO = 13;

export interface RaceCardSyncResult {
  meet: MeetCode;
  rcDate: number;
  racesSynced: number;
  horsesSynced: number;
  errors: string[];
}

export async function syncRaceCards(options: {
  rcDate: number;
  meets?: MeetCode[];
}): Promise<RaceCardSyncResult[]> {
  const meets: MeetCode[] = options.meets ?? [1, 3];
  const results: RaceCardSyncResult[] = [];

  console.log(`\n🎫 출주표 sync: ${options.rcDate} (meets: ${meets.join(',')})`);

  for (const meet of meets) {
    const r = await syncOneMeet(meet, options.rcDate);
    results.push(r);
  }

  return results;
}

async function syncOneMeet(
  meet: MeetCode,
  rcDate: number
): Promise<RaceCardSyncResult> {
  const result: RaceCardSyncResult = {
    meet,
    rcDate,
    racesSynced: 0,
    horsesSynced: 0,
    errors: [],
  };

  const kra = getKRAClient();
  const sb = getSupabaseAdmin();
  console.log(`  [meet=${meet}] 경주별 fetch 시도 (rc_no 1~${MAX_RC_NO})...`);

  for (let rcNo = 1; rcNo <= MAX_RC_NO; rcNo++) {
    try {
      const cards = await kra.getRaceCard({ meet, rcDate, rcNo });
      if (cards.length === 0) continue;

      // race_entries rows 변환
      const rows = cards.map((c) => toRaceEntryRow(c, meet, rcDate, rcNo));

      // race_entries upsert
      const { error: entryError } = await sb.from('race_entries').upsert(rows, {
        onConflict: 'race_date,meet,rc_no,pthr_no',
      });
      if (entryError) {
        result.errors.push(`rcNo=${rcNo}: ${entryError.message}`);
        console.error(`    rc_no=${rcNo} ❌ race_entries: ${entryError.message}`);
        continue;
      }

      // races 테이블에 경주 번호 먼저 insert (거리/주로는 경기 후 채워짐)
      const { error: raceError } = await sb.from('races').upsert(
        { race_date: rcDate, meet, rc_no: rcNo },
        { onConflict: 'race_date,meet,rc_no' }
      );
      if (raceError) {
        console.warn(`    rc_no=${rcNo} ⚠️ races insert 실패 (계속): ${raceError.message}`);
      }

      result.racesSynced++;
      result.horsesSynced += rows.length;
      console.log(`    rc_no=${rcNo} ✓ ${rows.length}마`);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('429') || msg.includes('LIMITED_NUMBER')) {
        result.errors.push(`rcNo=${rcNo}: rate limit (중단)`);
        console.error(`    ❌ KRA rate limit (rc_no=${rcNo})`);
        break;
      }
      result.errors.push(`rcNo=${rcNo}: ${msg.slice(0, 80)}`);
    }
  }

  console.log(
    `  [meet=${meet}] 완료: ${result.racesSynced} 경주 / ${result.horsesSynced} 마 / 에러 ${result.errors.length}`
  );
  return result;
}

// ============================================
// CLI
// ============================================
async function main() {
  const args = process.argv.slice(2);
  let rcDate = 0;
  let meets: MeetCode[] = [1, 3];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      rcDate = parseInt(args[i + 1]!, 10);
    } else if (args[i] === '--meet' && args[i + 1]) {
      meets = args[i + 1]!
        .split(',')
        .map((s) => parseInt(s, 10) as MeetCode)
        .filter((m) => m === 1 || m === 3);
    }
  }

  if (!rcDate) {
    console.error('Usage: tsx src/sync/raceCardSync.ts --date YYYYMMDD [--meet 1,3]');
    process.exit(1);
  }

  const results = await syncRaceCards({ rcDate, meets });
  console.log('\n' + '='.repeat(50));
  for (const r of results) {
    console.log(`  meet=${r.meet}: ${r.racesSynced} races / ${r.horsesSynced} horses / ${r.errors.length} errors`);
  }
}

const isMainModule =
  process.argv[1] && process.argv[1].includes('raceCardSync');
if (isMainModule) {
  main().catch((err) => {
    console.error('💥', err);
    process.exit(1);
  });
}
