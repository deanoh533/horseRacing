/**
 * KRA 공공데이터 포털 API 클라이언트
 *
 * 검증된 5개 엔드포인트:
 * 1. API214_1/RaceDetailResult_1   - 경주 결과 (말 단위)
 * 2. API4_3/raceResult_3            - 경주 기록 (동일)
 * 3. racedetailresult/getracedetailresult - 상세 (stOrd 포함)
 * 4. API284/HorseBloodBasicInfo     - 혈통 지수
 * 5. horseinfohi/gethorseinfohi     - 부마/모마
 */
import axios, { type AxiosInstance } from 'axios';
import pLimit from 'p-limit';
import { getEnv } from '@utils/env.js';
import type {
  KRARaceResult,
  KRARaceDetail,
  KRABloodInfo,
  KRAHorseInfo,
  MeetCode,
} from '@types/index.js';

const BASE_URL = 'https://apis.data.go.kr/B551015';

// 동시 요청 제한 (KRA API 부하 방지)
const limit = pLimit(5);

interface KRAResponse<T> {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      items: { item: T | T[] };
      numOfRows: number;
      pageNo: number;
      totalCount: number;
    };
  };
}

export class KRAClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor() {
    const env = getEnv();
    this.apiKey = env.KRA_API_KEY;
    this.client = axios.create({
      baseURL: BASE_URL,
      timeout: 30_000,
    });
  }

  /**
   * 응답 파싱 & 에러 처리
   */
  private parseResponse<T>(data: KRAResponse<T>): T[] {
    const code = data?.response?.header?.resultCode;

    if (code !== '00') {
      throw new Error(
        `KRA API 에러: ${data?.response?.header?.resultMsg ?? 'Unknown'} (${code})`
      );
    }

    const items = data?.response?.body?.items?.item;
    if (!items) return [];

    return Array.isArray(items) ? items : [items];
  }

  /**
   * API214_1: 경주 결과 (말 단위, 페이지네이션)
   */
  async getRaceResults(params: {
    meet: MeetCode;
    rcDate: number;
    pageNo?: number;
    numOfRows?: number;
  }): Promise<KRARaceResult[]> {
    return limit(async () => {
      const { data } = await this.client.get<KRAResponse<KRARaceResult>>(
        '/API214_1/RaceDetailResult_1',
        {
          params: {
            serviceKey: this.apiKey,
            meet: params.meet,
            rc_date: params.rcDate,
            pageNo: params.pageNo ?? 1,
            numOfRows: params.numOfRows ?? 100,
            _type: 'json',
          },
        }
      );
      return this.parseResponse(data);
    });
  }

  /**
   * API214_1 전체 페이지 자동 수집
   */
  async getAllRaceResults(params: {
    meet: MeetCode;
    rcDate: number;
  }): Promise<KRARaceResult[]> {
    const all: KRARaceResult[] = [];
    let pageNo = 1;
    const numOfRows = 100;

    while (true) {
      const page = await this.getRaceResults({
        ...params,
        pageNo,
        numOfRows,
      });
      if (page.length === 0) break;

      all.push(...page);
      if (page.length < numOfRows) break;

      pageNo++;
      if (pageNo > 50) break; // 안전장치
    }

    return all;
  }

  /**
   * racedetailresult: stOrd 포함 상세 정보
   */
  async getRaceDetailResult(params: {
    meet: MeetCode;
    rcDate: number;
    rcNo: number;
  }): Promise<KRARaceDetail[]> {
    return limit(async () => {
      const { data } = await this.client.get<KRAResponse<KRARaceDetail>>(
        '/racedetailresult/getracedetailresult',
        {
          params: {
            serviceKey: this.apiKey,
            meet: params.meet,
            rc_date: params.rcDate,
            rc_no: params.rcNo,
            pageNo: 1,
            numOfRows: 50,
            _type: 'json',
          },
        }
      );
      return this.parseResponse(data);
    });
  }

  /**
   * API284: 혈통 지수
   */
  async getBloodInfo(hrNo: string): Promise<KRABloodInfo | null> {
    return limit(async () => {
      const { data } = await this.client.get<KRAResponse<KRABloodInfo>>(
        '/API284/HorseBloodBasicInfo',
        {
          params: {
            serviceKey: this.apiKey,
            hr_no: hrNo,
            pageNo: 1,
            numOfRows: 1,
            _type: 'json',
          },
        }
      );
      const items = this.parseResponse(data);
      return items[0] ?? null;
    });
  }

  /**
   * horseinfohi: 말 정보 (부마/모마)
   */
  async getHorseInfo(params: {
    hrNo?: string;
    hrName?: string;
  }): Promise<KRAHorseInfo | null> {
    return limit(async () => {
      const queryParams: Record<string, string | number> = {
        serviceKey: this.apiKey,
        pageNo: 1,
        numOfRows: 1,
        _type: 'json',
      };
      if (params.hrNo) queryParams.hrno = params.hrNo;
      if (params.hrName) queryParams.hr_name = params.hrName;

      const { data } = await this.client.get<KRAResponse<KRAHorseInfo>>(
        '/horseinfohi/gethorseinfohi',
        { params: queryParams }
      );
      const items = this.parseResponse(data);
      return items[0] ?? null;
    });
  }

  /**
   * 모부마 가져오기 (모마 → 모마의 부마)
   */
  async getDamSire(damHrnm: string): Promise<string | null> {
    const damInfo = await this.getHorseInfo({ hrName: damHrnm });
    return damInfo?.sireHrnm ?? null;
  }
}

// 싱글톤 인스턴스
let _client: KRAClient | null = null;
export function getKRAClient(): KRAClient {
  if (!_client) _client = new KRAClient();
  return _client;
}
