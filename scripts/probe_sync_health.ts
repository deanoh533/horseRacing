// scripts/probe_sync_health.ts
/**
 * sync 건전성 점검 — 경주일별로 결과·조합배당·발주시각이 실제로 찼는지 대조한다.
 *
 * 왜 필요한가: GitHub Actions 이력의 성패만으로는 구멍이 안 보인다.
 * 휴장일 실패가 섞여 빨간불이 무뎌지고, KRA 타임아웃으로 결과가 통째로
 * 빠진 날은 이력만 봐선 티가 안 난다(2026-08 실측: 0808·0814·0821).
 * 판정은 `race_entries.ord` 채움 여부로 한다.
 *
 * DuckDB 미러가 아니라 **항상 Supabase 라이브**를 읽는다 — 미러는 정의상
 * 마지막 db:pull 시점이라 "지금 채워졌나"를 답할 수 없다.
 *
 * 사용:
 *   npm run probe:sync-health              # 최근 6주
 *   npm run probe:sync-health -- --from 20260801
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fetchRaceDateCounts } from '../src/sync/syncHealthQuery.js';
import {
  classifyRaceDate, ST_TIME_PRESERVED_SINCE,
  type SyncDateStatus,
} from '../src/utils/syncHealth.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ymd = (d: Date): number =>
  d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

const MARK: Record<SyncDateStatus, string> = {
  ok: '✅', pending: '⏳', partial: '⚠️ ', gap: '❗', hole: '❌',
};
const LABEL: Record<SyncDateStatus, string> = {
  ok: '정상', pending: '결과 대기', partial: '조합배당 누락',
  gap: '경주 일부 구멍', hole: '결과 구멍',
};

async function main(): Promise<void> {
  const sb = getSupabaseAdmin();
  const today = ymd(new Date());
  const from = Number(arg('--from') ?? (() => {
    const d = new Date(); d.setDate(d.getDate() - 42); return ymd(d);
  })());

  const rows = await fetchRaceDateCounts(sb, from);
  console.log(`\n📋 sync 건전성 — ${from} ~ (오늘 ${today})\n`);
  console.log('   경주일    출전  결과  결과경주  조합배당  발주시각  상태');
  const holes: number[] = [];
  for (const r of rows) {
    const st = classifyRaceDate(r, today);
    if (st === 'hole' || st === 'gap') holes.push(r.raceDate);
    console.log(
      `${MARK[st]} ${r.raceDate}  ${String(r.entries).padStart(4)}  ${String(r.ordFilled).padStart(4)}  ` +
      `${String(r.racesWithResult + '/' + r.races).padStart(8)}  ` +
      `${String(r.comboRows).padStart(8)}  ${String(r.stTimeFilled + '/' + r.races).padStart(8)}  ${LABEL[st]}`
    );
  }

  console.log('\n' + '='.repeat(64));
  if (holes.length === 0) {
    console.log('✅ 결과 구멍 없음');
  } else {
    console.log(`❌ 결과 구멍 ${holes.length}일치 — 아래 명령으로 백필:`);
    for (const d of holes) console.log(`   npm run sync -- --date ${d}`);
    console.log('   ⏭ "미시행·결과 미확정 → 스킵"이 찍히는 경주는 실제 취소된 경주다(빈 값 유지가 정답).');
  }
  // 발주시각: 결과 sync가 지우던 버그가 있었다(2026-08-23 수정). 수정 이전 날짜는
  // 매번 떠봐야 손쓸 수 없으니 한 줄로만 알리고, 회귀 감시는 수정일 이후만 한다.
  const regressed = rows.filter(
    (r) => r.raceDate >= ST_TIME_PRESERVED_SINCE && r.ordFilled > 0 && r.races > 0 && r.stTimeFilled === 0
  );
  const legacy = rows.filter(
    (r) => r.raceDate < ST_TIME_PRESERVED_SINCE && r.ordFilled > 0 && r.races > 0 && r.stTimeFilled === 0
  );
  if (regressed.length > 0) {
    console.log(`
❌ 결과 도착 후 발주시각이 사라진 날 ${regressed.length}건: ${regressed.map((r) => r.raceDate).join(', ')}`);
    console.log('   toRaceRow의 st_time 보존이 깨졌다 — src/sync/transformer.ts 확인.');
  } else if (legacy.length > 0) {
    console.log(`
ℹ️  발주시각 없음 ${legacy.length}건 (전부 ${ST_TIME_PRESERVED_SINCE} 수정 이전 = 기존 버그 흔적, 복구 불가)`);
  }
}

main().catch((err) => { console.error('💥', err); process.exit(1); });
