import type { ReadClient } from '../../db/localDb.js';
import { gatherRaceInputs } from '../scorePredictor.js';
import { ScoreEngine } from '../index.js';
import { buildFeatures } from '../features/buildFeatures.js';
import type { RaceRecord, HorseRecord } from './types.js';

/**
 * 지정 기간의 확정 경주(ord 있는 말 ≥3두) 전체를 수집한다.
 * @param db     ReadClient (localDb 또는 Supabase 어댑터)
 * @param fromDate YYYYMMDD 형식 숫자 (포함)
 * @param toDate   YYYYMMDD 형식 숫자 (포함)
 */
export async function collectRaces(
  db: ReadClient,
  fromDate: number,
  toDate: number,
  opts?: { shapeParCutoff?: number }
): Promise<RaceRecord[]> {
  const { data: raceList, error } = await db
    .from('races')
    .select('race_date, meet, rc_no, rc_dist')
    .gte('race_date', fromDate)
    .lte('race_date', toDate)
    .order('race_date')
    .order('meet')
    .order('rc_no');
  if (error) throw error;
  if (!raceList || raceList.length === 0) return [];

  const races: RaceRecord[] = [];
  const engine = new ScoreEngine({});

  for (const r of raceList as { race_date: number; meet: number; rc_no: number; rc_dist: number | null }[]) {
    const rows = await gatherRaceInputs(db, r.race_date, r.meet, r.rc_no, opts);
    if (rows.length === 0) continue;

    // 확정 경주만: ord가 있고 취소마(ord>=50)가 아닌 말 3두 이상
    const withOrd = rows.filter((row) => row.ord !== null && row.ord < 50);
    if (withOrd.length < 3) continue;

    // win_odds 조회
    const { data: entries } = await db
      .from('race_entries')
      .select('pthr_no, win_odds')
      .eq('race_date', r.race_date)
      .eq('meet', r.meet)
      .eq('rc_no', r.rc_no);
    const oddsMap = new Map<number, number | null>();
    for (const e of (entries ?? []) as { pthr_no: number; win_odds: number | null }[]) {
      oddsMap.set(e.pthr_no, e.win_odds);
    }

    const horses: HorseRecord[] = withOrd.map((row) => {
      const scored = engine.calculateScores(row.input);

      // 항목별 rawScore 추출 (Record<ItemId, ItemScore> → Record<string, number>)
      const rawScores: Record<string, number> = {};
      for (const [id, item] of Object.entries(scored.items)) {
        rawScores[id] = item.rawScore;
      }

      return {
        hrName: row.hr_name,
        pthrNo: row.pthr_no,
        ord: row.ord as number,  // withOrd 필터로 non-null 보장
        winOdds: oddsMap.get(row.pthr_no) ?? null,
        rawScores,
        features: buildFeatures(row.input),
      };
    });

    races.push({ raceDate: r.race_date, meet: r.meet, rcNo: r.rc_no, rcDist: r.rc_dist ?? undefined, horses });
  }

  return races;
}
