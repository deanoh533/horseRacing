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

export const config = { runtime: 'edge' };

const REPO = 'deanoh533/horseRacing';
const WORKFLOW = 'sync.yml';

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST만 허용' }, 405);

  const secret = process.env.SYNC_SECRET;
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!secret || !token) {
    return json({ error: '서버 환경변수 미설정(SYNC_SECRET/GH_DISPATCH_TOKEN)' }, 500);
  }
  if (req.headers.get('x-sync-key') !== secret) return json({ error: '인증 실패(암구호 불일치)' }, 401);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: '본문 JSON 파싱 실패' }, 400);
  }
  const parsed = parseSyncBody(raw);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  const gh = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'content-type': 'application/json',
        'User-Agent': 'kra-analyzer-sync',
      },
      body: JSON.stringify({ ref: 'main', inputs: parsed.inputs }),
    }
  );

  if (gh.status === 204) {
    return json(
      { ok: true, target: parsed.inputs.target, date: parsed.inputs.date ?? '(자동)' },
      200
    );
  }
  const detail = (await gh.text()).slice(0, 300);
  return json({ error: `GitHub 응답 ${gh.status}`, detail }, 502);
}
