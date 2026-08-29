import { describe, it, expect } from 'vitest';
import { isStaleUnresolved } from './catchupLogic.js';

describe('isStaleUnresolved', () => {
  const CUTOFF = 20260827; // 오늘 20260829 - 2일

  it('묵은 날짜(cutoff 이하)인데 이번에도 0건이면 true', () => {
    expect(isStaleUnresolved(20260823, CUTOFF, 0)).toBe(true);
    expect(isStaleUnresolved(20260827, CUTOFF, 0)).toBe(true); // 경계 포함
  });

  it('묵은 날짜라도 이번 시도로 뭔가 채워졌으면 false (진전 있음)', () => {
    expect(isStaleUnresolved(20260823, CUTOFF, 5)).toBe(false);
  });

  it('최근 날짜(cutoff보다 최신)면 0건이어도 false (정상 지연)', () => {
    expect(isStaleUnresolved(20260828, CUTOFF, 0)).toBe(false);
    expect(isStaleUnresolved(20260829, CUTOFF, 0)).toBe(false);
  });
});
