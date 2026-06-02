import { describe, it, expect } from 'vitest';
import { calculateSpeedFigureScore, SPEED_FIGURE_LO, SPEED_FIGURE_HI } from './20_speed_figure.js';

describe('calculateSpeedFigureScore', () => {
  it('이력 없음(null) → 0.5 중립', () => {
    expect(calculateSpeedFigureScore({ abilityRaw: null })).toBe(0.5);
  });
  it('LO 이하 → 0', () => {
    expect(calculateSpeedFigureScore({ abilityRaw: SPEED_FIGURE_LO - 0.05 })).toBe(0);
  });
  it('HI 이상 → 1', () => {
    expect(calculateSpeedFigureScore({ abilityRaw: SPEED_FIGURE_HI + 0.05 })).toBe(1);
  });
  it('중간값 → 선형 0~1 사이', () => {
    const mid = (SPEED_FIGURE_LO + SPEED_FIGURE_HI) / 2;
    expect(calculateSpeedFigureScore({ abilityRaw: mid })).toBeCloseTo(0.5, 5);
  });
});
