// scripts/catchupSync.ts
/**
 * 결과 캐치업 — 최근 7일 중 여전히 구멍(hole·gap)인 날짜를 찾아 자동 재싱크한다.
 *
 * 왜 필요한가: 2026-08-23~27 KRA 장애처럼 며칠에 걸쳐 간헐적으로 재발하는 장애는
 * 하루짜리 재시도(슬롯 늘리기·타임아웃 늘리기)로 못 넘는다(docs/status/05-data-infra.md
 * 2026-08-28·29 참고). 결과 sync가 고정 슬롯 대신 발주시각 기반 폴러(resultsPoll.ts)로
 * 바뀐 뒤에도, 그날 폴러가 통째로 못 돌면 다음날 이 캐치업이 자동으로 메꾼다.
 *
 * 7일 창이 지나면 오래된 구멍은 저절로 재시도 대상에서 빠진다 — 20251226 부경 R6처럼
 * KRA가 영구히 "미시행"만 반환하는 진짜 취소 경주를 매일 재호출하는 낭비를 막는다
 * (별도 예외처리 불필요, TODO O-001 참고).
 *
 * 판정은 probe:sync-health와 같은 로직(classifyRaceDate)을 쓴다 — 매일 사람이
 * probe를 돌려서 백필 명령을 치던 걸 그대로 자동화한 것.
 *
 * 알림 정책(L-004 유지, 2026-08-29 설계): 어제·그저께 생긴 구멍은 시도해서 안
 * 채워져도 조용히 넘어간다(폴러가 아직 못 따라잡았을 뿐일 수 있음 — 정상 지연).
 * 하지만 **`STALE_THRESHOLD_DAYS`일 이상 묵은 구멍이 이번 시도로도 전혀 안
 * 채워지면**(이번 호출 racesSynced 합계 0) 잡을 실패 처리해 메일 알림을 보낸다 —
 * 매 폴마다 실패 메일이 오던 옛 방식의 소음 없이, "며칠째 안 풀림"만 알린다.
 *
 * 사용:
 *   npm run sync:catchup            # 최근 7일 구멍 재싱크
 *   npm run sync:catchup -- --dry-run   # KRA 호출 없이 대상 날짜만 확인
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fetchRaceDateCounts } from '../src/sync/syncHealthQuery.js';
import { classifyRaceDate } from '../src/utils/syncHealth.js';
import { yyyymmddOffset } from '../src/utils/syncCli.js';
import { syncDay } from '../src/sync/dailySync.js';
import { STALE_THRESHOLD_DAYS, isStaleUnresolved } from '../src/sync/catchupLogic.js';

const LOOKBACK_DAYS = 7;
const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const sb = getSupabaseAdmin();
  const today = yyyymmddOffset(0);
  const from = yyyymmddOffset(-LOOKBACK_DAYS);

  const rows = await fetchRaceDateCounts(sb, from);
  const targets = rows
    .filter((r) => {
      const st = classifyRaceDate(r, today);
      return st === 'hole' || st === 'gap';
    })
    .map((r) => r.raceDate);

  if (targets.length === 0) {
    console.log(`✅ 캐치업 — 최근 ${LOOKBACK_DAYS}일 구멍 없음`);
    return;
  }

  console.log(`❗ 캐치업 대상 ${targets.length}일: ${targets.join(', ')}`);
  if (dryRun) {
    console.log('(--dry-run: KRA 호출 생략)');
    return;
  }

  const staleCutoff = yyyymmddOffset(-STALE_THRESHOLD_DAYS);
  let hasUnresolvedStale = false;

  for (const rcDate of targets) {
    console.log(`\n🔄 ${rcDate} 재싱크 시도`);
    try {
      const results = await syncDay({ rcDate, meets: [1, 3] });
      for (const r of results) {
        console.log(`  meet=${r.meet}: ${r.racesSynced} 경주 / ${r.horsesSynced} 두 / 스킵 ${r.racesSkipped} / 에러 ${r.errors.length}`);
      }
      const totalSynced = results.reduce((sum, r) => sum + r.racesSynced, 0);
      if (isStaleUnresolved(rcDate, staleCutoff, totalSynced)) hasUnresolvedStale = true;
    } catch (err) {
      console.warn(`  ⚠️ ${rcDate} 캐치업 실패(다음 캐치업이 재시도): ${err instanceof Error ? err.message : err}`);
      if (isStaleUnresolved(rcDate, staleCutoff, 0)) hasUnresolvedStale = true;
    }
  }

  if (hasUnresolvedStale) {
    console.error(`\n❌ ${STALE_THRESHOLD_DAYS}일 이상 묵은 구멍이 이번 시도로도 안 채워짐 — 알림 필요`);
    process.exit(1);
  }
}

main().catch((err) => { console.error('💥', err); process.exit(1); });
