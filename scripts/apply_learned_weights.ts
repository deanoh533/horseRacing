/**
 * 학습된 가중치를 DB에 실제 적용
 * 1. 전체 데이터로 Spearman 학습 → 적정 가중치 산출
 * 2. 점진 수렴 (현재 + 적정) / 2
 * 3. weight_history에 저장
 * 4. predictions의 total_score / predicted_rank 모두 재계산
 * 5. 적중률 재측정
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  computeCorrelations,
  computeOptimalWeights,
  blendWeights,
  getCurrentWeights,
  applyWeightsToPredictions,
  saveWeightHistory,
} from '../src/engine/weightLearner.js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log('\n📚 가중치 학습 + 적용');
  console.log('='.repeat(50));

  // 1. 학습
  console.log('[1/4] 전체 데이터 Spearman 계산...');
  const current = await getCurrentWeights(sb);
  const { correlations, raceCount } = await computeCorrelations(sb, 20240101, 20991231);
  const optimal = computeOptimalWeights(correlations);
  const blended = blendWeights(current, optimal);
  console.log(`  학습 경주: ${raceCount}`);

  // 2. weight_history 저장
  console.log('[2/4] weight_history 저장...');
  await saveWeightHistory(sb, 20240524, 20260528, raceCount, blended, correlations, optimal);

  // 3. predictions 재계산 (race-batch)
  console.log('[3/4] predictions 재계산 (race 단위 batch)...');
  const startedAt = Date.now();
  const { updated, races } = await applyWeightsToPredictions(
    sb,
    blended,
    undefined,
    undefined,
    (done, total) => {
      const pct = ((done / total) * 100).toFixed(0);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`  진행 ${done}/${total} (${pct}%, ${elapsed}s)`);
    }
  );
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`  ${updated} rows / ${races} races / ${elapsed}s`);

  // 4. 적중률 재측정 (간단)
  console.log('[4/4] 적중률 재측정...');
  const all: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('predictions')
      .select('race_date, meet, rc_no, predicted_rank, actual_ord, hr_name')
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
  let win = 0;
  let place = 0;
  let show = 0;
  let valid = 0;
  for (const horses of byRace.values()) {
    const pred1 = horses.find((h: any) => h.predicted_rank === 1);
    if (!pred1) continue;
    const hasActual = horses.some((h: any) => h.actual_ord !== null);
    if (!hasActual) continue;
    valid++;
    if (pred1.actual_ord === 1) win++;
    if (pred1.actual_ord !== null && pred1.actual_ord <= 2) place++;
    if (pred1.actual_ord !== null && pred1.actual_ord <= 3) show++;
  }
  const pct = (n: number) => ((n / valid) * 100).toFixed(1);
  console.log(`\n=== 새 가중치 적중률 (${valid} 경주) ===`);
  console.log(`  단승  : ${win}/${valid} = ${pct(win)}%   (이전 26.2%)`);
  console.log(`  연승  : ${place}/${valid} = ${pct(place)}%   (이전 44.3%)`);
  console.log(`  복승  : ${show}/${valid} = ${pct(show)}%   (이전 57.7%)`);
}
main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
