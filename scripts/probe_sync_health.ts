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
import {
  classifyRaceDate, ST_TIME_PRESERVED_SINCE,
  type RaceDateCounts, type SyncDateStatus,
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

  // ⚠️ PostgREST는 select() 응답을 기본 1000행에서 자른다. 행을 받아 세면
  //    조용히 틀린 수가 나오므로(이 저장소가 이미 겪은 함정) 전부 서버 count로 센다.
  const countOf = async (
    table: string, raceDate: number, refine?: (q: any) => any
  ): Promise<number> => {
    let q = sb.from(table).select('*', { count: 'exact', head: true }).eq('race_date', raceDate);
    if (refine) q = refine(q);
    const { count, error: e } = await q;
    if (e) throw new Error(`${table}(${raceDate}): ${e.message}`);
    return count ?? 0;
  };

  // 경주일 목록만 행으로 받는다 (경주일당 8~17행이라 페이지네이션으로 충분).
  // 휴장일은 races 행 자체가 없어 자동으로 빠진다.
  const raceDates = new Set<number>();
  for (let page = 0; ; page++) {
    const { data, error: e } = await sb.from('races')
      .select('race_date').gte('race_date', from)
      .order('race_date').range(page * 1000, page * 1000 + 999);
    if (e) throw e;
    for (const r of (data ?? []) as Array<{ race_date: number }>) raceDates.add(r.race_date);
    if (!data || data.length < 1000) break;
  }

  // 부분 구멍은 두수가 아니라 **경주 수**로 대조해야 보인다(제외마 때문에 두수는
  // 매일 모자란다). distinct는 PostgREST가 못 하니 (경주일,경마장,경주번호)만
  // 받아 와서 세되, 1000행 캡을 페이지네이션으로 넘긴다.
  const resultRaces = new Map<number, Set<string>>();
  for (let page = 0; ; page++) {
    const { data, error: e } = await sb.from('race_entries')
      .select('race_date,meet,rc_no').gte('race_date', from).not('ord', 'is', null)
      .order('race_date').order('meet').order('rc_no')
      .range(page * 1000, page * 1000 + 999);
    if (e) throw e;
    for (const r of (data ?? []) as Array<{ race_date: number; meet: number; rc_no: number }>) {
      const set = resultRaces.get(r.race_date) ?? new Set<string>();
      set.add(`${r.meet}-${r.rc_no}`);
      resultRaces.set(r.race_date, set);
    }
    if (!data || data.length < 1000) break;
  }

  const counts: RaceDateCounts[] = [];
  for (const d of [...raceDates].sort((a, b) => a - b)) {
    counts.push({
      raceDate: d,
      entries: await countOf('race_entries', d),
      ordFilled: await countOf('race_entries', d, (q: any) => q.not('ord', 'is', null)),
      races: await countOf('races', d),
      racesWithResult: resultRaces.get(d)?.size ?? 0,
      stTimeFilled: await countOf('races', d, (q: any) => q.not('st_time', 'is', null)),
      comboRows: await countOf('combo_dividends', d),
    });
  }

  const rows = counts;
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
