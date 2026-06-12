/**
 * 검증: win_odds(시장)가 실제 착순(ord)을 얼마나 맞히나? (읽기 전용)
 * - 인기순위(popularity)별 단승/연승 적중률 + 평균 착순
 * - win_odds ↔ ord 경주 내 스피어만 ρ (우리 항목 ρ와 동일 잣대: +ρ=잘 맞힘)
 * 사용: npx tsx scripts/probe_odds_vs_finish.ts
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';

type Row = { race_date: number; meet: number; rc_no: number; win_odds: number | null; popularity: number | null; ord: number | null };

function rank(values: number[]): number[] {
  const sorted = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length).fill(0);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[sorted[k][1]] = avg;
    i = j + 1;
  }
  return ranks;
}
function spearman(xs: number[], ys: number[]): number {
  if (xs.length < 2) return NaN;
  const rx = rank(xs), ry = rank(ys);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

async function main() {
  const sb = getSupabaseAdmin();
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('race_entries')
      .select('race_date, meet, rc_no, win_odds, popularity, ord')
      .not('ord', 'is', null)
      .order('race_date').order('meet').order('rc_no').order('win_odds')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  // 인기순위별 집계
  type Agg = { n: number; win: number; place: number; ordSum: number };
  const byPop = new Map<number, Agg>();
  for (const r of rows) {
    if (r.popularity == null || r.ord == null || r.ord > 50) continue;
    const p = r.popularity;
    if (!byPop.has(p)) byPop.set(p, { n: 0, win: 0, place: 0, ordSum: 0 });
    const a = byPop.get(p)!;
    a.n++; if (r.ord === 1) a.win++; if (r.ord <= 3) a.place++; a.ordSum += r.ord;
  }
  console.log('인기순위 | 표본   | 단승%  | 연승%(3착) | 평균착순');
  console.log('-'.repeat(52));
  for (let p = 1; p <= 12; p++) {
    const a = byPop.get(p); if (!a) continue;
    console.log(`${String(p).padStart(6)}   | ${String(a.n).padStart(6)} | ${(100*a.win/a.n).toFixed(1).padStart(5)} | ${(100*a.place/a.n).toFixed(1).padStart(7)}    | ${(a.ordSum/a.n).toFixed(2)}`);
  }

  // 경주 내 win_odds ↔ ord 스피어만 ρ (+ρ=시장이 잘 맞힘)
  const byRace = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.race_date}-${r.meet}-${r.rc_no}`;
    if (!byRace.has(k)) byRace.set(k, []);
    byRace.get(k)!.push(r);
  }
  let sum = 0, cnt = 0;
  for (const hs of byRace.values()) {
    const v = hs.filter((h) => h.win_odds != null && h.win_odds > 0 && h.ord != null && h.ord <= 50);
    if (v.length < 3) continue;
    // win_odds 작을수록 좋고 ord 작을수록 좋음 → spearman(win_odds, ord) 양수 = 잘 맞힘
    const rho = spearman(v.map((h) => h.win_odds!), v.map((h) => h.ord as number));
    if (Number.isFinite(rho)) { sum += rho; cnt++; }
  }
  console.log('-'.repeat(52));
  console.log(`시장 win_odds ↔ 착순 경주내 ρ(평균, +=잘맞힘): ${(sum/cnt).toFixed(3)}  (n=${cnt}경주)`);
  console.log('참고 항목 ρ: 후반순위 0.311 · 부담중량 0.301 · 속도능력지수 0.271');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
