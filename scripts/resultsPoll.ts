// scripts/resultsPoll.ts
/**
 * 결과 폴러 — 19시·23시 고정 슬롯 대신, 출마표 발주시각(races.st_time) 기반으로
 * "지금 KRA를 불러야 하나"를 매 폴마다 싸게 판정한다(2026-08-29 설계).
 *
 * 경주 있는 날 낮 시간대(KST 10:00~21:00, Actions cron)에 15분 간격으로 돈다.
 * 오늘 출마표의 발주시각 + 여유 15분이 지났는데 아직 착순이 없는 경주가
 * 하나라도 있을 때만 KRA를 부른다 — 없으면 DB 조회만 하고 조용히 끝난다
 * (KRA 쿼터 절약). 순수 판정은 src/sync/resultsPollLogic.ts.
 *
 * 안전장치: 너무 일찍 불러도 dailySync의 "미시행 가드"가 알아서 스킵하고
 * 다음 폴이 재시도한다. 그날 폴이 전부 실패해도 catchupSync.ts가 다음날 메꾼다.
 *
 * 사용:
 *   npm run sync:poll               # 오늘 날짜 판정 + 필요 시 재싱크
 *   npm run sync:poll -- --dry-run  # KRA 호출 없이 판정 결과만 확인
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { hasDueUnsyncedRace, type RaceTimingStatus } from '../src/sync/resultsPollLogic.js';
import { yyyymmddOffset } from '../src/utils/syncCli.js';
import { syncDay } from '../src/sync/dailySync.js';

const BUFFER_MINUTES = 15;
const dryRun = process.argv.includes('--dry-run');

async function fetchTodayTiming(sb: any, rcDate: number): Promise<RaceTimingStatus[]> {
  const { data: races, error: raceErr } = await sb.from('races')
    .select('meet,rc_no,st_time').eq('race_date', rcDate);
  if (raceErr) throw raceErr;

  const { data: entries, error: entErr } = await sb.from('race_entries')
    .select('meet,rc_no').eq('race_date', rcDate).not('ord', 'is', null);
  if (entErr) throw entErr;

  const resulted = new Set(
    (entries ?? []).map((e: { meet: number; rc_no: number }) => `${e.meet}-${e.rc_no}`)
  );

  return (races ?? []).map((r: { meet: number; rc_no: number; st_time: string | null }) => ({
    stTime: r.st_time,
    hasResult: resulted.has(`${r.meet}-${r.rc_no}`),
  }));
}

async function main(): Promise<void> {
  const sb = getSupabaseAdmin();
  const rcDate = yyyymmddOffset(0);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const timing = await fetchTodayTiming(sb, rcDate);
  if (timing.length === 0) {
    console.log(`⏳ ${rcDate} 출마표 없음 (휴장일이거나 아직 카드 미발표) — 확인할 것 없음`);
    return;
  }

  const due = hasDueUnsyncedRace(timing, nowMinutes, BUFFER_MINUTES);
  if (!due) {
    console.log(`⏳ ${rcDate} — 발주시각+${BUFFER_MINUTES}분 지난 미확정 경주 없음 (KRA 호출 생략)`);
    return;
  }

  console.log(`🔔 ${rcDate} — 확인할 경주 있음`);
  if (dryRun) {
    console.log('(--dry-run: KRA 호출 생략)');
    return;
  }

  const results = await syncDay({ rcDate, meets: [1, 3] });
  for (const r of results) {
    console.log(`  meet=${r.meet}: ${r.racesSynced} 경주 / ${r.horsesSynced} 두 / 스킵 ${r.racesSkipped} / 에러 ${r.errors.length}`);
  }
}

main().catch((err) => { console.error('💥', err); process.exit(1); });
