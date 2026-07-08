import { describe, it, expect } from 'vitest';
import { buildShapeParMap, SHAPE_PAR_MIN_ROWS, type ShapeParSourceRow } from './shapePar.js';
import { shapeParKey } from './features/shapeSignals.js';

const mkRows = (n: number, base: Partial<ShapeParSourceRow> = {}): ShapeParSourceRow[] =>
  Array.from({ length: n }, (_, i) => ({
    raceDate: 20240101 + i, meet: 1, rcDist: 1200,
    g3fAcc: 48 + (i % 5) * 0.1,   // 48.0~48.4 → 중앙값 48.2
    fin600: 38 + (i % 5) * 0.1,   // 중앙값 38.2
    ...base,
  }));

describe('buildShapeParMap', () => {
  it('meet×dist 중앙값으로 par3/par6 산출', () => {
    const map = buildShapeParMap(mkRows(50), 20991231);
    const p = map.get(shapeParKey(1, 1200));
    expect(p).toBeDefined();
    expect(p!.par3).toBeCloseTo(48.2, 6);
    expect(p!.par6).toBeCloseTo(38.2, 6);
  });

  it('cutoff 이후 행은 제외', () => {
    const past = mkRows(SHAPE_PAR_MIN_ROWS);                              // 20240101~
    const future = mkRows(100, { g3fAcc: 99, fin600: 59 }).map((r, i) => ({ ...r, raceDate: 20260101 + i }));
    const map = buildShapeParMap([...past, ...future], 20250101);
    expect(map.get(shapeParKey(1, 1200))!.par3).toBeLessThan(50); // future(99) 미반영
  });

  it('버킷 행수 < SHAPE_PAR_MIN_ROWS → 버킷 없음', () => {
    const map = buildShapeParMap(mkRows(SHAPE_PAR_MIN_ROWS - 1), 20991231);
    expect(map.get(shapeParKey(1, 1200))).toBeUndefined();
  });
});
