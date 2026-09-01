import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * KRAClient 재시도(retry) 동작 검증.
 *
 * 배경: 무인 배치(GitHub Actions)에서 결과 sync가 KRA 결과 API(API214_1) 응답 지연으로
 * `timeout of 30000ms exceeded` 한 번에 배치 전체가 실패했다. 클라이언트에 재시도가
 * 전혀 없어 일시적 네트워크 지연이 곧바로 exit 1로 증폭됐다.
 * (원인: 로컬(한국 IP)은 정상, 러너에서 결과 엔드포인트만 간헐 지연 → 재시도 부재)
 *
 * 이 테스트는 axios를 페이크로 대체해 (1) 타임아웃/네트워크 오류는 지수 백오프로
 * 재시도하고 (2) 최대 시도 후 실패는 던지며 (3) 4xx 같은 비재시도 오류는 즉시
 * 던지는지를 검증한다.
 */

const { mockGet, createdConfig } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  // axios.create에 넘어간 설정을 붙잡아 기본값(타임아웃·커넥션 재사용)을 검증한다
  createdConfig: { value: undefined as Record<string, unknown> | undefined },
}));

vi.mock('axios', () => {
  const create = (cfg: Record<string, unknown>) => {
    createdConfig.value = cfg;
    return { get: mockGet };
  };
  const isAxiosError = (e: unknown): boolean =>
    Boolean(e && typeof e === 'object' && (e as { isAxiosError?: boolean }).isAxiosError);
  return { default: { create, isAxiosError }, isAxiosError };
});

vi.mock('@utils/env.js', () => ({
  getEnv: () => ({ KRA_API_KEY: 'test-key' }),
}));

// mock 등록 후 import (호이스팅된 mock이 먼저 적용되도록)
const { KRAClient } = await import('@kra/client.js');

/** 성공 응답(경주 결과 1건) */
function okResponse() {
  return {
    data: {
      response: {
        header: { resultCode: '00', resultMsg: 'NORMAL' },
        body: {
          items: { item: [{ rcNo: 1, hrName: '테스트마', ord: 1 }] },
          numOfRows: 100,
          pageNo: 1,
          totalCount: 1,
        },
      },
    },
  };
}

/** axios 타임아웃 오류 (응답 없음 → 재시도 대상) */
function timeoutError() {
  return { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' };
}

/** 4xx 오류 (응답 있음, <500 → 비재시도) */
function badRequestError() {
  return { isAxiosError: true, response: { status: 400 }, message: 'Bad Request' };
}

describe('KRAClient 재시도', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('타임아웃이 나면 지수 백오프로 재시도하고, 성공하면 결과를 반환한다', async () => {
    // 두 번 타임아웃 → 세 번째 성공
    mockGet
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(okResponse());

    const client = new KRAClient({ baseDelayMs: 0, maxAttempts: 4 });
    const rows = await client.getRaceResults({ meet: 1, rcDate: 20260726 });

    expect(rows).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledTimes(3);
  });

  it('최대 시도 횟수까지 계속 실패하면 오류를 던진다', async () => {
    mockGet.mockRejectedValue(timeoutError());

    const client = new KRAClient({ baseDelayMs: 0, maxAttempts: 4 });
    await expect(client.getRaceResults({ meet: 1, rcDate: 20260726 })).rejects.toThrow();
    expect(mockGet).toHaveBeenCalledTimes(4);
  });

  it('4xx 같은 비재시도 오류는 즉시 던진다 (재시도 안 함)', async () => {
    mockGet.mockRejectedValue(badRequestError());

    const client = new KRAClient({ baseDelayMs: 0, maxAttempts: 4 });
    await expect(client.getRaceResults({ meet: 1, rcDate: 20260726 })).rejects.toBeDefined();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('KRAClient.getComboDividends', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  /** integratedInfo 성공 응답 (조합 아이템 배열) */
  function comboResponse(items: unknown[], totalCount: number) {
    return {
      data: {
        response: {
          header: { resultCode: '00', resultMsg: 'NORMAL' },
          body: { items: { item: items }, numOfRows: 1000, pageNo: 1, totalCount },
        },
      },
    };
  }

  it('단일 페이지 조합배당을 파싱해 반환한다', async () => {
    mockGet.mockResolvedValueOnce(
      comboResponse(
        [
          { rcNo: 1, pool: '복승식', chulNo: 3, chulNo2: 7, chulNo3: 0, odds: 12.4 },
          { rcNo: 1, pool: '삼복승식', chulNo: 3, chulNo2: 7, chulNo3: 1, odds: 88.1 },
        ],
        2
      )
    );

    const client = new KRAClient({ baseDelayMs: 0, maxAttempts: 4 });
    const rows = await client.getComboDividends({ meet: 1, rcDate: 20260726, rcNo: 1 });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ pool: '복승식', chulNo: 3, chulNo2: 7, odds: 12.4 });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('totalCount가 페이지 크기를 넘으면 다음 페이지도 이어 받는다', async () => {
    mockGet
      .mockResolvedValueOnce(
        comboResponse([{ rcNo: 1, pool: '복승식', chulNo: 1, chulNo2: 2, chulNo3: 0, odds: 5 }], 3000)
      )
      .mockResolvedValueOnce(comboResponse([], 3000)); // 2페이지 빈 응답 → 종료

    const client = new KRAClient({ baseDelayMs: 0, maxAttempts: 4 });
    const rows = await client.getComboDividends({ meet: 1, rcDate: 20260726, rcNo: 1 });

    expect(rows).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});

/**
 * 기본값 회귀 — 2026-08-30 조정 근거를 고정한다.
 *
 * 실측(GitHub Actions 로그): 정상 응답은 1~4초. 그런데 타임아웃이 120초·5회여서
 * KRA가 무응답일 때 경마장 하나당 10분, 두 곳이면 20분을 태우고도 결국 실패했다
 * (2026-08-23 두 슬롯 실측). 무응답 구간에서는 인프로세스 재시도가 출발지 IP를
 * 못 바꿔 실효가 없고 — 같은 시각 다른 러너는 3분 뒤 성공했다 — 구멍은 다음 날
 * catchup(새 러너 = 새 IP)이 메운다. 그러니 빨리 포기하는 편이 낫다.
 */
describe('KRAClient 기본 설정', () => {
  beforeEach(() => {
    mockGet.mockReset();
    createdConfig.value = undefined;
  });

  it('기본 타임아웃은 30초 (정상 응답 1~4초의 약 8배 여유)', () => {
    new KRAClient();
    expect(createdConfig.value?.timeout).toBe(30_000);
  });

  it('재시도가 죽은 커넥션을 재사용하지 않도록 keep-alive를 끈다', () => {
    // Node 19+ 전역 agent는 keepAlive 기본 on이라, 무응답 소켓을 그대로 물고
    // 재시도하면 매 시도가 같은 조건이 된다. 매번 새로 dial하게 한다.
    new KRAClient();
    const agent = createdConfig.value?.httpsAgent as { options?: { keepAlive?: boolean } };
    expect(agent).toBeDefined();
    expect(agent.options?.keepAlive).toBe(false);
  });

  it('기본 시도 횟수는 4회 (첫 시도 + 재시도 3회)', async () => {
    mockGet.mockRejectedValue(timeoutError());
    const client = new KRAClient({ baseDelayMs: 0 }); // 대기만 제거, 횟수는 기본값
    await expect(client.getRaceResults({ meet: 1, rcDate: 20260726 })).rejects.toThrow();
    expect(mockGet).toHaveBeenCalledTimes(4);
  });
});
