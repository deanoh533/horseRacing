import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // 5월 23일 서울 2경주 전체
  const { data } = await sb
    .from('horse_results')
    .select('chul_no, hr_name, ord, rank_str, rc_time')
    .eq('race_date', 20260523)
    .eq('meet', 1)
    .eq('rc_no', 2)
    .order('chul_no');
  console.log('=== 2026-05-23 서울 2R 전체 ===');
  console.log(data);

  // 비정상 ord(>20)
  const { data: weird } = await sb
    .from('horse_results')
    .select('race_date, meet, rc_no, chul_no, hr_name, ord, rank_str, rc_time')
    .gt('ord', 20)
    .limit(20);
  console.log('\n=== ord > 20 (비정상) ===');
  console.log(weird);
}
main().catch(console.error);
