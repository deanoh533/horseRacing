import type { Tally } from './market.js';

// ── 롤링 벤치마크 리포트 ──────────────────────────────────────────

/** inSample: 이 방법(챔피언)이 학습에 쓴 분기 — 표에서 * 표시, (OOS) 행에서 제외. */
export interface RollingRow { method: string; byQuarter: Map<string, Tally>; overall: Tally; inSample?: Set<string>; }

/** 분기 시작일 ≤ 학습 상한이면 그 분기 일부라도 학습에 들어갔다 → in-sample. */
export function inSampleQuarters(blocks: Array<{ key: string; blockStart: number }>, trainUntil: number | null): Set<string> {
  if (trainUntil == null) return new Set();
  return new Set(blocks.filter((b) => b.blockStart <= trainUntil).map((b) => b.key));
}

/** metric: 'show'=연승(1순위 픽 3착내, 기본) · 'win'=단승(1순위 픽 1착). */
export function printRollingTable(rows: RollingRow[], quarters: string[], metric: 'show' | 'win' = 'show'): void {
  const pctShow = (t: Tally | undefined) => (t && t.n ? `${(t[metric] / t.n * 100).toFixed(1)}%` : '-');
  const title = metric === 'win' ? '롤링 단승율 (분기별, 1순위 픽 1착)' : '롤링 연승율 (분기별, 1순위 픽 3착내)';
  console.log(`\n=== ${title} ===\n`);
  const header = '방법'.padEnd(16) + '│' + quarters.map((q) => ` ${q} `).join('│') + '│ 전체';
  console.log(header);
  console.log('─'.repeat(header.length));
  const star = (t: Tally | undefined, on: boolean) => pctShow(t) + (on && t && t.n ? '*' : '');
  for (const r of rows) {
    const cells = quarters.map((q) => ` ${star(r.byQuarter.get(q), !!r.inSample?.has(q)).padStart(7)} `).join('│');
    console.log(r.method.padEnd(16) + '│' + cells + '│ ' + star(r.overall, !!r.inSample?.size));
  }
  const marked = rows.filter((r) => r.inSample?.size);
  for (const r of marked) {
    const oos: Tally = { win: 0, place: 0, show: 0, n: 0 };
    const cells = quarters.map((q) => {
      if (r.inSample!.has(q)) return ` ${'-'.padStart(7)} `;
      const t = r.byQuarter.get(q);
      if (t) { oos.win += t.win; oos.place += t.place; oos.show += t.show; oos.n += t.n; }
      return ` ${pctShow(t).padStart(7)} `;
    }).join('│');
    console.log(`${r.method} (OOS)`.padEnd(16) + '│' + cells + '│ ' + pctShow(oos));
  }
  if (marked.length) console.log('  * = 챔피언이 학습에 쓴 구간(in-sample) — 참고용. (OOS) 행 = 학습 밖 분기만 집계');
}
