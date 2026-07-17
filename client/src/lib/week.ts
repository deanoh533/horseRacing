/**
 * 주간 경계 (주간 강추): YYYYMMDD 숫자가 속한 주의 월요일(from)~일요일(to).
 * 입력이 이미 KST 기준 날짜 숫자이므로 UTC 산술로 계산 — 실행 머신 TZ 무관.
 * 스펙: docs/superpowers/specs/2026-07-17-weekly-picks-design.md §2
 */
export function weekRange(today: number): { from: number; to: number } {
  const y = Math.floor(today / 10000);
  const m = Math.floor(today / 100) % 100;
  const d = today % 100;
  const t = Date.UTC(y, m - 1, d);
  const dow = new Date(t).getUTCDay();      // 0=일 … 6=토
  const mondayOffset = (dow + 6) % 7;       // 월=0 … 일=6
  const fromMs = t - mondayOffset * 86400000;
  const toMs = fromMs + 6 * 86400000;
  const toNum = (ms: number) => {
    const dt = new Date(ms);
    return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
  };
  return { from: toNum(fromMs), to: toNum(toMs) };
}
