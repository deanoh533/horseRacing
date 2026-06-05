import { describe, it, expect } from 'vitest';
import { computeAsOfHorseStats, distCategoryOf, type AsOfPastRace } from './asOfHorseStats.js';

describe('computeAsOfHorseStats — 누수 방지 as-of 통계', () => {
  it('과거 경주 없으면 전부 null/undefined', () => {
    const r = computeAsOfHorseStats([], 'middle');
    expect(r.avgPositionRatio).toBeNull();
    expect(r.stddevPositionRatio).toBeNull();
    expect(r.frontRunSuccessRate).toBeUndefined();
    expect(r.distFinishRatio).toBeNull();
  });

  it('position 통계는 ≥3경주부터 산출(뷰 HAVING≥3)', () => {
    const two: AsOfPastRace[] = [
      { s1fOrd: 1, ord: 1, fieldSize: 11, distCategory: 'middle' },
      { s1fOrd: 2, ord: 2, fieldSize: 11, distCategory: 'middle' },
    ];
    expect(computeAsOfHorseStats(two, 'middle').avgPositionRatio).toBeNull();

    const three = [...two, { s1fOrd: 3, ord: 3, fieldSize: 11, distCategory: 'middle' as const }];
    expect(computeAsOfHorseStats(three, 'middle').avgPositionRatio).not.toBeNull();
  });

  it('position_ratio = (s1fOrd-1)/(fieldSize-1) 평균', () => {
    // 11두 경주: s1fOrd 1,1,1 → ratio 0,0,0 → avg 0 (항상 선두)
    const front: AsOfPastRace[] = [
      { s1fOrd: 1, ord: 1, fieldSize: 11, distCategory: 'short' },
      { s1fOrd: 1, ord: 2, fieldSize: 11, distCategory: 'short' },
      { s1fOrd: 1, ord: 1, fieldSize: 11, distCategory: 'short' },
    ];
    expect(computeAsOfHorseStats(front, 'short').avgPositionRatio).toBeCloseTo(0, 5);
  });

  it('frontRunSuccessRate = 출발상위30% 중 결승상위30% 비율', () => {
    // 11두: pos≤0.3 → s1fOrd ≤ 4 (=(4-1)/10=0.3). fin≤0.3 → ord ≤ 4
    const races: AsOfPastRace[] = [
      { s1fOrd: 1, ord: 1, fieldSize: 11, distCategory: 'middle' }, // 선두→성공
      { s1fOrd: 2, ord: 9, fieldSize: 11, distCategory: 'middle' }, // 선두→실패
      { s1fOrd: 3, ord: 2, fieldSize: 11, distCategory: 'middle' }, // 선두→성공
      { s1fOrd: 10, ord: 10, fieldSize: 11, distCategory: 'middle' }, // 후미(분모 제외)
    ];
    // 선두 3경주 중 2 성공 → 0.667
    expect(computeAsOfHorseStats(races, 'middle').frontRunSuccessRate).toBeCloseTo(2 / 3, 5);
  });

  it('distFinishRatio는 현재 거리 카테고리만, ≥2경주', () => {
    const races: AsOfPastRace[] = [
      { s1fOrd: 1, ord: 1, fieldSize: 11, distCategory: 'short' }, // fin 0.0
      { s1fOrd: 5, ord: 6, fieldSize: 11, distCategory: 'short' }, // fin 0.5
      { s1fOrd: 2, ord: 11, fieldSize: 11, distCategory: 'long' }, // 다른 거리 → 제외
    ];
    // short 2경주: (0.0 + 0.5)/2 = 0.25
    expect(computeAsOfHorseStats(races, 'short').distFinishRatio).toBeCloseTo(0.25, 5);
    // long은 1경주뿐 → null
    expect(computeAsOfHorseStats(races, 'long').distFinishRatio).toBeNull();
  });

  it('fieldSize<2 경주는 무시', () => {
    const races: AsOfPastRace[] = [
      { s1fOrd: 1, ord: 1, fieldSize: 1, distCategory: 'middle' },
      { s1fOrd: 1, ord: 1, fieldSize: 1, distCategory: 'middle' },
      { s1fOrd: 1, ord: 1, fieldSize: 1, distCategory: 'middle' },
    ];
    expect(computeAsOfHorseStats(races, 'middle').avgPositionRatio).toBeNull();
  });

  it('distCategoryOf 경계', () => {
    expect(distCategoryOf(1399)).toBe('short');
    expect(distCategoryOf(1400)).toBe('middle');
    expect(distCategoryOf(1800)).toBe('middle');
    expect(distCategoryOf(1801)).toBe('long');
    expect(distCategoryOf(null)).toBeNull();
  });
});

describe('computeAsOfHorseStats — 통산 클래스 신호 (earnings 누수 대체)', () => {
  it('과거 없으면 careerN=0, ratio/rate=null', () => {
    const r = computeAsOfHorseStats([], 'middle');
    expect(r.careerN).toBe(0);
    expect(r.careerFinishRatio).toBeNull();
    expect(r.careerPlaceRate).toBeNull();
  });

  it('careerFinishRatio = (ord-1)/(fieldSize-1) 평균, careerN=유효경주수', () => {
    const past: AsOfPastRace[] = [
      { s1fOrd: null, ord: 1, fieldSize: 11, distCategory: 'middle' },  // ratio 0
      { s1fOrd: null, ord: 11, fieldSize: 11, distCategory: 'middle' }, // ratio 1
    ];
    const r = computeAsOfHorseStats(past, 'middle');
    expect(r.careerFinishRatio).toBeCloseTo(0.5, 5);
    expect(r.careerN).toBe(2);
  });

  it('careerPlaceRate: 8두↑는 3착내 입상', () => {
    const past: AsOfPastRace[] = [
      { s1fOrd: null, ord: 3, fieldSize: 10, distCategory: 'middle' }, // 입상
      { s1fOrd: null, ord: 4, fieldSize: 10, distCategory: 'middle' }, // 비입상
    ];
    expect(computeAsOfHorseStats(past, 'middle').careerPlaceRate).toBeCloseTo(0.5, 5);
  });

  it('careerPlaceRate: 5~7두는 2착내만 입상', () => {
    const past: AsOfPastRace[] = [
      { s1fOrd: null, ord: 2, fieldSize: 6, distCategory: 'middle' }, // 입상
      { s1fOrd: null, ord: 3, fieldSize: 6, distCategory: 'middle' }, // 비입상(6두라 3착은 미입상)
    ];
    expect(computeAsOfHorseStats(past, 'middle').careerPlaceRate).toBeCloseTo(0.5, 5);
  });

  it('careerPlaceRate: 4두↓는 연승 미발매라 분모서 제외 (단 finishRatio엔 포함)', () => {
    const past: AsOfPastRace[] = [
      { s1fOrd: null, ord: 1, fieldSize: 4, distCategory: 'middle' },  // place 제외, finish 포함
      { s1fOrd: null, ord: 1, fieldSize: 10, distCategory: 'middle' }, // 입상
    ];
    const r = computeAsOfHorseStats(past, 'middle');
    expect(r.careerPlaceRate).toBeCloseTo(1.0, 5); // 1/1 (4두 경주 제외)
    expect(r.careerN).toBe(2);                     // finishRatio는 fieldSize>=2라 둘 다
  });
});
