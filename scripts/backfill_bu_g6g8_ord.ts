/**
 * 부경 G6F·G8F 순위 backfill
 *
 * race_entries 중 meet=3(부경)이고 bu_g6f_ord가 NULL인 행 중
 * 거리가 1600m 이상인 경주만 대상으로 재수집합니다.
 * (1200~1400m 단거리는 G6F 구간 자체가 없으므로 제외)
 *
 * 실행: npx tsx scripts/backfill_bu_g6g8_ord.ts
 */
import 'dotenv/config';
import { getKRAClient } from '../src/kra/client.js';
import { getSupabaseAdmin } from '../src/db/supabase.js';

const kra = getKRAClient();
const supabase = getSupabaseAdmin();

async function main() {
  // 부경 1600m+ 경주 날짜 목록 (bu_g6f_ord NULL인 것)
  const { data: dates, error } = await supabase
    .from('race_entries')
    .select('race_date')
    .eq('meet', 3)
    .is('bu_g6f_ord', null)
    .not('ord', 'is', null)
    .gte('rc_dist', 1600)
    .order('race_date', { ascending: false });

  if (error) throw error;
  if (!dates || dates.length === 0) {
    console.log('✅ backfill 대상 없음');
    return;
  }

  const uniqueDates = [...new Set(dates.map(d => d.race_date))];
  console.log(`📅 대상 날짜 ${uniqueDates.length}개`);

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
        const g6fOrd = horse.buG6fOrd && horse.buG6fOrd > 0 ? horse.buG6fOrd : null;
        const g8fOrd = horse.buG8fOrd && horse.buG8fOrd > 0 ? horse.buG8fOrd : null;

        if (g6fOrd === null && g8fOrd === null) continue;

        const { error: updErr } = await supabase
          .from('race_entries')
          .update({ bu_g6f_ord: g6fOrd, bu_g8f_ord: g8fOrd })
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

      console.log(`  ✓ ${rcDate}: 처리 완료`);
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
