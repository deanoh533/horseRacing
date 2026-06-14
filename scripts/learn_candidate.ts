/**
 * 후보 모델 버전 생성 (Stage B) — 전체 데이터 ρ 학습
 *
 * 누수 수정 후의 정직한 데이터로 ρ를 학습해 가중치 벡터를 만들고,
 * model_versions에 **비활성(is_active=false) 후보**로 저장한다. (라이브 영향 없음)
 *
 * 사용: npm run learn:candidate
 * 이후: npm run benchmark                          (검증)
 *       npm run promote -- --version <id>        (사람 판단 후 승격)
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { computeCorrelations, computeOptimalWeights, saveWeightHistory } from '../src/engine/weightLearner.js';
import { ITEM_NAMES } from '../src/types/index.js';

async function main() {
  const args = process.argv.slice(2);
  const untilIdx = args.indexOf('--until');
  const until = untilIdx >= 0 ? Number(args[untilIdx + 1]) : 20991231; // 기본 = 전체

  const sb = getSupabaseAdmin();
  console.log(`📚 후보 가중치 학습 (Spearman ρ, 2024-01-01 ~ ${until})...`);
  const { correlations, raceCount } = await computeCorrelations(sb, 20240101, until);
  const weights = computeOptimalWeights(correlations);

  // 다음 라벨 (v1, v2, ... 중 최대+1)
  const { data: existing } = await sb.from('model_versions').select('label');
  const maxN = Math.max(
    0,
    ...((existing ?? []) as { label: string }[]).map(
      (r) => parseInt(String(r.label).replace(/^v/, ''), 10) || 0
    )
  );
  const label = `v${maxN + 1}`;

  const { data: inserted, error } = await sb
    .from('model_versions')
    .insert({
      label,
      weights,
      source: 'learned',
      is_active: false,
      notes: `ρ 학습 (2024-01-01~${until}, ${raceCount}경주). 누수 수정 후 정직한 데이터.`,
    })
    .select('id')
    .single();
  if (error) throw error;

  // ρ·학습 기록을 weight_history에도 저장 → 버전비교 화면의 ρ가 정직한 최신값으로 갱신
  const today = new Date();
  const todayNum = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  await saveWeightHistory(sb, 20240101, Math.min(until, todayNum), raceCount, weights, correlations, weights);

  const names = ITEM_NAMES as Record<string, string>;
  console.log(`\n✅ 후보 저장: ${label} (id=${inserted.id}, is_active=false)`);
  console.log('상위 가중치:');
  Object.entries(weights)
    .filter(([, v]) => (v as number) > 0)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 8)
    .forEach(([id, v]) => console.log(`  ${names[id] ?? id}: ${(v as number).toFixed(2)}`));

  console.log(`\n검증: npm run benchmark`);
  console.log(`승격: npm run promote -- --version ${inserted.id}  (사람 판단 후)`);
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
