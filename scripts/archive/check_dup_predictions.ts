import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { count } = await sb.from('predictions').select('*', { count: 'exact', head: true });
  console.log('predictions 총 rows:', count);

  // race 단위 row 수 분포
  const all: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('predictions')
      .select('race_date, meet, rc_no, hr_name')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  console.log('fetched:', all.length);

  const byRace = new Map<string, number>();
  const dupHorses = new Map<string, number>();
  for (const r of all) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    byRace.set(k, (byRace.get(k) ?? 0) + 1);
    const hk = `${k}-${r.hr_name}`;
    dupHorses.set(hk, (dupHorses.get(hk) ?? 0) + 1);
  }

  console.log('unique races:', byRace.size);
  const counts = [...byRace.values()];
  counts.sort((a, b) => b - a);
  console.log('race당 row 수 상위 5:', counts.slice(0, 5));
  console.log('race당 row 수 하위 5:', counts.slice(-5));

  const dups = [...dupHorses.entries()].filter(([_, c]) => c > 1);
  console.log(`\n중복 (race, hr_name) 쌍: ${dups.length}건`);
  if (dups.length > 0) {
    console.log('샘플 5건:');
    dups.slice(0, 5).forEach(([k, c]) => console.log(`  ${k} : ${c}회`));
  }
}
main();
