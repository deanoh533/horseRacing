/**
 * 수득상금 구간별 단승 적중률 (수동 검증)
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // race_cards 전체
  const cards: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('race_cards')
      .select('race_date, meet, rc_no, hr_name, erng_sump')
      .order('race_date').order('meet').order('rc_no').order('hr_name')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    cards.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`race_cards: ${cards.length}`);

  // 예측 1위 + actual_ord
  const preds: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('predictions')
      .select('race_date, meet, rc_no, hr_name, actual_ord')
      .eq('predicted_rank', 1)
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    preds.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`predictions(top1): ${preds.length}`);

  const key = (r: any) => `${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`;
  const cardMap = new Map(cards.map((c) => [key(c), c]));

  const buckets = [
    { label: '미입상 (0)', min: 0, max: 1, count: 0, hits: 0 },
    { label: '입문 (1~100만)', min: 1, max: 1_000_000, count: 0, hits: 0 },
    { label: '중수 (100~1000만)', min: 1_000_000, max: 10_000_000, count: 0, hits: 0 },
    { label: '상수 (1000만~1억)', min: 10_000_000, max: 100_000_000, count: 0, hits: 0 },
    { label: '최상위 (1억+)', min: 100_000_000, max: Infinity, count: 0, hits: 0 },
  ];

  let matched = 0;
  for (const p of preds) {
    if (p.actual_ord === null) continue;
    const c = cardMap.get(key(p));
    if (!c || c.erng_sump === null) continue;
    matched++;
    const e = c.erng_sump;
    const b = buckets.find((x) => e >= x.min && e < x.max);
    if (b) {
      b.count++;
      if (p.actual_ord === 1) b.hits++;
    }
  }

  console.log(`\nmatched: ${matched}/${preds.length}`);
  console.log('\n수득상금 구간별 단승 적중률:');
  console.log('구간                  | 카운트 | 적중 | 적중률');
  console.log('-'.repeat(60));
  buckets.forEach((b) => {
    const rate = b.count > 0 ? ((b.hits / b.count) * 100).toFixed(1) : '-';
    console.log(`  ${b.label.padEnd(22)} | ${String(b.count).padStart(5)} | ${String(b.hits).padStart(4)} | ${String(rate).padStart(5)}%`);
  });
}
main();
