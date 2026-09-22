import type { Tally } from './market.js';

// ── 롤링 벤치마크 리포트 ──────────────────────────────────────────

export interface RollingRow { method: string; byQuarter: Map<string, Tally>; overall: Tally; }

/** metric: 'show'=연승(1순위 픽 3착내, 기본) · 'win'=단승(1순위 픽 1착). */
export function printRollingTable(rows: RollingRow[], quarters: string[], metric: 'show' | 'win' = 'show'): void {
  const pctShow = (t: Tally | undefined) => (t && t.n ? `${(t[metric] / t.n * 100).toFixed(1)}%` : '-');
  const title = metric === 'win' ? '롤링 단승율 (분기별, 1순위 픽 1착)' : '롤링 연승율 (분기별, 1순위 픽 3착내)';
  console.log(`\n=== ${title} ===\n`);
  const header = '방법'.padEnd(16) + '│' + quarters.map((q) => ` ${q} `).join('│') + '│ 전체';
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const r of rows) {
    const cells = quarters.map((q) => ` ${pctShow(r.byQuarter.get(q)).padStart(7)} `).join('│');
    console.log(r.method.padEnd(16) + '│' + cells + '│ ' + pctShow(r.overall));
  }
}
