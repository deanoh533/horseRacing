import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { count } = await sb.from('horses').select('*', { count: 'exact', head: true });
  console.log('horses rows:', count);

  // 샘플 3개
  const { data } = await sb
    .from('horses')
    .select('hr_no, hr_name, sire_hr_nm, dam_hr_nm, foalg_dt, sex')
    .limit(3);
  console.log('샘플:', data);
}
main();
