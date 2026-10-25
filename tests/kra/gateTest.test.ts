import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { toSeconds, decodeEucKr, parseGateRound, parseGateList } from '../../src/kra/gateTest.js';

const fx = (name: string) => decodeEucKr(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe('toSeconds', () => {
  it('분:초 → 초', () => {
    expect(toSeconds('1:03.4')).toBeCloseTo(63.4, 10);
    expect(toSeconds('1:08.4')).toBeCloseTo(68.4, 10);
  });
  it('초만 있으면 그대로, 비었거나 기호면 null', () => {
    expect(toSeconds('63.4')).toBeCloseTo(63.4, 10);
    expect(toSeconds('')).toBeNull();
    expect(toSeconds('-')).toBeNull();
    expect(toSeconds('심사제외')).toBeNull();
  });
});

describe('parseGateRound', () => {
  const { rows, skipped, found } = parseGateRound(fx('gate_round_20261001_m1_t1.html'), 1, 20261001, 1);

  it('정상 회차: 12행, 건너뛴 행 0', () => {
    expect(rows).toHaveLength(12);
    expect(skipped).toBe(0);
    expect(found).toBe(true);
  });

  it('첫 행 전 필드', () => {
    expect(rows[0]).toEqual({
      test_date: 20261001, meet: 1, trno: 1,
      hr_no: '0056500', hr_name: '플로터', rank: 1, gate_no: 8,
      reason: '주행미합(신)', origin: '한국', sex: '수', age: 2, burden: '53+ 1.0',
      jockey: '김효정', trainer: '신삼영', owner: '이영해', body_weight: 496,
      time_sec: 63.4, margin: null, verdict: '합격', verdict_reason: null,
      track_cond: '건조 ( 3％ )',
    });
  });

  it('순위·기록 없는 심사제외 행도 버리지 않고 null로 저장', () => {
    const last = rows[11]!;
    expect(last.hr_no).toBe('0057120');
    expect(last.hr_name).toBe('천둥의비상');
    expect(last.rank).toBeNull();
    expect(last.time_sec).toBeNull();
    expect(last.margin).toBe('심사제외');
    expect(last.verdict).toBe('불합격');
    expect(last.verdict_reason).toBe('진입불량');
  });

  it('빈 표(심사 없는 날짜·회차) → 0행', () => {
    expect(parseGateRound(fx('gate_round_empty.html'), 1, 20251002, 9)).toEqual({ rows: [], skipped: 0, found: true });
  });

  it('표가 아예 없는 페이지(점검·오류) → 0행', () => {
    expect(parseGateRound('<html><body>점검 중</body></html>', 1, 20251002, 1)).toEqual({ rows: [], skipped: 0, found: false });
  });

  it('캡션은 있고 짧은 깨진 행 1개 + 정상 행 1개 → rows 1, skipped 1', () => {
    const good = fx('gate_round_20261001_m1_t1.html').split('<tr>').slice(1).find((t) => t.includes('goPage1'))!;
    const html = `<caption>주행심사결과를 순위</caption><tbody><tr><td>1</td><td>2</td><td>3</td></tr><tr>${good.split('</tbody>')[0]}</tbody>`;
    const r = parseGateRound(html, 1, 20261001, 1);
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toBe(1);
    expect(r.found).toBe(true);
  });
});

describe('parseGateList', () => {
  it('목록 행 → 날짜·회차·편성두수', () => {
    const list = parseGateList(fx('gate_list_m1.html'));
    expect(list.length).toBeGreaterThanOrEqual(10);
    expect(list[0]).toEqual({ date: 20261001, trnos: [1, 2, 3, 4, 5], entries: 60 });
  });
  it('목록 표가 없는 페이지 → []', () => {
    expect(parseGateList('<html><body>점검 중</body></html>')).toEqual([]);
  });
});
