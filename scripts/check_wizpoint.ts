import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await sb
    .from('horse_results')
    .select('chul_no, hr_name, rating, wg_hr, wg_hr_diff, wg_jk, wg_budam, jk_name, tr_name, ord')
    .eq('race_date', 20260523)
    .eq('meet', 1)
    .eq('rc_no', 1)
    .order('chul_no');
  console.log('=== 5/23 서울 1R ===');
  data?.forEach((r) => {
    console.log(
      `  ${r.chul_no}번 ${r.hr_name.padEnd(8)} | rating=${String(r.rating).padStart(4)} | 마체중=${r.wg_hr ?? '?'}(${r.wg_hr_diff ?? '?'}) | 기수체중=${r.wg_jk ?? '?'} | 부담=${r.wg_budam ?? '?'} | 기수=${r.jk_name ?? '?'}`
    );
  });

  // anon 키로도 같은 데이터 오는지
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const { data: anonData } = await anon
    .from('horse_results')
    .select('chul_no, hr_name, rating, wg_hr, wg_jk')
    .eq('race_date', 20260523).eq('meet', 1).eq('rc_no', 1)
    .order('chul_no');
  console.log('\n=== anon 키 응답 ===');
  console.log('첫 3개 row:', anonData?.slice(0, 3));
}
main();
