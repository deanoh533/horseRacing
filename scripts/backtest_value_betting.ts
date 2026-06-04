/**
 * Stage 2 Phase 1 — value 베팅 백테스트 (읽기전용).
 * 중배당 × 모델 상위터셀(train 컷오프)에 연승 베팅 → plc_odds로 정산 → 구간별/분기별 ROI.
 * 스펙: docs/superpowers/specs/2026-06-04-stage2-phase1-value-betting-design.md
 * 사용: npm run backtest:value -- --matrix data/training_matrix.jsonl --split 20250101
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { oddsBand } from '../src/engine/analysis/edgeProbe.js';
import { topTercileCutoffs, isBet, summarize, roi, type Bet } from '../src/engine/analysis/valueBacktest.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number | null; win_odds: number | null; top3: number; features: Feature[]; }
const TARGET = ['4-7', '7-15']; // 주 타깃 중배당 (출력은 전 구간)
const quarter = (d: number) => `${Math.floor(d / 10000)}-Q${Math.floor((Math.floor((d % 10000) / 100) - 1) / 3) + 1}`;

function load(path: string): Row[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function printSummary(title: string, rows: ReturnType<typeof summarize>) {
  console.log(`\n### ${title}`);
  console.log('배당구간 | 베팅수 | 적중 | 적중율 | 평균배당 | ROI');
  console.log('-'.repeat(58));
  for (const r of rows) {
    const roiPct = (r.roi * 100);
    console.log(
      `${r.band.padEnd(8)} | ${String(r.nBets).padStart(6)} | ${String(r.nHits).padStart(4)} | ` +
      `${(r.hitRate * 100).toFixed(0).padStart(5)}% | ${r.avgOdds.toFixed(2).padStart(7)} | ` +
      `${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}%`
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const split = Number(arg('--split', '20250101'));

  const all = load(matrixPath);
  const train = all.filter((r) => r.race_date < split);
  const test = all.filter((r) => r.race_date >= split);

  // 1) Stage-1 로지스틱 학습 (Phase 0과 동일 하이퍼파라미터)
  const schema = buildSchema(train.map((r) => r.features));
  const model = fitLogistic(
    train.map((r) => toVector(r.features, schema)),
    train.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 },
  );

  // 2) train 점수로 배당구간 상위터셀 컷오프 (look-ahead 회피)
  const trainScored = train
    .filter((r) => r.win_odds && r.win_odds > 0)
    .map((r) => ({ odds: r.win_odds as number, score: predictLogit(model, toVector(r.features, schema)) }));
  const cutoffs = topTercileCutoffs(trainScored);
  console.log('배당구간 컷오프(train 상위1/3 logit):',
    Object.fromEntries(Object.entries(cutoffs).map(([k, v]) => [k, v.toFixed(3)])));

  // 3) plc_odds 조인 맵: (race_date,meet,rc_no,hr_name) → plc_odds (입상마만 non-null)
  const sb = getSupabaseAdmin();
  const plcMap = new Map<string, number | null>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_no, hr_name, plc_odds')
      .gte('race_date', split)
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number; hr_name: string; plc_odds: number | null }[]) {
      plcMap.set(`${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`, r.plc_odds);
    }
    if (data.length < PAGE) break;
  }

  // 4) test 말별 베팅 선정·정산
  interface QBet extends Bet { quarter: string }
  const bets: QBet[] = [];      // 전략: 컷오프 통과(상위터셀)
  const baseline: QBet[] = [];  // 베이스라인: 같은 구간 전 마필 무조건 베팅
  for (const r of test) {
    if (!(r.win_odds && r.win_odds > 0)) continue;
    if (oddsBand(r.win_odds) === 'na') continue;
    const score = predictLogit(model, toVector(r.features, schema));
    const plc = plcMap.get(`${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`) ?? null;
    const band = oddsBand(r.win_odds);
    const q = quarter(r.race_date);
    baseline.push({ band, plcOdds: plc, quarter: q });
    if (isBet(r.win_odds, score, cutoffs)) bets.push({ band, plcOdds: plc, quarter: q });
  }

  console.log(`\n테스트 ${test.length}행 / 유효배당 베팅후보 ${baseline.length} / 전략 베팅 ${bets.length}`);

  printSummary('전략: 중배당 × 모델 상위터셀 (구간별 ROI)', summarize(bets));
  printSummary('베이스라인: 구간 전 마필 무조건 연승 (시장 takeout 손실 기준선)', summarize(baseline));

  // 5) 주 타깃 구간 분기별 일관성
  console.log('\n========== 주 타깃(4-15) 분기별 ROI ==========');
  const quarters = [...new Set(bets.map((b) => b.quarter))].sort();
  console.log('구간    | ' + quarters.map((q) => q.padStart(9)).join(' | '));
  for (const band of TARGET) {
    const cells = quarters.map((q) => {
      const sub = bets.filter((b) => b.band === band && b.quarter === q);
      if (sub.length === 0) return '   -    ';
      const rp = roi(sub) * 100;
      return `${rp >= 0 ? '+' : ''}${rp.toFixed(0)}%(${sub.length})`.padStart(9);
    });
    console.log(`${band.padEnd(7)} | ${cells.join(' | ')}`);
  }

  console.log('\n판정: 주 타깃 구간이 ROI>0 + 다분기 일관(≈5/6↑ 양수) + 베팅수 충분이면 → Phase 2(calibration+Kelly).');
  console.log('정직성: plc_odds·win_odds는 사후 확정값 → ROI는 낙관적 상한. 단일분기 큰 ROI=노이즈.');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
