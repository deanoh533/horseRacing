import { describe, it, expect } from 'vitest';
import {
  pairKey, isMidTercile, selectTop2, selectValuePairs, selectTercilePairs, settlePair,
  type ComboHorse,
} from './comboBacktest.js';

const H = (chulNo: number, score: number, winOdds: number): ComboHorse => ({ chulNo, score, winOdds });

describe('pairKey', () => {
  it('무순 정규화 (작은 번호 먼저)', () => {
    expect(pairKey(3, 1)).toBe('1-3');
    expect(pairKey(1, 3)).toBe('1-3');
  });
});

describe('isMidTercile', () => {
  const cut = { '4-7': 0.5, '7-15': 0.2 };
  it('중배당 구간 AND 점수>=컷오프', () => {
    expect(isMidTercile(5, 0.6, cut, ['4-7', '7-15'])).toBe(true);
    expect(isMidTercile(5, 0.4, cut, ['4-7', '7-15'])).toBe(false);
  });
  it('중배당 밖 구간은 false', () => {
    expect(isMidTercile(1.5, 0.9, cut, ['4-7', '7-15'])).toBe(false);
  });
});

describe('selectTop2', () => {
  it('모델 점수 상위 2마리 1조합', () => {
    const horses = [H(1, 0.1, 3), H(2, 0.9, 5), H(3, 0.5, 8)];
    expect(selectTop2(horses)).toEqual([[2, 3]]);
  });
  it('2마리 미만이면 빈 배열', () => {
    expect(selectTop2([H(1, 0.5, 3)])).toEqual([]);
  });
});

describe('selectValuePairs', () => {
  it('모델 1픽 × 중배당·상위터셀 말', () => {
    const cut = { '4-7': 0.4, '7-15': 0.4 };
    const horses = [H(1, 0.1, 3), H(2, 0.9, 50), H(3, 0.5, 5), H(4, 0.45, 20)];
    expect(selectValuePairs(horses, cut, ['4-7', '7-15'])).toEqual([[2, 3]]);
  });
});

describe('selectTercilePairs', () => {
  it('중배당·상위터셀 말들의 모든 2조합', () => {
    const cut = { '4-7': 0.4 };
    const horses = [H(1, 0.5, 5), H(2, 0.9, 50), H(3, 0.45, 6)];
    expect(selectTercilePairs(horses, cut, ['4-7'])).toEqual([[1, 3]]);
  });
});

describe('settlePair', () => {
  const placed = new Map([[1, true], [2, true], [3, false]]);
  const odds = new Map([['1-2', 4.5], ['1-3', 9.0]]);
  it('둘 다 입상이면 payout=odds', () => {
    expect(settlePair([1, 2], placed, odds)).toBe(4.5);
    expect(settlePair([2, 1], placed, odds)).toBe(4.5);
  });
  it('한쪽 미입상이면 null(손실)', () => {
    expect(settlePair([1, 3], placed, odds)).toBe(null);
  });
  it('둘 다 입상인데 배당 결측이면 null', () => {
    expect(settlePair([1, 2], placed, new Map())).toBe(null);
  });
});
