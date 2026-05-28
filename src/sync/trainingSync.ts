/**
 * 일별 훈련 정보 sync (API18_1/dailyTraining_1)
 *
 * API 검증됨: probe 결과 정상 응답 확인 (2026-05-20)
 * 응답 필드: chulGubun, hrName, hrNo, meet, part, partNo, prGubun, prNo,
 *            run1Cnt, run2Cnt, spTime, stTime, trDate, trName, trTerm
 *
 * CLI:
 *   npx tsx src/sync/trainingSync.ts --date 20260520
 *   npx tsx src/sync/trainingSync.ts --date 20260520 --meet 1
 *   npx tsx src/sync/trainingSync.ts --date 20260520 --hr_no 0050860
 */
import { getKRAClient } from '@kra/client.js';
import { getSupabaseAdmin } from '@db/supabase.js';
import { toTrainingRow } from './transformer.js';
import type { MeetCode } from '@app-types/index.js';

export interface TrainingSyncResult {
  meet: MeetCode;
  trDate: number;
  rowsSynced: number;
  errors: string[];
}

export async function syncTraining(options: {
  trDate: number;
  meets?: MeetCode[];
  hrNo?: string;
}): Promise<TrainingSyncResult[]> {
  const meets: MeetCode[] = options.meets ?? [1, 3];
  const results: TrainingSyncResult[] = [];

  console.log(`\n훈련 sync: ${options.trDate} (meets: ${meets.join(',')})`);

  for (const meet of meets) {
    const r = await syncOneMeet(meet, options.trDate, options.hrNo);
    results.push(r);
  }

  return results;
}

async function syncOneMeet(
  meet: MeetCode,
  trDate: number,
  hrNo?: string
): Promise<TrainingSyncResult> {
  const result: TrainingSyncResult = {
    meet,
    trDate,
    rowsSynced: 0,
    errors: [],
  };

  const kra = getKRAClient();
  const sb = getSupabaseAdmin();

  try {
    console.log(
      `  [meet=${meet}] 훈련 기록 fetch (hrNo=${hrNo ?? '전체'})...`
    );
    const records = await kra.getAllTrainingHistory({ meet, trDate, hrNo });
    if (records.length === 0) {
      console.log(`  [meet=${meet}] 데이터 없음`);
      return result;
    }

    const rows = records.map(toTrainingRow);

    const { error } = await sb.from('training_logs').upsert(rows, {
      onConflict: 'train_date,meet,hr_no,part',
    });
    if (error) {
      result.errors.push(error.message);
      console.error(`  [meet=${meet}] training_logs 오류: ${error.message}`);
    } else {
      result.rowsSynced = rows.length;
      console.log(`  [meet=${meet}] ${rows.length}건 upsert 완료`);
    }
  } catch (e) {
    const msg = (e as Error).message;
    result.errors.push(msg.slice(0, 100));
    console.error(`  [meet=${meet}] 오류:`, msg);
  }

  return result;
}

// ============================================
// 날짜 유틸
// ============================================
function rcDateToDate(d: number): Date {
  return new Date(Math.floor(d / 10000), Math.floor((d % 10000) / 100) - 1, d % 100);
}

function dateToRcDate(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function dateRange(from: number, to: number): number[] {
  const dates: number[] = [];
  let cur = rcDateToDate(from);
  const end = rcDateToDate(to);
  while (cur <= end) {
    dates.push(dateToRcDate(cur));
    cur = addDays(cur, 1);
  }
  return dates;
}

// ============================================
// CLI
// ============================================
async function main() {
  const args = process.argv.slice(2);
  let trDate = 0;
  let fromDate = 0;
  let toDate = 0;
  let meets: MeetCode[] = [1, 3];
  let hrNo: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      trDate = parseInt(args[i + 1]!, 10);
    } else if (args[i] === '--from' && args[i + 1]) {
      fromDate = parseInt(args[i + 1]!, 10);
    } else if (args[i] === '--to' && args[i + 1]) {
      toDate = parseInt(args[i + 1]!, 10);
    } else if (args[i] === '--meet' && args[i + 1]) {
      meets = args[i + 1]!
        .split(',')
        .map((s) => parseInt(s, 10) as MeetCode)
        .filter((m) => m === 1 || m === 3);
    } else if (args[i] === '--hr_no' && args[i + 1]) {
      hrNo = args[i + 1]!;
    }
  }

  if (!trDate && !fromDate) {
    console.error(
      'Usage:\n' +
      '  tsx src/sync/trainingSync.ts --date YYYYMMDD [--meet 1,3] [--hr_no <번호>]\n' +
      '  tsx src/sync/trainingSync.ts --from YYYYMMDD --to YYYYMMDD [--meet 1,3]'
    );
    process.exit(1);
  }

  // 단일 날짜
  if (trDate) {
    const results = await syncTraining({ trDate, meets, hrNo });
    console.log('\n' + '='.repeat(50));
    for (const r of results) {
      console.log(`  meet=${r.meet}: ${r.rowsSynced} rows / ${r.errors.length} errors`);
      for (const err of r.errors) console.log(`    - ${err}`);
    }
    return;
  }

  // 날짜 범위
  if (!toDate) toDate = fromDate;
  const dates = dateRange(fromDate, toDate);
  console.log(`\n범위 sync: ${fromDate} ~ ${toDate} (${dates.length}일)`);

  let totalRows = 0;
  let totalErrors = 0;
  for (const d of dates) {
    const results = await syncTraining({ trDate: d, meets, hrNo });
    for (const r of results) {
      totalRows += r.rowsSynced;
      totalErrors += r.errors.length;
    }
  }
  console.log('\n' + '='.repeat(50));
  console.log(`  완료: ${dates.length}일 / ${totalRows} rows / 에러 ${totalErrors}건`);
}

const isMainModule =
  process.argv[1] && process.argv[1].includes('trainingSync');
if (isMainModule) {
  main().catch((err) => {
    console.error('오류:', err);
    process.exit(1);
  });
}
