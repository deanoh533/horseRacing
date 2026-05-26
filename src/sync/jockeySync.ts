/**
 * 기수 성적 sync (jkpresult/getjkpresult — 이미 구독, 검증됨)
 *
 * meet 단위로 전체 조회 (기수번호별 개별 조회 X)
 *   - getJockeyStats({ meet: 1 }) → 서울 전체 기수 통산 성적
 *
 * CLI:
 *   npx tsx src/sync/jockeySync.ts                     # 서울+부경 전체
 *   npx tsx src/sync/jockeySync.ts --jk_no 051174      # 특정 기수만
 *   npx tsx src/sync/jockeySync.ts --meet 1            # 서울만
 */
import { getKRAClient } from '@kra/client.js';
import { getSupabaseAdmin } from '@db/supabase.js';
import { toJockeyStatsRow } from './transformer.js';
import type { MeetCode } from '@app-types/index.js';

interface JockeySyncOptions {
  jkNo?: string;
  meet?: MeetCode;
}

interface JockeySyncResult {
  total: number;
  synced: number;
  errors: string[];
}

export async function syncJockeys(
  options: JockeySyncOptions = {}
): Promise<JockeySyncResult> {
  const result: JockeySyncResult = { total: 0, synced: 0, errors: [] };
  const sb = getSupabaseAdmin();
  const kra = getKRAClient();

  const meetsToSync: MeetCode[] = options.meet ? [options.meet] : [1, 3];

  for (const meet of meetsToSync) {
    try {
      console.log(`  meet=${meet} 기수 통산 성적 조회...`);
      const params = options.jkNo
        ? { jkNo: options.jkNo, meet }
        : { meet };
      const stats = await kra.getJockeyStats(params);
      if (stats.length === 0) {
        console.log(`  meet=${meet}: 데이터 없음`);
        continue;
      }

      result.total += stats.length;
      const rows = stats.map((s) => toJockeyStatsRow(s));
      const { error } = await sb.from('jockey_stats').upsert(rows, {
        onConflict: 'jcky_no,meet',
      });
      if (error) {
        result.errors.push(`meet=${meet}: ${error.message}`);
      } else {
        result.synced += rows.length;
        console.log(`  meet=${meet}: ${rows.length}명 동기화`);
      }
    } catch (e) {
      const msg = (e as Error).message;
      result.errors.push(`meet=${meet}: ${msg.slice(0, 120)}`);
      console.error(`  meet=${meet} 에러: ${msg.slice(0, 120)}`);
    }
  }

  console.log(
    `  완료: ${result.synced}/${result.total} 동기화 / 에러 ${result.errors.length}`
  );
  return result;
}

// ============================================
// CLI
// ============================================
async function main() {
  const args = process.argv.slice(2);
  let jkNo: string | undefined;
  let meet: MeetCode | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--jk_no' && args[i + 1]) {
      jkNo = args[i + 1]!;
    } else if (args[i] === '--meet' && args[i + 1]) {
      meet = parseInt(args[i + 1]!, 10) as MeetCode;
    }
  }

  const result = await syncJockeys({ jkNo, meet });
  console.log('\n' + '='.repeat(50));
  console.log(`  total=${result.total} synced=${result.synced} errors=${result.errors.length}`);
  for (const err of result.errors.slice(0, 5)) {
    console.log(`    - ${err}`);
  }
}

const isMainModule =
  process.argv[1] && process.argv[1].includes('jockeySync');
if (isMainModule) {
  main().catch((err) => {
    console.error('오류:', err);
    process.exit(1);
  });
}
