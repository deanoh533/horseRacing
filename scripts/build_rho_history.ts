/**
 * 정직한 ρ 이력 재구축 (Stage C Phase 2a)
 *
 * weight_history를 **분기 컷오프별 ρ 타임라인**으로 다시 채운다.
 * 각 행 = "2024-01-01 ~ 그 분기말" 데이터로 계산한 항목별 ρ + 거기서 환산한 가중치.
 *
 * 배경: weight_history에 누수 수정 *전*(거짓) ρ가 남아 화면 ρ가 거짓이었음.
 *       또 "history"여야 하는데 단일 값뿐이었음.
 * 효과: 최신 행 = 현재 정직 ρ → /versions·통계 화면 ρ가 새로고침만으로 정직해짐(재배포 불요).
 *
 * 사용: npm run build:rho-history
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import {
  computeCorrelations,
  computeOptimalWeights,
  saveWeightHistory,
} from '../src/engine/weightLearner.js';
import { ITEM_NAMES } from '../src/types/index.js';

/** 2024-Q4 ~ 현재 분기까지의 분기 말일(YYYYMMDD) */
function quarterEnds(): number[] {
  const ends: number[] = [];
  const today = new Date();
  const curY = today.getFullYear();
  const curQ = Math.floor(today.getMonth() / 3) + 1;
  let y = 2024;
  let q = 4; // 데이터 시작이 2024 → 첫 컷오프 = 2024-Q4말
  const lastDayOf = (endMonth: number) => (endMonth === 6 || endMonth === 9 ? 30 : 31);
  while (y < curY || (y === curY && q <= curQ)) {
    const endMonth = q * 3;
    ends.push(y * 10000 + endMonth * 100 + lastDayOf(endMonth));
    q++;
    if (q > 4) {
      q = 1;
      y++;
    }
  }
  return ends;
}

async function main() {
  const sb = getSupabaseAdmin();
  const cutoffs = quarterEnds();
  console.log(`📈 정직한 ρ 이력 재구축 — 컷오프 ${cutoffs.length}개`);
  console.log(`   ${cutoffs.join(', ')}`);

  // 기존(누수 전) weight_history 정리 후 재구축
  const { error: delErr } = await sb.from('weight_history').delete().gte('id', 0);
  if (delErr) throw delErr;
  console.log('기존 weight_history 정리 완료.\n');

  const names = ITEM_NAMES as Record<string, string>;
  let prevCount = -1;
  let inserted = 0;
  for (const cutoff of cutoffs) {
    const { correlations, raceCount } = await computeCorrelations(sb, 20240101, cutoff);
    if (raceCount === 0 || raceCount === prevCount) {
      console.log(`  ${cutoff}: n=${raceCount} (데이터 없음/증가 없음) — 건너뜀`);
      continue;
    }
    prevCount = raceCount;
    const optimal = computeOptimalWeights(correlations);
    await saveWeightHistory(sb, 20240101, cutoff, raceCount, optimal, correlations, optimal);
    inserted++;

    const top = Object.entries(correlations)
      .filter(([, v]) => (v as number) > 0)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 3)
      .map(([id, v]) => `${names[id] ?? id} ${(v as number).toFixed(3)}`)
      .join(', ');
    console.log(`  ${cutoff}: n=${raceCount} | top ρ: ${top}`);
  }

  console.log(`\n✅ 완료 — weight_history에 ${inserted}개 분기 행 기록.`);
  console.log('   /versions·통계 새로고침하면 ρ가 정직값으로 표시됩니다.');
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
