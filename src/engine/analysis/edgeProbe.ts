/**
 * 시장 엣지 탐색 순수 헬퍼.
 * 핵심: 같은 배당 구간 안에서 모델 점수 터셀이 실제 top3율을 가르나(스프레드).
 */
const BANDS: Array<[string, number, number]> = [
  ['<2', 0, 2], ['2-4', 2, 4], ['4-7', 4, 7], ['7-15', 7, 15], ['15-30', 15, 30], ['30+', 30, Infinity],
];

export function oddsBand(winOdds: number): string {
  if (!(winOdds > 0)) return 'na';
  for (const [label, lo, hi] of BANDS) if (winOdds >= lo && winOdds < hi) return label;
  return 'na';
}

/** 값 순위로 0(하)/1/2(상) 터셀. 동률은 입력 순서로 분리. 길이 동일 배열 반환. */
export function terciles(values: number[]): number[] {
  const n = values.length;
  const ranked = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array(n).fill(0);
  ranked.forEach((pair, rank) => {
    out[pair[1]] = Math.min(2, Math.floor((rank / n) * 3));
  });
  return out;
}

export interface CellStat { n: number; top3: number; rate: number; }
export interface BandEdge { band: string; n: number; lo: CellStat; mid: CellStat; hi: CellStat; spread: number; }

const emptyCell = (): CellStat => ({ n: 0, top3: 0, rate: 0 });
function finalize(c: CellStat): CellStat { c.rate = c.n ? c.top3 / c.n : 0; return c; }

/**
 * 레코드를 배당 구간으로 묶고, 구간 안에서 score 터셀별 top3율과 스프레드(상−하)를 낸다.
 * @param minN 구간 최소 표본 (미만이면 제외)
 */
export function conditionalEdge(
  recs: { odds: number; score: number; top3: number }[],
  minN = 30
): BandEdge[] {
  const byBand = new Map<string, { odds: number; score: number; top3: number }[]>();
  for (const r of recs) {
    const b = oddsBand(r.odds);
    if (b === 'na') continue;
    if (!byBand.has(b)) byBand.set(b, []);
    byBand.get(b)!.push(r);
  }
  const out: BandEdge[] = [];
  for (const [band] of BANDS) {
    const rows = byBand.get(band);
    if (!rows || rows.length < minN) continue;
    const t = terciles(rows.map((r) => r.score));
    const cells = [emptyCell(), emptyCell(), emptyCell()];
    rows.forEach((r, i) => { const c = cells[t[i]!]!; c.n++; c.top3 += r.top3; });
    cells.forEach(finalize);
    out.push({ band, n: rows.length, lo: cells[0]!, mid: cells[1]!, hi: cells[2]!, spread: cells[2]!.rate - cells[0]!.rate });
  }
  return out;
}
