import { describe, it, expect } from 'vitest';
import { buildH7Table, GAP_BUCKETS, ACHIEVE_BUCKETS, type H7SqlRow } from './h7Table.js';

const SQL_GAP = ['a. ~0.5초', 'b. ~1.0초', 'c. ~1.5초', 'd. 1.5초+'];
const SQL_ACH = ['1_낮음(~30%)', '2_중간(30~70%)', '3_높음(70%+)'];

function fullRows(): H7SqlRow[] {
  const rows: H7SqlRow[] = [];
  for (const g of SQL_GAP) for (const a of SQL_ACH) {
    rows.push({ gapBucket: g, achieveBucket: a, starts: 100, winRate: 0.1, placeRate: 0.3 });
  }
  return rows;
}
const META = { generatedAt: '2026-07-18', raceDateFrom: 20220101, raceDateTo: 20260626 };

describe('buildH7Table', () => {
  it('SQL 접두 라벨 → 클린 라벨 매핑 + 12칸 + totalStarts 합산', () => {
    const t = buildH7Table(fullRows(), META);
    expect(t.cells).toHaveLength(12);
    expect(t.totalStarts).toBe(1200);
    expect(t.cells.map((c) => c.gapBucket)).toEqual(expect.arrayContaining([...GAP_BUCKETS]));
    expect(t.cells.map((c) => c.achieveBucket)).toEqual(expect.arrayContaining([...ACHIEVE_BUCKETS]));
    expect(t.cells.some((c) => (c.gapBucket as string).includes('a.'))).toBe(false);
    expect(t.generatedAt).toBe('2026-07-18');
  });
  it('칸 누락 시 throw', () => {
    expect(() => buildH7Table(fullRows().slice(0, 11), META)).toThrow(/12/);
  });
  it('중복 칸 throw', () => {
    const rows = fullRows(); rows[1] = { ...rows[0] };
    expect(() => buildH7Table(rows, META)).toThrow();
  });
  it('rate 범위 밖·starts 0 throw', () => {
    const bad = fullRows(); bad[0] = { ...bad[0]!, winRate: 1.2 };
    expect(() => buildH7Table(bad, META)).toThrow();
    const zero = fullRows(); zero[0] = { ...zero[0]!, starts: 0 };
    expect(() => buildH7Table(zero, META)).toThrow();
  });
  it('미지 라벨 throw', () => {
    const bad = fullRows(); bad[0] = { ...bad[0]!, gapBucket: 'e. 2초+' };
    expect(() => buildH7Table(bad, META)).toThrow();
  });
});
