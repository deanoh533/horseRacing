/**
 * KRA Analyzer - 메인 진입점
 *
 * 동작 확인:
 * 1. 환경 변수 검증
 * 2. KRA API 호출
 * 3. Supabase 연결 + 11개 테이블 확인
 */
import { getEnv } from '@utils/env.js';
import { getKRAClient } from '@kra/client.js';
import { getSupabaseAdmin } from '@db/supabase.js';

async function main() {
  console.log('🐎 KRA Analyzer 시작');
  console.log('='.repeat(50));

  // ============================================
  // 1. 환경 변수 검증
  // ============================================
  console.log('\n[1] 환경 변수 검증');
  let env;
  try {
    env = getEnv();
    console.log('✅ KRA API:', env.KRA_API_KEY.slice(0, 10) + '...');
    console.log('✅ Supabase URL:', env.SUPABASE_URL);
    console.log('✅ Anthropic Key:', env.ANTHROPIC_API_KEY.slice(0, 15) + '...');
  } catch (err) {
    console.error('❌', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // ============================================
  // 2. KRA API 동작 확인
  // ============================================
  console.log('\n[2] KRA API 동작 확인');
  try {
    const client = getKRAClient();
    const results = await client.getRaceResults({
      meet: 3,
      rcDate: 20260517,
      numOfRows: 3,
    });
    console.log(`✅ KRA API 정상: ${results.length}개 데이터 수신`);
    if (results[0]) {
      console.log(
        `   샘플: ${results[0].hrName} (${results[0].ord}위, ${results[0].rcDist}m)`
      );
    }
  } catch (err) {
    console.error('❌ KRA API:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // ============================================
  // 3. Supabase 연결 + 테이블 확인
  // ============================================
  console.log('\n[3] Supabase 연결 + 11개 테이블 확인');
  try {
    const supabase = getSupabaseAdmin();

    const expectedTables = [
      'races',
      'race_entries',
      'horses',
      'jockeys',
      'trainers',
      'weight_history',
      'predictions',
      'race_insights',
      'horse_insights',
      'user_settings',
      'ai_usage',
      'sync_logs',
    ];

    let foundCount = 0;
    const missing: string[] = [];

    for (const table of expectedTables) {
      const { error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        missing.push(table);
      } else {
        foundCount++;
      }
    }

    console.log(`✅ Supabase 연결 성공`);
    console.log(`   테이블 ${foundCount}/${expectedTables.length}개 확인`);

    if (missing.length > 0) {
      console.warn(`⚠️ 누락 테이블:`, missing.join(', '));
      console.warn(`   SQL 마이그레이션 다시 실행 필요:`);
      console.warn(`   supabase/migrations/001_initial_schema.sql`);
    }

    // user_settings 기본값 확인
    const { data: settings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (settings) {
      console.log(`✅ 기본 사용자 설정 OK`);
      console.log(
        `   인사이트 4개:`,
        Array.isArray(settings.insight_indicators)
          ? settings.insight_indicators.join(', ')
          : settings.insight_indicators
      );
    } else {
      console.warn(`⚠️ user_settings 기본값 없음 (마이그레이션 재실행 필요)`);
    }
  } catch (err) {
    console.error('❌ Supabase:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // ============================================
  // 완료
  // ============================================
  console.log('\n' + '='.repeat(50));
  console.log('🎉 모든 초기 동작 확인 완료!');
  console.log('\n다음 단계:');
  console.log('  - 데이터 동기화 (npm run sync)');
  console.log('  - 또는 onboarding 백테스트 (npm run sync:full)');
  process.exit(0);
}

main().catch((err) => {
  console.error('💥 치명적 에러:', err);
  process.exit(1);
});
