import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data, error } = await sb
    .from('weight_history')
    .select('id, period_start, period_end, race_count, applied_at, correlations, weights')
    .order('applied_at', { ascending: false });
  if (error) throw error;

  console.log(`weight_history rows: ${data?.length ?? 0}`);
  data?.forEach((row) => {
    console.log(`  id=${row.id} ${row.period_start}~${row.period_end} (${row.race_count} races) applied=${row.applied_at}`);
    console.log(`    correlations keys: ${Object.keys(row.correlations ?? {}).length}`);
    console.log(`    weights keys: ${Object.keys(row.weights ?? {}).length}`);
  });
}
main().catch(console.error);
