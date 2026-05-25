/**
 * 출주표 sync (API314 서울 / API316 부산경남)
 *
 * 운영 사용:
 *   - 매주 수~목요일: 다음 주말 (금/토/일) 경주 출주표 fetch
 *   - 각 경주마다 rcNo 1~12 시도 (없으면 skip)
 *
 * CLI:
 *   tsx src/sync/raceCardSync.ts --date 20260530
 *   tsx src/sync/raceCardSync.ts --date 20260530 --meet 1
 */
import { getKRAClient } from '@kra/client.js';
import { getSupabaseAdmin } from '@db/supabase.js';
import type { MeetCode } from '@app-types/index.js';

const MAX_RC_NO = 13; // KRA 보통 최대 12경주

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

      const rows = cards.map((c) => ({
        race_date: rcDate,
        meet,
        rc_no: rcNo,
        pthr_no: c.pthrNo,
        hr_name: c.hrnm,
        ag: c.ag ?? null,
        gndr: c.gndr ?? null,
        prds: c.prds ?? null,
        burd_wgt: c.burdWgt ?? null,
        ratg: c.ratg ?? null,
        jcky_nm: c.jckyNm ?? null,
        trar_nm: c.trarNm ?? null,
        owner_nm: c.ownerNm ?? null,
        erng_sump: c.erngSump ?? null,
        erng_loy: c.erngLoy ?? null,
        erng_lsm: c.erngLsm ?? null,
        sump_rcod_fplc: c.sumpRcodFplc ?? null,
        sump_rcod_splc: c.sumpRcodSplc ?? null,
        sump_rcod_tplc: c.sumpRcodTplc ?? null,
        sump_rcod_sum: c.sumpRcodSum ?? null,
        loy_rcod_fplc: c.loyRcodFplc ?? null,
        loy_rcod_splc: c.loyRcodSplc ?? null,
        loy_rcod_tplc: c.loyRcodTplc ?? null,
        loy_rcod_sum: c.loyRcodSum ?? null,
        asis_equip1: dashToNull(c.asisEquip1),
        asis_equip2: dashToNull(c.asisEquip2),
        asis_equip3: dashToNull(c.asisEquip3),
        asis_equip4: dashToNull(c.asisEquip4),
        asis_equip5: dashToNull(c.asisEquip5),
        latst_bledg1: dashToNull(c.latstBledg1),
        latst_bledg2: dashToNull(c.latstBledg2),
        latst_trea1_txt: dashToNull(c.latstTrea1Txt),
        latst_trea2_txt: dashToNull(c.latstTrea2Txt),
      }));

      const { error } = await sb.from('race_cards').upsert(rows, {
        onConflict: 'race_date,meet,rc_no,pthr_no',
      });
      if (error) {
        result.errors.push(`rcNo=${rcNo}: ${error.message}`);
        console.error(`    rc_no=${rcNo} ❌ ${error.message}`);
        continue;
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

function dashToNull(v: string | undefined | null): string | null {
  if (!v || v === '-') return null;
  return v;
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
