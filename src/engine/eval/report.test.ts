import { describe, it, expect, vi, afterEach } from 'vitest';
import { printRollingTable, type RollingRow } from './report.js';
import { printMarketDiag, type MarketDiag } from './market.js';

const tally = (win: number, show: number, n: number) => ({ win, place: show, show, n });

function capture(fn: () => void): string {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  fn();
  const out = spy.mock.calls.map((c) => c.join(' ')).join('\n');
  spy.mockRestore();
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe('printRollingTable', () => {
  const rows: RollingRow[] = [
    { method: '챔피언', byQuarter: new Map([['2025-Q1', tally(3, 6, 10)]]), overall: tally(3, 6, 10) },
  ];

  it('기본은 연승(3착내) 표', () => {
    const out = capture(() => printRollingTable(rows, ['2025-Q1']));
    expect(out).toContain('롤링 연승율');
    expect(out).toContain('60.0%');
  });

  it("metric='win'이면 단승(1착) 표", () => {
    const out = capture(() => printRollingTable(rows, ['2025-Q1'], 'win'));
    expect(out).toContain('롤링 단승율');
    expect(out).toContain('30.0%');
    expect(out).not.toContain('60.0%');
  });
});

describe('printMarketDiag', () => {
  it('모델 단승과 시장 단승 격차를 출력', () => {
    const d: MarketDiag = {
      model: tally(3, 6, 10), market: tally(4, 7, 10),
      disModel: tally(1, 2, 4), disFav: tally(2, 3, 4),
      rankModel: [{ hit: 6, n: 10 }, { hit: 5, n: 10 }, { hit: 4, n: 10 }],
      rankMkt: [{ hit: 7, n: 10 }, { hit: 5, n: 10 }, { hit: 4, n: 10 }],
      setModelSum: 15, setMktSum: 16, setN: 10,
    };
    const out = capture(() => printMarketDiag(d));
    expect(out).toContain('[모델] 1순위 — 연승 60.0 / 단승 30.0');
    expect(out).toContain('모델 단승 − 시장 단승 = -10.0%p');
    expect(out).toContain('모델픽 단승 25.0 / 인기픽 단승 50.0');
  });
});
