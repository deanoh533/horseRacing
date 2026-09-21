/**
 * sync 건전성 판정용 DB 조회 — probe_sync_health.ts와 catchupSync.ts가 공유한다.
 * 판정 자체(hole/gap/ok)는 순수 함수 `classifyRaceDate`(src/utils/syncHealth.ts)가
 * 하고, 여기는 그 입력(RaceDateCounts)을 Supabase에서 긁어오는 I/O만 맡는다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { COMBO_SYNC_SINCE, type RaceDateCounts } from '../utils/syncHealth.js';

/**
 * 주어진 경주들 중 조합배당(combo_dividends)이 한 행이라도 있는 경주 키(`meet-rc_no`) 집합.
 * 조합배당은 경주당 수백~수천 행이라 행을 받아 세면 egress가 크다 → 경주마다 서버
 * count(head)만 묻는다. 경주 수만큼 요청하지만 응답은 숫자 하나씩이다.
 */
export async function racesWithComboSet(
  sb: SupabaseClient,
  raceDate: number,
  races: Array<{ meet: number; rc_no: number }>
): Promise<Set<string>> {
  const hits = await Promise.all(races.map(async (r) => {
    const { count, error: e } = await sb.from('combo_dividends')
      .select('*', { count: 'exact', head: true })
      .eq('race_date', raceDate).eq('meet', r.meet).eq('rc_no', r.rc_no);
    if (e) throw new Error(`combo_dividends(${raceDate} ${r.meet}-${r.rc_no}): ${e.message}`);
    return (count ?? 0) > 0 ? `${r.meet}-${r.rc_no}` : null;
  }));
  return new Set(hits.filter((k): k is string => k !== null));
}

/**
 * 이 경주일 출마표를 마지막으로 수집한 시각. 한 행만 받는다(정렬 + limit 1).
 *
 * `fetched_at`은 2026-09-21까지 DB 기본값(`DEFAULT NOW()`)에만 의존해 **INSERT에만**
 * 찍혔다 — 그래서 그 이전 경주일은 전부 "최초 수집 시각"이고, 재실행이 돌았는지
 * 알 수 없다. 결과만 백필된 과거 행은 `null`이다(출마표를 받은 적 없음).
 */
export async function latestCardFetch(
  sb: SupabaseClient,
  raceDate: number
): Promise<string | null> {
  const { data, error: e } = await sb.from('race_entries')
    .select('fetched_at').eq('race_date', raceDate)
    .order('fetched_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (e) throw new Error(`race_entries.fetched_at(${raceDate}): ${e.message}`);
  return (data?.fetched_at as string | undefined) ?? null;
}

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
  // 경마장(meet)도 함께 받는다 — 경마장이 통째로 빠지는 변화를 보려면 필요하다
  const raceDates = new Set<number>();
  const meetsByDate = new Map<number, Set<number>>();
  for (let page = 0; ; page++) {
    const { data, error: e } = await sb.from('races')
      .select('race_date,meet').gte('race_date', from)
      .order('race_date').range(page * 1000, page * 1000 + 999);
    if (e) throw e;
    for (const r of (data ?? []) as Array<{ race_date: number; meet: number }>) {
      raceDates.add(r.race_date);
      const s = meetsByDate.get(r.race_date) ?? new Set<number>();
      s.add(r.meet);
      meetsByDate.set(r.race_date, s);
    }
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
      // 조합배당 수집 이전 날짜는 판정에 안 쓰므로 조회를 생략하고 결과 경주 수로 채운다
      racesWithCombo: d >= COMBO_SYNC_SINCE
        ? (await racesWithComboSet(sb, d, [...(resultRaces.get(d) ?? [])].map((k) => {
            const [meet, rc_no] = k.split('-').map(Number);
            return { meet: meet!, rc_no: rc_no! };
          }))).size
        : resultRaces.get(d)?.size ?? 0,
      stTimeFilled: await countOf('races', d, (q: any) => q.not('st_time', 'is', null)),
      comboRows: await countOf('combo_dividends', d),
      cardFetchedAt: await latestCardFetch(sb, d),
      meets: [...(meetsByDate.get(d) ?? [])].sort(),
    });
  }

  return counts;
}
