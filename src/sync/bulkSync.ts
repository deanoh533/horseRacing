/**
 * Bulk Sync - 날짜 범위 일괄 동기화
 *
 * 사용:
 *   tsx src/sync/bulkSync.ts --from 20260423 --to 20260522
 *   tsx src/sync/bulkSync.ts --days 30
 */
import { syncDay } from './dailySync.js';
import { getSupabaseAdmin } from '@db/supabase.js';
import type { MeetCode } from '@app-types/index.js';

interface BulkSyncOptions {
  fromDate: number;
  toDate: number;
  meets?: MeetCode[];
}

/**
 * 날짜 범위로 일괄 동기화
 */
async function bulkSync(options: BulkSyncOptions) {
  const dates = generateDateRange(options.fromDate, options.toDate);
  const meets = options.meets ?? [1, 3];

  console.log('='.repeat(60));
  console.log(`📅 Bulk Sync: ${options.fromDate} ~ ${options.toDate}`);
  console.log(`📊 총 ${dates.length}일 / ${meets.length}개 경마장`);
  console.log('='.repeat(60));

  let totalRaces = 0;
  let totalHorses = 0;
  let totalErrors = 0;
  const startTime = Date.now();

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]!;
    const progress = `[${i + 1}/${dates.length}]`;
    console.log(`\n${progress} 📅 ${date}`);

    try {
      const results = await syncDay({ rcDate: date, meets });
      for (const r of results) {
        totalRaces += r.racesSynced;
        totalHorses += r.horsesSynced;
        totalErrors += r.errors.length;
      }
    } catch (err) {
      console.error(
        `${progress} ❌ ${date} 전체 실패:`,
        err instanceof Error ? err.message : err
      );
      totalErrors++;
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(0);

  // 최종 요약
  console.log('\n' + '='.repeat(60));
  console.log('📊 Bulk Sync 완료 요약');
  console.log('='.repeat(60));
  console.log(`  기간: ${options.fromDate} ~ ${options.toDate} (${dates.length}일)`);
  console.log(`  경주: ${totalRaces}건 동기화`);
  console.log(`  말:   ${totalHorses}건 동기화`);
  console.log(`  에러: ${totalErrors}건`);
  console.log(`  소요: ${duration}초`);

  // sync_logs 종합 기록
  const supabase = getSupabaseAdmin();
  await supabase.from('sync_logs').insert({
    sync_type: 'manual',
    start_date: options.fromDate,
    end_date: options.toDate,
    races_synced: totalRaces,
    horses_synced: totalHorses,
    errors: totalErrors > 0 ? [`${totalErrors}개 에러 발생`] : null,
    status:
      totalErrors === 0
        ? 'success'
        : totalRaces > 0
          ? 'partial'
          : 'failed',
    completed_at: new Date().toISOString(),
  });
}

/**
 * 날짜 범위 → 날짜 배열 (YYYYMMDD 형식)
 */
function generateDateRange(fromDate: number, toDate: number): number[] {
  const dates: number[] = [];

  const from = parseDate(fromDate);
  const to = parseDate(toDate);

  const current = new Date(from);
  while (current <= to) {
    dates.push(toRcDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function parseDate(rcDate: number): Date {
  const y = Math.floor(rcDate / 10000);
  const m = Math.floor((rcDate % 10000) / 100) - 1;
  const d = rcDate % 100;
  return new Date(y, m, d);
}

function toRcDate(d: Date): number {
  return (
    d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
  );
}

// ============================================
// CLI
// ============================================
async function main() {
  const args = process.argv.slice(2);
  let fromDate = 0;
  let toDate = 0;
  let days = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      fromDate = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--to' && args[i + 1]) {
      toDate = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--days' && args[i + 1]) {
      days = parseInt(args[i + 1]!, 10);
      i++;
    }
  }

  // --days 30 → 최근 30일 (오늘 제외)
  if (days > 0) {
    const today = new Date();
    today.setDate(today.getDate() - 1); // 어제
    toDate = toRcDate(today);

    const from = new Date(today);
    from.setDate(from.getDate() - (days - 1));
    fromDate = toRcDate(from);
  }

  if (!fromDate || !toDate) {
    console.error('Usage: tsx src/sync/bulkSync.ts --from YYYYMMDD --to YYYYMMDD');
    console.error('   or: tsx src/sync/bulkSync.ts --days 30');
    process.exit(1);
  }

  await bulkSync({ fromDate, toDate });
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
