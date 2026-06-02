/**
 * 검증: race_entries.popularity가 정말 win_odds 오름차순(인기순)인가? (읽기 전용)
 * 사용: npx tsx scripts/probe_popularity_odds.ts
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';

type Row = { race_date: number; meet: number; rc_no: number; hr_name: string; win_odds: number | null; popularity: number | null };

async function main() {
  const sb = getSupabaseAdmin();
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('race_entries')
      .select('race_date, meet, rc_no, hr_name, win_odds, popularity')
      .not('ord', 'is', null)
      .order('race_date').order('meet').order('rc_no').order('hr_name')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  // race 그룹핑
  const byRace = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(r);
  }

  let races = 0, favRaces = 0, favAgree = 0;
  let horseTotal = 0, rankExact = 0;
  let popNull = 0, oddsNull = 0;
  const mismatchEx: string[] = [];

  for (const [k, hs] of byRace) {
    const valid = hs.filter((h) => h.win_odds != null && h.win_odds > 0);
    popNull += hs.filter((h) => h.popularity == null).length;
    oddsNull += hs.filter((h) => h.win_odds == null).length;
    if (valid.length < 2) continue;
    races++;

    // win_odds 오름차순 순위 (동률은 같은 순위 부여 = RANK)
    const sorted = [...valid].sort((a, b) => (a.win_odds! - b.win_odds!));
    const minOdds = sorted[0].win_odds!;

    // 풀 순위 일치: popularity == odds_rank
    let rank = 0, prevOdds = NaN, seen = 0;
    for (const h of sorted) {
      seen++;
      if (h.win_odds !== prevOdds) { rank = seen; prevOdds = h.win_odds!; }
      if (h.popularity != null) {
        horseTotal++;
        if (h.popularity === rank) rankExact++;
      }
    }

    // 인기1위 일치: popularity==1 말이 최저 win_odds(동률 허용)인가
    const pop1 = valid.find((h) => h.popularity === 1);
    if (pop1) {
      favRaces++;
      if (pop1.win_odds === minOdds) favAgree++;
      else if (mismatchEx.length < 8) {
        mismatchEx.push(`${k} ${pop1.hr_name}: pop1 odds=${pop1.win_odds} vs minOdds=${minOdds}`);
      }
    }
  }

  console.log(`경주(유효): ${races} / 말(popularity 있음): ${horseTotal}`);
  console.log(`popularity NULL 말: ${popNull} / win_odds NULL 말: ${oddsNull}`);
  console.log(`풀 순위 일치(popularity == win_odds 순위): ${rankExact}/${horseTotal} = ${(100*rankExact/horseTotal).toFixed(2)}%`);
  console.log(`인기1위 일치(pop=1 말이 최저배당): ${favAgree}/${favRaces} = ${(100*favAgree/favRaces).toFixed(2)}%`);
  if (mismatchEx.length) {
    console.log('\n불일치 예시:');
    mismatchEx.forEach((m) => console.log('  ' + m));
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
