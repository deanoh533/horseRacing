/**
 * predictFromCards 동작 확인 (results 없는 race_date에 대해)
 *  - 우리 DB max date = 20260523. 그 다음 race_cards 있는 날짜 찾아 시도
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { predictRace } from '../src/engine/scorePredictor.js';

async function main() {
  const sb = getSupabaseAdmin();

  // race_cards에 있지만 horse_results에 없는 race_date 찾기
  const { data: maxResults } = await sb
    .from('horse_results')
    .select('race_date')
    .order('race_date', { ascending: false })
    .limit(1);
  const maxResultDate = maxResults?.[0]?.race_date ?? 0;
  console.log(`horse_results max date: ${maxResultDate}`);

  const { data: futureCards } = await sb
    .from('race_cards')
    .select('race_date, meet, rc_no')
    .gt('race_date', maxResultDate)
    .order('race_date')
    .order('meet')
    .order('rc_no')
    .limit(5);
  console.log(`\nfuture race_cards 후보:`);
  console.log(futureCards);

  if (!futureCards || futureCards.length === 0) {
    console.log('\n(미래 race_cards 없음 → 모든 cards가 이미 results와 함께 있음)');
    // 그래도 한 경주에 대해 강제 cards-only 모드 시도
    console.log('\n예시: 5/24 1R 1경주 (results 있지만 predictFromCards 강제 호출)');
    return;
  }

  const target = futureCards[0]!;
  console.log(`\n🎯 ${target.race_date} meet=${target.meet} rc=${target.rc_no} 예측 시도`);
  const predictions = await predictRace(sb, target.race_date, target.meet, target.rc_no);
  console.log(`\n예측 결과 ${predictions.length}건:`);
  predictions
    .sort((a, b) => a.predicted_rank - b.predicted_rank)
    .slice(0, 5)
    .forEach((p) => {
      console.log(`  ${p.predicted_rank}위  ${p.hr_name}  ${p.total_score}점  (actual: ${p.actual_ord})`);
    });
}
main().catch(console.error);
