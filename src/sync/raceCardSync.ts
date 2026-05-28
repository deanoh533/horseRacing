/**
 * 출전표 sync (API26_2/entrySheet_2)
 *
 * 운영 사용:
 *   - 매주 수~목요일: 다음 주말 (금/토/일) 경주 출전표 fetch
 *   - meet + rc_date 단위로 전체 경주 일괄 반환 → rcNo 루프 불필요
 *   - race_entries + races 동시 채움 (거리·등급·상금조건 포함)
 *
 * CLI:
 *   tsx src/sync/raceCardSync.ts --date 20260530
 *   tsx src/sync/raceCardSync.ts --date 20260530 --meet 1
 */
import { getKRAClient } from '@kra/client.js';
import { getSupabaseAdmin } from '@db/supabase.js';
import { toRaceEntryRowFromEntrySheet, toRaceRowFromEntrySheet } from './transformer.js';
import type { MeetCode } from '@app-types/index.js';

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
  console.log(`  [meet=${meet}] API26_2 출전표 fetch...`);

  try {
    const items = await kra.getAllEntrySheet({ meet, rcDate });
    if (items.length === 0) {
      console.log(`  [meet=${meet}] 데이터 없음`);
      return result;
    }

    // rcNo별 그룹핑
    const byRcNo = new Map<number, typeof items>();
    for (const item of items) {
      if (!byRcNo.has(item.rcNo)) byRcNo.set(item.rcNo, []);
      byRcNo.get(item.rcNo)!.push(item);
    }

    for (const [rcNo, raceItems] of byRcNo) {
      try {
        // race_entries upsert
        const entryRows = raceItems.map(toRaceEntryRowFromEntrySheet);
        const { error: entryError } = await sb.from('race_entries').upsert(entryRows, {
          onConflict: 'race_date,meet,rc_no,pthr_no',
        });
        if (entryError) {
          result.errors.push(`rcNo=${rcNo}: ${entryError.message}`);
          console.error(`    rc_no=${rcNo} ❌ race_entries: ${entryError.message}`);
          continue;
        }

        // races upsert (거리·등급·상금조건 포함, 주로/날씨는 결과 싱크에서 채움)
        const raceRow = toRaceRowFromEntrySheet(raceItems[0]!);
        const { error: raceError } = await sb.from('races').upsert(raceRow, {
          onConflict: 'race_date,meet,rc_no',
        });
        if (raceError) {
          console.warn(`    rc_no=${rcNo} ⚠️ races upsert 실패 (계속): ${raceError.message}`);
        }

        result.racesSynced++;
        result.horsesSynced += raceItems.length;
        console.log(`    rc_no=${rcNo} ✓ ${raceItems.length}마`);
      } catch (e) {
        const msg = (e as Error).message;
        result.errors.push(`rcNo=${rcNo}: ${msg.slice(0, 80)}`);
        console.error(`    rc_no=${rcNo} ❌ ${msg}`);
      }
    }
  } catch (e) {
    const msg = (e as Error).message;
    result.errors.push(`전체 실패: ${msg}`);
    console.error(`  [meet=${meet}] ❌ ${msg}`);
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
