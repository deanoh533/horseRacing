// scripts/probe_picks_roi.ts
/**
 * 선별 표시(강추/주목) ROI probe — 로컬 DuckDB 읽기전용.
 *
 * "강추마만 베팅하면 흑자인가?"에 답한다. probe:picks는 적중률만 보고,
 * backtest:value는 배당구간×모델터셀을 본다 — 이 스크립트는 화면에 뜨는
 * 강추/주목 라벨 그대로 끊어 연승·단승 ROI를 잰다.
 *
 *  · 티어별(강추 ≥0.72 / 주목 ≥0.62 / 베이스 전체) 연승·단승 ROI
 *  · 강추 연승: 배당구간 세분 + 분기별 일관성
 * 정직성: win_odds/plc_odds는 사후 확정값 → ROI는 낙관적 상한.
 *         predictions는 사후 백테스트 테이블(적중률 73% 보고와 동일 기준).
 *
 * 사용: npm run probe:picks:roi [-- --from YYYYMMDD]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getLocalDb } from '../src/db/localDb.js';
import { oddsBand } from '../src/engine/analysis/edgeProbe.js';
import { placePaid, roi, summarize, type Bet } from '../src/engine/analysis/valueBacktest.js';

const CONFIG_PATH = 'client/src/config/selective_picks.json';
const pct = (x: number): string => (x * 100).toFixed(1) + '%';
const signed = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
const quarter = (d: number): string =>
  `${Math.floor(d / 10000)}-Q${Math.floor((Math.floor((d % 10000) / 100) - 1) / 3) + 1}`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface PredRow { race_date: number; meet: number; rc_no: number; hr_name: string; p_top3: number | null; actual_ord: number | null; }
interface OddsRow { race_date: number; meet: number; rc_no: number; hr_name: string; win_odds: number | null; plc_odds: number | null; }

type Tier = 'strong' | 'watch' | 'base';
const TIER_LABEL: Record<Tier, string> = { strong: '강추', watch: '주목', base: '베이스' };

/** 티어 단위(배당구간 무시) 집계 — summarize와 같은 정산, band 합산. */
function tierLine(bets: Bet[]): { nBets: number; nHits: number; hitRate: number; avgOdds: number; roi: number } {
  const hits = bets.filter((b) => b.plcOdds != null);
  const avgOdds = hits.length ? hits.reduce((s, b) => s + (b.plcOdds as number), 0) / hits.length : 0;
  return { nBets: bets.length, nHits: hits.length, hitRate: bets.length ? hits.length / bets.length : 0, avgOdds, roi: roi(bets) };
}

function printTierTable(title: string, byTier: Record<Tier, Bet[]>): void {
  console.log(`\n═══ ${title} ═══`);
  console.log('티어   | 베팅수 | 적중 | 적중률 | 평균배당 | ROI');
  console.log('-'.repeat(54));
  for (const t of ['strong', 'watch', 'base'] as Tier[]) {
    const s = tierLine(byTier[t]);
    console.log(
      `${TIER_LABEL[t].padEnd(5)} | ${String(s.nBets).padStart(6)} | ${String(s.nHits).padStart(4)} | ` +
      `${pct(s.hitRate).padStart(6)} | ${s.avgOdds.toFixed(2).padStart(7)}x | ${signed(s.roi * 100).padStart(7)}`,
    );
  }
}

function printBandTable(title: string, bets: Bet[]): void {
  console.log(`\n  [배당구간 세분 — ${title}]`);
  console.log('  배당구간 | 베팅수 | 적중 | 적중률 | 평균배당 | ROI');
  console.log('  ' + '-'.repeat(54));
  for (const r of summarize(bets)) {
    console.log(
      `  ${r.band.padEnd(8)} | ${String(r.nBets).padStart(6)} | ${String(r.nHits).padStart(4)} | ` +
      `${pct(r.hitRate).padStart(6)} | ${r.avgOdds.toFixed(2).padStart(7)}x | ${signed(r.roi * 100).padStart(7)}`,
    );
  }
}

async function main(): Promise<void> {
  const from = arg('--from') ? Number(arg('--from')) : undefined;
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const sMin: number = cfg.tiers.strong.minProb;
  const wMin: number = cfg.tiers.watch.minProb;

  const db = await getLocalDb();

  // 1) 사후 예측 (p_top3·actual_ord)
  let pq = db.from('predictions')
    .select('race_date, meet, rc_no, hr_name, p_top3, actual_ord')
    .not('actual_ord', 'is', null)
    .not('p_top3', 'is', null);
  if (from) pq = pq.gte('race_date', from);
  const { data: predData, error: pErr } = await pq;
  if (pErr) throw pErr;
  const preds = (predData ?? []) as PredRow[];

  // 2) 배당 (win_odds·plc_odds) — 키: race_date-meet-rc_no-hr_name
  let oq = db.from('race_entries').select('race_date, meet, rc_no, hr_name, win_odds, plc_odds');
  if (from) oq = oq.gte('race_date', from);
  const { data: oddsData, error: oErr } = await oq;
  if (oErr) throw oErr;
  const oddsMap = new Map<string, OddsRow>();
  for (const r of (oddsData ?? []) as OddsRow[]) oddsMap.set(`${r.race_date}-${r.meet}-${r.rc_no}-${r.hr_name}`, r);

  // 3) 출주두수 = 경주별 사후 예측 행 수(actual_ord 있는 말)
  const fieldSize = new Map<string, number>();
  for (const p of preds) {
    const rk = `${p.race_date}-${p.meet}-${p.rc_no}`;
    fieldSize.set(rk, (fieldSize.get(rk) ?? 0) + 1);
  }

  // 4) 정산: 티어 × {연승, 단승} Bet 배열 (band = win_odds 구간 = 인기도 축)
  const place: Record<Tier, Bet[]> = { strong: [], watch: [], base: [] };
  const win: Record<Tier, Bet[]> = { strong: [], watch: [], base: [] };
  const strongPlaceByRace: { date: number; bet: Bet }[] = [];
  let joined = 0, noOdds = 0, smallField = 0;

  for (const p of preds) {
    if (p.p_top3 == null || p.actual_ord == null) continue;
    const rk = `${p.race_date}-${p.meet}-${p.rc_no}`;
    const o = oddsMap.get(`${rk}-${p.hr_name}`);
    if (!o || !(o.win_odds && o.win_odds > 0)) { noOdds++; continue; }
    joined++;
    const band = oddsBand(o.win_odds);
    if (band === 'na') continue;

    const tiers: Tier[] = ['base'];
    if (p.p_top3 >= sMin) tiers.push('strong');
    else if (p.p_top3 >= wMin) tiers.push('watch');

    // 단승: 1착이면 win_odds 회수, 아니면 손실
    const winBet: Bet = { band, plcOdds: p.actual_ord === 1 ? o.win_odds : null };
    for (const t of tiers) win[t].push(winBet);

    // 연승: 5두↑ 발매. 입상 시 plc_odds 회수, 아니면 손실
    const fs = fieldSize.get(rk) ?? 0;
    if (fs < 5) { smallField++; continue; }
    const placed = placePaid(p.actual_ord, fs);
    const placeBet: Bet = { band, plcOdds: placed ? o.plc_odds ?? null : null };
    for (const t of tiers) place[t].push(placeBet);
    if (tiers.includes('strong')) strongPlaceByRace.push({ date: p.race_date, bet: placeBet });
  }

  const races = new Set(preds.map((p) => `${p.race_date}-${p.meet}-${p.rc_no}`)).size;
  console.log(`📊 선별 ROI probe — 사후 predictions ${preds.length}행 / 배당조인 ${joined} (배당없음 ${noOdds}) / 소두수 연승제외 ${smallField}`);
  console.log(`   경주 ${races} · 임계값 강추≥${sMin} · 주목≥${wMin}${from ? ` · ≥${from}` : ''}`);
  console.log('   정직성: 사후 확정배당 → ROI는 낙관적 상한. 손익분기 ROI=0%.');

  printTierTable('연승 (place) ROI — 강추 73% 연승, 메인 지표', place);
  printBandTable('강추 연승', place.strong);

  printTierTable('단승 (win) ROI — 참고', win);
  printBandTable('강추 단승', win.strong);

  // 5) 강추 연승 분기별 일관성 (단일분기 큰 ROI = 노이즈 경계)
  console.log('\n═══ 강추 연승 분기별 ROI ═══');
  const quarters = [...new Set(strongPlaceByRace.map((r) => quarter(r.date)))].sort();
  console.log('구간    | ' + quarters.map((q) => q.padStart(11)).join(' | '));
  const cells = quarters.map((q) => {
    const sub = strongPlaceByRace.filter((r) => quarter(r.date) === q).map((r) => r.bet);
    if (sub.length === 0) return '    -    ';
    return `${signed(roi(sub) * 100)}(${sub.length})`.padStart(11);
  });
  console.log('연승ROI | ' + cells.join(' | '));
  console.log('\n판정: 강추 연승 ROI>0 + 다분기 일관(양수) + 베팅수 충분 → 흑자 신호. 단일분기 큰 값=노이즈.');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
