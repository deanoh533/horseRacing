/**
 * Walk-forward 검증 (Stage B) — 읽기 전용 (DB 절대 수정 안 함)
 *
 * 확장형 윈도우 + 달력 분기 홀드아웃으로 "후보 가중치가 챔피언(현재 라이브)보다
 * 나은가"를 후보가 안 본 구간에서 채점한다.
 *
 * 블록: 2024 = 부트스트랩(학습 전용, 테스트 안 함), 2025-Q1부터 분기별 테스트.
 * 지표: 1순위 예측마의 단승(1착)·연승(3착 내). 연승(ord≤3) 우선.
 *   (주의: 단일마 지표라 "연승"이 맞다. 진짜 복승/복연승/삼복승은 2~3마리 다마리 베팅 → 묶음 분석 참고)
 *
 * 사용:
 *   npm run walkforward                  # 경우 A: 분기마다 ρ 재학습 후보 vs 챔피언
 *   npm run walkforward -- --candidate 3 # 경우 B: model_versions[3] 고정 후보 vs 챔피언
 *   npm run walkforward -- --champion 1  # 챔피언 버전 지정 (기본 = 활성 버전)
 */
import 'dotenv/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { computeCorrelations, computeOptimalWeights } from '../src/engine/weightLearner.js';

const FIRST_TEST = { year: 2025, q: 1 }; // 2024는 부트스트랩

type Weights = Record<string, number>;
interface PredRow {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_name: string;
  item_scores: Record<string, { rawScore?: number }> | null;
  actual_ord: number | null;
  win_odds?: number | null; // race_entries에서 조인 (시장 벤치마크용)
}

function quarterOf(raceDate: number) {
  const y = Math.floor(raceDate / 10000);
  const m = Math.floor((raceDate % 10000) / 100);
  return { year: y, q: Math.floor((m - 1) / 3) + 1 };
}
const qKey = (y: number, q: number) => `${y}-Q${q}`;
const qStart = (y: number, q: number) => y * 10000 + ((q - 1) * 3 + 1) * 100 + 1;

/** 가중치로 한 마리 종합점수 */
function scoreOf(h: PredRow, weights: Weights): number {
  let s = 0;
  const items = h.item_scores ?? {};
  for (const id of Object.keys(items)) s += (items[id]?.rawScore ?? 0) * (weights[id] ?? 0);
  return s;
}

/** 종합점수 내림차순 정렬 (모델 순위) */
function rankByScore(horses: PredRow[], weights: Weights): PredRow[] {
  return [...horses].sort((a, b) => scoreOf(b, weights) - scoreOf(a, weights));
}

/** win_odds 오름차순 정렬 (시장 인기 순위, 유효 배당만) */
function rankByOdds(horses: PredRow[]): PredRow[] {
  return horses
    .filter((h) => h.win_odds != null && h.win_odds > 0)
    .sort((a, b) => (a.win_odds as number) - (b.win_odds as number));
}

/** 한 경주에서 가중치로 1순위 예측마 (동일성 비교 위해 행 전체 반환) */
function topPick(horses: PredRow[], weights: Weights): PredRow | null {
  return rankByScore(horses, weights)[0] ?? null;
}

/** 한 경주에서 시장 인기 1위마 (win_odds 최저). 유효 배당 없으면 null */
function favoritePick(horses: PredRow[]): PredRow | null {
  return rankByOdds(horses)[0] ?? null;
}

const isShow = (ord: number | null | undefined) => ord != null && ord >= 1 && ord <= 3;

interface Tally { win: number; place: number; show: number; n: number; }
const emptyTally = (): Tally => ({ win: 0, place: 0, show: 0, n: 0 });
function addRace(t: Tally, ord: number | null) {
  if (ord === null || ord > 50) return;
  t.n++;
  if (ord === 1) t.win++;
  if (ord <= 2) t.place++;
  if (ord <= 3) t.show++;
}
const pct = (a: number, n: number) => (n ? ((a / n) * 100).toFixed(1) : '-');

async function fetchVersion(
  sb: SupabaseClient,
  by: { id?: number; label?: string; active?: boolean }
): Promise<{ id: number; label: string; weights: Weights } | null> {
  let q = sb.from('model_versions').select('id, label, weights');
  if (by.id !== undefined) q = q.eq('id', by.id);
  else if (by.label !== undefined) q = q.eq('label', by.label);
  else q = q.eq('is_active', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id as number, label: data.label as string, weights: data.weights as Weights };
}

/** 결과 있는 테스트 예측 전부 (2025-Q1~) */
async function fetchTestPredictions(sb: SupabaseClient): Promise<PredRow[]> {
  const rows: PredRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('predictions')
      .select('race_date, meet, rc_no, hr_name, item_scores, actual_ord')
      .gte('race_date', qStart(FIRST_TEST.year, FIRST_TEST.q))
      .not('actual_ord', 'is', null)
      .order('race_date').order('meet').order('rc_no').order('hr_name') // 페이지 경계 누락/중복 방지
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as PredRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

/** 테스트 구간 race_entries의 win_odds → key=`date-meet-rc-hr_name` 맵 (시장 벤치마크용) */
async function fetchWinOddsMap(sb: SupabaseClient): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('race_entries')
      .select('race_date, meet, rc_no, hr_name, win_odds')
      .gte('race_date', qStart(FIRST_TEST.year, FIRST_TEST.q))
      .not('ord', 'is', null)
      .order('race_date').order('meet').order('rc_no').order('hr_name') // 페이지 경계 누락/중복 방지
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number; hr_name: string; win_odds: number | null }[]) {
      if (r.win_odds == null) continue;
      map.set(`${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`, r.win_odds);
    }
    if (data.length < PAGE) break;
  }
  return map;
}

async function main() {
  const args = process.argv.slice(2);
  const candIdx = args.indexOf('--candidate');
  const candidateId = candIdx >= 0 ? Number(args[candIdx + 1]) : null;
  const champIdx = args.indexOf('--champion');
  const championId = champIdx >= 0 ? Number(args[champIdx + 1]) : null;

  const sb = getSupabaseAdmin();

  const champion = await fetchVersion(sb, championId !== null ? { id: championId } : { active: true });
  if (!champion) throw new Error('챔피언 버전을 찾을 수 없음 (활성 버전 또는 --champion id 확인)');
  const v1 = await fetchVersion(sb, { label: 'v1' }); // 추세 기준선
  const fixedCandidate = candidateId !== null ? await fetchVersion(sb, { id: candidateId }) : null;
  if (candidateId !== null && !fixedCandidate) throw new Error(`model_versions id=${candidateId} 없음`);

  const testRows = await fetchTestPredictions(sb);
  // 시장 벤치마크: race_entries.win_odds를 hr_name으로 조인
  const oddsMap = await fetchWinOddsMap(sb);
  for (const r of testRows) {
    r.win_odds = oddsMap.get(`${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`) ?? null;
  }
  // 분기 → 경주 → 출전마
  const byQuarter = new Map<string, Map<string, PredRow[]>>();
  for (const r of testRows) {
    const { year, q } = quarterOf(r.race_date);
    const qk = qKey(year, q);
    if (!byQuarter.has(qk)) byQuarter.set(qk, new Map());
    const rk = `${r.race_date}-${r.meet}-${r.rc_no}`;
    const m = byQuarter.get(qk)!;
    if (!m.has(rk)) m.set(rk, []);
    m.get(rk)!.push(r);
  }
  const quarters = [...byQuarter.keys()].sort();

  console.log(
    `\n📊 Walk-forward 검증 — 챔피언=${champion.label}` +
      `${fixedCandidate ? `, 후보=${fixedCandidate.label}(고정)` : ', 후보=ρ재학습(블록별)'}`
  );
  console.log('='.repeat(76));
  // 단일마 1순위 픽 기준: 연승=3착 내(ord≤3), 단승=1착(ord==1), 2착내=ord≤2(참고, 단일마 베팅명 없음)
  console.log('블록      | 연승 챔/후       | 단승 챔/후       | 2착내 챔/후      | 경주');
  console.log('-'.repeat(76));

  const cumChamp = emptyTally();
  const cumCand = emptyTally();
  const cumV1 = emptyTally();
  const cumMkt = emptyTally(); // 시장(인기1위)
  // 불일치 구간(챔피언 1순위 ≠ 인기1위)에서 챔피언픽 vs 인기픽
  const disModel = emptyTally();
  const disFav = emptyTally();
  // ① 순위별 연승: 모델/시장의 1·2·3순위 픽이 실제 top3(3착 내)에 든 횟수 (챔피언 기준)
  const rankModel = [0, 0, 0].map(() => ({ hit: 0, n: 0 }));
  const rankMkt = [0, 0, 0].map(() => ({ hit: 0, n: 0 }));
  // ② 상위3 묶음 교집합: 모델/시장 상위3마리가 실제 top3를 몇 마리 잡나 (합산 / 경주수)
  let setModelSum = 0;
  let setMktSum = 0;
  let setN = 0;

  for (const qk of quarters) {
    const [yStr, qStr] = qk.split('-Q');
    const blockStart = qStart(Number(yStr), Number(qStr));

    let candWeights: Weights;
    if (fixedCandidate) {
      candWeights = fixedCandidate.weights;
    } else {
      // 경우 A: 블록 이전 데이터로만 ρ 학습 (확장형: 2024-01-01 ~ blockStart-1)
      const { correlations } = await computeCorrelations(sb, 20240101, blockStart - 1);
      candWeights = computeOptimalWeights(correlations) as Weights;
    }

    const cT = emptyTally(); // champion
    const xT = emptyTally(); // candidate
    const vT = emptyTally(); // v1
    const mT = emptyTally(); // 시장(인기1위)
    for (const horses of byQuarter.get(qk)!.values()) {
      const champOrder = rankByScore(horses, champion.weights);
      const mktOrder = rankByOdds(horses);
      const champPick = champOrder[0] ?? null;
      const favPick = mktOrder[0] ?? null;
      addRace(cT, champPick?.actual_ord ?? null);
      addRace(xT, topPick(horses, candWeights)?.actual_ord ?? null);
      if (v1) addRace(vT, topPick(horses, v1.weights)?.actual_ord ?? null);
      addRace(mT, favPick?.actual_ord ?? null);
      // 챔피언과 시장이 엇갈린 경주에서만 두 픽의 적중 누적
      if (champPick && favPick && champPick.hr_name !== favPick.hr_name) {
        addRace(disModel, champPick.actual_ord);
        addRace(disFav, favPick.actual_ord);
      }
      // ① 순위별 연승 (1·2·3순위 픽이 실제 top3=3착 내에 들었나)
      for (let k = 0; k < 3; k++) {
        const mh = champOrder[k];
        if (mh) { rankModel[k].n++; if (isShow(mh.actual_ord)) rankModel[k].hit++; }
        const fh = mktOrder[k];
        if (fh) { rankMkt[k].n++; if (isShow(fh.actual_ord)) rankMkt[k].hit++; }
      }
      // ② 상위3 묶음 교집합 (실제 top3 명단을 상위3 픽이 몇 마리 잡나)
      const actualTop3 = new Set(horses.filter((h) => isShow(h.actual_ord)).map((h) => h.hr_name));
      if (actualTop3.size > 0) {
        setN++;
        setModelSum += champOrder.slice(0, 3).filter((h) => actualTop3.has(h.hr_name)).length;
        setMktSum += mktOrder.slice(0, 3).filter((h) => actualTop3.has(h.hr_name)).length;
      }
    }
    (['win', 'place', 'show', 'n'] as const).forEach((k) => {
      cumChamp[k] += cT[k];
      cumCand[k] += xT[k];
      cumV1[k] += vT[k];
      cumMkt[k] += mT[k];
    });

    console.log(
      `${qk.padEnd(9)} | ${pct(cT.show, cT.n).padStart(5)} / ${pct(xT.show, xT.n).padStart(5)} | ` +
        `${pct(cT.win, cT.n).padStart(5)} / ${pct(xT.win, xT.n).padStart(5)} | ` +
        `${pct(cT.place, cT.n).padStart(5)} / ${pct(xT.place, xT.n).padStart(5)} | ${cT.n}`
    );
  }

  console.log('-'.repeat(76));
  console.log(
    `누적      | ${pct(cumChamp.show, cumChamp.n).padStart(5)} / ${pct(cumCand.show, cumCand.n).padStart(5)} | ` +
      `${pct(cumChamp.win, cumChamp.n).padStart(5)} / ${pct(cumCand.win, cumCand.n).padStart(5)} | ` +
      `${pct(cumChamp.place, cumChamp.n).padStart(5)} / ${pct(cumCand.place, cumCand.n).padStart(5)} | ${cumChamp.n}`
  );
  if (v1 && v1.id !== champion.id) {
    console.log(
      `(v1 추세) 연승 ${pct(cumV1.show, cumV1.n)} / 단승 ${pct(cumV1.win, cumV1.n)} / 2착내 ${pct(cumV1.place, cumV1.n)}`
    );
  }

  // ① 시장 벤치마크 (인기1위 = win_odds 최저) — 같은 경주 집합, 상시 잣대
  console.log('-'.repeat(76));
  console.log(
    `[시장] 인기1위 — 연승 ${pct(cumMkt.show, cumMkt.n)} / 단승 ${pct(cumMkt.win, cumMkt.n)} / 2착내 ${pct(cumMkt.place, cumMkt.n)}  (n=${cumMkt.n})`
  );
  if (cumChamp.n > 0 && cumMkt.n > 0) {
    const d = ((cumChamp.show / cumChamp.n) - (cumMkt.show / cumMkt.n)) * 100;
    console.log(`  → 챔피언 연승 − 시장 연승 = ${d >= 0 ? '+' : ''}${d.toFixed(1)}%p  ${d >= 0 ? '(시장 우위)' : '(시장에 뒤짐)'}`);
  }

  // ② 불일치 구간 — "군중과 다르게 갈 때 맞히나"
  console.log('-'.repeat(76));
  console.log(`[불일치] 챔피언 1순위 ≠ 인기1위인 경주: ${disModel.n}건 (전체 ${cumChamp.n}건 중 ${pct(disModel.n, cumChamp.n)}%)`);
  if (disModel.n > 0) {
    console.log(`  챔피언픽  연승 ${pct(disModel.show, disModel.n)} / 단승 ${pct(disModel.win, disModel.n)} / 2착내 ${pct(disModel.place, disModel.n)}`);
    console.log(`  인기픽    연승 ${pct(disFav.show, disFav.n)} / 단승 ${pct(disFav.win, disFav.n)} / 2착내 ${pct(disFav.place, disFav.n)}`);
    const edge = ((disModel.show / disModel.n) - (disFav.show / disFav.n)) * 100;
    console.log(`  → 엇갈릴 때 연승 우위: ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%p  ${edge >= 0 ? '(모델이 시장보다 나음 = 부가가치 O)' : '(모델이 시장보다 못함 = 부가가치 X)'}`);
  }

  // ① 순위별 연승 — 1·2·3순위 픽이 실제 top3(3착 내)에 들 확률 (챔피언 기준)
  console.log('-'.repeat(76));
  console.log('[순위별 연승] 1·2·3순위 픽이 실제 3등 안에 든 비율 (챔피언 기준)');
  console.log(`         | 1순위  | 2순위  | 3순위`);
  console.log(`  모델   | ${pct(rankModel[0].hit, rankModel[0].n).padStart(5)} | ${pct(rankModel[1].hit, rankModel[1].n).padStart(5)} | ${pct(rankModel[2].hit, rankModel[2].n).padStart(5)}`);
  console.log(`  시장   | ${pct(rankMkt[0].hit, rankMkt[0].n).padStart(5)} | ${pct(rankMkt[1].hit, rankMkt[1].n).padStart(5)} | ${pct(rankMkt[2].hit, rankMkt[2].n).padStart(5)}`);

  // ② 상위3 묶음 교집합 — 삼복승/복연승 추천이 시장보다 나은가
  console.log('-'.repeat(76));
  console.log('[상위3 묶음] 상위 3마리가 실제 top3를 평균 몇 마리 잡나 (0~3, 높을수록 좋음)');
  if (setN > 0) {
    const m = setModelSum / setN;
    const f = setMktSum / setN;
    console.log(`  모델 ${m.toFixed(2)}마리  /  시장 ${f.toFixed(2)}마리  (n=${setN})`);
    const d = m - f;
    console.log(`  → 묶음 우위: ${d >= 0 ? '+' : ''}${d.toFixed(2)}마리  ${d >= 0 ? '(모델이 시장보다 잘 잡음)' : '(시장이 더 잘 잡음)'}`);
  }

  // 노이즈 경고 (연승=ord≤3 기준, 대략 95% 신뢰구간)
  if (cumCand.n > 0 && cumChamp.n > 0) {
    const diff = ((cumCand.show / cumCand.n) - (cumChamp.show / cumChamp.n)) * 100;
    const p = cumChamp.show / cumChamp.n;
    const se = Math.sqrt((p * (1 - p)) / cumCand.n) * 100 * 1.96;
    console.log(`\n연승 차이(후보-챔피언): ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p  |  대략 95% 표본오차 ±${se.toFixed(1)}%p`);
    console.log(
      Math.abs(diff) > se
        ? '→ 오차 범위 밖: 유의미할 수 있음 (그래도 사람이 최종 판단)'
        : '→ 오차 범위 안: 노이즈일 수 있음 (신중히)'
    );
  }
  console.log('\n승격하려면(사람 판단 후): npm run promote -- --version <id>\n');
}

main().catch((e) => {
  console.error('💥', e);
  process.exit(1);
});
