import { describe, it, expect } from 'vitest';
import { buildFeatures } from './buildFeatures.js';
import type { ScoreEngineInput } from '../index.js';

describe('buildFeatures + 의료', () => {
  it('raceDate·의료필드 있으면 의료 피처 합류', () => {
    const input: ScoreEngineInput = {
      rating: 0,
      raceDate: 20250601,
      latstBledg1: '2025.05.10 1회',
      latstTrea1: '2025.05.20운동기인성 피로회복(수액처치)',
    };
    const names = buildFeatures(input).map((f) => f.name);
    expect(names).toContain('med_bled_asof');
    expect(names).toContain('med_fatigue_asof');
  });

  it('raceDate 없으면 의료 피처 미합류', () => {
    const names = buildFeatures({ rating: 0 }).map((f) => f.name);
    expect(names.some((n) => n.startsWith('med_'))).toBe(false);
  });
});
