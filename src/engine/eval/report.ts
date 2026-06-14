import type { Tally } from './market.js';

// ── 롤링 벤치마크 리포트 ──────────────────────────────────────────

export interface RollingRow { method: string; byQuarter: Map<string, Tally>; overall: Tally; }

export function printRollingTable(rows: RollingRow[], quarters: string[]): void {
  const pctShow = (t: Tally | undefined) => (t && t.n ? `${(t.show / t.n * 100).toFixed(1)}%` : '-');
  console.log('\n=== 롤링 연승율 (분기별, 1순위 픽 3착내) ===\n');
  const header = '방법'.padEnd(16) + '│' + quarters.map((q) => ` ${q} `).join('│') + '│ 전체';
  console.log(header);
  console.log('─'.repeat(header.length));
  for (const r of rows) {
    const cells = quarters.map((q) => ` ${pctShow(r.byQuarter.get(q)).padStart(7)} `).join('│');
    console.log(r.method.padEnd(16) + '│' + cells + '│ ' + pctShow(r.overall));
  }
}
