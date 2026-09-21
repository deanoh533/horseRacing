import { describe, it, expect } from 'vitest';
import {
  summarizePools,
  diffSnapshots,
  hasMovement,
  type OddsSnapshot,
} from './oddsSnapshot.js';
import type { KRAComboDividend } from './client.js';

function item(
  pool: string,
  chulNo: number,
  chulNo2: number,
  odds: number,
  chulNo3 = 0
): KRAComboDividend {
  return { rcNo: 1, pool, chulNo, chulNo2, chulNo3, odds };
}

function snap(capturedAt: string, items: KRAComboDividend[]): OddsSnapshot {
  return { capturedAt, raceDate: 20260925, meet: 1, rcNo: 1, items };
}

describe('summarizePools', () => {
  it('pool별로 묶어 건수 많은 순으로 낸다', () => {
    const out = summarizePools([
      item('복승식', 1, 2, 10.5),
      item('쌍승식', 1, 2, 20.0),
      item('복승식', 1, 3, 7.2),
      item('복승식', 2, 3, 30.0),
    ]);

    expect(out.map((p) => p.pool)).toEqual(['복승식', '쌍승식']);
    expect(out[0]).toMatchObject({ count: 3, minOdds: 7.2, maxOdds: 30.0 });
    expect(out[1]).toMatchObject({ count: 1, minOdds: 20.0, maxOdds: 20.0 });
  });

  it('빈 입력은 빈 배열', () => {
    expect(summarizePools([])).toEqual([]);
  });
});

describe('diffSnapshots', () => {
  it('배당이 바뀐 조합·새 조합·사라진 조합을 센다', () => {
    const prev = snap('2026-09-25T12:00:00+09:00', [
      item('복승식', 1, 2, 10.0),
      item('복승식', 1, 3, 7.0),
      item('복승식', 2, 3, 30.0),
    ]);
    const next = snap('2026-09-25T12:40:00+09:00', [
      item('복승식', 1, 2, 11.5), // 변함
      item('복승식', 1, 3, 7.0), // 그대로
      item('복승식', 1, 4, 55.0), // 새로 생김
    ]);

    const [d] = diffSnapshots(prev, next);
    expect(d).toMatchObject({
      pool: '복승식',
      changed: 1,
      unchanged: 1,
      added: 1,
      removed: 1,
    });
    expect(d!.samples).toEqual([{ combo: '1-2', from: 10.0, to: 11.5 }]);
  });

  it('전부 같으면 변화 0', () => {
    const items = [item('복승식', 1, 2, 10.0), item('쌍승식', 1, 2, 20.0)];
    const d = diffSnapshots(snap('t1', items), snap('t2', items));
    expect(d.every((p) => p.changed === 0 && p.added === 0 && p.removed === 0)).toBe(true);
  });

  it('한쪽에만 있는 pool도 낸다', () => {
    const prev = snap('t1', [item('복승식', 1, 2, 10.0)]);
    const next = snap('t2', [item('복승식', 1, 2, 10.0), item('삼복승식', 1, 2, 99.0, 3)]);

    const byPool = Object.fromEntries(diffSnapshots(prev, next).map((d) => [d.pool, d]));
    expect(byPool['삼복승식']).toMatchObject({ added: 1, changed: 0, removed: 0 });
  });

  it('3마리 조합은 세 번째 말까지 봐야 다른 조합이다', () => {
    const prev = snap('t1', [item('삼복승식', 1, 2, 50.0, 3)]);
    const next = snap('t2', [item('삼복승식', 1, 2, 50.0, 4)]);

    const [d] = diffSnapshots(prev, next);
    expect(d).toMatchObject({ added: 1, removed: 1, changed: 0 });
  });

  it('같은 조합이 중복으로 오면 마지막 값을 쓴다', () => {
    const prev = snap('t1', [item('복승식', 1, 2, 10.0)]);
    const next = snap('t2', [item('복승식', 1, 2, 10.0), item('복승식', 1, 2, 12.0)]);

    const [d] = diffSnapshots(prev, next);
    expect(d).toMatchObject({ changed: 1, unchanged: 0 });
  });

  it('샘플은 최대 5건까지만', () => {
    const prev = snap('t1', Array.from({ length: 9 }, (_, i) => item('복승식', 1, i + 2, 10.0)));
    const next = snap('t2', Array.from({ length: 9 }, (_, i) => item('복승식', 1, i + 2, 11.0)));

    const [d] = diffSnapshots(prev, next);
    expect(d!.changed).toBe(9);
    expect(d!.samples).toHaveLength(5);
  });
});

describe('hasMovement', () => {
  it('배당이 바뀌었으면 움직인 것', () => {
    expect(hasMovement([{ pool: '복승식', added: 0, removed: 0, changed: 2, unchanged: 5, samples: [] }])).toBe(true);
  });

  it('조합이 늘었어도 움직인 것 (발매 진행 중 신호)', () => {
    expect(hasMovement([{ pool: '복승식', added: 3, removed: 0, changed: 0, unchanged: 5, samples: [] }])).toBe(true);
  });

  it('전부 그대로면 고정', () => {
    expect(hasMovement([{ pool: '복승식', added: 0, removed: 0, changed: 0, unchanged: 5, samples: [] }])).toBe(false);
  });
});
