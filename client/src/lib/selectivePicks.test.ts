import { describe, it, expect } from 'vitest';
import { classifyPickWith, tierLabel } from './selectivePicks';

describe('classifyPickWith', () => {
  it('경계값 분류', () => {
    expect(classifyPickWith(0.9, 0.8, 0.6)).toBe('strong');
    expect(classifyPickWith(0.8, 0.8, 0.6)).toBe('strong');
    expect(classifyPickWith(0.7, 0.8, 0.6)).toBe('watch');
    expect(classifyPickWith(0.59, 0.8, 0.6)).toBe(null);
    expect(classifyPickWith(null, 0.8, 0.6)).toBe(null);
    expect(classifyPickWith(0.99, 0, 0)).toBe(null); // 비활성
  });
});

describe('tierLabel', () => {
  it('티어 라벨', () => {
    expect(tierLabel('strong')).toBe('강추');
    expect(tierLabel('watch')).toBe('주목');
    expect(tierLabel(null)).toBe(null);
  });
});
