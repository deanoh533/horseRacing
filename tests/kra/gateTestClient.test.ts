import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGateClient } from '../../src/kra/gateTest.js';

const eucBytes = readFileSync(new URL('./fixtures/gate_round_20261001_m1_t1.html', import.meta.url));
const ok = () => new Response(eucBytes, { status: 200 });

describe('createGateClient', () => {
  it('상세 요청: POST 본문에 trno·date·meet·Act·Sub, EUC-KR 해독', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const client = createGateClient({
      delayMs: 0, retryDelayMs: 0,
      fetchImpl: (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return ok(); }) as typeof fetch,
    });
    const html = await client.fetchRound(1, 20261001, 1);
    expect(html).toContain('플로터');
    expect(calls[0]!.url).toBe('https://race.kra.co.kr/referee/RacingTrainCheckScoreTable.do');
    expect(calls[0]!.body).toBe('trno=1&date=20261001&meet=1&Act=07&Sub=8');
  });

  it('목록 요청: meet은 쿼리, pageIndex는 본문', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const client = createGateClient({
      delayMs: 0, retryDelayMs: 0,
      fetchImpl: (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return ok(); }) as typeof fetch,
    });
    await client.fetchList(3);
    expect(calls[0]!.url).toBe('https://race.kra.co.kr/referee/RacingTrainCheckList.do?Act=07&Sub=8&meet=3');
    expect(calls[0]!.body).toBe('pageIndex=1');
  });

  it('두 번 실패 후 세 번째 성공', async () => {
    let n = 0;
    const client = createGateClient({
      delayMs: 0, retryDelayMs: 0,
      fetchImpl: (async () => { n++; if (n < 3) throw new Error('ECONNRESET'); return ok(); }) as typeof fetch,
    });
    await expect(client.fetchRound(1, 20261001, 1)).resolves.toContain('플로터');
    expect(n).toBe(3);
  });

  it('HTTP 500도 실패로 보고 재시도, 3번 모두 실패하면 throw', async () => {
    let n = 0;
    const client = createGateClient({
      delayMs: 0, retryDelayMs: 0,
      fetchImpl: (async () => { n++; return new Response('err', { status: 500 }); }) as typeof fetch,
    });
    await expect(client.fetchRound(1, 20261001, 1)).rejects.toThrow(/20261001/);
    expect(n).toBe(3);
  });

  it('요청 사이에 delayMs만큼 쉰다', async () => {
    const t: number[] = [];
    const client = createGateClient({
      delayMs: 50, retryDelayMs: 0,
      fetchImpl: (async () => { t.push(Date.now()); return ok(); }) as typeof fetch,
    });
    await client.fetchRound(1, 20261001, 1);
    await client.fetchRound(1, 20261001, 2);
    expect(t[1]! - t[0]!).toBeGreaterThanOrEqual(45);
  });
});
