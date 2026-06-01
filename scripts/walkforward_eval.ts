/**
 * Walk-forward 검증 (Stage B) — 읽기 전용 (DB 절대 수정 안 함)
 *
 * 확장형 윈도우 + 달력 분기 홀드아웃으로 "후보 가중치가 챔피언(현재 라이브)보다
 * 나은가"를 후보가 안 본 구간에서 채점한다.
 *
 * 블록: 2024 = 부트스트랩(학습 전용, 테스트 안 함), 2025-Q1부터 분기별 테스트.
 * 지표: 1순위 예측마의 단/연/복 (apply_learned_weights와 동일 정의, 복승 우선).
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
  item_scores: Record<string, { rawScore?: number }> | null;
  actual_ord: number | null;
}

function quarterOf(raceDate: number) {
  const y = Math.floor(raceDate / 10000);
  const m = Math.floor((raceDate % 10000) / 100);
  return { year: y, q: Math.floor((m - 1) / 3) + 1 };
}
const qKey = (y: number, q: number) => `${y}-Q${q}`;
const qStart = (y: number, q: number) => y * 10000 + ((q - 1) * 3 + 1) * 100 + 1;

/** 한 경주에서 가중치로 1순위 예측마의 실제 착순 */
function topPickOrd(horses: PredRow[], weights: Weights): number | null {
  let best: PredRow | null = null;
  let bestScore = -Infinity;
  for (const h of horses) {
    let s = 0;
    const items = h.item_scores ?? {};
    for (const id of Object.keys(items)) s += (items[id]?.rawScore ?? 0) * (weights[id] ?? 0);
    if (s > bestScore) {
      bestScore = s;
      best = h;
    }
  }
  return best?.actual_ord ?? null;
}

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
      .select('race_date, meet, rc_no, item_scores, actual_ord')
      .gte('race_date', qStart(FIRST_TEST.year, FIRST_TEST.q))
      .not('actual_ord', 'is', null)
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as PredRow[]));
    if (data.length < PAGE) break;
  }
  return rows;
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
  console.log('블록      | 복승 챔/후       | 단승 챔/후       | 연승 챔/후       | 경주');
  console.log('-'.repeat(76));

  const cumChamp = emptyTally();
  const cumCand = emptyTally();
  const cumV1 = emptyTally();

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
    for (const horses of byQuarter.get(qk)!.values()) {
      addRace(cT, topPickOrd(horses, champion.weights));
      addRace(xT, topPickOrd(horses, candWeights));
      if (v1) addRace(vT, topPickOrd(horses, v1.weights));
    }
    (['win', 'place', 'show', 'n'] as const).forEach((k) => {
      cumChamp[k] += cT[k];
      cumCand[k] += xT[k];
      cumV1[k] += vT[k];
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
      `(v1 추세) 복승 ${pct(cumV1.show, cumV1.n)} / 단승 ${pct(cumV1.win, cumV1.n)} / 연승 ${pct(cumV1.place, cumV1.n)}`
    );
  }

  // 노이즈 경고 (복승 기준, 대략 95% 신뢰구간)
  if (cumCand.n > 0 && cumChamp.n > 0) {
    const diff = ((cumCand.show / cumCand.n) - (cumChamp.show / cumChamp.n)) * 100;
    const p = cumChamp.show / cumChamp.n;
    const se = Math.sqrt((p * (1 - p)) / cumCand.n) * 100 * 1.96;
    console.log(`\n복승 차이(후보-챔피언): ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%p  |  대략 95% 표본오차 ±${se.toFixed(1)}%p`);
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
