import { describe, it, expect } from 'vitest';
import { calculateLatePositionScore } from './05_late_position';

describe('⑤ 후반 구간 순위 (확장판)', () => {
  it('빈 입력 → 0.5 (중립)', () => {
    expect(calculateLatePositionScore({ positions: [] })).toBe(0.5);
  });

  it('field_size < 2 → 0.5 (불가)', () => {
    const score = calculateLatePositionScore({
      positions: [{ startOrd: 1, finishOrd: 1, fieldSize: 1 }],
    });
    expect(score).toBe(0.5);
  });

  it('1위 → 1위 (선두 유지, 8마 경주) → 매우 높은 점수', () => {
    // startR=0, finishR=0, finishScore=1, gainScore=0.5
    // total = 1*0.6 + 0.5*0.4 = 0.8
    const score = calculateLatePositionScore({
      positions: [{ startOrd: 1, finishOrd: 1, fieldSize: 8 }],
    });
    expect(score).toBeCloseTo(0.8, 1);
  });

  it('5위 → 1위 (강한 추월, 8마) → 만점 가까이', () => {
    // startR=4/7≈0.571, finishR=0
    // finishScore=1, gainScore=clamp(0.571*0.5+0.5)=0.786
    // total = 1*0.6 + 0.786*0.4 ≈ 0.914
    const score = calculateLatePositionScore({
      positions: [{ startOrd: 5, finishOrd: 1, fieldSize: 8 }],
    });
    expect(score).toBeGreaterThan(0.85);
  });

  it('1위 → 8위 (퇴보, 8마) → 낮은 점수', () => {
    // startR=0, finishR=1, finishScore=0
    // gainScore = clamp((0-1)*0.5+0.5) = clamp(0) = 0
    // total = 0
    const score = calculateLatePositionScore({
      positions: [{ startOrd: 1, finishOrd: 8, fieldSize: 8 }],
    });
    expect(score).toBeLessThan(0.1);
  });

  it('출전두수 정규화 확인 — 5마 1등 vs 14마 1등 같은 점수', () => {
    const small = calculateLatePositionScore({
      positions: [{ startOrd: 1, finishOrd: 1, fieldSize: 5 }],
    });
    const large = calculateLatePositionScore({
      positions: [{ startOrd: 1, finishOrd: 1, fieldSize: 14 }],
    });
    expect(small).toBeCloseTo(large, 2);
  });

  it('3시점 데이터 활용 (g1fOrd 포함)', () => {
    // 5위 → 3위 → 1위 (점진적 추격, 8마)
    const gradual = calculateLatePositionScore({
      positions: [{ startOrd: 5, finishOrd: 1, fieldSize: 8, g1fOrd: 3 }],
    });
    // 5위 → 1위 → 1위 (초반 추격 후 유지)
    const earlyBurst = calculateLatePositionScore({
      positions: [{ startOrd: 5, finishOrd: 1, fieldSize: 8, g1fOrd: 1 }],
    });
    // 두 점수 모두 결승선 1등이라 finishScore=1로 동일.
    // gain 패턴이 달라 약간 차이.
    expect(gradual).toBeGreaterThan(0.8);
    expect(earlyBurst).toBeGreaterThan(0.8);
  });

  it('front_run_success_rate 100% 선행마 보너스', () => {
    const base = calculateLatePositionScore({
      positions: [{ startOrd: 1, finishOrd: 2, fieldSize: 8 }],
    });
    const withBonus = calculateLatePositionScore({
      positions: [{ startOrd: 1, finishOrd: 2, fieldSize: 8 }],
      frontRunSuccessRate: 1.0,
    });
    // 출발 ratio 0 → ≤0.3 → 보너스 적용
    expect(withBonus).toBeGreaterThan(base);
  });

  it('front_run_success_rate 0% 선행마 페널티', () => {
    const base = calculateLatePositionScore({
      positions: [{ startOrd: 1, finishOrd: 2, fieldSize: 8 }],
    });
    const withPenalty = calculateLatePositionScore({
      positions: [{ startOrd: 1, finishOrd: 2, fieldSize: 8 }],
      frontRunSuccessRate: 0.0,
    });
    expect(withPenalty).toBeLessThan(base);
  });

  it('추입마(출발 후미)는 front_run_success_rate 영향 없음', () => {
    const base = calculateLatePositionScore({
      positions: [{ startOrd: 7, finishOrd: 1, fieldSize: 8 }],
    });
    const withRate = calculateLatePositionScore({
      positions: [{ startOrd: 7, finishOrd: 1, fieldSize: 8 }],
      frontRunSuccessRate: 1.0,
    });
    // 출발 ratio 6/7 ≈ 0.857 > 0.3 → multiplier 미적용
    expect(withRate).toBe(base);
  });

  it('가중 평균: 최근 경주 영향 가장 큼', () => {
    const recentGood = calculateLatePositionScore({
      positions: [
        { startOrd: 5, finishOrd: 1, fieldSize: 8 },
        { startOrd: 1, finishOrd: 5, fieldSize: 8 },
      ],
    });
    const recentBad = calculateLatePositionScore({
      positions: [
        { startOrd: 1, finishOrd: 5, fieldSize: 8 },
        { startOrd: 5, finishOrd: 1, fieldSize: 8 },
      ],
    });
    expect(recentGood).toBeGreaterThan(recentBad);
  });
});
