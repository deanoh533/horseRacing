import { describe, it, expect } from 'vitest';
import {
  shapeParKey, horseShapeStats, raceShapeSignals,
  type ShapeParMap, type ShapeHistRace, type HorseShapeStats,
} from './shapeSignals.js';

const PAR: ShapeParMap = new Map([[shapeParKey(1, 1200), { par3: 48.0, par6: 38.0 }]]);
const row = (g3fAcc: number, fin600: number): ShapeHistRace =>
  ({ meet: 1, rcDist: 1200, rcTime: g3fAcc + fin600, g3fAcc });

describe('horseShapeStats', () => {
  it('유효 이력 3회: meanD3/meanD6/stdD6(표본) 계산', () => {
    // d3 = −0.5, −0.1, +0.3 → mean −0.1 / d6 = 0.0, 0.4, 0.8 → mean 0.4, 표본std 0.4
    const s = horseShapeStats([row(47.5, 38.0), row(47.9, 38.4), row(48.3, 38.8)], PAR);
    expect(s).not.toBeNull();
    expect(s!.n).toBe(3);
    expect(s!.meanD3).toBeCloseTo(-0.1, 6);
    expect(s!.meanD6).toBeCloseTo(0.4, 6);
    expect(s!.stdD6).toBeCloseTo(0.4, 6);
  });

  it('유효 이력 2회: mean은 있고 stdD6=null', () => {
    const s = horseShapeStats([row(47.5, 38.0), row(48.5, 39.0)], PAR);
    expect(s).not.toBeNull();
    expect(s!.n).toBe(2);
    expect(s!.stdD6).toBeNull();
  });

  it('bestD6: 종반 600m 최고 기록 = d6 최솟값 (한 방 능력)', () => {
    // d6 = 0.0, 0.4, 0.8 → best(min) = 0.0
    const s = horseShapeStats([row(47.5, 38.0), row(47.9, 38.4), row(48.3, 38.8)], PAR);
    expect(s!.bestD6).toBeCloseTo(0.0, 6);
    // par보다 빠른 이력이 섞이면 음수: d6 = −0.6, 0.4 → best −0.6
    const s2 = horseShapeStats([row(47.5, 37.4), row(47.9, 38.4)], PAR);
    expect(s2!.bestD6).toBeCloseTo(-0.6, 6);
  });

  it('유효 이력 1회 → null', () => {
    expect(horseShapeStats([row(48.0, 38.0)], PAR)).toBeNull();
  });

  it('무효 행 제외: fin600 범위 밖·par 버킷 없음·결측', () => {
    const rows: ShapeHistRace[] = [
      row(47.5, 38.0), row(47.9, 38.4),               // 유효 2
      row(48.0, 25.0),                                 // fin600 < 30 → 제외
      { meet: 3, rcDist: 1200, rcTime: 86, g3fAcc: 48 }, // par 버킷 없음(3|1200) → 제외
      { meet: 1, rcDist: 1200, rcTime: null, g3fAcc: 48 }, // rcTime 결측 → 제외
      { meet: 1, rcDist: null, rcTime: 86, g3fAcc: 48 },   // rcDist 결측 → 제외
    ];
    const s = horseShapeStats(rows, PAR);
    expect(s!.n).toBe(2);
  });
});

const stat = (meanD3: number, meanD6: number, stdD6: number | null): HorseShapeStats =>
  ({ meanD3, meanD6, stdD6, bestD6: meanD6, n: 3 });

describe('raceShapeSignals', () => {
  it('예측 선두는 gap 0·pAchieve 0.5, 나머지는 gap·z 계산', () => {
    // A(선두): meanD3 −0.1, meanD6 0.4, std 0.4 → gap 0, z = (0.4−0−0.4)/0.4 = 0 → 0.5
    // D: meanD3 0.7 → gap 0.8; 필요 = 0.4 − 0.8 = −0.4; z = (−0.4 − 1.2)/0.2 = −8 → p ≈ 0
    const out = raceShapeSignals([stat(-0.1, 0.4, 0.4), stat(0.7, 1.2, 0.2)]);
    expect(out[0]!.predGap).toBeCloseTo(0, 6);
    expect(out[0]!.pAchieve).toBeCloseTo(0.5, 6);
    expect(out[1]!.predGap).toBeCloseTo(0.8, 6);
    expect(out[1]!.pAchieve).toBeLessThan(0.001);
  });

  it('stdD6 null인 말은 pAchieve null, predGap은 계산', () => {
    const out = raceShapeSignals([stat(-0.1, 0.4, 0.4), { meanD3: 0.5, meanD6: 1.0, stdD6: null, bestD6: 1.0, n: 2 }]);
    expect(out[1]!.predGap).toBeCloseTo(0.6, 6);
    expect(out[1]!.pAchieve).toBeNull();
  });

  it('stats 보유 말 < 2 → 전원 null', () => {
    const out = raceShapeSignals([stat(-0.1, 0.4, 0.4), null, null]);
    expect(out).toEqual([null, null, null]);
  });

  it('std 하한 0.1 클램프: std 0.01이어도 z 폭발 없음', () => {
    // B: gap 0.3, 필요 = 0.4−0.3 = 0.1, own meanD6 0.2 → z = (0.1−0.2)/max(0.01,0.1) = −1
    const out = raceShapeSignals([stat(-0.1, 0.4, 0.4), stat(0.2, 0.2, 0.01)]);
    const expected = 1 / (1 + Math.exp(1.702)); // z=−1
    expect(out[1]!.pAchieve).toBeCloseTo(expected, 6);
  });

  it('par 상쇄 성질: par3에 상수 +1(전 이력 동일 버킷) → 신호 불변', () => {
    const PAR2: ShapeParMap = new Map([[shapeParKey(1, 1200), { par3: 49.0, par6: 38.0 }]]);
    const mk = (p: ShapeParMap) => {
      const a = horseShapeStats([row(47.5, 38.0), row(47.9, 38.4), row(48.3, 38.8)], p)!;
      const b = horseShapeStats([row(48.1, 38.2), row(48.5, 38.6), row(48.9, 39.0)], p)!;
      return raceShapeSignals([a, b]);
    };
    const [o1, o2] = [mk(PAR), mk(PAR2)];
    expect(o2[1]!.predGap).toBeCloseTo(o1[1]!.predGap, 6);
    expect(o2[1]!.pAchieve!).toBeCloseTo(o1[1]!.pAchieve!, 6);
  });
});
