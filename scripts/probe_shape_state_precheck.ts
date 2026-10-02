/**
 * 1단계 사전점검 실행 — 로컬 DuckDB 미러만 사용, KRA·Supabase 호출 0.
 * 실행: npm run probe:shape-state
 */
import { getLocalDb } from '../src/db/localDb.js';
import { precheckRmse, judgePrecheck, type PrecheckRow } from '../src/engine/eval/shapeStatePrecheck.js';

const CUTOFF = 20240101; // 계수 추정 종료일(=par as-of 컷오프) — 이후만 시험

interface Raw {
  race_date: number; meet: number; rc_no: number; hr_name: string; rc_dist: number | null;
  track_type: string | null; rc_time: number | null;
  se_g3f_acc_time: number | null; bu_g3f_acc_time: number | null;
}

async function main(): Promise<void> {
  const sb = await getLocalDb();
  const rows: PrecheckRow[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb.from('race_entries')
      .select('race_date, meet, rc_no, hr_name, rc_dist, track_type, rc_time, se_g3f_acc_time, bu_g3f_acc_time')
      .not('ord', 'is', null)
      .not('rc_time', 'is', null)
      .order('race_date').order('meet').order('rc_no').order('pthr_no')
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Raw[]) {
      const g3f = r.meet === 1 ? r.se_g3f_acc_time : r.bu_g3f_acc_time;
      if (r.rc_dist == null || r.rc_time == null || g3f == null || !(g3f > 0) || !(r.rc_time > 0)) continue;
      const fin600 = r.rc_time - g3f;
      if (fin600 < 30 || fin600 > 60) continue;
      rows.push({ date: r.race_date, meet: r.meet, rcNo: r.rc_no, hk: r.hr_name, dist: r.rc_dist, state: r.track_type, g3f, fin600 });
    }
    if (data.length < PAGE) break;
  }
  console.log(`유효 행 ${rows.length}`);
  const stats = precheckRmse(rows, CUTOFF);
  const j = judgePrecheck(stats);
  for (const s of j.slices) {
    const st = stats.get(s.year)!;
    const rm = (v: number) => Math.sqrt(v / st.horses).toFixed(4);
    console.log(`${s.year}: 경주 ${st.races}·말 ${st.horses} | 초반 RMSE ${rm(st.sseOffE)} → ${rm(st.sseOnE)} (${(s.relEarly * 100).toFixed(2)}%) | 종반 ${rm(st.sseOffL)} → ${rm(st.sseOnL)} (${(s.relLate * 100).toFixed(2)}%) | ${s.ok ? '≥1% 통과' : '미달'}`);
  }
  console.log(j.pass ? '\n판정: 통과 (슬라이스 ≥2) → Task 3 진행' : '\n판정: 미통과 → 기각·종결 (Task 3~4 생략)');
}
main().catch((e) => { console.error(e); process.exit(1); });
