import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { count } = await sb.from('race_cards').select('*', { count: 'exact', head: true });
  console.log(`race_cards total: ${count}`);

  // 한 경주 샘플 (5/24 서울 1R)
  const { data } = await sb
    .from('race_cards')
    .select('*')
    .eq('race_date', 20260524)
    .eq('meet', 1)
    .eq('rc_no', 1)
    .order('pthr_no');

  console.log('\n=== 5/24 서울 1R 출주표 (전체 필드) ===');
  console.log(JSON.stringify(data?.[0], null, 2));

  console.log('\n=== 요약 (수득상금/건강) ===');
  data?.forEach((r) => {
    const treat = [r.latst_trea1_txt, r.latst_trea2_txt].filter(Boolean).join(' / ') || '-';
    const equips = [r.asis_equip1, r.asis_equip2, r.asis_equip3, r.asis_equip4, r.asis_equip5]
      .filter(Boolean).length;
    console.log(
      `  ${r.pthr_no}번 ${r.hr_name.padEnd(8)} | 상금 ${(r.erng_sump / 10000).toFixed(0).padStart(7)}만 | 통산 ${r.sump_rcod_fplc}-${r.sump_rcod_splc}-${r.sump_rcod_tplc}/${r.sump_rcod_sum} | 마구 ${equips}개 | 진료 ${treat.slice(0, 30)}`
    );
  });
}
main().catch(console.error);
