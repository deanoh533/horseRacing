import { describe, it, expect } from 'vitest';
import { isStaleUnresolved, isCatchupTarget } from './catchupLogic.js';

describe('isCatchupTarget', () => {
  it('결과 구멍(hole·gap)은 재싱크 대상', () => {
    expect(isCatchupTarget('hole')).toBe(true);
    expect(isCatchupTarget('gap')).toBe(true);
  });

  // 2026-09-18: 조합배당만 빠진 날(partial)은 캐치업이 안 봐서 영구로 남을 수 있었다.
  // 재싱크(syncDay)가 끝난 경주의 조합배당을 전부 다시 받으므로 대상에 넣는다.
  it('조합배당 구멍(partial)도 재싱크 대상', () => {
    expect(isCatchupTarget('partial')).toBe(true);
  });

  it('정상·결과 대기는 대상 아님', () => {
    expect(isCatchupTarget('ok')).toBe(false);
    expect(isCatchupTarget('pending')).toBe(false);
  });
});

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
