/**
 * 단일 학습 테스트
 * - 전체 데이터로 Spearman 1번 계산
 * - 가중치 변화 + 예상 적중률 보여줌
 * - DB 변경 X (dry-run)
 *
 * 사용: npx tsx scripts/learn_weights_once.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  computeCorrelations,
  computeOptimalWeights,
  blendWeights,
  getCurrentWeights,
} from '../src/engine/weightLearner.js';
import { ITEM_NAMES, type ScoreItemId } from '../src/types/index.js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log('\n📊 전체 데이터로 Spearman 학습 (dry-run)\n');

  const current = await getCurrentWeights(sb);
  const { correlations, raceCount } = await computeCorrelations(sb, 20240101, 20991231);
  const optimal = computeOptimalWeights(correlations);
  const blended = blendWeights(current, optimal);

  console.log(`학습 경주 수: ${raceCount}`);
  console.log('');
  console.log('항목                  ρ        현재     적정     수렴');
  console.log('-'.repeat(64));
  const ids = Object.keys(current) as ScoreItemId[];
  // 상관계수 내림차순
  ids.sort((a, b) => correlations[b] - correlations[a]);
  for (const id of ids) {
    const name = ITEM_NAMES[id].padEnd(15);
    const rho = correlations[id].toFixed(3).padStart(7);
    const cur = current[id].toFixed(2).padStart(7);
    const opt = optimal[id].toFixed(2).padStart(7);
    const ble = blended[id].toFixed(2).padStart(7);
    const arrow = blended[id] > current[id] ? ' ↑' : blended[id] < current[id] ? ' ↓' : ' =';
    console.log(`${name}     ${rho}  ${cur}  ${opt}  ${ble}${arrow}`);
  }

  const sumCur = Object.values(current).reduce((a, b) => a + b, 0);
  const sumOpt = Object.values(optimal).reduce((a, b) => a + b, 0);
  const sumBle = Object.values(blended).reduce((a, b) => a + b, 0);
  console.log('-'.repeat(64));
  console.log(`합계                            ${sumCur.toFixed(2)}   ${sumOpt.toFixed(2)}  ${sumBle.toFixed(2)}`);
}
main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
