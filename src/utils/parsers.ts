/**
 * KRA API 데이터 파싱 유틸
 */
import type { ParsedWeight } from '@app-types/index.js';

/**
 * wgHr 문자열 파싱
 * "463(+3)" → { weight: 463, diff: 3 }
 * "463(-2)" → { weight: 463, diff: -2 }
 * "463" → { weight: 463, diff: 0 }
 */
export function parseWgHr(wgHrStr: string | null | undefined): ParsedWeight | null {
  if (!wgHrStr) return null;

  const match = wgHrStr.match(/(\d+)\(([+-]?\d+)\)/);
  if (match && match[1] && match[2]) {
    return {
      weight: parseInt(match[1], 10),
      diff: parseInt(match[2], 10),
    };
  }

  // 변화량 없는 경우
  const weightOnly = wgHrStr.match(/(\d+)/);
  if (weightOnly && weightOnly[1]) {
    return { weight: parseInt(weightOnly[1], 10), diff: 0 };
  }

  return null;
}

/**
 * track 문자열에서 종류만 추출
 * "건조 (2%)" → "건조"
 * "다소불량" → "다소불량"
 */
export function extractTrackType(track: string | null | undefined): string {
  if (!track) return '';
  return track.replace(/\s*\([^)]*\)/, '').trim();
}

/**
 * KRA 마명 앞 지역 이적 태그 제거
 * "[부산경남]벌교의꿈" / "[부]벌교의꿈" / "벌교의꿈" → "벌교의꿈"
 *
 * 같은 말이 이적 시점 전후로 KRA 응답에서 다른 태그(전체명/축약형/태그없음)로
 * 표기돼 hr_name이 갈린다. hr_name은 과거전적·기수궁합·조교기록 등 매칭 키로
 * 쓰이므로 항상 태그 제거 후 저장해야 동일 말이 계속 매칭된다.
 */
export function stripHrNameTag(name: string): string {
  return name.replace(/^\[[^\]]*\]/, '').trim();
}

/**
 * 시즌 분류
 * 4-9월: 여름 / 10-3월: 겨울
 */
export function getSeason(rcDate: number): '여름' | '겨울' {
  const month = Math.floor((rcDate % 10000) / 100);
  return month >= 4 && month <= 9 ? '여름' : '겨울';
}

/**
 * rcDate (20260517) → Date 객체
 */
export function parseRcDate(rcDate: number): Date {
  const year = Math.floor(rcDate / 10000);
  const month = Math.floor((rcDate % 10000) / 100) - 1; // 0-indexed
  const day = rcDate % 100;
  return new Date(year, month, day);
}

/**
 * Date 객체 → rcDate 형식 (YYYYMMDD)
 */
export function formatRcDate(date: Date): number {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return y * 10000 + m * 100 + d;
}

/**
 * 두 날짜 사이 일수 차이
 */
export function differenceInDays(later: number, earlier: number): number {
  const laterDate = parseRcDate(later);
  const earlierDate = parseRcDate(earlier);
  const diffMs = laterDate.getTime() - earlierDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
