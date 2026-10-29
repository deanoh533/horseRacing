import { describe, it, expect } from 'vitest';
import { favSegment, confSegment, judgeBoxSegments, judgeFavH1, BOX_SEG_RULE, type SegTally } from './boxSegments.js';

const t = (cost: number, payout: number): SegTally => ({ races: cost / 600, hits: 0, cost, payout });

describe('구간 분류 (사전등록 2026-10-29 §2)', () => {
  it('인기 1위 단승 배당: ≤1.8 강함 · 1.9~2.9 보통 · 3.0+ 혼전', () => {
    expect(favSegment(1.8)).toBe('strong');
    expect(favSegment(1.9)).toBe('normal');
    expect(favSegment(2.9)).toBe('normal');
    expect(favSegment(3.0)).toBe('open');
  });
  it('모델 1순위 우승확률: 경계 0.246 / 0.338 고정', () => {
    expect(BOX_SEG_RULE.confCuts).toEqual([0.246, 0.338]);
    expect(confSegment(0.2459)).toBe('low');
    expect(confSegment(0.246)).toBe('mid');
    expect(confSegment(0.338)).toBe('high');
  });
});

describe('judgeBoxSegments (복승 기준 판정)', () => {
  it('H1: 보통 구간 회수율이 전체·강함·혼전보다 모두 높으면 통과', () => {
    const j = judgeBoxSegments({
      fav: { strong: t(600, 400), normal: t(600, 540), open: t(600, 420) },
      conf: { low: t(600, 500), mid: t(600, 550), high: t(600, 380) },
    });
    expect(j.h1).toBe(true);
    expect(j.h2).toBe(true);
  });
  it('H1: 보통이 혼전보다 낮으면 기각', () => {
    const j = judgeBoxSegments({
      fav: { strong: t(600, 400), normal: t(600, 500), open: t(600, 560) },
      conf: { low: t(600, 500), mid: t(600, 550), high: t(600, 380) },
    });
    expect(j.h1).toBe(false);
  });
  it('H2: 중간이 높음보다 높아도 전체보다 낮으면 기각', () => {
    const j = judgeBoxSegments({
      fav: { strong: t(600, 400), normal: t(600, 540), open: t(600, 420) },
      conf: { low: t(600, 590), mid: t(600, 470), high: t(600, 380) },
    });
    expect(j.overallConf).toBeCloseTo((590 + 470 + 380) / 1800, 6);
    expect(j.h2).toBe(false);
  });
  it('구간에 경주가 없으면 그 비교는 실패로 친다', () => {
    const j = judgeBoxSegments({
      fav: { strong: t(600, 400), normal: { races: 0, hits: 0, cost: 0, payout: 0 }, open: t(600, 420) },
      conf: { low: t(600, 500), mid: t(600, 550), high: t(600, 380) },
    });
    expect(j.h1).toBe(false);
  });
});

describe('judgeFavH1 (§7 과거 데이터 — H1만)', () => {
  it('judgeBoxSegments의 h1과 같은 판정', () => {
    const fav = { strong: t(600, 400), normal: t(600, 540), open: t(600, 420) };
    expect(judgeFavH1(fav)).toEqual({ h1: true, overall: (400 + 540 + 420) / 1800 });
    expect(judgeFavH1({ ...fav, normal: t(600, 410) }).h1).toBe(false);
  });
});
