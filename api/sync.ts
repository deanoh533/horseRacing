/**
 * 수동 동기화 서버리스 함수 (Vercel Edge) — 설정탭 버튼이 호출하면
 * GitHub workflow_dispatch(sync.yml)를 대리 실행한다. 토큰은 서버 환경변수(번들 밖).
 * 스펙: docs/superpowers/specs/2026-07-22-manual-sync-serverless-design.md
 */

export type SyncParse =
  | { ok: true; inputs: { target: string; date?: string } }
  | { ok: false; error: string };

const TARGETS = new Set(['racecard', 'results']);

/** 요청 본문 → workflow_dispatch inputs. target 필수(허용값), date는 8자리 숫자만 채택. */
export function parseSyncBody(raw: unknown): SyncParse {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '잘못된 요청 본문' };
  const body = raw as { target?: unknown; date?: unknown };
  const target = body.target;
  if (typeof target !== 'string' || !TARGETS.has(target)) {
    return { ok: false, error: "target은 'racecard' 또는 'results'" };
  }
  const inputs: { target: string; date?: string } = { target };
  if (typeof body.date === 'string' && /^\d{8}$/.test(body.date)) inputs.date = body.date;
  return { ok: true, inputs };
}
