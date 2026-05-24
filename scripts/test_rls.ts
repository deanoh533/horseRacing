import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const url = process.env.SUPABASE_URL!;
  const anon = createClient(url, process.env.SUPABASE_ANON_KEY!);
  const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  
  for (const table of ['races', 'horse_results', 'horses', 'jockeys', 'trainers']) {
    const { count: anonCount } = await anon.from(table).select('*', { count: 'exact', head: true });
    const { count: srvCount } = await service.from(table).select('*', { count: 'exact', head: true });
    console.log(`${table.padEnd(15)} anon=${String(anonCount).padStart(5)}  service=${String(srvCount).padStart(5)}`);
  }
}
main();
