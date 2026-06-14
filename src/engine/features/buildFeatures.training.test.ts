import { describe, it, expect } from 'vitest';
import { buildFeatures } from './buildFeatures.js';
import type { ScoreEngineInput } from '../index.js';

describe('buildFeatures + 조교', () => {
  it('raceDate·trainingHistory 있으면 조교 피처가 합류된다', () => {
    const input: ScoreEngineInput = {
      rating: 0,
      raceDate: 20260515,
      prevRaceDate: 20260501,
      trainingHistory: [
        { trainDate: 20260512, trTerm: 90, run1Cnt: 2, run2Cnt: 1, prGubun: '이기수' },
      ],
    };
    const fs = buildFeatures(input);
    const names = fs.map((f) => f.name);
    expect(names).toContain('train_has_data');
    expect(names).toContain('train_count');
    expect(fs.find((f) => f.name === 'train_count')?.value).toBe(1);
  });

  it('raceDate 없으면 조교 피처 미합류(기존 동작 보존)', () => {
    const fs = buildFeatures({ rating: 0 });
    expect(fs.map((f) => f.name).some((n) => n.startsWith('train_'))).toBe(false);
  });
});
