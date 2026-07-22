/**
 * YYYYMMDD 숫자에 일수(음수 가능)를 더한 결과를 YYYYMMDD로 반환.
 * UTC 산술로 계산 — 실행 머신 TZ 무관.
 * 스펙: docs/superpowers/specs/2026-07-20-picks-week-nav-design.md §2
 */
export function addDaysToYmd(ymd: number, days: number): number {
  const y = Math.floor(ymd / 10000);
  const m = Math.floor(ymd / 100) % 100;
  const d = ymd % 100;
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
}

/** YYYYMMDD 정수 → "YYYY-MM-DD" 표시용. null/undefined/0/비8자리 → "—". */
export function ymdToDisplay(ymd: number | null | undefined): string {
  if (!ymd || ymd <= 0) return '—';
  const s = String(ymd);
  if (s.length !== 8) return '—';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * 주간 경계 (주간 강추): YYYYMMDD 숫자가 속한 주의 월요일(from)~일요일(to).
 * 입력이 이미 KST 기준 날짜 숫자이므로 UTC 산술로 계산 — 실행 머신 TZ 무관.
 * 스펙: docs/superpowers/specs/2026-07-17-weekly-picks-design.md §2
 */
export function weekRange(today: number): { from: number; to: number } {
  const y = Math.floor(today / 10000);
  const m = Math.floor(today / 100) % 100;
  const d = today % 100;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=일 … 6=토
  const mondayOffset = (dow + 6) % 7;                       // 월=0 … 일=6
  const from = addDaysToYmd(today, -mondayOffset);
  const to = addDaysToYmd(from, 6);
  return { from, to };
}
