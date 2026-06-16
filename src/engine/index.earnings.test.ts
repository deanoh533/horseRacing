import { describe, it, expect } from 'vitest';
import { ScoreEngine } from './index.js';

/**
 * ⑱ 수득상금 누수 조치 — rawScore가 erng_sump(현재 스냅샷=누수)이 아니라
 * earningsAsof(과거-only 누적, 현재경주 제외)를 써야 한다.
 */
describe('18_earnings — as-of 누수 조치', () => {
  it('스냅샷 아닌 earningsAsof로 점수 산출', () => {
    const eng = new ScoreEngine();
    // 스냅샷 6억(→1.0), as-of 5백만(→0.25). as-of를 써야 0.25.
    const r = eng.calculateScores({ rating: 0, erngSump: 600_000_000, earningsAsof: 5_000_000 });
    expect(r.items['18_earnings']!.rawScore).toBeCloseTo(0.25, 6);
  });
  it('earningsAsof 결측이면 중립 0.5 (스냅샷으로 폴백 안 함)', () => {
    const eng = new ScoreEngine();
    const r = eng.calculateScores({ rating: 0, erngSump: 600_000_000 });
    expect(r.items['18_earnings']!.rawScore).toBeCloseTo(0.5, 6);
  });
});
