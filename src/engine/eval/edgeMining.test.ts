import { describe, it, expect } from 'vitest';
import { conditionRace } from './edgeMining.js';

describe('conditionRace — 버킷 경계', () => {
  it('배당대(분위수 기반): 1.8 이하 강한본명 / 2.9 초과 혼전', () => {
    expect(conditionRace({ favWinOdds: 1.8, fieldSize: 10, rcDist: 1200, favModelRank: 2 }).favOddsBand).toBe('fav<=1.8');
    expect(conditionRace({ favWinOdds: 3.0, fieldSize: 10, rcDist: 1200, favModelRank: 2 }).favOddsBand).toBe('fav>2.9');
  });
  it('두수: 9 이하 / 10~11 / 12 이상', () => {
    expect(conditionRace({ favWinOdds: 3, fieldSize: 9, rcDist: 1200, favModelRank: 2 }).fieldBand).toBe('field<=9');
    expect(conditionRace({ favWinOdds: 3, fieldSize: 12, rcDist: 1200, favModelRank: 2 }).fieldBand).toBe('field>=12');
  });
  it('거리: 1400 이하 단 / 1700 초과 장', () => {
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1400, favModelRank: 2 }).distBand).toBe('dist<=1400');
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1800, favModelRank: 2 }).distBand).toBe('dist>1700');
  });
  it('불일치 강도: 인기1위가 모델 2등=약 / 4등 이상=강', () => {
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1200, favModelRank: 2 }).disagreeStrength).toBe('dis2');
    expect(conditionRace({ favWinOdds: 3, fieldSize: 10, rcDist: 1200, favModelRank: 5 }).disagreeStrength).toBe('dis>=4');
  });
});
