import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data } = await sb
    .from('horse_results')
    .select('race_date, meet, rc_no, ord, rc_dist')
    .eq('hr_name', '엔딩파이어')
    .lt('race_date', 20260523)
    .order('race_date', { ascending: false })
    .limit(10);
  console.log('엔딩파이어 과거 이력:', data?.length, '건');
  console.log(data);

  const { data: allHorses } = await sb.from('horse_results').select('hr_name');
  const counts: Record<string, number> = {};
  (allHorses ?? []).forEach((r) => {
    counts[r.hr_name] = (counts[r.hr_name] ?? 0) + 1;
  });
  const totalUnique = Object.keys(counts).length;
  const multi = Object.values(counts).filter((c) => c > 1).length;
  console.log(`\n전체 unique 말: ${totalUnique}마, 2번 이상 출전: ${multi}마`);
}
main();
