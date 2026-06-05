/**
 * 출전표 sync (API26_2/entrySheet_2)
 *
 * 운영 사용:
 *   - 매주 수요일 오후 2시30분경 서울+부경 전체 출전표 동시 발표
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
import { predictRace } from '../engine/scorePredictor.js';
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

  // rcNo별 그룹핑 (보조 싱크에서도 사용)
  const byRcNo = new Map<number, Awaited<ReturnType<typeof kra.getAllEntrySheet>>>();

  try {
    const items = await kra.getAllEntrySheet({ meet, rcDate });
    if (items.length === 0) {
      console.log(`  [meet=${meet}] 데이터 없음`);
      return result;
    }

    for (const item of items) {
      if (!byRcNo.has(item.rcNo)) byRcNo.set(item.rcNo, []);
      byRcNo.get(item.rcNo)!.push(item);
    }

    for (const [rcNo, raceItems] of byRcNo) {
      try {
        // race_entries upsert
        const validItems = raceItems.filter((it) => {
          if (!it.hrName) {
            console.warn(`    rc_no=${rcNo} hrName 없는 항목 스킵 (chulNo=${it.chulNo})`);
            return false;
          }
          return true;
        });
        const entryRows = validItems.map(toRaceEntryRowFromEntrySheet);
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

        // 예측 점수 생성 (사전 모드: ord=null → actual_ord=null)
        try {
          const preds = await predictRace(sb, rcDate, meet, rcNo);
          if (preds.length > 0) {
            await sb.from('predictions')
              .delete()
              .eq('race_date', rcDate).eq('meet', meet).eq('rc_no', rcNo);
            const { error: predErr } = await sb.from('predictions').insert(preds);
            if (predErr) throw predErr;
          }
        } catch (e) {
          console.warn(`    rc_no=${rcNo} ⚠️ 예측 생성 실패 (계속): ${(e as Error).message}`);
        }

        result.racesSynced++;
        result.horsesSynced += validItems.length;
        console.log(`    rc_no=${rcNo} ✓ ${raceItems.length}마 + 예측`);
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

  // 보조 싱크: API314/316에서 asisEquip·latstBledg·latstTrea만 추가 수집
  if (byRcNo.size > 0) {
    await syncEquipAndMedical(kra, sb, meet, rcDate, [...byRcNo.keys()], result.errors);
  }

  console.log(
    `  [meet=${meet}] 완료: ${result.racesSynced} 경주 / ${result.horsesSynced} 마 / 에러 ${result.errors.length}`
  );
  return result;
}

/**
 * API314(서울)/API316(부경): asisEquip·latstBledg·latstTrea 보조 수집
 * API26_2에 없는 3개 필드 그룹만 race_entries에 UPDATE
 */
async function syncEquipAndMedical(
  kra: ReturnType<typeof getKRAClient>,
  sb: ReturnType<typeof getSupabaseAdmin>,
  meet: MeetCode,
  rcDate: number,
  rcNos: number[],
  errors: string[]
): Promise<void> {
  console.log(`  [meet=${meet}] 보조싱크(장구·진료): rc_no ${rcNos.join(',')}...`);
  const nullIfDash = (v: string): string | null => (!v || v === '-' ? null : v);

  for (const rcNo of rcNos) {
    try {
      const cards = await kra.getRaceCard({ meet, rcDate, rcNo });
      for (const c of cards) {
        await sb
          .from('race_entries')
          .update({
            asis_equip1: nullIfDash(c.asisEquip1),
            asis_equip2: nullIfDash(c.asisEquip2),
            asis_equip3: nullIfDash(c.asisEquip3),
            asis_equip4: nullIfDash(c.asisEquip4),
            asis_equip5: nullIfDash(c.asisEquip5),
            latst_bledg1: nullIfDash(c.latstBledg1),
            latst_bledg2: nullIfDash(c.latstBledg2),
            latst_trea1_txt: nullIfDash(c.latstTrea1Txt),
            latst_trea2_txt: nullIfDash(c.latstTrea2Txt),
          })
          .eq('race_date', rcDate)
          .eq('meet', meet)
          .eq('rc_no', rcNo)
          .eq('pthr_no', c.pthrNo);
      }
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`equip rcNo=${rcNo}: ${msg.slice(0, 80)}`);
      console.warn(`    보조싱크 rc_no=${rcNo} ⚠️ ${msg}`);
    }
  }
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
