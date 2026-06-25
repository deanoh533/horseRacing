// scripts/probe_selective_picks.ts
/**
 * 선별 표시 probe — 로컬 DuckDB predictions(사후)로:
 *  · 기본      : 임계값별 (연승 적중률·단승·커버리지·건수) 곡선 + 베이스라인
 *  · --strong H --watch H : 목표 연승적중률 H를 주는 최저 임계값 역산
 *  · --write   : 위 임계값을 client/src/config/selective_picks.json 에 기록
 *  · --track   : 현재 config 임계값으로 티어별 실측
 *  · --from YYYYMMDD : 시작일 필터(선택)
 * 사용: npm run probe:picks [-- --strong 0.85 --watch 0.75 --write]
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { getLocalDb } from '../src/db/localDb.js';
import {
  buildSelectionCurve, tierAccuracy, pickThreshold, type PredRow,
} from '../src/engine/eval/selectivePicks.js';

const CONFIG_PATH = 'client/src/config/selective_picks.json';
const pct = (x: number): string => (x * 100).toFixed(1) + '%';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadRows(from?: number): Promise<PredRow[]> {
  const db = await getLocalDb();
  let q = db.from('predictions')
    .select('race_date, meet, rc_no, p_top3, p_win, actual_ord')
    .not('actual_ord', 'is', null)
    .not('p_top3', 'is', null);
  if (from) q = q.gte('race_date', from);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PredRow[];
}

async function main(): Promise<void> {
  const from = arg('--from') ? Number(arg('--from')) : undefined;
  const rows = await loadRows(from);
  console.log(`📊 선별 표시 probe — 사후 예측 ${rows.length}행${from ? ` (≥${from})` : ''}\n`);

  const grid: number[] = [];
  for (let t = 0.5; t <= 0.95 + 1e-9; t += 0.05) grid.push(Number(t.toFixed(2)));
  const curve = buildSelectionCurve(rows, grid);
  console.log(`경주 ${curve.totalRaces} · 베이스라인 연승 ${pct(curve.baselinePlace)} · 단승 ${pct(curve.baselineWin)}\n`);
  console.log('p_top3 ≥ | 건수  | 연승적중 | 단승적중 | 커버리지');
  console.log('---------|-------|----------|----------|---------');
  for (const p of [...curve.points].sort((a, b) => b.threshold - a.threshold)) {
    console.log(
      `  ${p.threshold.toFixed(2)}   | ${String(p.picks).padStart(5)} | ${pct(p.placeHitRate).padStart(8)} | ` +
      `${pct(p.winHitRate).padStart(8)} | ${pct(p.coverage).padStart(7)}`,
    );
  }

  if (process.argv.includes('--track')) {
    const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const [strong, watch] = tierAccuracy(rows, cfg.tiers.strong.minProb, cfg.tiers.watch.minProb);
    console.log(`\n── 현재 config 티어 실측 (강추≥${cfg.tiers.strong.minProb} · 주목≥${cfg.tiers.watch.minProb}) ──`);
    for (const s of [strong, watch]) {
      const label = s.tier === 'strong' ? '강추' : '주목';
      console.log(`  ${label}: ${s.picks}건 · 연승 ${pct(s.placeHitRate)} · 단승 ${pct(s.winHitRate)} · 커버리지 ${pct(s.coverage)}`);
    }
  }

  const sTarget = arg('--strong') ? Number(arg('--strong')) : undefined;
  const wTarget = arg('--watch') ? Number(arg('--watch')) : undefined;
  if (sTarget != null || wTarget != null) {
    const fine: number[] = [];
    for (let t = 0.4; t <= 0.99 + 1e-9; t += 0.01) fine.push(Number(t.toFixed(2)));
    const fineCurve = buildSelectionCurve(rows, fine);
    const sMin = sTarget != null ? pickThreshold(fineCurve, sTarget) : null;
    const wMin = wTarget != null ? pickThreshold(fineCurve, wTarget) : null;
    console.log('\n── 목표 적중률 → 최저 임계값 ──');
    if (sTarget != null) console.log(`  강추 목표 연승 ${pct(sTarget)} → p_top3 ≥ ${sMin ?? '(달성 불가)'}`);
    if (wTarget != null) console.log(`  주목 목표 연승 ${pct(wTarget)} → p_top3 ≥ ${wMin ?? '(달성 불가)'}`);

    if (process.argv.includes('--write')) {
      if (sMin == null || wMin == null) { console.error('⚠️ 임계값 달성 불가 — write 취소'); process.exit(1); }
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      cfg.tiers.strong.minProb = sMin; cfg.tiers.strong.targetHit = sTarget;
      cfg.tiers.watch.minProb = wMin;  cfg.tiers.watch.targetHit = wTarget;
      cfg.fitAt = new Date().toISOString().slice(0, 10);
      const dates = rows.map((r) => r.race_date);
      cfg.fitMeta = { rows: rows.length, from: Math.min(...dates), to: Math.max(...dates) };
      writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
      console.log(`\n✅ ${CONFIG_PATH} 기록: 강추≥${sMin} · 주목≥${wMin}`);
    }
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
