/**
 * 부경 구간별 개별 타임 backfill
 *
 * race_entries 중 meet=3(부경)이고 bu_s1f_time이 NULL인 행을
 * KRA API214_1에서 다시 수집해 채웁니다.
 *
 * 실행: npx tsx scripts/backfill_bu_split_times.ts
 */
import 'dotenv/config';
import { getKRAClient } from '../src/kra/client.js';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { toRaceEntryResultRow } from '../src/sync/transformer.js';

const kra = getKRAClient();
const supabase = getSupabaseAdmin();

async function main() {
  // 1. 부경 경기 날짜 목록 (bu_s1f_time NULL인 것)
  const { data: dates, error } = await supabase
    .from('race_entries')
    .select('race_date, meet')
    .eq('meet', 3)
    .is('bu_s1f_time', null)
    .not('ord', 'is', null)  // 결과 있는 것만
    .order('race_date', { ascending: false });

  if (error) throw error;
  if (!dates || dates.length === 0) {
    console.log('✅ backfill 대상 없음');
    return;
  }

  // 날짜 중복 제거
  const uniqueDates = [...new Set(dates.map(d => d.race_date))];
  console.log(`📅 대상 날짜 ${uniqueDates.length}개 (총 ${dates.length}행)`);

  let updated = 0;
  let errors = 0;

  for (const rcDate of uniqueDates) {
    try {
      const horses = await kra.getAllRaceResults({ meet: 3, rcDate });
      if (horses.length === 0) {
        console.log(`  ${rcDate}: 데이터 없음`);
        continue;
      }

      for (const horse of horses) {
        const row = toRaceEntryResultRow(horse);
        const { error: updErr } = await supabase
          .from('race_entries')
          .update({
            bu_s1f_time: row.bu_s1f_time,
            bu_1fg_time: row.bu_1fg_time,
            bu_2fg_time: row.bu_2fg_time,
            bu_3fg_time: row.bu_3fg_time,
            bu_4_2f_time: row.bu_4_2f_time,
            bu_6_4f_time: row.bu_6_4f_time,
            bu_8_6f_time: row.bu_8_6f_time,
            bu_10_8f_time: row.bu_10_8f_time,
          })
          .eq('race_date', rcDate)
          .eq('meet', 3)
          .eq('rc_no', horse.rcNo)
          .eq('hr_name', horse.hrName);

        if (updErr) {
          console.error(`  ❌ ${rcDate} rc${horse.rcNo} ${horse.hrName}: ${updErr.message}`);
          errors++;
        } else {
          updated++;
        }
      }

      console.log(`  ✓ ${rcDate}: ${horses.length}두 업데이트`);
    } catch (err) {
      console.error(`  ❌ ${rcDate}: ${(err as Error).message}`);
      errors++;
    }
  }

  console.log(`\n완료: ${updated}행 업데이트 / 에러 ${errors}건`);
}

main().catch(e => {
  console.error('💥', e.message);
  process.exit(1);
});
