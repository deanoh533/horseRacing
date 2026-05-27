/**
 * race_entries의 서울/코너 구간 컬럼을 backfill
 *
 * 동작:
 *   1. 지정 날짜 범위의 races를 가져옴
 *   2. 각 날짜+meet에 대해 KRA API214_1 호출
 *   3. 응답을 toRaceEntryResultRow로 변환
 *   4. race_entries에 서울/코너 컬럼만 UPDATE (다른 컬럼 건드리지 않음)
 *
 * 사용:
 *   npx tsx scripts/backfill_sectional.ts --start 20260520 --end 20260524
 */
import 'dotenv/config';
import { getKRAClient } from '@kra/client.js';
import { getSupabaseAdmin } from '@db/supabase.js';
import { toRaceEntryResultRow } from '../src/sync/transformer.js';
import type { MeetCode } from '@app-types/index.js';

async function main() {
  const args = process.argv.slice(2);
  let startDate = 0, endDate = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i + 1]) startDate = Number(args[i + 1]);
    if (args[i] === '--end' && args[i + 1]) endDate = Number(args[i + 1]);
  }
  // 인자 없으면 races 전체 범위
  const sb = getSupabaseAdmin();
  const kra = getKRAClient();

  // races 테이블 전체 페이지네이션 fetch (1000 row 제한 우회)
  const races: { race_date: number; meet: number }[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    let q = sb.from('races').select('race_date, meet');
    if (startDate) q = q.gte('race_date', startDate);
    if (endDate) q = q.lte('race_date', endDate);
    q = q.range(off, off + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    races.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`races 테이블 ${races.length}개 row fetch 완료`);

  const dateMeets = new Set<string>();
  races.forEach((r) => dateMeets.add(`${r.race_date}-${r.meet}`));
  const range = startDate && endDate ? `${startDate}~${endDate}` : '전체';
  console.log(`\n📅 ${range}: ${dateMeets.size} date×meet groups`);

  let totalUpdated = 0;
  let errors = 0;

  for (const key of [...dateMeets].sort()) {
    const [rcDateStr, meetStr] = key.split('-');
    const rcDate = Number(rcDateStr);
    const meet = Number(meetStr) as MeetCode;

    try {
      console.log(`\n  [${rcDate} meet=${meet}] KRA API214_1 fetch...`);
      const horses = await kra.getAllRaceResults({ meet, rcDate });
      if (horses.length === 0) {
        console.log(`    데이터 없음`);
        continue;
      }

      for (const horse of horses) {
        const row = toRaceEntryResultRow(horse);
        const { error: updErr } = await sb
          .from('race_entries')
          .update({
            ratg: row.ratg,
            // 부경 (이미 있을 수도 있지만 일관성 위해 UPSERT)
            bu_g1f_acc_time: row.bu_g1f_acc_time,
            bu_g2f_acc_time: row.bu_g2f_acc_time,
            bu_g3f_acc_time: row.bu_g3f_acc_time,
            bu_g4f_acc_time: row.bu_g4f_acc_time,
            bu_g6f_acc_time: row.bu_g6f_acc_time,
            bu_g8f_acc_time: row.bu_g8f_acc_time,
            bu_s1f_acc_time: row.bu_s1f_acc_time,
            bu_g1f_ord: row.bu_g1f_ord,
            bu_g2f_ord: row.bu_g2f_ord,
            bu_g3f_ord: row.bu_g3f_ord,
            bu_g4f_ord: row.bu_g4f_ord,
            bu_s1f_ord: row.bu_s1f_ord,
            // 서울 (핵심)
            se_g1f_acc_time: row.se_g1f_acc_time,
            se_g3f_acc_time: row.se_g3f_acc_time,
            se_s1f_acc_time: row.se_s1f_acc_time,
            se_1c_acc_time: row.se_1c_acc_time,
            se_2c_acc_time: row.se_2c_acc_time,
            se_3c_acc_time: row.se_3c_acc_time,
            se_4c_acc_time: row.se_4c_acc_time,
            sj_g1f_ord: row.sj_g1f_ord,
            sj_g3f_ord: row.sj_g3f_ord,
            sj_s1f_ord: row.sj_s1f_ord,
            sj_1c_ord: row.sj_1c_ord,
            sj_2c_ord: row.sj_2c_ord,
            sj_3c_ord: row.sj_3c_ord,
            sj_4c_ord: row.sj_4c_ord,
          })
          .eq('race_date', rcDate)
          .eq('meet', meet)
          .eq('rc_no', horse.rcNo)
          .eq('hr_name', horse.hrName);
        if (updErr) {
          errors++;
          console.warn(`    UPDATE 실패: ${horse.hrName} ${updErr.message}`);
        } else {
          totalUpdated++;
        }
      }
      console.log(`    ✓ ${horses.length}건 backfill`);

      // KRA rate limit 회피
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      errors++;
      console.error(`    ❌ ${(e as Error).message}`);
    }
  }

  console.log(`\n✅ 완료: ${totalUpdated} rows updated / ${errors} errors`);
}

main().catch((err) => {
  console.error('💥', err.message ?? err);
  process.exit(1);
});
