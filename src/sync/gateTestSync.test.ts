import { describe, it, expect } from 'vitest';
import { eachDate, backfillGateTests, syncRecentGateTests, MAX_TRNO, MAX_CONSECUTIVE_FAILURES, parseBackfillRange, type GateStore } from './gateTestSync.js';
import type { GateClient, GateTestRow } from '../kra/gateTest.js';

// 테스트용 HTML 생성기 — 실제 페이지와 같은 구조(caption·tbody·16칸·goPage1)
const roundHtml = (horses: string[]) => `<caption>주행심사결과를 순위...</caption><tbody>${horses.map((h, i) =>
  `<tr><td>${i + 1}</td><td>${i + 1}</td><td><a onclick="javascript:goPage1('${h}','1')">말${h}</a></td>` +
  `<td>주행미합(신)</td><td>한국</td><td>수</td><td>2</td><td>53</td><td>기수</td><td>조교사</td><td>마주</td>` +
  `<td>450</td><td>1:03.${i}</td><td></td><td>합격</td><td></td></tr>`).join('')}</tbody>`;
const EMPTY = '<caption>주행심사결과를 순위...</caption><tbody></tbody>';
const listHtml = (rows: Array<{ date: number; trnos: number[]; entries: number }>) => `<tbody>${rows.map((r, i) =>
  `<tr><td>${i + 1}</td><td>결과표</td><td>x</td><td>${r.trnos.map((t) => `<a onclick='goPage1("${t}","${r.date}")'>${t}</a>`).join('')}</td>` +
  `<td>${r.entries}</td><td>0</td><td>0</td></tr>`).join('')}</tbody>`;

function fakeClient(rounds: Record<string, string[] | 'fail' | { raw: string }>, lists: Record<number, string | 'fail'> = {}) {
  const calls: string[] = [];
  const client: GateClient = {
    async fetchRound(meet, date, trno) {
      const k = `${meet}|${date}|${trno}`; calls.push(k);
      const v = rounds[k];
      if (v === 'fail') throw new Error('boom');
      if (v && !Array.isArray(v)) return v.raw;
      return v ? roundHtml(v) : EMPTY;
    },
    async fetchList(meet) {
      calls.push(`list${meet}`);
      const v = lists[meet];
      if (v === 'fail') throw new Error('boom');
      return v ?? '<html>점검</html>';
    },
  };
  return { client, calls };
}

function fakeStore(initial: Array<{ test_date: number; meet: number; trno: number }> = []) {
  const saved: GateTestRow[] = [];
  const store: GateStore = {
    async existing(from, to) { return initial.filter((r) => r.test_date >= from && r.test_date <= to); },
    async upsert(rows) { saved.push(...rows); },
  };
  return { store, saved };
}

describe('eachDate', () => {
  it('달·해 경계를 넘는다', () => {
    expect(eachDate(20231230, 20240102)).toEqual([20231230, 20231231, 20240101, 20240102]);
  });
});

describe('backfillGateTests', () => {
  it('회차 1부터 빈 표가 나올 때까지 받고 저장', async () => {
    const { client, calls } = fakeClient({ '1|20240104|1': ['0000001', '0000002'], '1|20240104|2': ['0000003'] });
    const { store, saved } = fakeStore();
    const rep = await backfillGateTests(client, store, 20240104, 20240104, { meets: [1] });
    expect(calls).toEqual(['1|20240104|1', '1|20240104|2', '1|20240104|3']);
    expect(saved.map((r) => r.hr_no)).toEqual(['0000001', '0000002', '0000003']);
    expect(rep).toMatchObject({ rounds: 2, rows: 3, failures: [] });
  });

  it('도중에 끊긴 날짜는 남은 회차부터 이어 받는다(이미 있는 회차는 요청 안 함)', async () => {
    const { client, calls } = fakeClient({ '1|20240104|3': ['0000009'] });
    const { store, saved } = fakeStore([
      { test_date: 20240104, meet: 1, trno: 1 }, { test_date: 20240104, meet: 1, trno: 2 },
    ]);
    await backfillGateTests(client, store, 20240104, 20240104, { meets: [1] });
    expect(calls).toEqual(['1|20240104|3', '1|20240104|4']);
    expect(saved.map((r) => r.hr_no)).toEqual(['0000009']);
  });

  it('요청 실패는 기록하고 다음 날짜로 계속', async () => {
    const { client } = fakeClient({ '1|20240104|1': 'fail', '1|20240105|1': ['0000005'] });
    const { store, saved } = fakeStore();
    const rep = await backfillGateTests(client, store, 20240104, 20240105, { meets: [1] });
    expect(rep.failures).toEqual(['m1 20240104 회차1: boom']);
    expect(saved.map((r) => r.hr_no)).toEqual(['0000005']);
  });

  it('캡션 없는 페이지(점검·오류)는 실패로 기록, 저장 없이 다음 날짜로 계속', async () => {
    const { client } = fakeClient({ '1|20240104|1': { raw: '<html>점검 중</html>' }, '1|20240105|1': ['0000005'] });
    const { store, saved } = fakeStore();
    const rep = await backfillGateTests(client, store, 20240104, 20240105, { meets: [1] });
    expect(rep.failures).toEqual(['m1 20240104 회차1: 결과표 없음(점검·오류 페이지?)']);
    expect(saved.map((r) => r.hr_no)).toEqual(['0000005']);
  });

  it('캡션은 있으나 행이 전부 깨졌으면 실패로 기록', async () => {
    const raw = '<caption>주행심사결과를 순위</caption><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody>';
    const { client } = fakeClient({ '1|20240104|1': { raw } });
    const { store, saved } = fakeStore();
    const rep = await backfillGateTests(client, store, 20240104, 20240104, { meets: [1] });
    expect(rep.failures).toEqual(['m1 20240104 회차1: 행 파싱 실패 1행(마크업 변경?)']);
    expect(saved).toEqual([]);
  });

  it('연속 실패가 MAX_CONSECUTIVE_FAILURES에 닿으면 중단', async () => {
    const calls: string[] = [];
    const client: GateClient = {
      async fetchRound(m, d, t) { calls.push(`${m}|${d}|${t}`); throw new Error('boom'); },
      async fetchList() { return ''; },
    };
    const rep = await backfillGateTests(client, fakeStore().store, 20240101, 20240130, { meets: [1] });
    expect(calls).toHaveLength(MAX_CONSECUTIVE_FAILURES);
    expect(rep.failures).toHaveLength(MAX_CONSECUTIVE_FAILURES + 1);
    expect(rep.failures.at(-1)).toBe(`연속 실패 ${MAX_CONSECUTIVE_FAILURES}회 — 사이트 차단·장애 의심, 중단(다시 실행하면 이어받음)`);
  });

  it('빈 표가 끝내 안 나와도 MAX_TRNO에서 멈춘다', async () => {
    const rounds: Record<string, string[]> = {};
    for (let t = 1; t <= MAX_TRNO + 5; t++) rounds[`1|20240104|${t}`] = [`00000${t}`];
    const { client, calls } = fakeClient(rounds);
    await backfillGateTests(client, fakeStore().store, 20240104, 20240104, { meets: [1] });
    expect(calls).toHaveLength(MAX_TRNO);
  });
});

describe('syncRecentGateTests', () => {
  it('목록에서 DB에 없는 회차만 받는다', async () => {
    const { client, calls } = fakeClient(
      { '1|20261001|2': ['0000002'] },
      { 1: listHtml([{ date: 20261001, trnos: [1, 2], entries: 2 }]) },
    );
    const { store, saved } = fakeStore([{ test_date: 20261001, meet: 1, trno: 1 }]);
    const rep = await syncRecentGateTests(client, store, { meets: [1] });
    expect(calls).toEqual(['list1', '1|20261001|2']);
    expect(saved).toHaveLength(1);
    expect(rep).toMatchObject({ rounds: 1, rows: 1, failures: [], shortfalls: [] });
  });

  it('저장 행 수가 편성두수보다 적으면 shortfall', async () => {
    const { client } = fakeClient(
      { '1|20261001|1': ['0000001'] },
      { 1: listHtml([{ date: 20261001, trnos: [1], entries: 10 }]) },
    );
    const rep = await syncRecentGateTests(client, fakeStore().store, { meets: [1] });
    expect(rep.shortfalls).toEqual(['m1 20261001 저장 1/편성 10']);
  });

  it('목록이 비었거나(점검 페이지) 실패하면 failures에 남긴다 — 조용히 0건 금지', async () => {
    const { client } = fakeClient({}, { 1: '<html>점검</html>', 3: 'fail' });
    const rep = await syncRecentGateTests(client, fakeStore().store, { meets: [1, 3] });
    expect(rep.failures).toEqual(['목록 m1', '목록 m3: boom']);
  });

  it('existing은 행 단위 — 같은 회차 2행이면 요청 없이 편성 2와 일치, 3이면 shortfall', async () => {
    const two = [{ test_date: 20261001, meet: 1, trno: 1 }, { test_date: 20261001, meet: 1, trno: 1 }];
    const a = fakeClient({}, { 1: listHtml([{ date: 20261001, trnos: [1], entries: 2 }]) });
    const repA = await syncRecentGateTests(a.client, fakeStore(two).store, { meets: [1] });
    expect(a.calls).toEqual(['list1']);
    expect(repA.shortfalls).toEqual([]);
    const b = fakeClient({}, { 1: listHtml([{ date: 20261001, trnos: [1], entries: 3 }]) });
    const repB = await syncRecentGateTests(b.client, fakeStore(two).store, { meets: [1] });
    expect(repB.shortfalls).toEqual(['m1 20261001 저장 2/편성 3']);
  });
});

describe('parseBackfillRange', () => {
  it('둘 다 없으면 recent', () => { expect(parseBackfillRange(undefined, undefined)).toBe('recent'); });
  it('정상 쌍', () => { expect(parseBackfillRange('20220101', '20261004')).toEqual({ from: 20220101, to: 20261004 }); });
  it.each([
    ['20220101', undefined], [undefined, '20220101'], ['2022', '20220101'],
    ['20220102', '20220101'], ['2022010a', '20220101'],
  ])('잘못된 입력 %s, %s → null', (f, t) => { expect(parseBackfillRange(f, t)).toBeNull(); });
});
