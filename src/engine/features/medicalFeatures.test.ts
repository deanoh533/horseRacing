import { describe, it, expect } from 'vitest';
import { medicalFeatures, parseLeadingYmd, isFatigueTrea } from './medicalFeatures.js';

const get = (fs: { name: string; value: number }[], n: string) =>
  fs.find((f) => f.name === n)?.value;

describe('parseLeadingYmd', () => {
  it('앞 10자 YYYY.MM.DD → 정수', () => {
    expect(parseLeadingYmd('2024.11.17인푸렌자예방접종,선역예방접종')).toBe(20241117);
    expect(parseLeadingYmd('2026.03.08 1회')).toBe(20260308);
  });
  it('null·빈문자·형식불일치 → null', () => {
    expect(parseLeadingYmd(null)).toBeNull();
    expect(parseLeadingYmd('')).toBeNull();
    expect(parseLeadingYmd('미상')).toBeNull();
  });
});

describe('isFatigueTrea', () => {
  it('피로/수액 포함 → true', () => {
    expect(isFatigueTrea('2025.05.20운동기인성 피로회복(수액처치)')).toBe(true);
    expect(isFatigueTrea('2025.05.20수액처치')).toBe(true);
  });
  it('예방접종 등은 false', () => {
    expect(isFatigueTrea('2024.11.17인푸렌자예방접종')).toBe(false);
    expect(isFatigueTrea(null)).toBe(false);
  });
});

describe('medicalFeatures', () => {
  it('데이터 없으면 플래그 0', () => {
    const fs = medicalFeatures({ latstBledg1: null, latstBledg2: null, latstTrea1: null, raceDate: 20250601 });
    expect(get(fs, 'med_bled_asof')).toBe(0);
    expect(get(fs, 'med_fatigue_asof')).toBe(0);
    expect(get(fs, 'med_bled_days_since')).toBeUndefined();
  });

  it('과거 출혈은 as-of 집계 + 최근성', () => {
    const fs = medicalFeatures({ latstBledg1: '2025.05.10 1회', latstBledg2: null, latstTrea1: null, raceDate: 20250601 });
    expect(get(fs, 'med_bled_asof')).toBe(1);
    expect(get(fs, 'med_bled_days_since')).toBe(22); // 0510→0601
  });

  it('미래 출혈은 제외(누수 방지)', () => {
    const fs = medicalFeatures({ latstBledg1: '2026.03.08 1회', latstBledg2: null, latstTrea1: null, raceDate: 20250601 });
    expect(get(fs, 'med_bled_asof')).toBe(0);
  });

  it('최근치료=피로/수액(과거)이면 fatigue 플래그', () => {
    const fs = medicalFeatures({ latstBledg1: null, latstBledg2: null, latstTrea1: '2025.05.20운동기인성 피로회복(수액처치)', raceDate: 20250601 });
    expect(get(fs, 'med_fatigue_asof')).toBe(1);
    expect(get(fs, 'med_fatigue_days_since')).toBe(12); // 0520→0601
  });

  it('예방접종 치료는 fatigue 아님', () => {
    const fs = medicalFeatures({ latstBledg1: null, latstBledg2: null, latstTrea1: '2025.05.20인푸렌자예방접종', raceDate: 20250601 });
    expect(get(fs, 'med_fatigue_asof')).toBe(0);
  });
});
