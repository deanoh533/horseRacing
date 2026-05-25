import { describe, it, expect } from 'vitest';
import { calculateTrainerFormScore } from './10_trainer_form';

describe('⑩ 조교사 폼 (60일)', () => {
  it('20회 미만 → 0.5 (중립)', () => {
    expect(calculateTrainerFormScore({ recent60DayOrds: [] })).toBe(0.5);
    expect(
      calculateTrainerFormScore({
        recent60DayOrds: [1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4],
      })
    ).toBe(0.5);
  });

  it('20회 출전 + 50% 입상 + 우승 보너스', () => {
    // 20회 중 1위 5, 2위 5, 3위 0, 나머지 10 → 입상률 0.5, 1등 보너스 (5/20)*0.2 = 0.05
    // expected = 0.5 + 0.05 = 0.55
    const ords = [
      ...Array(5).fill(1),
      ...Array(5).fill(2),
      ...Array(10).fill(10),
    ];
    expect(calculateTrainerFormScore({ recent60DayOrds: ords })).toBeCloseTo(0.55, 2);
  });

  it('20회 모두 1위 → 1.0 (만점 clamp)', () => {
    const ords = Array(20).fill(1);
    expect(calculateTrainerFormScore({ recent60DayOrds: ords })).toBe(1.0);
  });

  it('20회 모두 10위 → 0.0', () => {
    const ords = Array(20).fill(10);
    expect(calculateTrainerFormScore({ recent60DayOrds: ords })).toBe(0);
  });

  it('대량 데이터: 50회 중 입상률 40%, 1위 8회', () => {
    // 입상 20/50=0.4, 1등 보너스 8/50*0.2=0.032 → ~0.432
    const ords = [
      ...Array(8).fill(1),
      ...Array(6).fill(2),
      ...Array(6).fill(3),
      ...Array(30).fill(10),
    ];
    const score = calculateTrainerFormScore({ recent60DayOrds: ords });
    expect(score).toBeCloseTo(0.432, 2);
  });
});
