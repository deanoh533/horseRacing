import { describe, it, expect } from 'vitest';
import { calculateJockeyFormScore } from './09_jockey_form';

describe('⑨ 기수 폼 (입상 비율 + 1등 보너스)', () => {
  it('데이터 부족 (5회 미만) → 0.5 중립', () => {
    expect(
      calculateJockeyFormScore({ recent30DayOrds: [1, 2, 3] })
    ).toBe(0.5);
  });

  it('20번 출전, 모두 1등 → 1.0 만점', () => {
    const ords = Array(20).fill(1);
    expect(calculateJockeyFormScore({ recent30DayOrds: ords })).toBe(1.0);
  });

  it('20번 출전, 모두 입상 (입상률 100%) → 1.0', () => {
    // 10번 1등 + 10번 2등 = 입상률 100% + 1등 비율 50% × 0.2 = 1.0 clamp
    const ords = [
      ...Array(10).fill(1),
      ...Array(10).fill(2),
    ];
    expect(calculateJockeyFormScore({ recent30DayOrds: ords })).toBe(1.0);
  });

  it('사용자 노하우: 5번 입상 (꾸준) > 1번 우승 (간헐)', () => {
    // 20번 중 5번 입상 + 0번 1등
    const consistent = calculateJockeyFormScore({
      recent30DayOrds: [
        ...Array(5).fill(2),
        ...Array(15).fill(5),
      ],
    });
    // 20번 중 1번 1등 + 0번 입상
    const occasional = calculateJockeyFormScore({
      recent30DayOrds: [
        1,
        ...Array(19).fill(5),
      ],
    });
    expect(consistent).toBeGreaterThan(occasional);
  });

  it('20번 출전 (1등 10 / 입상 15) → 정확히 0.85', () => {
    const ords = [
      ...Array(10).fill(1),
      ...Array(5).fill(2),
      ...Array(5).fill(5),
    ];
    // top3Rate = 15/20 = 0.75 + top1Rate(0.5) × 0.2 = 0.10
    expect(calculateJockeyFormScore({ recent30DayOrds: ords })).toBeCloseTo(
      0.85,
      2
    );
  });
});
