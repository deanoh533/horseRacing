/**
 * 일일 동기화 - KRA API → Supabase
 *
 * 사용:
 *   npm run sync -- --date 20260517 --meet 3
 *   또는
 *   tsx src/sync/dailySync.ts --date 20260517
 *
 * 흐름:
 *   1. KRA 결과 API → races upsert (거리/주로/날씨 채움)
 *   2. KRA 결과 API → race_entries UPDATE (결과 컬럼: ord, rc_time 등)
 *      - race_entries가 없는 경우 (출주표 없이 결과만 있는 경우) INSERT
 *   3. predictions 보충 — 수요일 사전 예측(raceCardSync)을 보존하기 위해
 *      재계산(DELETE→INSERT)하지 않음. 해당 경주에 예측이 하나도 없을 때만
 *      forcePrecompetition 모드로 계산해 INSERT (v7 라이브 추적,
 *      docs/superpowers/plans/2026-07-11-v7-live-tracking.md Task 2)
 *   4. predictions.actual_ord만 UPDATE — 결과(ord) 도착 시 이 필드만 채움.
 *      total_score·predicted_rank·p_top3·p_win·item_scores 등 예측값 필드는
 *      절대 건드리지 않음 (결과 기록이지 예측 덮어쓰기가 아님).
 *      skipPredictions=true(대량 백필)일 때는 3·4단계 모두 건너뜀
 *      (docs/superpowers/specs/2026-07-11-v7-live-tracking-design.md §3.1,
 *       사용자 결정 2026-07-11)
 */
import { getKRAClient } from '@kra/client.js';
import { getSupabaseAdmin } from '@db/supabase.js';
import {
  toRaceRow,
  toRaceEntryResultRow,
  calculatePopularities,
} from './transformer.js';
import { predictRace } from '../engine/scorePredictor.js';
import type { ReadClient } from '../db/localDb.js';
import type { MeetCode } from '@app-types/index.js';

interface SyncOptions {
  rcDate: number;
  meets?: MeetCode[];
  /** 과거 백필용: predictions 생성 생략 (Supabase 대량 읽기 방지) */
  skipPredictions?: boolean;
}

interface SyncResult {
  meet: MeetCode;
  racesSynced: number;
  horsesSynced: number;
  errors: string[];
}

export async function syncDay(options: SyncOptions): Promise<SyncResult[]> {
  const meets: MeetCode[] = options.meets ?? [1, 3];
  const results: SyncResult[] = [];

  console.log(`\n🔄 ${options.rcDate} 동기화 시작 (meets: ${meets.join(',')})`);

  for (const meet of meets) {
    const result = await syncMeet(meet, options.rcDate, options.skipPredictions ?? false);
    results.push(result);
  }

  return results;
}

async function syncMeet(
  meet: MeetCode,
  rcDate: number,
  skipPredictions = false
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
    console.log(`\n  [meet=${meet}] KRA API 호출 중...`);
    const allHorses = await kra.getAllRaceResults({ meet, rcDate });
    console.log(`  [meet=${meet}] ${allHorses.length}건 수신`);

    if (allHorses.length === 0) {
      console.log(`  [meet=${meet}] 데이터 없음 (경마 없는 날)`);
      return result;
    }

    // 경주별 그룹핑
    const racesByRcNo = new Map<number, typeof allHorses>();
    for (const horse of allHorses) {
      if (!racesByRcNo.has(horse.rcNo)) racesByRcNo.set(horse.rcNo, []);
      racesByRcNo.get(horse.rcNo)!.push(horse);
    }

    for (const [rcNo, horses] of racesByRcNo) {
      try {
        // 1. races upsert (거리/주로/날씨 채움)
        const raceRow = toRaceRow(horses[0]!);
        const { error: raceError } = await supabase
          .from('races')
          .upsert(raceRow, { onConflict: 'race_date,meet,rc_no' });
        if (raceError) throw new Error(`races upsert: ${raceError.message}`);

        // 2. 인기도 계산
        const popMap = calculatePopularities(horses);

        // 결과 도착 시 predictions.actual_ord만 채우기 위해 말별 (hr_name, ord) 수집
        // (skipPredictions=true인 백필 경로에서는 사용하지 않음 — 아래 6단계 참고)
        const resultOrds: Array<{ hrName: string; ord: number | null }> = [];

        // 4. race_entries 결과 컬럼 UPDATE (hr_name 기준)
        for (const horse of horses) {
          if (!horse.hrName) {
            console.warn(`    [meet=${meet}, rcNo=${rcNo}] hrName 없는 항목 스킵 (chulNo=${horse.chulNo})`);
            continue;
          }
          const resultRow = toRaceEntryResultRow(horse);
          resultRow.popularity = popMap.get(horse.hrNo) ?? null;
          resultOrds.push({ hrName: horse.hrName, ord: resultRow.ord });

          // race_entries UPDATE 시도
          const { data: existing } = await supabase
            .from('race_entries')
            .select('pthr_no')
            .eq('race_date', rcDate)
            .eq('meet', meet)
            .eq('rc_no', rcNo)
            .eq('hr_name', horse.hrName)
            .maybeSingle();

          if (existing) {
            // 출주표 있음 → 결과 컬럼만 UPDATE (rc_dist/track_type 포함)
            const { error: updErr } = await supabase
              .from('race_entries')
              .update({
                rc_dist: raceRow.rc_dist ?? null,
                track_type: raceRow.track_type ?? null,
                hr_no: resultRow.hr_no,
                jcky_no: resultRow.jcky_no,
                trar_no: resultRow.trar_no,
                ord: resultRow.ord,
                rc_time: resultRow.rc_time,
                diff_unit: resultRow.diff_unit,
                wg_hr: resultRow.wg_hr,
                wg_hr_diff: resultRow.wg_hr_diff,
                wg_jk: resultRow.wg_jk,
                win_odds: resultRow.win_odds,
                plc_odds: resultRow.plc_odds,
                popularity: resultRow.popularity,
                bu_g1f_acc_time: resultRow.bu_g1f_acc_time,
                bu_g2f_acc_time: resultRow.bu_g2f_acc_time,
                bu_g3f_acc_time: resultRow.bu_g3f_acc_time,
                bu_g4f_acc_time: resultRow.bu_g4f_acc_time,
                bu_g6f_acc_time: resultRow.bu_g6f_acc_time,
                bu_g8f_acc_time: resultRow.bu_g8f_acc_time,
                bu_s1f_acc_time: resultRow.bu_s1f_acc_time,
                bu_g1f_ord: resultRow.bu_g1f_ord,
                bu_g2f_ord: resultRow.bu_g2f_ord,
                bu_g3f_ord: resultRow.bu_g3f_ord,
                bu_g4f_ord: resultRow.bu_g4f_ord,
                bu_g6f_ord: resultRow.bu_g6f_ord,
                bu_g8f_ord: resultRow.bu_g8f_ord,
                bu_s1f_ord: resultRow.bu_s1f_ord,
                bu_s1f_time: resultRow.bu_s1f_time,
                bu_1fg_time: resultRow.bu_1fg_time,
                bu_2fg_time: resultRow.bu_2fg_time,
                bu_3fg_time: resultRow.bu_3fg_time,
                bu_4_2f_time: resultRow.bu_4_2f_time,
                bu_6_4f_time: resultRow.bu_6_4f_time,
                bu_8_6f_time: resultRow.bu_8_6f_time,
                bu_10_8f_time: resultRow.bu_10_8f_time,
                se_g1f_acc_time: resultRow.se_g1f_acc_time,
                se_g3f_acc_time: resultRow.se_g3f_acc_time,
                se_s1f_acc_time: resultRow.se_s1f_acc_time,
                se_1c_acc_time: resultRow.se_1c_acc_time,
                se_2c_acc_time: resultRow.se_2c_acc_time,
                se_3c_acc_time: resultRow.se_3c_acc_time,
                se_4c_acc_time: resultRow.se_4c_acc_time,
                sj_g1f_ord: resultRow.sj_g1f_ord,
                sj_g3f_ord: resultRow.sj_g3f_ord,
                sj_s1f_ord: resultRow.sj_s1f_ord,
                sj_1c_ord: resultRow.sj_1c_ord,
                sj_2c_ord: resultRow.sj_2c_ord,
                sj_3c_ord: resultRow.sj_3c_ord,
                sj_4c_ord: resultRow.sj_4c_ord,
                result_at: new Date().toISOString(),
              })
              .eq('race_date', rcDate)
              .eq('meet', meet)
              .eq('rc_no', rcNo)
              .eq('hr_name', horse.hrName);
            if (updErr) throw new Error(`race_entries update: ${updErr.message}`);
          } else {
            // 출주표 없음 (과거 데이터) → 사전+결과 동시 INSERT
            const { error: insErr } = await supabase
              .from('race_entries')
              .upsert({
                race_date: rcDate,
                meet,
                rc_no: rcNo,
                pthr_no: horse.chulNo,
                hr_name: horse.hrName,
                ag: horse.age ?? null,
                gndr: horse.sex ?? null,
                burd_wgt: horse.wgBudam ?? null,
                ratg: horse.rating && horse.rating > 0 ? horse.rating : null,
                rc_dist: raceRow.rc_dist ?? null,
                track_type: raceRow.track_type ?? null,
                jcky_no: resultRow.jcky_no,
                jcky_nm: horse.jkName ?? null,
                trar_no: resultRow.trar_no,
                trar_nm: horse.trName ?? null,
                hr_no: resultRow.hr_no,
                ord: resultRow.ord,
                rc_time: resultRow.rc_time,
                diff_unit: resultRow.diff_unit,
                wg_hr: resultRow.wg_hr,
                wg_hr_diff: resultRow.wg_hr_diff,
                wg_jk: resultRow.wg_jk,
                win_odds: resultRow.win_odds,
                plc_odds: resultRow.plc_odds,
                popularity: resultRow.popularity,
                bu_g1f_acc_time: resultRow.bu_g1f_acc_time,
                bu_g2f_acc_time: resultRow.bu_g2f_acc_time,
                bu_g3f_acc_time: resultRow.bu_g3f_acc_time,
                bu_g4f_acc_time: resultRow.bu_g4f_acc_time,
                bu_g6f_acc_time: resultRow.bu_g6f_acc_time,
                bu_g8f_acc_time: resultRow.bu_g8f_acc_time,
                bu_s1f_acc_time: resultRow.bu_s1f_acc_time,
                bu_g1f_ord: resultRow.bu_g1f_ord,
                bu_g2f_ord: resultRow.bu_g2f_ord,
                bu_g3f_ord: resultRow.bu_g3f_ord,
                bu_g4f_ord: resultRow.bu_g4f_ord,
                bu_g6f_ord: resultRow.bu_g6f_ord,
                bu_g8f_ord: resultRow.bu_g8f_ord,
                bu_s1f_ord: resultRow.bu_s1f_ord,
                bu_s1f_time: resultRow.bu_s1f_time,
                bu_1fg_time: resultRow.bu_1fg_time,
                bu_2fg_time: resultRow.bu_2fg_time,
                bu_3fg_time: resultRow.bu_3fg_time,
                bu_4_2f_time: resultRow.bu_4_2f_time,
                bu_6_4f_time: resultRow.bu_6_4f_time,
                bu_8_6f_time: resultRow.bu_8_6f_time,
                bu_10_8f_time: resultRow.bu_10_8f_time,
                se_g1f_acc_time: resultRow.se_g1f_acc_time,
                se_g3f_acc_time: resultRow.se_g3f_acc_time,
                se_s1f_acc_time: resultRow.se_s1f_acc_time,
                se_1c_acc_time: resultRow.se_1c_acc_time,
                se_2c_acc_time: resultRow.se_2c_acc_time,
                se_3c_acc_time: resultRow.se_3c_acc_time,
                se_4c_acc_time: resultRow.se_4c_acc_time,
                sj_g1f_ord: resultRow.sj_g1f_ord,
                sj_g3f_ord: resultRow.sj_g3f_ord,
                sj_s1f_ord: resultRow.sj_s1f_ord,
                sj_1c_ord: resultRow.sj_1c_ord,
                sj_2c_ord: resultRow.sj_2c_ord,
                sj_3c_ord: resultRow.sj_3c_ord,
                sj_4c_ord: resultRow.sj_4c_ord,
                result_at: new Date().toISOString(),
              }, { onConflict: 'race_date,meet,rc_no,pthr_no' });
            if (insErr) throw new Error(`race_entries insert: ${insErr.message}`);
          }
        }

        // 5. predictions 보충 (v7 라이브 추적: 수요일 사전 예측 보존, 재계산·삭제하지 않음)
        //    - 이미 예측이 있으면 절대 건드리지 않음 (DELETE→INSERT 재계산 제거)
        //    - 예측이 없는 경주만 사전 모드(forcePrecompetition)로 보충 INSERT
        //      (docs/superpowers/plans/2026-07-11-v7-live-tracking.md Task 2)
        if (!skipPredictions) {
          try {
            const { data: existingPred, error: existErr } = await supabase
              .from('predictions')
              .select('id')
              .eq('race_date', rcDate)
              .eq('meet', meet)
              .eq('rc_no', rcNo)
              .limit(1);
            if (existErr) throw existErr;

            if (!existingPred || existingPred.length === 0) {
              const predictions = await predictRace(
                supabase as unknown as ReadClient,
                rcDate,
                meet,
                rcNo,
                { forcePrecompetition: true }
              );
              if (predictions.length > 0) {
                const { error: predErr } = await supabase.from('predictions').insert(predictions);
                if (predErr) throw predErr;
                console.warn(
                  `    [meet=${meet}, rcNo=${rcNo}] ⚠️ 예측 미보유 → 사전 모드로 보충 (${predictions.length}건)`
                );
              }
            }
          } catch (err) {
            console.warn(
              `    [meet=${meet}, rcNo=${rcNo}] 예측 보충 실패 (계속): ${(err as Error).message}`
            );
          }

          // 6. predictions.actual_ord만 UPDATE — 결과 기록 전용, 예측값 필드는 절대 건드리지 않음
          //    (총점·순위·확률 등은 수요일 사전 예측 그대로 유지)
          //    보충(위 5단계)된 예측도 여기서 함께 채워짐.
          //    skipPredictions=true(대량 백필)일 때는 건너뜀: backfill_results.ts가 다루는
          //    과거 날짜는 predictions이 아직 없어(별도 backfill_predictions 경로) 매 말마다
          //    빈 UPDATE만 쏘게 되어 Supabase egress만 낭비 — 사용자 결정 2026-07-11,
          //    docs/superpowers/specs/2026-07-11-v7-live-tracking-design.md §3.1
          for (const { hrName, ord } of resultOrds) {
            if (ord == null) continue; // 실격/미도착 등 결과 미확정 → 스킵
            const { error: actualOrdErr } = await supabase
              .from('predictions')
              .update({ actual_ord: ord })
              .eq('race_date', rcDate)
              .eq('meet', meet)
              .eq('rc_no', rcNo)
              .eq('hr_name', hrName);
            if (actualOrdErr) {
              console.warn(
                `    [meet=${meet}, rcNo=${rcNo}, hr=${hrName}] actual_ord UPDATE 실패 (계속): ${actualOrdErr.message}`
              );
            }
          }
        }

        result.racesSynced++;
        result.horsesSynced += horses.length;
        console.log(`    [meet=${meet}, rcNo=${rcNo}] ✓ ${horses.length}두${skipPredictions ? '' : ' + 예측'}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`rcNo=${rcNo}: ${msg}`);
        console.error(`    [meet=${meet}, rcNo=${rcNo}] ❌ ${msg}`);
      }
    }

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
// CLI
// ============================================
async function main() {
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
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    rcDate =
      yesterday.getFullYear() * 10000 +
      (yesterday.getMonth() + 1) * 100 +
      yesterday.getDate();
    console.log(`📅 날짜 인자 없음 → 어제(${rcDate})로 자동 설정`);
  }

  const results = await syncDay({ rcDate, meets });

  console.log('\n' + '='.repeat(50));
  console.log('📊 동기화 결과 요약');
  console.log('='.repeat(50));
  for (const r of results) {
    console.log(`  meet=${r.meet}: ${r.racesSynced} 경주 / ${r.horsesSynced} 두 / 에러 ${r.errors.length}`);
  }
}

const isMainModule =
  process.argv[1] && process.argv[1].includes('dailySync');
if (isMainModule) {
  main().catch((err) => {
    console.error('💥', err);
    process.exit(1);
  });
}
