/**
 * KRA API 응답 → Supabase DB 행 변환
 */
import type { KRARaceResult, KRARaceDetail, KRAHorseInfo, KRABloodInfo } from '@app-types/index.js';
import type { KRARaceCard } from '@kra/client.js';
import { parseWgHr, extractTrackType } from '@utils/parsers.js';

/**
 * races 테이블 행
 */
export interface RaceRow {
  race_date: number;
  meet: number;
  rc_no: number;
  rc_dist: number | null;
  rc_name: string | null;
  rc_day: string | null;
  track: string | null;
  track_type: string | null;
  weather: string | null;
  age_cond: string | null;
  prize_cond: string | null;
  chaksun1: number | null;
  chaksun2: number | null;
  chaksun3: number | null;
}

/**
 * horse_results 테이블 행
 */
export interface HorseResultRow {
  race_date: number;
  meet: number;
  rc_no: number;
  chul_no: number;
  st_ord: number | null;
  hr_no: string;
  hr_name: string;
  age: number | null;
  sex: string | null;
  rating: number | null;
  rank_str: string | null;
  rank_rise: number;
  ord: number | null;
  rc_time: number | null;
  diff_unit: string | null;
  rc_dist: number | null;
  track: string | null;
  track_type: string | null;
  wg_budam: number | null; // DECIMAL(4,1) - 소수 허용 (예: 55.5)
  wg_hr_str: string | null;
  wg_hr: number | null;
  wg_hr_diff: number | null;
  wg_jk: number | null; // DECIMAL(4,1)
  win_odds: number | null;
  plc_odds: number | null;
  popularity: number | null;
  jk_no: string | null;
  jk_name: string | null;
  tr_no: string | null;
  tr_name: string | null;
  bu_g1f_acc_time: number | null;
  bu_g2f_acc_time: number | null;
  bu_g3f_acc_time: number | null;
  bu_g4f_acc_time: number | null;
  bu_g6f_acc_time: number | null;
  bu_g8f_acc_time: number | null;
  bu_s1f_acc_time: number | null;
  bu_g1f_ord: number | null;
  bu_g2f_ord: number | null;
  bu_g3f_ord: number | null;
  bu_g4f_ord: number | null;
  bu_s1f_ord: number | null;
}

/**
 * "부경" / "서울" → meet 코드
 */
function meetNameToCode(meetName: string): number {
  if (meetName.includes('서울')) return 1;
  if (meetName.includes('부경') || meetName.includes('부산')) return 3;
  if (meetName.includes('제주')) return 2;
  return 0; // unknown
}

/**
 * KRARaceResult → races 행 (경주 정보)
 *
 * 같은 경주의 첫 번째 말 데이터를 사용 (모든 말이 동일 경주 정보)
 */
export function toRaceRow(horse: KRARaceResult): RaceRow {
  return {
    race_date: horse.rcDate,
    meet: meetNameToCode(horse.meet),
    rc_no: horse.rcNo,
    rc_dist: horse.rcDist ?? null,
    rc_name: horse.rcName ?? null,
    rc_day: horse.rcDay ?? null,
    track: horse.track ?? null,
    track_type: horse.track ? extractTrackType(horse.track) : null,
    weather: horse.weather ?? null,
    age_cond: horse.ageCond ?? null,
    prize_cond: horse.prizeCond ?? null,
    chaksun1: horse.chaksun1 ?? null,
    chaksun2: horse.chaksun2 ?? null,
    chaksun3: horse.chaksun3 ?? null,
  };
}

/**
 * KRARaceResult → horse_results 행
 */
export function toHorseResultRow(horse: KRARaceResult): HorseResultRow {
  const wgHrParsed = parseWgHr(horse.wgHr);
  return {
    race_date: horse.rcDate,
    meet: meetNameToCode(horse.meet),
    rc_no: horse.rcNo,
    chul_no: horse.chulNo,
    st_ord: null, // racedetailresult에서 별도 채움
    hr_no: horse.hrNo,
    hr_name: horse.hrName,
    age: horse.age ?? null,
    sex: horse.sex ?? null,
    rating: horse.rating ?? null,
    rank_str: horse.rank ?? null,
    rank_rise: horse.rankRise ?? 0,
    // ord ≥ 90 은 KRA의 비주파 코드 (취소/실격/사고로 미완주) → NULL
    ord: horse.ord != null && horse.ord < 90 ? horse.ord : null,
    rc_time: horse.rcTime && horse.rcTime > 0 ? horse.rcTime : null,
    diff_unit: typeof horse.diffUnit === 'number' ? String(horse.diffUnit) : horse.diffUnit ?? null,
    rc_dist: horse.rcDist ?? null,
    track: horse.track ?? null,
    track_type: horse.track ? extractTrackType(horse.track) : null,
    wg_budam: horse.wgBudam ?? null,
    wg_hr_str: horse.wgHr ?? null,
    wg_hr: wgHrParsed?.weight ?? null,
    wg_hr_diff: wgHrParsed?.diff ?? null,
    wg_jk: horse.wgJk ?? null,
    win_odds: horse.winOdds ?? null,
    plc_odds: horse.plcOdds ?? null,
    popularity: null, // 인기도는 계산 후 채움 (같은 경주 winOdds 정렬)
    jk_no: horse.jkNo ?? null,
    jk_name: horse.jkName ?? null,
    tr_no: horse.trNo ?? null,
    tr_name: horse.trName ?? null,
    bu_g1f_acc_time: horse.buG1fAccTime ?? null,
    bu_g2f_acc_time: horse.buG2fAccTime ?? null,
    bu_g3f_acc_time: horse.buG3fAccTime ?? null,
    bu_g4f_acc_time: horse.buG4fAccTime ?? null,
    bu_g6f_acc_time: horse.buG6fAccTime ?? null,
    bu_g8f_acc_time: horse.buG8fAccTime ?? null,
    bu_s1f_acc_time: horse.buS1fAccTime ?? null,
    bu_g1f_ord: horse.buG1fOrd ?? null,
    bu_g2f_ord: horse.buG2fOrd ?? null,
    bu_g3f_ord: horse.buG3fOrd ?? null,
    bu_g4f_ord: horse.buG4fOrd ?? null,
    bu_s1f_ord: horse.buS1fOrd ?? null,
  };
}

/**
 * 인기도 계산: 같은 경주 내 winOdds 오름차순 정렬 → 순위
 *
 * 입력: 같은 경주의 모든 말
 * 출력: { hr_no → popularity (1=1인기, 2=2인기, ...) }
 */
export function calculatePopularities(
  horses: KRARaceResult[]
): Map<string, number> {
  const result = new Map<string, number>();
  const sorted = [...horses]
    .filter((h) => h.winOdds > 0)
    .sort((a, b) => a.winOdds - b.winOdds);

  sorted.forEach((horse, idx) => {
    result.set(horse.hrNo, idx + 1);
  });

  return result;
}

/**
 * racedetailresult → stOrd 매핑
 */
export function buildStOrdMap(details: KRARaceDetail[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const d of details) {
    if (d.hrNo && d.stOrd) {
      map.set(d.hrNo, d.stOrd);
    }
  }
  return map;
}

// ============================================
// race_entries 관련 타입 및 변환 함수
// ============================================

/**
 * race_entries 사전 정보 행 (수요일 출주표 기반)
 */
export interface RaceEntryRow {
  race_date: number;
  meet: number;
  rc_no: number;
  pthr_no: number;
  hr_name: string;
  ag: number | null;
  gndr: string | null;
  prds: string | null;
  burd_wgt: number | null;
  ratg: number | null;
  jcky_nm: string | null;
  trar_nm: string | null;
  owner_nm: string | null;
  erng_sump: number | null;
  erng_loy: number | null;
  erng_lsm: number | null;
  sump_rcod_fplc: number | null;
  sump_rcod_splc: number | null;
  sump_rcod_tplc: number | null;
  sump_rcod_sum: number | null;
  loy_rcod_fplc: number | null;
  loy_rcod_splc: number | null;
  loy_rcod_tplc: number | null;
  loy_rcod_sum: number | null;
  asis_equip1: string | null;
  asis_equip2: string | null;
  asis_equip3: string | null;
  asis_equip4: string | null;
  asis_equip5: string | null;
  latst_bledg1: string | null;
  latst_bledg2: string | null;
  latst_trea1_txt: string | null;
  latst_trea2_txt: string | null;
}

/**
 * race_entries 결과 컬럼 (경기 후 UPDATE용)
 */
export interface RaceEntryResultRow {
  race_date: number;
  meet: number;
  rc_no: number;
  hr_name: string;
  hr_no: string | null;
  jcky_no: string | null;
  trar_no: string | null;
  ord: number | null;
  rc_time: number | null;
  diff_unit: string | null;
  wg_hr: number | null;
  wg_hr_diff: number | null;
  wg_jk: number | null;
  win_odds: number | null;
  plc_odds: number | null;
  popularity: number | null;
  bu_g1f_acc_time: number | null;
  bu_g2f_acc_time: number | null;
  bu_g3f_acc_time: number | null;
  bu_g4f_acc_time: number | null;
  bu_g6f_acc_time: number | null;
  bu_g8f_acc_time: number | null;
  bu_s1f_acc_time: number | null;
  bu_g1f_ord: number | null;
  bu_g2f_ord: number | null;
  bu_g3f_ord: number | null;
  bu_g4f_ord: number | null;
  bu_s1f_ord: number | null;
}

function dashToNull(v: string | undefined | null): string | null {
  if (!v || v === '-') return null;
  return v;
}

/**
 * KRARaceCard → race_entries 사전 정보 행
 */
export function toRaceEntryRow(c: KRARaceCard, meet: number, rcDate: number, rcNo: number): RaceEntryRow {
  return {
    race_date: rcDate,
    meet,
    rc_no: rcNo,
    pthr_no: c.pthrNo,
    hr_name: c.hrnm,
    ag: c.ag ?? null,
    gndr: c.gndr ?? null,
    prds: c.prds ?? null,
    burd_wgt: c.burdWgt ?? null,
    ratg: c.ratg && c.ratg > 0 ? c.ratg : null,
    jcky_nm: c.jckyNm ?? null,
    trar_nm: c.trarNm ?? null,
    owner_nm: c.ownerNm ?? null,
    erng_sump: c.erngSump ?? null,
    erng_loy: c.erngLoy ?? null,
    erng_lsm: c.erngLsm ?? null,
    sump_rcod_fplc: c.sumpRcodFplc ?? null,
    sump_rcod_splc: c.sumpRcodSplc ?? null,
    sump_rcod_tplc: c.sumpRcodTplc ?? null,
    sump_rcod_sum: c.sumpRcodSum ?? null,
    loy_rcod_fplc: c.loyRcodFplc ?? null,
    loy_rcod_splc: c.loyRcodSplc ?? null,
    loy_rcod_tplc: c.loyRcodTplc ?? null,
    loy_rcod_sum: c.loyRcodSum ?? null,
    asis_equip1: dashToNull(c.asisEquip1),
    asis_equip2: dashToNull(c.asisEquip2),
    asis_equip3: dashToNull(c.asisEquip3),
    asis_equip4: dashToNull(c.asisEquip4),
    asis_equip5: dashToNull(c.asisEquip5),
    latst_bledg1: dashToNull(c.latstBledg1),
    latst_bledg2: dashToNull(c.latstBledg2),
    latst_trea1_txt: dashToNull(c.latstTrea1Txt),
    latst_trea2_txt: dashToNull(c.latstTrea2Txt),
  };
}

/**
 * KRARaceResult → race_entries 결과 컬럼 (경기 후 UPDATE용)
 */
export function toRaceEntryResultRow(horse: KRARaceResult): RaceEntryResultRow {
  const wgHrParsed = parseWgHr(horse.wgHr);
  return {
    race_date: horse.rcDate,
    meet: meetNameToCode(horse.meet),
    rc_no: horse.rcNo,
    hr_name: horse.hrName,
    hr_no: horse.hrNo ?? null,
    jcky_no: horse.jkNo ?? null,
    trar_no: horse.trNo ?? null,
    ord: horse.ord != null && horse.ord < 90 ? horse.ord : null,
    rc_time: horse.rcTime && horse.rcTime > 0 ? horse.rcTime : null,
    diff_unit: typeof horse.diffUnit === 'number' ? String(horse.diffUnit) : horse.diffUnit ?? null,
    wg_hr: wgHrParsed?.weight ?? null,
    wg_hr_diff: wgHrParsed?.diff ?? null,
    wg_jk: horse.wgJk ?? null,
    win_odds: horse.winOdds ?? null,
    plc_odds: horse.plcOdds ?? null,
    popularity: null,
    bu_g1f_acc_time: horse.buG1fAccTime ?? null,
    bu_g2f_acc_time: horse.buG2fAccTime ?? null,
    bu_g3f_acc_time: horse.buG3fAccTime ?? null,
    bu_g4f_acc_time: horse.buG4fAccTime ?? null,
    bu_g6f_acc_time: horse.buG6fAccTime ?? null,
    bu_g8f_acc_time: horse.buG8fAccTime ?? null,
    bu_s1f_acc_time: horse.buS1fAccTime ?? null,
    bu_g1f_ord: horse.buG1fOrd ?? null,
    bu_g2f_ord: horse.buG2fOrd ?? null,
    bu_g3f_ord: horse.buG3fOrd ?? null,
    bu_g4f_ord: horse.buG4fOrd ?? null,
    bu_s1f_ord: horse.buS1fOrd ?? null,
  };
}

/**
 * KRAHorseInfo + KRABloodInfo → horses 행
 */
export interface HorseInfoRow {
  hr_no: string;
  hr_name: string;
  eng_hr_name: string | null;
  birthday: number | null;
  sex: string | null;
  pcty_nm: string | null;
  spcs_nm: string | null;
  sire_hr_nm: string | null;
  dam_hr_nm: string | null;
  dam_sire_hr_nm: string | null;
  dsa_bri_vl: number | null;
  dsa_clc_vl: number | null;
  dsa_ier_vl: number | null;
  dsa_prf_vl: number | null;
  dsa_coi_rt: number | null;
  dsidx_vl: number | null;
}

export function toHorseInfoRow(
  info: KRAHorseInfo,
  blood?: KRABloodInfo | null,
  damSire?: string | null
): HorseInfoRow {
  return {
    hr_no: info.hrno,
    hr_name: info.korHrnm,
    eng_hr_name: blood?.engHrnm ?? null,
    birthday: blood?.foalgDt ?? null,
    sex: info.gndrNm ?? null,
    pcty_nm: info.pctyNm ?? null,
    spcs_nm: info.spcsNm ?? null,
    sire_hr_nm: info.sireHrnm ?? null,
    dam_hr_nm: info.damHrnm ?? null,
    dam_sire_hr_nm: damSire ?? null,
    dsa_bri_vl: blood?.dsaBriVl ?? null,
    dsa_clc_vl: blood?.dsaClcVl ?? null,
    dsa_ier_vl: blood?.dsaIerVl ?? null,
    dsa_prf_vl: blood?.dsaPrfVl ?? null,
    dsa_coi_rt: blood?.dsaCoiRt ?? null,
    dsidx_vl: blood?.dsidxVl ?? null,
  };
}
