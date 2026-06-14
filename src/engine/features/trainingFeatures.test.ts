import { describe, it, expect } from 'vitest';
import { trainingFeatures, isJockeyRidden } from './trainingFeatures.js';
import type { TrainingSession } from '../index.js';

const get = (fs: { name: string; value: number }[], n: string) =>
  fs.find((f) => f.name === n)?.value;

describe('isJockeyRidden', () => {
  it('역할코드(조/관/생)는 기수 아님', () => {
    expect(isJockeyRidden('조')).toBe(false);
    expect(isJockeyRidden('관')).toBe(false);
    expect(isJockeyRidden('생')).toBe(false);
  });
  it('이름/이름(트)/기타는 기수로 간주', () => {
    expect(isJockeyRidden('김기수')).toBe(true);
    expect(isJockeyRidden('박철수(트)')).toBe(true);
  });
  it('null·빈문자는 false', () => {
    expect(isJockeyRidden(null)).toBe(false);
    expect(isJockeyRidden('')).toBe(false);
  });
});

describe('trainingFeatures', () => {
  it('데이터 없으면 has_data=0', () => {
    const fs = trainingFeatures({ trainingHistory: [], prevRaceDate: 20260501, raceDate: 20260515 });
    expect(get(fs, 'train_has_data')).toBe(0);
    expect(get(fs, 'train_window_is_fallback')).toBe(0);
  });

  it('prep 윈도우[직전경주,경주) 내 조교만 집계', () => {
    const hist: TrainingSession[] = [
      { trainDate: 20260430, trTerm: 60, run1Cnt: 1, run2Cnt: 0, prGubun: '김기수' }, // 직전경주 이전 → 제외
      { trainDate: 20260505, trTerm: 70, run1Cnt: 2, run2Cnt: 0, prGubun: '조' },
      { trainDate: 20260512, trTerm: 90, run1Cnt: 2, run2Cnt: 1, prGubun: '이기수' },
    ];
    const fs = trainingFeatures({ trainingHistory: hist, prevRaceDate: 20260501, raceDate: 20260515 });
    expect(get(fs, 'train_has_data')).toBe(1);
    expect(get(fs, 'train_count')).toBe(2);                 // 05,12만
    expect(get(fs, 'train_days_since_last')).toBe(3);       // 0512→0515
    expect(get(fs, 'train_jockey_ridden_ratio')).toBeCloseTo(0.5); // 이기수만
    expect(get(fs, 'train_last_rider_is_jockey')).toBe(1);  // 0512=이기수
    expect(get(fs, 'train_term_mean')).toBeCloseTo(80);     // (70+90)/2
    expect(get(fs, 'train_term_last')).toBe(90);
  });

  it('신마(prevRaceDate=null)는 fallback 90일 + 플래그', () => {
    const hist: TrainingSession[] = [
      { trainDate: 20260510, trTerm: 50, run1Cnt: 1, run2Cnt: 0, prGubun: '조' },
    ];
    const fs = trainingFeatures({ trainingHistory: hist, prevRaceDate: null, raceDate: 20260515 });
    expect(get(fs, 'train_window_is_fallback')).toBe(1);
    expect(get(fs, 'train_has_data')).toBe(1);
    expect(get(fs, 'train_count')).toBe(1);
  });
});
