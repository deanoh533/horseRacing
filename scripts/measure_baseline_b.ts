/**
 * Baseline B 측정
 * - PRD 기본 가중치 + stOrd 봉인
 * - 학습 없음
 *
 * 학습 효과 분리: C(학습 적용) - B(학습 X) = 진짜 학습 효과
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { applyWeightsToPredictions, type Weights } from '../src/engine/weightLearner.js';
import { ITEM_WEIGHTS, type ScoreItemId } from '../src/types/index.js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // PRD 기본값에서 stOrd만 0으로, 나머지는 100으로 재정규화
  const SEALED: ScoreItemId = '12_starting_position';
  const items = Object.keys(ITEM_WEIGHTS) as ScoreItemId[];
  const baseline = { ...ITEM_WEIGHTS } as Weights;
  baseline[SEALED] = 0;
  const sum = items.reduce((s, k) => s + baseline[k], 0);
  for (const k of items) {
    if (k === SEALED) continue;
    baseline[k] = Math.round((baseline[k] / sum) * 10000) / 100;
  }
  console.log('Baseline B weights (PRD + stOrd 봉인, 정규화):');
  for (const k of items) {
    console.log(`  ${k.padEnd(28)}  ${baseline[k].toFixed(2)}`);
  }
  console.log(`  합계: ${items.reduce((s, k) => s + baseline[k], 0).toFixed(2)}`);

  console.log('\n[1/2] predictions 재계산...');
  const t0 = Date.now();
  const { updated, races } = await applyWeightsToPredictions(
    sb,
    baseline,
    undefined,
    undefined,
    (done, total) => {
      if (done % 500 === 0) {
        console.log(`  진행 ${done}/${total} (${((done / total) * 100).toFixed(0)}%, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
    }
  );
  console.log(`  ${updated} rows / ${races} races / ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  console.log('\n[2/2] 적중률 측정...');
  const all: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('predictions')
      .select('race_date, meet, rc_no, predicted_rank, actual_ord')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  const byRace = new Map<string, any[]>();
  for (const r of all) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(r);
  }
  let win = 0, place = 0, show = 0, valid = 0;
  for (const horses of byRace.values()) {
    const pred1 = horses.find((h: any) => h.predicted_rank === 1);
    if (!pred1) continue;
    if (!horses.some((h: any) => h.actual_ord !== null)) continue;
    valid++;
    if (pred1.actual_ord === 1) win++;
    if (pred1.actual_ord !== null && pred1.actual_ord <= 2) place++;
    if (pred1.actual_ord !== null && pred1.actual_ord <= 3) show++;
  }
  const p = (n: number) => ((n / valid) * 100).toFixed(1);
  console.log('\n=== Baseline B (PRD + stOrd 봉인, 학습 X) ===');
  console.log(`  단승 : ${win}/${valid} = ${p(win)}%`);
  console.log(`  연승 : ${place}/${valid} = ${p(place)}%`);
  console.log(`  복승 : ${show}/${valid} = ${p(show)}%`);
  console.log('\n=== 비교표 ===');
  console.log('                  단승    연승    복승');
  console.log(`  A (cheating)    26.2%   44.3%   57.7%`);
  console.log(`  B (이번/학습X)  ${p(win)}%   ${p(place)}%   ${p(show)}%`);
  console.log(`  C (학습O)       23.9%   41.0%   52.6%`);
}
main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
