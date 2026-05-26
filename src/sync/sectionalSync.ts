/**
 * 구간별 통과기록 sync (API37_1/sectionRecord_1)
 *
 * [TODO] API 경로 미확인:
 *   - probe 결과 /API37_1/sectionRecord_1 → HTTP 403 (키 구독 불일치)
 *   - /API6_1/* → 404 ("API not found")
 *   - data.go.kr "한국마사회 마필 구간별 경주기록" (ID: 15057859) 신청 승인 후
 *     실제 경로·파라미터 확인하고 client.ts의 getSectionalRecords() 경로 수정 필요
 *
 * CLI:
 *   npx tsx src/sync/sectionalSync.ts --date 20260524
 *   npx tsx src/sync/sectionalSync.ts --date 20260524 --meet 1
 */
import { getKRAClient } from '@kra/client.js';
import { getSupabaseAdmin } from '@db/supabase.js';
import { toSectionalRow } from './transformer.js';
import type { MeetCode } from '@app-types/index.js';

const MAX_RC_NO = 13;

export interface SectionalSyncResult {
  meet: MeetCode;
  rcDate: number;
  racesSynced: number;
  rowsSynced: number;
  errors: string[];
}

export async function syncSectional(options: {
  rcDate: number;
  meets?: MeetCode[];
}): Promise<SectionalSyncResult[]> {
  const meets: MeetCode[] = options.meets ?? [1, 3];
  const results: SectionalSyncResult[] = [];

  console.log(`\n구간기록 sync: ${options.rcDate} (meets: ${meets.join(',')})`);

  for (const meet of meets) {
    const r = await syncOneMeet(meet, options.rcDate);
    results.push(r);
  }

  return results;
}

async function syncOneMeet(
  meet: MeetCode,
  rcDate: number
): Promise<SectionalSyncResult> {
  const result: SectionalSyncResult = {
    meet,
    rcDate,
    racesSynced: 0,
    rowsSynced: 0,
    errors: [],
  };

  const kra = getKRAClient();
  const sb = getSupabaseAdmin();
  console.log(`  [meet=${meet}] 경주별 구간기록 fetch (rc_no 1~${MAX_RC_NO})...`);

  for (let rcNo = 1; rcNo <= MAX_RC_NO; rcNo++) {
    try {
      const records = await kra.getSectionalRecords({ meet, rcDate, rcNo });
      if (records.length === 0) continue;

      const rows = records.map((r) => toSectionalRow(r, meet));

      const { error } = await sb.from('sectional_records').upsert(rows, {
        onConflict: 'race_date,meet,rc_no,hr_no',
      });
      if (error) {
        result.errors.push(`rcNo=${rcNo}: ${error.message}`);
        console.error(`    rc_no=${rcNo} sectional_records 오류: ${error.message}`);
        continue;
      }

      result.racesSynced++;
      result.rowsSynced += rows.length;
      console.log(`    rc_no=${rcNo} ${rows.length}마`);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('403')) {
        result.errors.push(
          `rcNo=${rcNo}: API 403 — 구독 미신청 또는 키 불일치. data.go.kr에서 "마필 구간별 경주기록" 신청 필요`
        );
        console.error(`    rc_no=${rcNo} 403: API 구독 문제`);
        break; // 이후 rcNo도 동일 오류이므로 중단
      }
      if (msg.includes('429') || msg.includes('LIMITED_NUMBER')) {
        result.errors.push(`rcNo=${rcNo}: rate limit (중단)`);
        console.error(`    rate limit (rc_no=${rcNo})`);
        break;
      }
      result.errors.push(`rcNo=${rcNo}: ${msg.slice(0, 80)}`);
    }
  }

  console.log(
    `  [meet=${meet}] 완료: ${result.racesSynced} 경주 / ${result.rowsSynced} rows / 에러 ${result.errors.length}`
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
    console.error(
      'Usage: tsx src/sync/sectionalSync.ts --date YYYYMMDD [--meet 1,3]'
    );
    process.exit(1);
  }

  const results = await syncSectional({ rcDate, meets });
  console.log('\n' + '='.repeat(50));
  for (const r of results) {
    console.log(
      `  meet=${r.meet}: ${r.racesSynced} races / ${r.rowsSynced} rows / ${r.errors.length} errors`
    );
    for (const err of r.errors) console.log(`    - ${err}`);
  }
}

const isMainModule =
  process.argv[1] && process.argv[1].includes('sectionalSync');
if (isMainModule) {
  main().catch((err) => {
    console.error('오류:', err);
    process.exit(1);
  });
}
