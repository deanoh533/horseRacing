/**
 * KRA API 응답 → Supabase DB 행 변환
 */
import type { KRARaceResult, KRARaceDetail, KRAHorseInfo, KRABloodInfo } from '@types/index.js';
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
