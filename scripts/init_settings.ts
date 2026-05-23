import { getSupabaseAdmin } from '@db/supabase.js';

const supabase = getSupabaseAdmin();
const { data, error } = await supabase
  .from('user_settings')
  .upsert({
    id: 1,
    insight_indicators: [
      '03_recent_form',
      '06_distance_fitness',
      '09_jockey_form',
      '16_jockey_horse_chemistry',
    ],
    ai_enabled: true,
    ai_monthly_limit: 5.00,
    ai_daily_limit: 0.20,
    theme: 'dark',
    language: 'ko',
  })
  .select();

if (error) {
  console.error('❌', error);
  process.exit(1);
}
console.log('✅ user_settings 기본값 입력 완료');
console.log(data);
