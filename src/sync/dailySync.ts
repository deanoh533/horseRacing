/**
 * 일일 동기화 - KRA API → Supabase
 *
 * 사용:
 *   npm run sync -- --date 20260517 --meet 3
 *   또는
 *   tsx src/sync/dailySync.ts --date 20260517
 */
import { getKRAClient } from '@kra/client.js';
import { getSupabaseAdmin } from '@db/supabase.js';
import {
  toRaceRow,
  toHorseResultRow,
  calculatePopularities,
  buildStOrdMap,
} from './transformer.js';
import type { MeetCode } from '@types/index.js';

interface SyncOptions {
  rcDate: number;
  meets?: MeetCode[];
}

interface SyncResult {
  meet: MeetCode;
  racesSynced: number;
  horsesSynced: number;
  errors: string[];
}

/**
 * 하루치 동기화
 */
export async function syncDay(options: SyncOptions): Promise<SyncResult[]> {
  const meets: MeetCode[] = options.meets ?? [1, 3];
  const results: SyncResult[] = [];

  console.log(`\n🔄 ${options.rcDate} 동기화 시작 (meets: ${meets.join(',')})`);

  for (const meet of meets) {
    const result = await syncMeet(meet, options.rcDate);
    results.push(result);
  }

  return results;
}

async function syncMeet(
  meet: MeetCode,
  rcDate: number
): Promise<SyncResult> {
  const result: SyncResult = {
    meet,
    racesSynced: 0,
    horsesSynced: 0,
    errors: [],
  };

  const kra = getKRAClient();
  const supabase = getSupabaseAdmin();

  try {
    // 1. KRA에서 해당 날짜 모든 경주 데이터 가져오기
    console.log(`\n  [meet=${meet}] KRA API 호출 중...`);
    const allHorses = await kra.getAllRaceResults({ meet, rcDate });
    console.log(`  [meet=${meet}] ${allHorses.length}건 수신`);

    if (allHorses.length === 0) {
      console.log(`  [meet=${meet}] 데이터 없음 (경마 없는 날)`);
      return result;
    }

    // 2. 경주별 그룹핑 (rc_no 기준)
    const racesByRcNo = new Map<number, typeof allHorses>();
    for (const horse of allHorses) {
      if (!racesByRcNo.has(horse.rcNo)) {
        racesByRcNo.set(horse.rcNo, []);
      }
      racesByRcNo.get(horse.rcNo)!.push(horse);
    }

    // 3. 각 경주마다: races + horse_results upsert
    for (const [rcNo, horses] of racesByRcNo) {
      try {
        // races 테이블 upsert
        const raceRow = toRaceRow(horses[0]!);
        const { error: raceError } = await supabase
          .from('races')
          .upsert(raceRow, { onConflict: 'race_date,meet,rc_no' });

        if (raceError) {
          throw new Error(`races upsert: ${raceError.message}`);
        }

        // racedetailresult로 stOrd 가져오기 (선택, 실패해도 계속)
        let stOrdMap = new Map<string, number>();
        try {
          const details = await kra.getRaceDetailResult({ meet, rcDate, rcNo });
          stOrdMap = buildStOrdMap(details);
        } catch (err) {
          console.warn(`    [meet=${meet}, rcNo=${rcNo}] stOrd 가져오기 실패 (계속)`);
        }

        // 인기도 계산
        const popMap = calculatePopularities(horses);

        // horse_results 행 변환 (stOrd + popularity 채움)
        const horseRows = horses.map((h) => {
          const row = toHorseResultRow(h);
          row.st_ord = stOrdMap.get(h.hrNo) ?? null;
          row.popularity = popMap.get(h.hrNo) ?? null;
          return row;
        });

        // horse_results upsert (batch)
        const { error: hrError } = await supabase
          .from('horse_results')
          .upsert(horseRows, {
            onConflict: 'race_date,meet,rc_no,hr_no',
          });

        if (hrError) {
          throw new Error(`horse_results upsert: ${hrError.message}`);
        }

        result.racesSynced++;
        result.horsesSynced += horseRows.length;
        console.log(
          `    [meet=${meet}, rcNo=${rcNo}] ✓ ${horseRows.length}두`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`rcNo=${rcNo}: ${msg}`);
        console.error(`    [meet=${meet}, rcNo=${rcNo}] ❌ ${msg}`);
      }
    }

    // 4. 동기화 로그 기록
    await supabase.from('sync_logs').insert({
      sync_type: 'manual',
      start_date: rcDate,
      end_date: rcDate,
      races_synced: result.racesSynced,
      horses_synced: result.horsesSynced,
      errors: result.errors.length > 0 ? result.errors : null,
      status:
        result.errors.length === 0
          ? 'success'
          : result.racesSynced > 0
            ? 'partial'
            : 'failed',
      completed_at: new Date().toISOString(),
    });

    console.log(
      `\n  [meet=${meet}] 완료: ${result.racesSynced} 경주 / ${result.horsesSynced} 두 / 에러 ${result.errors.length}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`전체 실패: ${msg}`);
    console.error(`  [meet=${meet}] ❌ 전체 실패: ${msg}`);
  }

  return result;
}

// ============================================
// CLI 실행
// ============================================
async function main() {
  // 인자 파싱: --date 20260517 [--meet 1,3]
  const args = process.argv.slice(2);
  let rcDate = 0;
  let meets: MeetCode[] = [1, 3];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      rcDate = parseInt(args[i + 1]!, 10);
      i++;
    } else if (args[i] === '--meet' && args[i + 1]) {
      meets = args[i + 1]!
        .split(',')
        .map((s) => parseInt(s, 10) as MeetCode)
        .filter((m) => m === 1 || m === 3);
      i++;
    }
  }

  if (!rcDate) {
    // 기본값: 어제
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    rcDate =
      yesterday.getFullYear() * 10000 +
      (yesterday.getMonth() + 1) * 100 +
      yesterday.getDate();
    console.log(`📅 날짜 인자 없음 → 어제(${rcDate})로 자동 설정`);
  }

  const results = await syncDay({ rcDate, meets });

  // 요약
  console.log('\n' + '='.repeat(50));
  console.log('📊 동기화 결과 요약');
  console.log('='.repeat(50));
  for (const r of results) {
    console.log(`  meet=${r.meet}: ${r.racesSynced} 경주 / ${r.horsesSynced} 두 / 에러 ${r.errors.length}`);
  }
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
