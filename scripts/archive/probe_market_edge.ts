/**
 * Stage 2 Phase 0 — 시장 엣지 탐색 probe (읽기전용).
 * 같은 배당 구간 안에서 모델 점수 터셀이 실제 top3율을 가르나를 4슬라이스×분기로 본다.
 * 스펙: docs/superpowers/specs/2026-06-04-stage2-market-edge-probe-design.md
 * 사용: npm run probe:edge -- --matrix data/training_matrix.jsonl --split 20250101
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { fitLogistic, predictLogit } from '../src/engine/models/logistic.js';
import { buildSchema, toVector } from '../src/engine/features/alignFeatures.js';
import { conditionalEdge, oddsBand, type BandEdge } from '../src/engine/analysis/edgeProbe.js';
import type { Feature } from '../src/engine/features/types.js';

interface Row { race_date: number; meet: number; rc_no: number; hr_name: string; ord: number | null; win_odds: number | null; top3: number; features: Feature[]; }
interface Rec { odds: number; score: number; top3: number; fieldSize: number; rcDist: number; meet: number; track: string; quarter: string; confTier: number; }

const quarter = (d: number) => `${Math.floor(d / 10000)}-Q${Math.floor((Math.floor((d % 10000) / 100) - 1) / 3) + 1}`;

function load(path: string): Row[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function printEdge(title: string, edges: BandEdge[]) {
  console.log(`\n### ${title}`);
  console.log('배당구간 |    n | top3율 하/중/상        | 스프레드');
  console.log('-'.repeat(60));
  for (const e of edges) {
    const f = (c: { rate: number }) => (c.rate * 100).toFixed(0).padStart(3);
    const sp = (e.spread * 100);
    console.log(`${e.band.padEnd(8)} | ${String(e.n).padStart(4)} | ${f(e.lo)} / ${f(e.mid)} / ${f(e.hi)}            | ${sp >= 0 ? '+' : ''}${sp.toFixed(1)}%p`);
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

  const schema = buildSchema(train.map((r) => r.features));
  const model = fitLogistic(train.map((r) => toVector(r.features, schema)), train.map((r) => r.top3), schema, { l2: 0.02, iters: 800, lr: 0.2 });

  const sb = getSupabaseAdmin();
  const raceMeta = new Map<string, { rcDist: number; track: string }>();
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('races')
      .select('race_date, meet, rc_no, rc_dist, track_type')
      .gte('race_date', split)
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as { race_date: number; meet: number; rc_no: number; rc_dist: number | null; track_type: string | null }[]) {
      raceMeta.set(`${r.race_date}-${r.meet}-${r.rc_no}`, { rcDist: r.rc_dist ?? 0, track: r.track_type ?? '?' });
    }
    if (data.length < PAGE) break;
  }

  const byRace = new Map<string, Row[]>();
  for (const r of test) { const k = `${r.race_date}-${r.meet}-${r.rc_no}`; if (!byRace.has(k)) byRace.set(k, []); byRace.get(k)!.push(r); }

  const recs: Rec[] = [];
  for (const [k, horses] of byRace) {
    const scored = horses.map((h) => ({ h, s: predictLogit(model, toVector(h.features, schema)) }));
    const sortedDesc = [...scored].sort((a, b) => b.s - a.s);
    const top1 = sortedDesc[0]?.s ?? 0;
    const top2 = sortedDesc[1]?.s ?? top1;
    const gap = top1 - top2;
    const meta = raceMeta.get(k) ?? { rcDist: 0, track: '?' };
    for (const { h, s } of scored) {
      if (h.ord == null || h.ord > 50 || !(h.win_odds && h.win_odds > 0)) continue;
      recs.push({ odds: h.win_odds, score: s, top3: h.top3, fieldSize: horses.length, rcDist: meta.rcDist, meet: h.meet, track: meta.track, quarter: quarter(h.race_date), confTier: gap });
    }
  }

  console.log(`\n총 테스트 horse(유효배당): ${recs.length}  /  학습 ${train.length}행, 피처 ${schema.length}`);

  printEdge('[전체] 배당구간 × 모델터셀', conditionalEdge(recs, 50));

  for (const [lab, lo, hi] of [['소(≤8)', 0, 9], ['중(9-11)', 9, 12], ['다(≥12)', 12, 99]] as const) {
    printEdge(`[출전두수 ${lab}]`, conditionalEdge(recs.filter((r) => r.fieldSize >= lo && r.fieldSize < hi), 50));
  }

  for (const [lab, lo, hi] of [['단(≤1300)', 0, 1301], ['중(1301-1700)', 1301, 1701], ['장(≥1701)', 1701, 9999]] as const) {
    printEdge(`[거리 ${lab}]`, conditionalEdge(recs.filter((r) => r.rcDist >= lo && r.rcDist < hi), 50));
  }
  for (const m of [1, 3]) printEdge(`[경마장 meet=${m}]`, conditionalEdge(recs.filter((r) => r.meet === m), 50));

  {
    const gaps = recs.map((r) => r.confTier).sort((a, b) => a - b);
    const q1 = gaps[Math.floor(gaps.length / 3)]!, q2 = gaps[Math.floor((2 * gaps.length) / 3)]!;
    printEdge('[확신도 하위1/3]', conditionalEdge(recs.filter((r) => r.confTier <= q1), 50));
    printEdge('[확신도 상위1/3]', conditionalEdge(recs.filter((r) => r.confTier > q2), 50));
  }

  console.log('\n========== 분기별 일관성 (전체, 스프레드만) ==========');
  const quarters = [...new Set(recs.map((r) => r.quarter))].sort();
  for (const q of quarters) {
    const e = conditionalEdge(recs.filter((r) => r.quarter === q), 30);
    const sp = e.map((b) => `${b.band}:${(b.spread * 100 >= 0 ? '+' : '')}${(b.spread * 100).toFixed(0)}`).join('  ');
    console.log(`${q}  ${sp}`);
  }

  console.log('\n========== 시장 베이스라인 (배당구간) ==========');
  console.log('배당구간 |    n | 실제top3율 | 평균(1/odds)');
  const bands = ['<2', '2-4', '4-7', '7-15', '15-30', '30+'];
  for (const b of bands) {
    const g = recs.filter((r) => oddsBand(r.odds) === b);
    if (g.length === 0) continue;
    const top3 = g.reduce((s, r) => s + r.top3, 0) / g.length;
    const impl = g.reduce((s, r) => s + 1 / r.odds, 0) / g.length;
    console.log(`${b.padEnd(8)} | ${String(g.length).padStart(4)} | ${(top3 * 100).toFixed(0).padStart(6)}% | ${(impl * 100).toFixed(0).padStart(6)}%`);
  }

  console.log('\n판정: 어떤 슬라이스가 다분기 일관 + 표본충분 + 큰 양의 스프레드면 Phase 1로. (정직성: 단일분기 큰값=노이즈)');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
