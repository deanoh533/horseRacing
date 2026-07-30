import { describe, it, expect } from 'vitest';
import { toComboDividendRows } from '../../src/sync/transformer.js';
import type { KRAComboDividend } from '../../src/kra/client.js';

const KEYS = { race_date: 20260726, meet: 1, rc_no: 5 };

function item(o: Partial<KRAComboDividend>): KRAComboDividend {
  return { rcNo: 5, pool: '복승식', chulNo: 0, chulNo2: 0, chulNo3: 0, odds: 0, ...o };
}

describe('toComboDividendRows', () => {
  it('대상이 아닌 pool(단승식·연승식)은 제외한다', () => {
    const rows = toComboDividendRows(
      [
        item({ pool: '단승식', chulNo: 3, odds: 3.2 }),
        item({ pool: '연승식', chulNo: 3, odds: 1.5 }),
        item({ pool: '복승식', chulNo: 3, chulNo2: 7, odds: 12.4 }),
      ],
      KEYS
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pool).toBe('복승식');
  });

  it('2마리 조합은 leg3=0으로 저장한다', () => {
    const rows = toComboDividendRows([item({ pool: '쌍승식', chulNo: 4, chulNo2: 2, odds: 30 })], KEYS);
    expect(rows[0]).toEqual({
      race_date: 20260726, meet: 1, rc_no: 5, pool: '쌍승식',
      leg1: 4, leg2: 2, leg3: 0, odds: 30,
    });
  });

  it('3마리 조합은 leg3까지 보존하고 순서를 정렬하지 않는다', () => {
    const rows = toComboDividendRows(
      [item({ pool: '삼쌍승식', chulNo: 9, chulNo2: 1, chulNo3: 5, odds: 420 })],
      KEYS
    );
    expect(rows[0]).toMatchObject({ pool: '삼쌍승식', leg1: 9, leg2: 1, leg3: 5 });
  });

  it('chulNo3이 undefined여도 leg3=0으로 안전 처리한다', () => {
    const raw = { rcNo: 5, pool: '복연승식', chulNo: 2, chulNo2: 6, odds: 8 } as unknown as KRAComboDividend;
    const rows = toComboDividendRows([raw], KEYS);
    expect(rows[0]!.leg3).toBe(0);
  });
});
