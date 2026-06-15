import type { Feature } from './types.js';

/** "YYYY.MM.DD..." 앞 10자를 YYYYMMDD 정수로. 형식 불일치/없음 → null. */
export function parseLeadingYmd(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (!m) return null;
  return Number(`${m[1]}${m[2]}${m[3]}`);
}

/** 치료 텍스트가 운동기인성 피로회복/수액 처치류인지. */
export function isFatigueTrea(txt: string | null | undefined): boolean {
  if (!txt) return false;
  return txt.includes('피로') || txt.includes('수액');
}

function ymdToDate(ymd: number): Date {
  return new Date(Date.UTC(Math.floor(ymd / 10000), Math.floor((ymd % 10000) / 100) - 1, ymd % 100));
}
function daysBetweenYmd(a: number, b: number): number {
  return Math.round((ymdToDate(b).getTime() - ymdToDate(a).getTime()) / 86400000);
}

export interface MedicalFeatureContext {
  latstBledg1: string | null;
  latstBledg2: string | null;
  latstTrea1: string | null;
  raceDate: number;
}

/** race_entries 의료 raw 필드의 박힌 날짜로 as-of(누수 제거) 피처 추출. 가치판단 없음 — 모델이 학습. */
export function medicalFeatures(ctx: MedicalFeatureContext): Feature[] {
  const { latstBledg1, latstBledg2, latstTrea1, raceDate } = ctx;
  const f: Feature[] = [];
  const add = (name: string, value: number) => f.push({ name, value });

  // 출혈: bledg1/2 중 경주일 이전(as-of)인 것만
  const bledDates = [parseLeadingYmd(latstBledg1), parseLeadingYmd(latstBledg2)]
    .filter((y): y is number => y != null && y < raceDate);
  const bled = bledDates.length > 0;
  add('med_bled_asof', bled ? 1 : 0);
  if (bled) add('med_bled_days_since', daysBetweenYmd(Math.max(...bledDates), raceDate));

  // 치료: 최근 치료가 피로/수액류이고 경주일 이전이면 양(+)신호 후보
  const treaYmd = parseLeadingYmd(latstTrea1);
  const fatigue = treaYmd != null && treaYmd < raceDate && isFatigueTrea(latstTrea1);
  add('med_fatigue_asof', fatigue ? 1 : 0);
  if (fatigue) add('med_fatigue_days_since', daysBetweenYmd(treaYmd, raceDate));

  return f;
}
