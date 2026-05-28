/**
 * KRA 공공데이터 포털 API 클라이언트
 *
 * 검증된 5개 엔드포인트:
 * 1. API214_1/RaceDetailResult_1   - 경주 결과 (말 단위)
 * 2. API4_3/raceResult_3            - 경주 기록 (동일)
 * 3. racedetailresult/getracedetailresult - 상세 (stOrd 포함)
 * 4. API284/HorseBloodBasicInfo     - 혈통 지수
 * 5. horseinfohi/gethorseinfohi     - 부마/모마
 *
 * 신규 추가 (P0b):
 * 6. API18_1/dailyTraining_1        - 일별 훈련 정보 (검증됨)
 * 7. jkpresult/getjkpresult         - 기수 통산 성적 (이미 구독, 검증됨)
 *
 * 참고 — 구간기록은 API214_1 응답에 이미 모두 포함:
 *   서울: seG1fAccTime, seG3fAccTime, seS1fAccTime, se_3cAccTime, se_4cAccTime
 *   부경: buG1fAccTime ~ buG8fAccTime, buS1fAccTime
 *   순위: sjG1fOrd, sjG3fOrd, sjS1fOrd, sj_3cOrd, sj_4cOrd
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
} from '@app-types/index.js';

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

  /**
   * API26_2/entrySheet_2: 출전표 상세정보 (날짜 단위, 전 경주 일괄)
   * 구 API314/316(경주별)을 대체. meet + rc_date만으로 해당일 전체 반환.
   */
  async getEntrySheet(params: {
    meet: MeetCode;
    rcDate: number;
    pageNo?: number;
    numOfRows?: number;
  }): Promise<KRAEntrySheetItem[]> {
    return limit(async () => {
      const { data } = await this.client.get<KRAResponse<KRAEntrySheetItem>>(
        '/API26_2/entrySheet_2',
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

  /** API26_2 전체 페이지 자동 수집 */
  async getAllEntrySheet(params: {
    meet: MeetCode;
    rcDate: number;
  }): Promise<KRAEntrySheetItem[]> {
    const all: KRAEntrySheetItem[] = [];
    let pageNo = 1;
    const numOfRows = 100;

    while (true) {
      const page = await this.getEntrySheet({ ...params, pageNo, numOfRows });
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < numOfRows) break;
      pageNo++;
      if (pageNo > 20) break;
    }

    return all;
  }

  /**
   * @deprecated API314/316 구 카드 API. getAllEntrySheet() 사용 권장.
   */
  async getRaceCard(params: {
    meet: MeetCode;
    rcDate: number;
    rcNo: number;
  }): Promise<KRARaceCard[]> {
    return limit(async () => {
      const path =
        params.meet === 1
          ? '/API314/textDataHoldSePtinInfo'
          : '/API316/textDataHoldBuPtinInfo';
      const { data } = await this.client.get<KRAResponse<KRARaceCard>>(path, {
        params: {
          serviceKey: this.apiKey,
          race_dt: params.rcDate,
          race_no: params.rcNo,
          pageNo: 1,
          numOfRows: 30,
          _type: 'json',
        },
      });
      return this.parseResponse(data);
    });
  }

  /**
   * API37_1/sectionRecord_1: 구간별 통과기록 (경주 단위)
   *
   * [구독 필요 — 현재 403 Forbidden]
   *   - 경로: /API37_1/sectionRecord_1 (엔드포인트 존재 확인됨)
   *   - 신청: https://www.data.go.kr/data/15057859/openapi.do
   *   - 단, API214_1/RaceDetailResult_1 응답에 seG1fAccTime, seG3fAccTime,
   *     seS1fAccTime, se_3cAccTime, se_4cAccTime, sjG1fOrd 등이 이미 포함됨.
   *     별도 구독 없이도 구간 데이터 활용 가능.
   */
  async getSectionalRecords(params: {
    meet: MeetCode;
    rcDate: number;
    rcNo: number;
  }): Promise<KRASectionalRecord[]> {
    return limit(async () => {
      const { data } = await this.client.get<KRAResponse<KRASectionalRecord>>(
        '/API37_1/sectionRecord_1',
        {
          params: {
            serviceKey: this.apiKey,
            meet: params.meet,
            rc_date: params.rcDate,
            rc_no: params.rcNo,
            pageNo: 1,
            numOfRows: 20,
            _type: 'json',
          },
        }
      );
      return this.parseResponse(data);
    });
  }

  /**
   * API18_1/dailyTraining_1: 일별 훈련 정보 (검증됨 — 실제 응답 확인)
   *
   * 파라미터:
   *   meet: 경마장 코드 (1=서울, 3=부경)
   *   trDate: 훈련 날짜 YYYYMMDD
   *   hrNo?: 말 번호 (없으면 해당 날 전체)
   */
  async getTrainingHistory(params: {
    meet: MeetCode;
    trDate: number;
    hrNo?: string;
  }): Promise<KRATrainingRecord[]> {
    return limit(async () => {
      const queryParams: Record<string, string | number> = {
        serviceKey: this.apiKey,
        meet: params.meet,
        tr_date: params.trDate,
        pageNo: 1,
        numOfRows: 100,
        _type: 'json',
      };
      if (params.hrNo) queryParams.hr_no = params.hrNo;

      const { data } = await this.client.get<KRAResponse<KRATrainingRecord>>(
        '/API18_1/dailyTraining_1',
        { params: queryParams }
      );
      return this.parseResponse(data);
    });
  }

  /**
   * API18_1 전체 페이지 자동 수집 (totalCount 기반)
   */
  async getAllTrainingHistory(params: {
    meet: MeetCode;
    trDate: number;
    hrNo?: string;
  }): Promise<KRATrainingRecord[]> {
    const all: KRATrainingRecord[] = [];
    let pageNo = 1;
    const numOfRows = 100;

    while (true) {
      const queryParams: Record<string, string | number> = {
        serviceKey: this.apiKey,
        meet: params.meet,
        tr_date: params.trDate,
        pageNo,
        numOfRows,
        _type: 'json',
      };
      if (params.hrNo) queryParams.hr_no = params.hrNo;

      const { data } = await this.client.get<KRAResponse<KRATrainingRecord>>(
        '/API18_1/dailyTraining_1',
        { params: queryParams }
      );
      const page = this.parseResponse(data);
      if (page.length === 0) break;
      all.push(...page);
      if (page.length < numOfRows) break;
      pageNo++;
      if (pageNo > 20) break;
    }

    return all;
  }

  /**
   * jkpresult/getjkpresult: 기수 통산 성적
   *
   * data.go.kr 한국마사회 기수 성적 API. 이미 구독되어 있음.
   * 파라미터: meet (필수, 1=서울 / 3=부산경남), jk_no (선택)
   * 한 meet당 활성 기수 전체 조회 가능 (한 번 호출에 30~50건 정도)
   */
  async getJockeyStats(params: {
    jkNo?: string;
    meet: MeetCode;
  }): Promise<KRAJockeyStat[]> {
    return limit(async () => {
      const queryParams: Record<string, string | number> = {
        serviceKey: this.apiKey,
        pageNo: 1,
        numOfRows: 100,
        _type: 'json',
        meet: params.meet,
      };
      if (params.jkNo) queryParams.jk_no = params.jkNo;

      const { data } = await this.client.get<KRAResponse<KRAJockeyStat>>(
        '/jkpresult/getjkpresult',
        { params: queryParams }
      );
      return this.parseResponse(data);
    });
  }
}

/** @deprecated API314/316 구 카드 API — API26_2로 교체됨 */
export interface KRARaceCard {
  raceDt: number;
  raceNo: number;
  pthrNo: number;
  hrnm: string;
  ag: number;
  gndr: string;
  prds: string;
  burdWgt: number;
  ratg: number;
  jckyNm: string;
  trarNm: string;
  ownerNm: string;
  erngSump: number;
  erngLoy: number;
  erngLsm: number;
  sumpRcodFplc: number;
  sumpRcodSplc: number;
  sumpRcodTplc: number;
  sumpRcodSum: number;
  loyRcodFplc: number;
  loyRcodSplc: number;
  loyRcodTplc: number;
  loyRcodSum: number;
  asisEquip1: string;
  asisEquip2: string;
  asisEquip3: string;
  asisEquip4: string;
  asisEquip5: string;
  latstBledg1: string;
  latstBledg2: string;
  latstTrea1Txt: string;
  latstTrea2Txt: string;
}

/**
 * API26_2/entrySheet_2: 출전표 상세정보
 * - 날짜(rc_date) + 경마장(meet) 단위로 전체 경주 일괄 반환
 * - rating은 미등급 시 "-" 문자열, 등급 있으면 숫자
 */
export interface KRAEntrySheetItem {
  age: number;
  ageCond: string;
  budam: string;
  chaksun1: number;
  chaksun2: number;
  chaksun3: number;
  chaksun4: number;
  chaksun5: number;
  chaksunT: number;       // 통산 수득상금 (= erngSump)
  chaksunY: number;       // 금년 수득상금 (= erngLoy)
  chaksun_6m: number;     // 최근 6개월 수득상금 (= erngLsm)
  chulNo: number;         // 출주번호 (= pthrNo, PK)
  dusu: number;           // 출전 두수
  hrName: string;
  hrNameEn: string;
  hrNo: string;
  ilsu: number;           // 경마일수
  jkName: string;
  jkNameEn: string;
  jkNo: string;
  meet: string;           // "서울" | "부산경남"
  ord1CntT: number;       // 통산 1착 횟수 (= sumpRcodFplc)
  ord1CntY: number;       // 금년 1착 횟수 (= loyRcodFplc)
  ord2CntT: number;
  ord2CntY: number;
  ord3CntT: number;
  ord3CntY: number;
  owName: string;
  owNameEn: string;
  owNo: number | string;
  prd: string;            // 산지
  prizeCond: string;
  rank: string;           // 등급 (예: "국6등급")
  rating: number | string; // 미등급이면 "-", 등급 있으면 숫자
  rcCntT: number;         // 통산 출전수 (= sumpRcodSum)
  rcCntY: number;         // 금년 출전수 (= loyRcodSum)
  rcDate: number;
  rcDay: string;
  rcDist: number;
  rcName: string;
  rcNo: number;
  sex: string;
  sexCond: string;
  stTime: string;         // 출발시각 (예: "출발 :10:45")
  trName: string;
  trNameEn: string;
  trNo: string;
  wgBudam: number;        // 부담중량
}

// ============================================
// 신규 API 응답 인터페이스
// ============================================

/**
 * API37_1/sectionRecord_1: 구간별 통과기록
 * [TODO] 실제 필드명 미확인 (403 반환). 필드명은 KRA 포털 명세서 기준 추정.
 */
export interface KRASectionalRecord {
  rcDate: number;       // 경주날짜 (YYYYMMDD)
  meet: string;         // 경마장명 ("서울" | "부산경남")
  rcNo: number;         // 경주번호
  hrNo: string;         // 말번호
  hrName: string;       // 말명
  chulNo: number;       // 출주번호 (게이트 번호)
  ord: number;          // 착순
  // furlong 단위 구간 통과 누적 시간 (초, 소수점 1자리)
  buG1fAccTime: number | null;
  buG2fAccTime: number | null;
  buG3fAccTime: number | null;
  buG4fAccTime: number | null;
  buG6fAccTime: number | null;
  buG8fAccTime: number | null;
  buS1fAccTime: number | null;
  // 구간 순위
  buG1fOrd: number | null;
  buG2fOrd: number | null;
  buG3fOrd: number | null;
  buG4fOrd: number | null;
  buS1fOrd: number | null;
}

/**
 * API18_1/dailyTraining_1: 일별 훈련 정보
 * (실제 응답 검증됨 — 2026-05-20 데이터 확인)
 */
export interface KRATrainingRecord {
  trDate: number;       // 훈련날짜 (YYYYMMDD)
  meet: string;         // 경마장명 ("서울" | "부산경남")
  hrNo: string;         // 말번호
  hrName: string;       // 말명
  trName: string;       // 조교사명
  part: number;         // 조교 회차
  partNo: number;       // 조 번호
  chulGubun: string;    // 출전 구분 ("금주출전예정" | "-" 등)
  prGubun: string;      // 조교 구분
  prNo: string;         // 조교 번호
  run1Cnt: number;      // 1차 달린 횟수
  run2Cnt: number;      // 2차 달린 횟수
  stTime: number;       // 시작 시각 (YYYYMMDDHHmmss)
  spTime: number;       // 종료 시각 (YYYYMMDDHHmmss)
  trTerm: number;       // 조교 소요 시간 (초)
}

/**
 * jkpresult/getjkpresult: 기수 통산 성적 (이미 구독됨)
 * 실제 응답 필드명 (probe로 검증):
 *   meet, jkNo, jkName, raceCnttsum, firstCnt, secondCnt, thirdCnt,
 *   winRateTsum, quRateTsum
 */
export interface KRAJockeyStat {
  meet: number;           // 1=서울, 3=부산경남
  jkNo: string;           // 기수번호
  jkName: string;         // 기수명
  raceCnttsum: number;    // 통산 출주 수
  firstCnt: number;       // 통산 1위 횟수
  secondCnt: number;      // 통산 2위 횟수
  thirdCnt: number;       // 통산 3위 횟수
  winRateTsum: number;    // 통산 단승률 (%)
  quRateTsum: number;     // 통산 입상률 (%)
}

// ============================================
// 싱글톤 인스턴스
// ============================================

let _client: KRAClient | null = null;
export function getKRAClient(): KRAClient {
  if (!_client) _client = new KRAClient();
  return _client;
}
