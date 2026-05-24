import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  // 한 경주의 chul_no, st_ord, ord 비교
  const { data } = await sb
    .from('horse_results')
    .select('chul_no, st_ord, ord, hr_name')
    .eq('race_date', 20260523)
    .eq('meet', 1)
    .eq('rc_no', 1)
    .order('chul_no');
  console.log('=== 2026-05-23 서울 1R ===');
  console.log('chul_no | st_ord | ord | hr_name');
  console.log('-'.repeat(40));
  data?.forEach((r) =>
    console.log(`  ${String(r.chul_no).padStart(2)}   |   ${String(r.st_ord ?? '?').padStart(2)}   |  ${String(r.ord ?? '?').padStart(2)} | ${r.hr_name}`)
  );

  // st_ord == ord 인 행 비율 확인
  const { data: all } = await sb
    .from('horse_results')
    .select('st_ord, ord');
  const valid = (all ?? []).filter((r) => r.st_ord !== null && r.ord !== null);
  const same = valid.filter((r) => r.st_ord === r.ord).length;
  console.log(`\nst_ord == ord 비율: ${same}/${valid.length} = ${((same / valid.length) * 100).toFixed(1)}%`);
}
main();
