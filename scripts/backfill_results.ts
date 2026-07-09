/**
 * 과거 경주 결과 백필 — KRA 결과 API → Supabase (races + race_entries)
 *
 * 학습구간 확장용 (2026-07-09, t3 재실험·이력 깊이 회복 목적).
 * - 날짜 범위의 모든 달력일을 순회 (경마 없는 날은 API가 0건 반환 → 자동 skip)
 * - 이미 결과가 있는 날짜는 건너뜀 (idempotent re-run — rate limit 후 재실행 안전)
 * - predictions 생성은 생략 (skipPredictions — 과거 경주 예측은 backfill_predictions 별도 경로)
 * - KRA rate limit 도달 시 중단 + 진행 보고 (backfill_race_cards 패턴)
 *
 * 사용 (KRA 쿼터 소비 — 사용자 직접 실행):
 *   npm run backfill:results -- --from 20220101 --to 20240523
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { syncDay } from '../src/sync/dailySync.js';

function nextDay(yyyymmdd: number): number {
  const y = Math.floor(yyyymmdd / 10000);
  const m = Math.floor((yyyymmdd % 10000) / 100) - 1;
  const d = yyyymmdd % 100;
  const dt = new Date(Date.UTC(y, m, d + 1));
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

async function main() {
  const args = process.argv.slice(2);
  let fromDate = 0;
  let toDate = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) fromDate = Number(args[i + 1]);
    if (args[i] === '--to' && args[i + 1]) toDate = Number(args[i + 1]);
  }
  if (!fromDate || !toDate) {
    console.error('사용: npm run backfill:results -- --from YYYYMMDD --to YYYYMMDD');
    process.exit(1);
  }

  const sb = getSupabaseAdmin();

  console.log('[1/2] 이미 결과가 있는 날짜 수집...');
  const existing = new Set<number>();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from('races')
      .select('race_date')
      .gte('race_date', fromDate)
      .lte('race_date', toDate)
      .order('race_date')
      .range(off, off + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    data.forEach((r) => existing.add(r.race_date));
    if (data.length < 1000) break;
  }
  console.log(`  범위 내 기존 날짜: ${existing.size}`);

  console.log('[2/2] 날짜 순회 (경마 없는 날은 0건으로 자동 통과)...');
  const startedAt = Date.now();
  let totalRaces = 0;
  let totalHorses = 0;
  let raceDays = 0;
  let rateLimited = false;

  for (let date = fromDate; date <= toDate; date = nextDay(date)) {
    if (existing.has(date)) continue;
    try {
      const results = await syncDay({ rcDate: date, meets: [1, 3], skipPredictions: true });
      const races = results.reduce((s, r) => s + r.racesSynced, 0);
      const horses = results.reduce((s, r) => s + r.horsesSynced, 0);
      const errors = results.flatMap((r) => r.errors);
      if (races > 0) {
        raceDays++;
        totalRaces += races;
        totalHorses += horses;
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
        console.log(`  ${date}: ${races} races / ${horses} horses (누적 ${totalRaces}경주, ${elapsed}s)`);
      }
      if (errors.some((e) => e.includes('rate limit') || e.includes('429') || e.includes('LIMITED_NUMBER'))) {
        rateLimited = true;
        console.error(`\n❌ KRA rate limit (${date}) — 중단`);
        break;
      }
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('429') || msg.includes('LIMITED_NUMBER') || msg.includes('rate limit')) {
        rateLimited = true;
        console.error(`\n❌ KRA rate limit (${date}, 전체 throw) — 중단`);
        break;
      }
      console.error(`  ${date}: ERR ${msg.slice(0, 80)}`);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n✅ 종료: ${raceDays} 경마일 / ${totalRaces} races / ${totalHorses} horses / ${elapsed}s`);
  if (rateLimited) {
    console.log('⚠️ Rate limit으로 중단. 다음 날 같은 명령 재실행 (처리된 날짜는 skip).');
  } else {
    console.log('다음 단계: npm run db:pull (로컬 미러 갱신) → 벤치마크 재구성');
  }
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
