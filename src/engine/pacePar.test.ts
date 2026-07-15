import { describe, it, expect } from 'vitest';
import { buildPaceParMap, paceParKey, PACE_PAR_MIN_ROWS } from './pacePar.js';

function rows(n: number, avgS1f: (i: number) => number, raceDate = 20240101) {
  return Array.from({ length: n }, (_, i) => ({ raceDate, meet: 1, rcDist: 1200, avgS1f: avgS1f(i) }));
}

describe('buildPaceParMap', () => {
  it('중앙값 par + 최소행수 미달 버킷 제외', () => {
    const map = buildPaceParMap(rows(PACE_PAR_MIN_ROWS, (i) => 13 + (i % 3) * 0.1), 20250101);
    expect(map.get(paceParKey(1, 1200))).toBeCloseTo(13.1, 5);
    const small = buildPaceParMap(rows(PACE_PAR_MIN_ROWS - 1, () => 13), 20250101);
    expect(small.size).toBe(0);
  });
  it('cutoff 이후 행은 par에 반영 안 됨 (as-of)', () => {
    const past = rows(PACE_PAR_MIN_ROWS, () => 13.0, 20240101);
    const future = rows(PACE_PAR_MIN_ROWS, () => 12.0, 20260101);
    const map = buildPaceParMap([...past, ...future], 20250101);
    expect(map.get(paceParKey(1, 1200))).toBeCloseTo(13.0, 5);
  });
});
