/**
 * Stage 2 Phase 2A — 복연승 value 백테스트 (읽기전용).
 * 3 선정규칙(R1/R2/R3) × 복연승 배당으로 ROI(규칙·분기). 게이트는 사람 판단.
 * 사용: npm run backtest:combo -- --split 20250101 --div data/combo_dividends.jsonl
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { topTercileCutoffs, placePaid, roi, type Bet } from '../src/engine/analysis/valueBacktest.js';
import {
  selectTop2, selectValuePairs, selectTercilePairs, settlePair, pairKey, type ComboHorse,
} from '../src/engine/analysis/comboBacktest.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number | null; win_odds: number | null; top3: number; features: Feature[]; }
const MID = ['4-7', '7-15'];
const quarter = (d: number) => `${Math.floor(d / 10000)}-Q${Math.floor((Math.floor((d % 10000) / 100) - 1) / 3) + 1}`;
const load = (p: string): Row[] => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

interface QBet extends Bet { quarter: string }

async function main() {
  const args = process.argv.slice(2);
  const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1]! : d; };
  const matrixPath = arg('--matrix', 'data/training_matrix.jsonl');
  const divPath = arg('--div', 'data/combo_dividends.jsonl');
  const split = Number(arg('--split', '20250101'));

  const all = load(matrixPath);
  const train = all.filter((r) => r.race_date < split);
  const test = all.filter((r) => r.race_date >= split);

  const schema = buildSchema(train.map((r) => r.features));
  const model = fitLogistic(train.map((r) => toVector(r.features, schema)), train.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });
  const trainScored = train.filter((r) => r.win_odds && r.win_odds > 0)
    .map((r) => ({ odds: r.win_odds as number, score: predictLogit(model, toVector(r.features, schema)) }));
  const cutoffs = topTercileCutoffs(trainScored);

  const divLines = load(divPath) as unknown as { race_date: number; meet: number; rc_no: number; a: number; b: number; odds: number }[];
  const comboOdds = new Map<string, Map<string, number>>();
  for (const d of divLines) {
    const rk = `${d.race_date}-${d.meet}-${d.rc_no}`;
    if (!comboOdds.has(rk)) comboOdds.set(rk, new Map());
    comboOdds.get(rk)!.set(pairKey(d.a, d.b), d.odds);
  }

  const sb = getSupabaseAdmin();
  const pthrMap = new Map<string, number>();
  const fieldSize = new Map<string, number>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_no, hr_name, pthr_no, plc_odds')
      .gte('race_date', split).order('race_date').order('meet').order('rc_no').range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number; hr_name: string; pthr_no: number; plc_odds: number | null }[]) {
      const rk = `${r.race_date}-${r.meet}-${r.rc_no}`;
      pthrMap.set(`${rk}-${r.hr_name}`, r.pthr_no);
      if (r.plc_odds != null) fieldSize.set(rk, (fieldSize.get(rk) ?? 0) + 1);
    }
    if (data.length < PAGE) break;
  }

  const byRace = new Map<string, Row[]>();
  for (const r of test) { const k = `${r.race_date}-${r.meet}-${r.rc_no}`; if (!byRace.has(k)) byRace.set(k, []); byRace.get(k)!.push(r); }

  const bets: Record<string, QBet[]> = { R1: [], R2: [], R3: [], BASE: [] };
  let skipped = 0;
  for (const [rk, rows] of byRace) {
    const fs = fieldSize.get(rk) ?? 0;
    if (fs < 5) { skipped++; continue; }
    const odds = comboOdds.get(rk);
    if (!odds || odds.size === 0) { skipped++; continue; }
    const q = quarter(rows[0]!.race_date);
    const placedByChulNo = new Map<number, boolean>();
    const horses: ComboHorse[] = [];
    for (const r of rows) {
      if (r.ord == null || !(r.win_odds && r.win_odds > 0)) continue;
      const chulNo = pthrMap.get(`${rk}-${r.hr_name}`);
      if (chulNo == null) continue;
      const score = predictLogit(model, toVector(r.features, schema));
      horses.push({ chulNo, score, winOdds: r.win_odds });
      placedByChulNo.set(chulNo, placePaid(r.ord, fs));
    }
    const push = (rule: string, pairs: Array<[number, number]>) => {
      for (const p of pairs) bets[rule]!.push({ band: rule, plcOdds: settlePair(p, placedByChulNo, odds), quarter: q });
    };
    push('R1', selectTop2(horses));
    push('R2', selectValuePairs(horses, cutoffs, MID));
    push('R3', selectTercilePairs(horses, cutoffs, MID));
    const basePairs: Array<[number, number]> = [];
    for (let i = 0; i < horses.length; i++) for (let j = i + 1; j < horses.length; j++) basePairs.push([horses[i]!.chulNo, horses[j]!.chulNo]);
    push('BASE', basePairs);
  }

  console.log(`\n테스트 경주 ${byRace.size} / 제외(소두수·배당결측) ${skipped} / 배당경주 ${comboOdds.size}`);
  console.log('\n규칙        | 베팅수 | 적중 | 적중율 | 평균배당 | ROI');
  console.log('-'.repeat(62));
  const quarters = [...new Set(test.map((r) => quarter(r.race_date)))].sort();
  const label: Record<string, string> = { R1: 'R1 상위2픽', R2: 'R2 중배당가치', R3: 'R3 터셀페어', BASE: '베이스라인' };
  for (const rule of ['R1', 'R2', 'R3', 'BASE']) {
    const b = bets[rule]!;
    const hits = b.filter((x) => x.plcOdds != null);
    const avg = hits.length ? hits.reduce((s, x) => s + (x.plcOdds as number), 0) / hits.length : 0;
    const rp = roi(b) * 100;
    console.log(`${label[rule]!.padEnd(13)}| ${String(b.length).padStart(6)} | ${String(hits.length).padStart(4)} | ${(b.length ? hits.length / b.length * 100 : 0).toFixed(0).padStart(5)}% | ${avg.toFixed(1).padStart(7)} | ${rp >= 0 ? '+' : ''}${rp.toFixed(1)}%`);
  }
  console.log('\n========== 규칙별 분기 ROI ==========');
  console.log('규칙          | ' + quarters.map((q) => q.padStart(10)).join(' | '));
  for (const rule of ['R1', 'R2', 'R3']) {
    const cells = quarters.map((q) => {
      const sub = bets[rule]!.filter((x) => x.quarter === q);
      if (sub.length === 0) return '    -     ';
      return `${(roi(sub) * 100 >= 0 ? '+' : '')}${(roi(sub) * 100).toFixed(0)}%(${sub.length})`.padStart(10);
    });
    console.log(`${label[rule]!.padEnd(13)} | ${cells.join(' | ')}`);
  }
  console.log('\n판정(사람): 어떤 규칙이 ROI>0 + 다분기 일관 + 베팅수 충분이면 → Phase 2B(라이브 추천 UI).');
  console.log('정직성: 배당은 사후 확정 final → ROI 낙관적 상한. 3규칙 사전고정·분기 일관성으로 판정(단일분기=노이즈).');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
