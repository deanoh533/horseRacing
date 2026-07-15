/**
 * 페이스 조건부 성적 probe — 임계값·shrinkage K 확정용 분포 조사. 로컬 미러 전용(DB 0회).
 * 출력: ① delta(avg_s1f−par) 분위 ② 라벨 커버리지 ③ 말별 버킷 표본수 분포 → 권장 상수.
 * 스펙: docs/superpowers/specs/2026-07-15-pace-conditional-form-design.md §5-1
 */
import 'dotenv/config';
import { getLocalDb } from '../src/db/localDb.js';
import { buildPaceParMap, paceParKey, type PaceParSourceRow } from '../src/engine/pacePar.js';

const CUTOFF = 99991231; // 진단이므로 전 기간 par (as-of 아님 — 게이트 실행이 아니라 분포 조사)

function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

async function main() {
  const sb = await getLocalDb();

  // ① race_sectional_stats 전체 → par + delta 분포
  const src: PaceParSourceRow[] = [];
  const raceRows: Array<{ key: string; raceDate: number; meet: number; rcNo: number; rcDist: number; avgS1f: number }> = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_sectional_stats')
      .select('race_date, meet, rc_no, rc_dist, avg_s1f, horses')
      .order('race_date').order('meet').order('rc_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ race_date: number; meet: number; rc_no: number; rc_dist: number | null; avg_s1f: number | null; horses: number }>) {
      if (r.rc_dist == null || r.avg_s1f == null || !(Number(r.avg_s1f) > 0)) continue;
      src.push({ raceDate: r.race_date, meet: r.meet, rcDist: r.rc_dist, avgS1f: Number(r.avg_s1f) });
      raceRows.push({ key: `${r.race_date}-${r.meet}-${r.rc_no}`, raceDate: r.race_date, meet: r.meet, rcNo: r.rc_no, rcDist: r.rc_dist, avgS1f: Number(r.avg_s1f) });
    }
    if (data.length < PAGE) break;
  }
  const par = buildPaceParMap(src, CUTOFF);
  const deltas: number[] = [];
  const labelByRace = new Map<string, number>(); // key → delta
  for (const r of raceRows) {
    const p = par.get(paceParKey(r.meet, r.rcDist));
    if (p == null) continue;
    const d = r.avgS1f - p;
    deltas.push(d);
    labelByRace.set(r.key, d);
  }
  deltas.sort((a, b) => a - b);
  console.log(`경주 수: ${raceRows.length} · par 버킷: ${par.size} · delta 계산 가능: ${deltas.length} (커버리지 ${(100 * deltas.length / raceRows.length).toFixed(1)}%)`);
  console.log('delta 분위(초):');
  for (const q of [0.1, 0.3, 0.5, 0.7, 0.9]) console.log(`  p${q * 100}: ${quantile(deltas, q).toFixed(3)}`);
  const hotThr = quantile(deltas, 0.3), slowThr = quantile(deltas, 0.7);
  console.log(`→ 권장 PACE_HOT_DELTA=${hotThr.toFixed(2)} · PACE_SLOW_DELTA=${slowThr.toFixed(2)} (30/70 분위)`);

  // ② 말별 버킷 표본수: race_entries에서 (hr_name, 경주key) 수집 → delta 임계로 라벨 → 말×버킷 카운트
  const perHorse = new Map<string, { HOT: number; NORMAL: number; SLOW: number }>();
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('hr_name, race_date, meet, rc_no, ord')
      .not('ord', 'is', null)
      .order('race_date').order('meet').order('rc_no').order('pthr_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ hr_name: string; race_date: number; meet: number; rc_no: number }>) {
      const d = labelByRace.get(`${r.race_date}-${r.meet}-${r.rc_no}`);
      if (d == null) continue;
      const lab = d <= hotThr ? 'HOT' : d >= slowThr ? 'SLOW' : 'NORMAL';
      const c = perHorse.get(r.hr_name) ?? { HOT: 0, NORMAL: 0, SLOW: 0 };
      c[lab]++;
      perHorse.set(r.hr_name, c);
    }
    if (data.length < PAGE) break;
  }
  const hotNs = [...perHorse.values()].map((c) => c.HOT).sort((a, b) => a - b);
  const withAny = hotNs.filter((n) => n > 0).length;
  console.log(`\n말 수(1경주 이상 라벨 보유): ${perHorse.size} · HOT 경험 말: ${withAny} (${(100 * withAny / perHorse.size).toFixed(1)}%)`);
  console.log(`말별 HOT 버킷 n 분위: p50=${quantile(hotNs, 0.5)} p70=${quantile(hotNs, 0.7)} p90=${quantile(hotNs, 0.9)}`);
  console.log(`→ K 권장: 버킷 n 중앙값 근처 (수축 절반점). n 중앙값 ${quantile(hotNs.filter((n) => n > 0), 0.5)} 확인 후 결정.`);
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
