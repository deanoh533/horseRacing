import { describe, it, expect } from 'vitest';
import { groupRowsByRace, maxRaceDate } from './learn_logistic.js';

const row = (d: number, rc: number, hr: string, ord: number) => ({ race_date: d, meet: 1, rc_no: rc, hr_name: hr, ord, top3: ord <= 3 ? 1 : 0, features: [{ name: 'x', value: ord }] });

describe('learn_logistic helpers', () => {
  it('경주 단위로 묶는다', () => {
    const g = groupRowsByRace([row(1, 1, 'A', 1), row(1, 1, 'B', 2), row(1, 2, 'C', 1)], ['x']);
    expect(g).toHaveLength(2);
    expect(g[0]!.horses.map((h) => h.ord)).toEqual([1, 2]);
  });
  it('train_until = 행렬의 최대 경주일', () => {
    expect(maxRaceDate([row(20260601, 1, 'A', 1), row(20260630, 1, 'B', 1)])).toBe(20260630);
  });
});
