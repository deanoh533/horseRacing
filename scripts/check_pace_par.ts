/**
 * pace_par.json 드리프트 감지 — 재생성이 필요한지 데이터로 판단(읽기 전용, egress 0).
 * 배포된 JSON vs 미러로 재계산한 par 비교: ① 버킷별 par 이동폭 ② 실측 라벨 뒤집힘 경주 수.
 * 라벨 판정은 서버 labelPastRacePace(±0.11) 그대로 재사용 — 산식 갈림 없음.
 *
 * ⚠️ 로컬 미러 기준 — 최신으로 판단하려면 먼저 `npm run db:pull`.
 * 재생성이 필요하면: db:pull → `npm run export:pace-par` → commit → push.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { getLocalDb } from '../src/db/localDb.js';
import { buildPaceParMap, paceParKey, type PaceParSourceRow } from '../src/engine/pacePar.js';
import { labelPastRacePace } from '../src/engine/features/paceForm.js';

const CUTOFF = 99991231;      // all-time (export_pace_par와 동일 기준선)
const FLIP_WARN_PCT = 1.0;    // 라벨 뒤집힘 이 % 이상이면 재생성 권장 (표시 전용이라 관대)

async function main() {
  const committed: Record<string, number> = JSON.parse(
    readFileSync('client/src/config/pace_par.json', 'utf8')
  );
  const sb = await getLocalDb();

  // 미러 전체 로드 (export_pace_par와 동일 페치)
  const rows: PaceParSourceRow[] = [];
  const races: Array<{ key: string; avgS1f: number }> = [];
  const PAGE = 5000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_sectional_stats')
      .select('race_date, meet, rc_no, rc_dist, avg_s1f')
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ race_date: number; meet: number; rc_no: number; rc_dist: number | null; avg_s1f: number | null }>) {
      if (r.rc_dist == null || r.avg_s1f == null || !(Number(r.avg_s1f) > 0)) continue;
      rows.push({ raceDate: r.race_date, meet: r.meet, rcDist: r.rc_dist, avgS1f: Number(r.avg_s1f) });
      races.push({ key: paceParKey(r.meet, r.rc_dist), avgS1f: Number(r.avg_s1f) });
    }
    if (data.length < PAGE) break;
  }
  const fresh = buildPaceParMap(rows, CUTOFF);

  // ① 버킷별 드리프트
  const allKeys = new Set([...Object.keys(committed), ...fresh.keys()]);
  console.log(`버킷: 배포 JSON ${Object.keys(committed).length} · 미러 재계산 ${fresh.size}`);
  console.log('버킷별 par 이동(초):  key          배포   →  미러    Δ');
  let maxDrift = 0;
  for (const k of [...allKeys].sort()) {
    const oldV = committed[k];
    const newV = fresh.get(k);
    if (oldV == null) { console.log(`  + ${k.padEnd(11)} (없음)  →  ${newV!.toFixed(2)}   신규 버킷`); continue; }
    if (newV == null) { console.log(`  - ${k.padEnd(11)} ${oldV.toFixed(2)}  →  (없음)   버킷 소멸(30경주 미만)`); continue; }
    const d = newV - oldV;
    maxDrift = Math.max(maxDrift, Math.abs(d));
    const flag = Math.abs(d) >= 0.11 ? ' ⚠️임계급' : Math.abs(d) >= 0.03 ? ' ·' : '';
    console.log(`    ${k.padEnd(11)} ${oldV.toFixed(2)}  →  ${newV.toFixed(2)}   ${d >= 0 ? '+' : ''}${d.toFixed(3)}${flag}`);
  }

  // ② 라벨 뒤집힘: 각 경주를 old par / new par로 라벨해 다른 수 (재생성의 실제 영향)
  let flips = 0, labeled = 0;
  for (const r of races) {
    const oldLab = labelPastRacePace(r.avgS1f, committed[r.key] ?? null);
    const newLab = labelPastRacePace(r.avgS1f, fresh.get(r.key) ?? null);
    if (oldLab == null || newLab == null) continue;
    labeled++;
    if (oldLab !== newLab) flips++;
  }
  const flipPct = labeled ? (100 * flips) / labeled : 0;
  console.log(`\n실측 라벨 뒤집힘: ${flips}/${labeled} 경주 (${flipPct.toFixed(2)}%) · par 최대 이동 ${maxDrift.toFixed(3)}초`);
  if (flipPct >= FLIP_WARN_PCT) {
    console.log(`→ 재생성 권장: 뒤집힘 ${flipPct.toFixed(2)}% ≥ ${FLIP_WARN_PCT}%. db:pull 후 npm run export:pace-par.`);
  } else {
    console.log(`→ 재생성 불필요: 뒤집힘 ${flipPct.toFixed(2)}% < ${FLIP_WARN_PCT}% (par 안정적).`);
  }
  console.log('  ※ 로컬 미러 기준 — 최신 판단하려면 먼저 npm run db:pull.');
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
