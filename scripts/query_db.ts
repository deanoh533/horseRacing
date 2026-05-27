/**
 * 2차 backfill 후 분포 검증
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';

async function main() {
  const sb = getSupabaseAdmin();

  // meet별 분포 검증
  type Row = {
    meet: number;
    rc_date: number;
    bu_g3f: number | null;
    se_g3f: number | null;
  };
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await sb
      .from('race_entries')
      .select('meet, race_date, bu_g3f_acc_time, se_g3f_acc_time')
      .not('ord', 'is', null)
      .range(off, off + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      rows.push({
        meet: r.meet,
        rc_date: r.race_date,
        bu_g3f: r.bu_g3f_acc_time,
        se_g3f: r.se_g3f_acc_time,
      });
    }
    if (data.length < PAGE) break;
  }

  console.log(`총 ${rows.length} rows`);

  // meet별
  const byMeet = new Map<number, { total: number; bu: number; se: number }>();
  for (const r of rows) {
    const m = byMeet.get(r.meet) ?? { total: 0, bu: 0, se: 0 };
    m.total++;
    if (r.bu_g3f != null && r.bu_g3f > 0) m.bu++;
    if (r.se_g3f != null && r.se_g3f > 0) m.se++;
    byMeet.set(r.meet, m);
  }
  console.log('\n=== meet별 분포 ===');
  console.table(
    [...byMeet.entries()].map(([meet, v]) => ({
      meet,
      total: v.total,
      with_bu_g3f: v.bu,
      with_se_g3f: v.se,
      pct_se: ((v.se / v.total) * 100).toFixed(1) + '%',
      pct_bu: ((v.bu / v.total) * 100).toFixed(1) + '%',
    }))
  );

  // 서울 연도별 (이전 비교)
  const seoulByYear = new Map<number, { total: number; se: number }>();
  for (const r of rows) {
    if (r.meet !== 1) continue;
    const y = Math.floor(r.rc_date / 10000);
    const b = seoulByYear.get(y) ?? { total: 0, se: 0 };
    b.total++;
    if (r.se_g3f != null && r.se_g3f > 0) b.se++;
    seoulByYear.set(y, b);
  }
  console.log('\n=== 서울 연도별 with_se_g3f 진행률 ===');
  console.table(
    [...seoulByYear.entries()]
      .sort()
      .map(([year, v]) => ({
        year,
        total: v.total,
        with_se_g3f: v.se,
        pct: ((v.se / v.total) * 100).toFixed(1) + '%',
      }))
  );
}

main().catch((err) => {
  console.error('💥', err.message ?? err);
  process.exit(1);
});
