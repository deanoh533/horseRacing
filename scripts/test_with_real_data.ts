/**
 * 실제 DB 데이터로 Score Engine 테스트
 *
 * 사용:
 *   tsx scripts/test_with_real_data.ts --date 20260517 --meet 3 --rc 1
 */
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { ScoreEngine } from '../src/engine/index.js';
import {
  ITEM_NAMES,
  FOUR_CORE_AREAS,
  type ItemId,
} from '../src/types/index.js';

const engine = new ScoreEngine();

async function main() {
  // 인자 파싱
  const args = process.argv.slice(2);
  let rcDate = 20260517;
  let meet = 3;
  let rcNo = 1;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) rcDate = parseInt(args[i + 1]!);
    if (args[i] === '--meet' && args[i + 1]) meet = parseInt(args[i + 1]!);
    if (args[i] === '--rc' && args[i + 1]) rcNo = parseInt(args[i + 1]!);
  }

  console.log(`\n🐎 실제 데이터 점수 계산: ${rcDate} meet=${meet} rcNo=${rcNo}\n`);

  const supabase = getSupabaseAdmin();

  // 1. 경주 정보
  const { data: race } = await supabase
    .from('races')
    .select('*')
    .eq('race_date', rcDate)
    .eq('meet', meet)
    .eq('rc_no', rcNo)
    .single();

  if (!race) {
    console.error(`❌ 경주를 찾을 수 없음`);
    process.exit(1);
  }

  console.log(`📍 ${race.rc_dist}m ${race.rc_name} / ${race.track} / ${race.weather}\n`);

  // 2. 해당 경주 출전마들
  const { data: horses } = await supabase
    .from('horse_results')
    .select('*')
    .eq('race_date', rcDate)
    .eq('meet', meet)
    .eq('rc_no', rcNo)
    .order('chul_no');

  if (!horses || horses.length === 0) {
    console.error('❌ 출전마 없음');
    process.exit(1);
  }

  // 3. 모든 출전마 부담중량 (⑧ 항목용)
  const raceBudams = horses
    .map((h: any) => h.wg_budam)
    .filter((v: number | null): v is number => v != null);

  // 4. 각 말마다 점수 계산
  const results = await Promise.all(
    horses.map(async (h: any) => {
      // 과거 이력 조회 (최근 5경주)
      const { data: hist5 } = await supabase
        .from('horse_results')
        .select('ord, rc_dist, track, track_type, wg_hr_diff, win_odds')
        .eq('hr_name', h.hr_name)
        .lt('race_date', rcDate)
        .order('race_date', { ascending: false })
        .limit(5);

      const ord5 = (hist5 ?? []).reverse().map((r: any) => r.ord);
      const sameDistOrds = (hist5 ?? [])
        .filter((r: any) => r.rc_dist === h.rc_dist)
        .map((r: any) => r.ord);

      // 기수 30일 이력
      const thirtyDaysAgo = subtractDays(rcDate, 30);
      const { data: jockeyHist } = await supabase
        .from('horse_results')
        .select('ord')
        .eq('jk_no', h.jk_no)
        .gte('race_date', thirtyDaysAgo)
        .lt('race_date', rcDate);
      const jockey30DayOrds = (jockeyHist ?? []).map((r: any) => r.ord);

      // Score Engine 호출
      const result = engine.calculateScores({
        rating: h.rating ?? 0,
        ord5,
        sameDistOrds,
        jockey30DayOrds,
        weightDiffs: (hist5 ?? []).reverse().map((r: any) => r.wg_hr_diff ?? 0),
        sex: h.sex,
        myBudam: h.wg_budam,
        raceBudams,
        stOrd: h.st_ord ?? 0,
        totalHorses: horses.length,
        rcDist: h.rc_dist,
        age: h.age,
      });

      return {
        chul_no: h.chul_no,
        hr_name: h.hr_name,
        actual_ord: h.ord,
        rating: h.rating,
        popularity: h.popularity,
        total: result.total,
        items: result.items,
        ord5,
        sameDistCount: sameDistOrds.length,
        jockeyCount: jockey30DayOrds.length,
      };
    })
  );

  // 점수 내림차순
  results.sort((a, b) => b.total - a.total);

  console.log(
    '순위 | 마번 마명         | 종합  | 실제 | 인기 | 5경주이력 | 거리이력 | 기수30일'
  );
  console.log('-'.repeat(90));
  results.forEach((r, i) => {
    const rank = String(i + 1).padStart(2);
    const name = `${r.chul_no}번 ${r.hr_name}`.padEnd(17);
    const score = r.total.toFixed(1).padStart(5);
    const actual = String(r.actual_ord ?? '?').padStart(2);
    const pop = String(r.popularity ?? '?').padStart(2);
    const ord5 = r.ord5.length > 0 ? r.ord5.join('-') : '(데뷔)';
    const distCnt = String(r.sameDistCount).padStart(2);
    const jkCnt = String(r.jockeyCount).padStart(3);

    console.log(`  ${rank} | ${name} | ${score} | ${actual}위 | ${pop}인기 | ${ord5.padEnd(10)} | ${distCnt}회   | ${jkCnt}회`);
  });

  // 핵심 4개 영역 점수 분포 (1위 말)
  if (results[0]) {
    const top = results[0];
    console.log(`\n📊 ${top.hr_name} (예측 1위, 실제 ${top.actual_ord}위) 핵심 4영역 상세:`);
    for (const id of FOUR_CORE_AREAS) {
      const item = top.items[id];
      const pct = Math.round(item.rawScore * 100);
      const bar = '█'.repeat(Math.floor(pct / 10));
      console.log(`  ${ITEM_NAMES[id].padEnd(15)} ${bar} ${pct}% (${item.weightedScore.toFixed(2)}점)`);
    }
  }

  console.log('\n✅ 완료');
}

function subtractDays(rcDate: number, days: number): number {
  const y = Math.floor(rcDate / 10000);
  const m = Math.floor((rcDate % 10000) / 100) - 1;
  const d = rcDate % 100;
  const date = new Date(y, m, d);
  date.setDate(date.getDate() - days);
  return (
    date.getFullYear() * 10000 +
    (date.getMonth() + 1) * 100 +
    date.getDate()
  );
}

main().catch((err) => {
  console.error('💥', err);
  process.exit(1);
});
