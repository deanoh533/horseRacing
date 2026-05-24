import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  // Service role key로 RLS 우회
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  const { data: races, error: e1 } = await sb.from('races').select('race_date, meet, rc_no').order('race_date', { ascending: false }).limit(20);
  if (e1) { console.error('races error:', e1); return; }
  const dates = Array.from(new Set((races ?? []).map(r => r.race_date)));
  console.log('[races] 행 수 (최근 20):', races?.length);
  console.log('[races] 유니크 날짜:', dates.length, '→', dates.join(', '));
  
  const { count: hrCount, error: e2 } = await sb.from('horse_results').select('*', { count: 'exact', head: true });
  if (e2) console.error('horse_results error:', e2);
  else console.log('[horse_results] 총 행 수:', hrCount);
  
  const { count: raceCount, error: e3 } = await sb.from('races').select('*', { count: 'exact', head: true });
  if (e3) console.error('races count error:', e3);
  else console.log('[races] 총 행 수:', raceCount);
}
main();
