/**
 * 가중치 grid search (dry-run, 메모리 계산)
 *
 * DB의 predictions에서 item_scores.rawScore 를 가져와서,
 * 다양한 가중치 시나리오로 total_score 재계산 → 적중률만 측정.
 * DB 변경 없음. 매우 빠름 (~30초).
 *
 * 시나리오:
 *   PRD              : PRD 기본 가중치 (cheating ON)
 *   PRD + 봉인       : PRD - stOrd 0 (cheating OFF)
 *   학습 blend 0.1   : 점진적 학습 (90% PRD + 10% Spearman)
 *   학습 blend 0.3   :
 *   학습 blend 0.5   : 기존 방식 (50:50)
 *   학습 blend 1.0   : 완전 학습 가중치 (PRD 무시)
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  computeCorrelations,
  computeOptimalWeights,
  type Weights,
} from '../src/engine/weightLearner.js';
import { ITEM_WEIGHTS, type ScoreItemId } from '../src/types/index.js';

const SEALED: ScoreItemId = '12_starting_position';
const ITEMS = Object.keys(ITEM_WEIGHTS) as ScoreItemId[];

function normalizeSealed(w: Weights): Weights {
  const out = { ...w };
  out[SEALED] = 0;
  const sum = ITEMS.reduce((s, k) => s + out[k], 0);
  if (sum === 0) return out;
  for (const k of ITEMS) {
    if (k === SEALED) continue;
    out[k] = Math.round((out[k] / sum) * 10000) / 100;
  }
  return out;
}

function blend(a: Weights, b: Weights, alpha: number): Weights {
  const out = {} as Weights;
  for (const k of ITEMS) out[k] = a[k] * (1 - alpha) + b[k] * alpha;
  return out;
}

async function fetchAll(sb: any) {
  const all: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data } = await sb
      .from('predictions')
      .select('race_date, meet, rc_no, hr_name, item_scores, actual_ord')
      .order('race_date')
      .order('meet')
      .order('rc_no')
      .order('hr_name')
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

function measure(rows: any[], weights: Weights) {
  // rebuild per race
  const byRace = new Map<string, any[]>();
  for (const r of rows) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(r);
  }
  let win = 0, place = 0, show = 0, valid = 0;
  for (const horses of byRace.values()) {
    const withTotal = horses.map((h) => {
      let total = 0;
      for (const k of ITEMS) {
        const raw = h.item_scores?.[k]?.rawScore ?? 0;
        total += raw * weights[k];
      }
      return { hr_name: h.hr_name, actual_ord: h.actual_ord, total };
    });
    const sorted = [...withTotal].sort((a, b) => b.total - a.total);
    const pred1 = sorted[0];
    if (!pred1) continue;
    if (!withTotal.some((h) => h.actual_ord !== null)) continue;
    valid++;
    if (pred1.actual_ord === 1) win++;
    if (pred1.actual_ord !== null && pred1.actual_ord <= 2) place++;
    if (pred1.actual_ord !== null && pred1.actual_ord <= 3) show++;
  }
  const pct = (n: number) => ((n / valid) * 100).toFixed(1);
  return { win, place, show, valid, single: pct(win), pair: pct(place), triple: pct(show) };
}

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  console.log('데이터 로드...');
  const rows = await fetchAll(sb);
  console.log(`  ${rows.length} rows`);

  console.log('\nSpearman 계산...');
  const { correlations, raceCount } = await computeCorrelations(sb, 20240101, 20991231);
  console.log(`  학습 경주: ${raceCount}`);

  const prdRaw = { ...ITEM_WEIGHTS } as Weights;
  const prdSealed = normalizeSealed(prdRaw);
  const optimal = computeOptimalWeights(correlations); // 이미 SEALED 0 처리됨

  const scenarios = [
    ['PRD (cheating ON)', prdRaw],
    ['PRD + 봉인', prdSealed],
    ['blend 0.1', blend(prdSealed, optimal, 0.1)],
    ['blend 0.3', blend(prdSealed, optimal, 0.3)],
    ['blend 0.5 (기존)', blend(prdSealed, optimal, 0.5)],
    ['blend 1.0 (완전 학습)', optimal],
  ] as const;

  console.log('\n시나리오 비교');
  console.log('시나리오                  단승    연승    복승   유효');
  console.log('-'.repeat(60));
  for (const [name, w] of scenarios) {
    const r = measure(rows, w);
    console.log(
      `${name.padEnd(24)}  ${r.single.padStart(5)}%  ${r.pair.padStart(5)}%  ${r.triple.padStart(5)}%   ${r.valid}`
    );
  }

  // 상관계수 출력
  console.log('\n항목별 ρ (참고):');
  const sorted = [...ITEMS].sort((a, b) => correlations[b] - correlations[a]);
  for (const id of sorted) {
    console.log(`  ${id.padEnd(28)}  ρ=${correlations[id].toFixed(3)}  최적가중치=${optimal[id].toFixed(2)}`);
  }
}
main();
