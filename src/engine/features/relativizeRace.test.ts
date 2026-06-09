import { describe, it, expect } from 'vitest';
import { relativizeRace, RELATIVIZE_FEATURES } from './relativizeRace.js';
import type { Feature } from './types.js';

const z = (fs: Feature[], name: string) => fs.find((f) => f.name === name)?.value;
// 로직 검증용 명시 리스트 (프로덕션 RELATIVIZE_FEATURES는 z 종결로 비어있음)
const LIST = ['speed_ability_raw'];

describe('relativizeRace (로직 — 명시 리스트)', () => {
  it('지정 피처에 경주 내 z-score(_z)를 추가 (모집단 표준편차)', () => {
    const race: Feature[][] = [
      [{ name: 'speed_ability_raw', value: 10 }],
      [{ name: 'speed_ability_raw', value: 20 }],
      [{ name: 'speed_ability_raw', value: 30 }],
    ];
    const out = relativizeRace(race, LIST);
    // mean 20, popStd = sqrt((100+0+100)/3) = 8.16497
    expect(z(out[0]!, 'speed_ability_raw_z')!).toBeCloseTo(-1.22474, 4);
    expect(z(out[1]!, 'speed_ability_raw_z')!).toBeCloseTo(0, 6);
    expect(z(out[2]!, 'speed_ability_raw_z')!).toBeCloseTo(1.22474, 4);
  });

  it('원본 절대값 피처는 그대로 보존', () => {
    const race: Feature[][] = [
      [{ name: 'speed_ability_raw', value: 80 }],
      [{ name: 'speed_ability_raw', value: 90 }],
    ];
    const out = relativizeRace(race, LIST);
    expect(z(out[0]!, 'speed_ability_raw')).toBe(80);
    expect(z(out[1]!, 'speed_ability_raw')).toBe(90);
  });

  it('리스트에 없는 피처는 _z를 만들지 않음', () => {
    const race: Feature[][] = [
      [{ name: 'hist_n', value: 3 }, { name: 'sex_mare', value: 1 }],
      [{ name: 'hist_n', value: 5 }, { name: 'sex_mare', value: 0 }],
    ];
    const out = relativizeRace(race, LIST);
    expect(z(out[0]!, 'hist_n_z')).toBeUndefined();
    expect(z(out[0]!, 'sex_mare_z')).toBeUndefined();
  });

  it('__missing=1인 말은 통계에서 제외하고 _z도 안 붙음', () => {
    const race: Feature[][] = [
      [{ name: 'speed_ability_raw', value: 10 }],
      [{ name: 'speed_ability_raw', value: 20 }],
      // 결측: value 0 + __missing 1
      [{ name: 'speed_ability_raw', value: 0 }, { name: 'speed_ability_raw__missing', value: 1 }],
    ];
    const out = relativizeRace(race, LIST);
    // 통계는 [10,20]만 → mean15, popStd=5
    expect(z(out[0]!, 'speed_ability_raw_z')!).toBeCloseTo(-1, 6);
    expect(z(out[1]!, 'speed_ability_raw_z')!).toBeCloseTo(1, 6);
    // 결측 말은 _z 없음
    expect(z(out[2]!, 'speed_ability_raw_z')).toBeUndefined();
  });

  it('표준편차 0이면 z=0', () => {
    const race: Feature[][] = [
      [{ name: 'speed_ability_raw', value: 5 }],
      [{ name: 'speed_ability_raw', value: 5 }],
    ];
    const out = relativizeRace(race, LIST);
    expect(z(out[0]!, 'speed_ability_raw_z')).toBe(0);
    expect(z(out[1]!, 'speed_ability_raw_z')).toBe(0);
  });

  it('present가 2미만이면 _z 생략 (필드 정보 부족)', () => {
    const race: Feature[][] = [
      [{ name: 'speed_ability_raw', value: 10 }],
      [{ name: 'rating_abs', value: 80 }],
    ];
    const out = relativizeRace(race, LIST);
    expect(z(out[0]!, 'speed_ability_raw_z')).toBeUndefined();
  });

  it('RELATIVIZE_FEATURES는 비어있음 (z 트랙 종결)', () => {
    expect(RELATIVIZE_FEATURES.length).toBe(0);
  });

  it('기본 리스트(빈 값)로는 _z를 만들지 않음', () => {
    const race: Feature[][] = [
      [{ name: 'speed_ability_raw', value: 10 }],
      [{ name: 'speed_ability_raw', value: 20 }],
    ];
    const out = relativizeRace(race); // 기본값 = RELATIVIZE_FEATURES(빈)
    expect(z(out[0]!, 'speed_ability_raw_z')).toBeUndefined();
  });
});
