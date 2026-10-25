/**
 * 주행심사 결과 — 마사회 홈페이지(공공 API 없음) 파서 + HTTP 클라이언트.
 * 스펙 docs/superpowers/specs/2026-10-05-gate-test-collection-design.md
 */
export interface GateTestRow {
  test_date: number; meet: number; trno: number; hr_no: string; hr_name: string;
  rank: number | null; gate_no: number | null; reason: string | null; origin: string | null;
  sex: string | null; age: number | null; burden: string | null; jockey: string | null;
  trainer: string | null; owner: string | null; body_weight: number | null; time_sec: number | null;
  margin: string | null; verdict: string; verdict_reason: string | null; track_cond: string | null;
}

export interface GateListEntry { date: number; trnos: number[]; entries: number; }

const EUC_KR = new TextDecoder('euc-kr');
export function decodeEucKr(buf: ArrayBuffer | Uint8Array): string {
  return EUC_KR.decode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
}

export function toSeconds(s: string): number | null {
  const t = s.trim();
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

const strip = (s: string): string =>
  s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const text = (s: string): string | null => strip(s) || null;
const int = (s: string): number | null => { const v = Number(strip(s)); return strip(s) !== '' && Number.isFinite(v) ? v : null; };
const cells = (tr: string): string[] => tr.split(/<td[^>]*>/).slice(1).map((x) => x.split('</td>')[0]!);

/** found = 결과표 캡션 존재 여부(없으면 점검·오류 페이지 등 — 호출자가 빈 회차와 구분해야 한다). */
export function parseGateRound(html: string, meet: number, date: number, trno: number): { rows: GateTestRow[]; skipped: number; found: boolean } {
  const tbl = html.split('<caption>주행심사결과를')[1];
  if (!tbl) return { rows: [], skipped: 0, found: false };
  const body = tbl.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
  const track = /주로상태\s*:\s*([^<]+)/.exec(html)?.[1]?.trim() ?? null;
  const rows: GateTestRow[] = [];
  let skipped = 0;
  for (const tr of body.split('<tr>').slice(1)) {
    if (/<td[^>]*colspan/i.test(tr)) continue; // "자료가 없습니다." 안내 행
    const c = cells(tr);
    const hrNo = /goPage1\('(\d+)'/.exec(c[2] ?? '')?.[1];
    const verdict = text(c[14] ?? '');
    if (c.length < 16 || !hrNo || !verdict) { skipped++; continue; }
    rows.push({
      test_date: date, meet, trno, hr_no: hrNo, hr_name: strip(c[2]!),
      rank: int(c[0]!), gate_no: int(c[1]!), reason: text(c[3]!), origin: text(c[4]!),
      sex: text(c[5]!), age: int(c[6]!), burden: text(c[7]!), jockey: text(c[8]!),
      trainer: text(c[9]!), owner: text(c[10]!), body_weight: int(c[11]!),
      time_sec: toSeconds(strip(c[12]!)), margin: text(c[13]!), verdict,
      verdict_reason: text(c[15]!), track_cond: track,
    });
  }
  return { rows, skipped, found: true };
}

export function parseGateList(html: string): GateListEntry[] {
  const tbody = html.split('<tbody>')[1]?.split('</tbody>')[0];
  if (!tbody) return [];
  const out: GateListEntry[] = [];
  for (const tr of tbody.split('<tr>').slice(1)) {
    const c = cells(tr);
    const trnos = [...(c[3] ?? '').matchAll(/goPage1\("(\d+)","(\d+)"\)/g)];
    if (c.length < 6 || trnos.length === 0) continue;
    out.push({ date: Number(trnos[0]![2]), trnos: trnos.map((m) => Number(m[1])), entries: int(c[4]!) ?? 0 });
  }
  return out;
}

export interface GateClient {
  fetchRound(meet: number, date: number, trno: number): Promise<string>;
  fetchList(meet: number, pageIndex?: number): Promise<string>;
}

const ROUND_URL = 'https://race.kra.co.kr/referee/RacingTrainCheckScoreTable.do';
const LIST_URL = (meet: number) => `https://race.kra.co.kr/referee/RacingTrainCheckList.do?Act=07&Sub=8&meet=${meet}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createGateClient(opts: {
  fetchImpl?: typeof fetch; delayMs?: number; retryDelayMs?: number; timeoutMs?: number; maxAttempts?: number;
} = {}): GateClient {
  const f = opts.fetchImpl ?? fetch;
  const delayMs = opts.delayMs ?? 2000;
  const retryDelayMs = opts.retryDelayMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 30000;
  const maxAttempts = opts.maxAttempts ?? 3;
  let last = 0;

  async function post(url: string, body: string, label: string): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const wait = last + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        const res = await f(url, {
          method: 'POST', body,
          headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return decodeEucKr(await res.arrayBuffer());
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts) await sleep(retryDelayMs);
      }
    }
    throw new Error(`주행심사 요청 실패 ${label}: ${String(lastErr)}`);
  }

  return {
    fetchRound: (meet, date, trno) =>
      post(ROUND_URL, `trno=${trno}&date=${date}&meet=${meet}&Act=07&Sub=8`, `m${meet} ${date} 회차${trno}`),
    fetchList: (meet, pageIndex = 1) => post(LIST_URL(meet), `pageIndex=${pageIndex}`, `목록 m${meet} p${pageIndex}`),
  };
}
