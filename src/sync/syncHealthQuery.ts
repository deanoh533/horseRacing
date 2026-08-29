/**
 * sync 건전성 판정용 DB 조회 — probe_sync_health.ts와 catchupSync.ts가 공유한다.
 * 판정 자체(hole/gap/ok)는 순수 함수 `classifyRaceDate`(src/utils/syncHealth.ts)가
 * 하고, 여기는 그 입력(RaceDateCounts)을 Supabase에서 긁어오는 I/O만 맡는다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RaceDateCounts } from '../utils/syncHealth.js';

/**
 * `from`(YYYYMMDD) 이후 경주일 전체의 카운트를 모아 반환한다.
 * PostgREST 1000행 캡을 페이지네이션으로 넘긴다(이 저장소가 이미 겪은 함정).
 */
export async function fetchRaceDateCounts(
  sb: SupabaseClient,
  from: number
): Promise<RaceDateCounts[]> {
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

  return counts;
}
