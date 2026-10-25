# 주행심사 기록 수집 파이프라인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마사회 홈페이지 주행심사 결과를 `gate_tests` 테이블에 2022-01부터 백필하고, 매일 아침 캐치업 잡에서 새 회차를 자동 수집한다.

**Architecture:** 순수 파서(`src/kra/gateTest.ts`) + 지연·재시도·EUC-KR 해독을 맡는 HTTP 클라이언트(같은 파일, fetch 주입) + I/O를 주입받는 동기화 로직(`src/sync/gateTestSync.ts`) + Supabase를 연결하는 얇은 진입점(`scripts/gateTestSync.ts`). 백필은 날짜를 하루씩 훑고, 일일 수집은 목록 페이지에서 새 회차만 받는다. 둘 다 회차 단위로 "이미 있으면 건너뜀"이라 끊겨도 다시 실행하면 이어진다.

**Tech Stack:** TypeScript · Node 24 `fetch`/`TextDecoder('euc-kr')` · vitest · Supabase(service role) · GitHub Actions

**Spec:** `docs/superpowers/specs/2026-10-05-gate-test-collection-design.md`

## Global Constraints

- 요청 간 2초(`delayMs: 2000`), 요청당 30초 시간제한, 실패 시 3회까지(5초 간격) 재시도, 동시 요청 없음, User-Agent `Mozilla/5.0`.
- 출처: 상세 `POST https://race.kra.co.kr/referee/RacingTrainCheckScoreTable.do` body `trno, date, meet, Act=07, Sub=8` / 목록 `POST https://race.kra.co.kr/referee/RacingTrainCheckList.do?Act=07&Sub=8&meet={meet}` body `pageIndex`. 응답 EUC-KR.
- 대상 경마장: 서울(1)·부경(3)만. 영천(4)·제주(2) 제외.
- 테이블 `gate_tests` PK `(test_date, meet, trno, hr_no)`, 원문 보존, 멱등 upsert(`onConflict: 'test_date,meet,trno,hr_no'`).
- RLS: anon 읽기, 쓰기는 service_role만(015 관례).
- 일일 단계는 `continue-on-error: true` — 실패해도 결과 캐치업 잡은 성공.
- 커밋 메시지 한국어 + scope, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01XfySsfDteVzWfadnSVsWh9`. push·Supabase 적용·백필 실행은 사용자 승인/실행.
- 브랜치 `feat/gate-test-collection`(설계 문서 커밋 ce9d186 위).

## Review Focus

1. 백필이 회차 도중 끊긴 날(예: 회차 1~3만 저장) → 다시 실행하면 **남은 회차부터** 이어 받아야 한다(날짜 단위로 건너뛰면 영구 누락 — 스파이크에서 실제 발생). Task 3 테스트.
2. 사이트가 200으로 점검/오류 페이지를 주면(표 caption 없음) 파서는 `[]` → 백필은 "심사 없음"으로 넘어가되 저장이 없으니 재실행 시 재시도된다. 일일 수집의 목록 페이지가 비면 **경고+실패로 집계**해야 조용히 0건이 되지 않는다. Task 1·3 테스트.
3. 순위·기록이 빈 행(`심사제외`·출전취소) → 행을 버리지 않고 `rank`·`time_sec`를 null로 저장. Task 1 테스트(fixture 마지막 행).
4. 이미 저장된 회차 조회가 1,000행을 넘으면 Supabase 기본 페이지 한도에 잘린다 → 진입점에서 `range` 페이지 반복. Task 4 코드(+ 백필 후 연도별 집계로 검증).
5. 회차 루프 상한: 빈 표가 안 나오는 이상 응답(같은 표 반복 등)에 대비해 `trno ≤ 20`에서 멈춘다. Task 3 테스트.

---

### Task 1: 파서 + 실제 HTML fixture

**Files:**
- Create: `src/kra/gateTest.ts`
- Create: `tests/kra/fixtures/gate_round_20261001_m1_t1.html`, `tests/kra/fixtures/gate_round_empty.html`, `tests/kra/fixtures/gate_list_m1.html` (원본 EUC-KR 바이트 그대로)
- Test: `tests/kra/gateTest.test.ts`

**Interfaces:**
- Produces:
  - `interface GateTestRow { test_date: number; meet: number; trno: number; hr_no: string; hr_name: string; rank: number | null; gate_no: number | null; reason: string | null; origin: string | null; sex: string | null; age: number | null; burden: string | null; jockey: string | null; trainer: string | null; owner: string | null; body_weight: number | null; time_sec: number | null; margin: string | null; verdict: string; verdict_reason: string | null; track_cond: string | null }`
  - `interface GateListEntry { date: number; trnos: number[]; entries: number }`
  - `toSeconds(s: string): number | null`
  - `decodeEucKr(buf: ArrayBuffer | Uint8Array): string`
  - `parseGateRound(html: string, meet: number, date: number, trno: number): { rows: GateTestRow[]; skipped: number }`
  - `parseGateList(html: string): GateListEntry[]`

- [ ] **Step 1: fixture 저장 (원본 바이트)**

```bash
mkdir -p tests/kra/fixtures
curl -s -m 30 -A "Mozilla/5.0" -X POST "https://race.kra.co.kr/referee/RacingTrainCheckScoreTable.do" --data "trno=1&date=20261001&meet=1&Act=07&Sub=8" -o tests/kra/fixtures/gate_round_20261001_m1_t1.html
sleep 2
curl -s -m 30 -A "Mozilla/5.0" -X POST "https://race.kra.co.kr/referee/RacingTrainCheckScoreTable.do" --data "trno=9&date=20251002&meet=1&Act=07&Sub=8" -o tests/kra/fixtures/gate_round_empty.html
sleep 2
curl -s -m 30 -A "Mozilla/5.0" "https://race.kra.co.kr/referee/RacingTrainCheckList.do?Act=07&Sub=8&meet=1" -o tests/kra/fixtures/gate_list_m1.html
ls -la tests/kra/fixtures
```
Expected: 세 파일, 크기 대략 48KB / 31KB / 47KB. (스파이크 scratchpad의 `jh_detail.html`·`jh_x.html`·`jh_list.html`과 같은 요청 — 있으면 복사해도 된다.) 목록 fixture는 받은 시점 기준이라, 아래 목록 테스트 기대값이 다르면 **fixture 첫 행을 기준으로 기대값을 고친다**(2026-10-04 받은 판: 첫 행 2026/10/01, 회차 1~5, 편성 60).

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/kra/gateTest.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { toSeconds, decodeEucKr, parseGateRound, parseGateList } from '../../src/kra/gateTest.js';

const fx = (name: string) => decodeEucKr(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe('toSeconds', () => {
  it('분:초 → 초', () => {
    expect(toSeconds('1:03.4')).toBeCloseTo(63.4, 10);
    expect(toSeconds('1:08.4')).toBeCloseTo(68.4, 10);
  });
  it('초만 있으면 그대로, 비었거나 기호면 null', () => {
    expect(toSeconds('63.4')).toBeCloseTo(63.4, 10);
    expect(toSeconds('')).toBeNull();
    expect(toSeconds('-')).toBeNull();
    expect(toSeconds('심사제외')).toBeNull();
  });
});

describe('parseGateRound', () => {
  const { rows, skipped } = parseGateRound(fx('gate_round_20261001_m1_t1.html'), 1, 20261001, 1);

  it('정상 회차: 12행, 건너뛴 행 0', () => {
    expect(rows).toHaveLength(12);
    expect(skipped).toBe(0);
  });

  it('첫 행 전 필드', () => {
    expect(rows[0]).toEqual({
      test_date: 20261001, meet: 1, trno: 1,
      hr_no: '0056500', hr_name: '플로터', rank: 1, gate_no: 8,
      reason: '주행미합(신)', origin: '한국', sex: '수', age: 2, burden: '53+ 1.0',
      jockey: '김효정', trainer: '신삼영', owner: '이영해', body_weight: 496,
      time_sec: 63.4, margin: null, verdict: '합격', verdict_reason: null,
      track_cond: '건조 ( 3％ )',
    });
  });

  it('순위·기록 없는 심사제외 행도 버리지 않고 null로 저장', () => {
    const last = rows[11]!;
    expect(last.hr_no).toBe('0057120');
    expect(last.hr_name).toBe('천둥의비상');
    expect(last.rank).toBeNull();
    expect(last.time_sec).toBeNull();
    expect(last.margin).toBe('심사제외');
    expect(last.verdict).toBe('불합격');
    expect(last.verdict_reason).toBe('진입불량');
  });

  it('빈 표(심사 없는 날짜·회차) → 0행', () => {
    expect(parseGateRound(fx('gate_round_empty.html'), 1, 20251002, 9)).toEqual({ rows: [], skipped: 0 });
  });

  it('표가 아예 없는 페이지(점검·오류) → 0행', () => {
    expect(parseGateRound('<html><body>점검 중</body></html>', 1, 20251002, 1)).toEqual({ rows: [], skipped: 0 });
  });
});

describe('parseGateList', () => {
  it('목록 행 → 날짜·회차·편성두수', () => {
    const list = parseGateList(fx('gate_list_m1.html'));
    expect(list.length).toBeGreaterThanOrEqual(10);
    expect(list[0]).toEqual({ date: 20261001, trnos: [1, 2, 3, 4, 5], entries: 60 });
  });
  it('목록 표가 없는 페이지 → []', () => {
    expect(parseGateList('<html><body>점검 중</body></html>')).toEqual([]);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run tests/kra/gateTest.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현**

`src/kra/gateTest.ts`:
```ts
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

export function parseGateRound(html: string, meet: number, date: number, trno: number): { rows: GateTestRow[]; skipped: number } {
  const tbl = html.split('<caption>주행심사결과를')[1];
  if (!tbl) return { rows: [], skipped: 0 };
  const body = tbl.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
  const track = /주로상태\s*:\s*([^<]+)/.exec(html)?.[1]?.trim() ?? null;
  const rows: GateTestRow[] = [];
  let skipped = 0;
  for (const tr of body.split('<tr>').slice(1)) {
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
  return { rows, skipped };
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
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/kra/gateTest.test.ts`
Expected: PASS. 목록 첫 행 기대값만 다르면 Step 1 주석대로 fixture 기준으로 고치고, 그 사실을 ledger에 Ruling으로 남긴다.

- [ ] **Step 6: 커밋**

```bash
git add src/kra/gateTest.ts tests/kra/gateTest.test.ts tests/kra/fixtures/gate_round_20261001_m1_t1.html tests/kra/fixtures/gate_round_empty.html tests/kra/fixtures/gate_list_m1.html
git commit -m "feat(gate): 주행심사 결과 HTML 파서 + 실제 응답 fixture

회차 표(16칸)·목록(날짜·회차·편성두수) 파싱, 심사제외 행은 순위·기록 null로 보존.
다음: HTTP 클라이언트(지연·재시도·EUC-KR)."
```

---

### Task 2: HTTP 클라이언트 (지연·시간제한·재시도)

**Files:**
- Modify: `src/kra/gateTest.ts` (파일 끝에 추가)
- Test: `tests/kra/gateTestClient.test.ts`

**Interfaces:**
- Consumes: Task 1 `decodeEucKr`
- Produces:
  - `interface GateClient { fetchRound(meet: number, date: number, trno: number): Promise<string>; fetchList(meet: number, pageIndex?: number): Promise<string> }`
  - `createGateClient(opts?: { fetchImpl?: typeof fetch; delayMs?: number; retryDelayMs?: number; timeoutMs?: number; maxAttempts?: number }): GateClient` — 기본 `delayMs 2000, retryDelayMs 5000, timeoutMs 30000, maxAttempts 3`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/kra/gateTestClient.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGateClient } from '../../src/kra/gateTest.js';

const eucBytes = readFileSync(new URL('./fixtures/gate_round_20261001_m1_t1.html', import.meta.url));
const ok = () => new Response(eucBytes, { status: 200 });

describe('createGateClient', () => {
  it('상세 요청: POST 본문에 trno·date·meet·Act·Sub, EUC-KR 해독', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const client = createGateClient({
      delayMs: 0, retryDelayMs: 0,
      fetchImpl: (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return ok(); }) as typeof fetch,
    });
    const html = await client.fetchRound(1, 20261001, 1);
    expect(html).toContain('플로터');
    expect(calls[0]!.url).toBe('https://race.kra.co.kr/referee/RacingTrainCheckScoreTable.do');
    expect(calls[0]!.body).toBe('trno=1&date=20261001&meet=1&Act=07&Sub=8');
  });

  it('목록 요청: meet은 쿼리, pageIndex는 본문', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const client = createGateClient({
      delayMs: 0, retryDelayMs: 0,
      fetchImpl: (async (url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return ok(); }) as typeof fetch,
    });
    await client.fetchList(3);
    expect(calls[0]!.url).toBe('https://race.kra.co.kr/referee/RacingTrainCheckList.do?Act=07&Sub=8&meet=3');
    expect(calls[0]!.body).toBe('pageIndex=1');
  });

  it('두 번 실패 후 세 번째 성공', async () => {
    let n = 0;
    const client = createGateClient({
      delayMs: 0, retryDelayMs: 0,
      fetchImpl: (async () => { n++; if (n < 3) throw new Error('ECONNRESET'); return ok(); }) as typeof fetch,
    });
    await expect(client.fetchRound(1, 20261001, 1)).resolves.toContain('플로터');
    expect(n).toBe(3);
  });

  it('HTTP 500도 실패로 보고 재시도, 3번 모두 실패하면 throw', async () => {
    let n = 0;
    const client = createGateClient({
      delayMs: 0, retryDelayMs: 0,
      fetchImpl: (async () => { n++; return new Response('err', { status: 500 }); }) as typeof fetch,
    });
    await expect(client.fetchRound(1, 20261001, 1)).rejects.toThrow(/20261001/);
    expect(n).toBe(3);
  });

  it('요청 사이에 delayMs만큼 쉰다', async () => {
    const t: number[] = [];
    const client = createGateClient({
      delayMs: 50, retryDelayMs: 0,
      fetchImpl: (async () => { t.push(Date.now()); return ok(); }) as typeof fetch,
    });
    await client.fetchRound(1, 20261001, 1);
    await client.fetchRound(1, 20261001, 2);
    expect(t[1]! - t[0]!).toBeGreaterThanOrEqual(45);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/kra/gateTestClient.test.ts`
Expected: FAIL (`createGateClient` 없음)

- [ ] **Step 3: 구현 (`src/kra/gateTest.ts` 끝에 추가)**

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/kra/gateTestClient.test.ts tests/kra/gateTest.test.ts`
Expected: PASS (9 + 5)

- [ ] **Step 5: 커밋**

```bash
git add src/kra/gateTest.ts tests/kra/gateTestClient.test.ts
git commit -m "feat(gate): 주행심사 HTTP 클라이언트 — 2초 간격·30초 제한·3회 재시도

스파이크에서 시간제한 없는 요청이 무한 대기한 사례 반영. 다음: 동기화 로직."
```

---

### Task 3: 동기화 로직 (백필·최근분, I/O 주입)

**Files:**
- Create: `src/sync/gateTestSync.ts`
- Test: `src/sync/gateTestSync.test.ts`

**Interfaces:**
- Consumes: Task 1 `parseGateRound`, `parseGateList`, `GateTestRow`; Task 2 `GateClient`
- Produces:
  - `interface GateStore { existing(from: number, to: number): Promise<Array<{ test_date: number; meet: number; trno: number }>>; upsert(rows: GateTestRow[]): Promise<void> }`
  - `interface GateSyncReport { rounds: number; rows: number; skippedRows: number; failures: string[]; shortfalls: string[] }`
  - `eachDate(from: number, to: number): number[]`
  - `backfillGateTests(client: GateClient, store: GateStore, from: number, to: number, opts?: { meets?: number[]; log?: (m: string) => void }): Promise<GateSyncReport>`
  - `syncRecentGateTests(client: GateClient, store: GateStore, opts?: { meets?: number[]; log?: (m: string) => void }): Promise<GateSyncReport>`
  - `const MAX_TRNO = 20`

**동작:**
- 백필: 경마장마다 `eachDate(from,to)`의 날짜를 차례로. 날짜마다 `trno = 1..MAX_TRNO`: **이미 있는 (날짜·경마장·회차)면 요청 없이 다음 회차**; 아니면 받아서 파싱 → 0행이면 그 날짜 종료, 행이 있으면 upsert. 요청 실패는 `failures`에 `m{meet} {date} 회차{trno}`를 넣고 그 날짜 종료(다음 날짜 계속).
- 최근분: 경마장마다 목록 1페이지. 목록 요청 실패 또는 파싱 결과 `[]` → `failures`에 `목록 m{meet}` 기록. 목록의 각 (날짜·회차) 중 DB에 없는 것만 받아 upsert. 끝으로 날짜별 저장 행 수(기존+이번)가 `entries`보다 적으면 `shortfalls`에 `m{meet} {date} 저장 {n}/편성 {entries}`.
- 저장 여부는 시작 시 `store.existing(from,to)` 한 번 조회(백필: from~to, 최근분: 목록 최소~최대 날짜). 최근분의 날짜별 행 수는 `existing` 결과의 행 개수로 센다(existing은 **행 단위** 목록을 돌려준다).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/sync/gateTestSync.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { eachDate, backfillGateTests, syncRecentGateTests, MAX_TRNO, type GateStore } from './gateTestSync.js';
import type { GateClient, GateTestRow } from '../kra/gateTest.js';

// 테스트용 HTML 생성기 — 실제 페이지와 같은 구조(caption·tbody·16칸·goPage1)
const roundHtml = (horses: string[]) => `<caption>주행심사결과를 순위...</caption><tbody>${horses.map((h, i) =>
  `<tr><td>${i + 1}</td><td>${i + 1}</td><td><a onclick="javascript:goPage1('${h}','1')">말${h}</a></td>` +
  `<td>주행미합(신)</td><td>한국</td><td>수</td><td>2</td><td>53</td><td>기수</td><td>조교사</td><td>마주</td>` +
  `<td>450</td><td>1:03.${i}</td><td></td><td>합격</td><td></td></tr>`).join('')}</tbody>`;
const EMPTY = '<caption>주행심사결과를 순위...</caption><tbody></tbody>';
const listHtml = (rows: Array<{ date: number; trnos: number[]; entries: number }>) => `<tbody>${rows.map((r, i) =>
  `<tr><td>${i + 1}</td><td>결과표</td><td>x</td><td>${r.trnos.map((t) => `<a onclick='goPage1("${t}","${r.date}")'>${t}</a>`).join('')}</td>` +
  `<td>${r.entries}</td><td>0</td><td>0</td></tr>`).join('')}</tbody>`;

function fakeClient(rounds: Record<string, string[] | 'fail'>, lists: Record<number, string | 'fail'> = {}) {
  const calls: string[] = [];
  const client: GateClient = {
    async fetchRound(meet, date, trno) {
      const k = `${meet}|${date}|${trno}`; calls.push(k);
      const v = rounds[k];
      if (v === 'fail') throw new Error('boom');
      return v ? roundHtml(v) : EMPTY;
    },
    async fetchList(meet) {
      calls.push(`list${meet}`);
      const v = lists[meet];
      if (v === 'fail') throw new Error('boom');
      return v ?? '<html>점검</html>';
    },
  };
  return { client, calls };
}

function fakeStore(initial: Array<{ test_date: number; meet: number; trno: number }> = []) {
  const saved: GateTestRow[] = [];
  const store: GateStore = {
    async existing(from, to) { return initial.filter((r) => r.test_date >= from && r.test_date <= to); },
    async upsert(rows) { saved.push(...rows); },
  };
  return { store, saved };
}

describe('eachDate', () => {
  it('달·해 경계를 넘는다', () => {
    expect(eachDate(20231230, 20240102)).toEqual([20231230, 20231231, 20240101, 20240102]);
  });
});

describe('backfillGateTests', () => {
  it('회차 1부터 빈 표가 나올 때까지 받고 저장', async () => {
    const { client, calls } = fakeClient({ '1|20240104|1': ['0000001', '0000002'], '1|20240104|2': ['0000003'] });
    const { store, saved } = fakeStore();
    const rep = await backfillGateTests(client, store, 20240104, 20240104, { meets: [1] });
    expect(calls).toEqual(['1|20240104|1', '1|20240104|2', '1|20240104|3']);
    expect(saved.map((r) => r.hr_no)).toEqual(['0000001', '0000002', '0000003']);
    expect(rep).toMatchObject({ rounds: 2, rows: 3, failures: [] });
  });

  it('도중에 끊긴 날짜는 남은 회차부터 이어 받는다(이미 있는 회차는 요청 안 함)', async () => {
    const { client, calls } = fakeClient({ '1|20240104|3': ['0000009'] });
    const { store, saved } = fakeStore([
      { test_date: 20240104, meet: 1, trno: 1 }, { test_date: 20240104, meet: 1, trno: 2 },
    ]);
    await backfillGateTests(client, store, 20240104, 20240104, { meets: [1] });
    expect(calls).toEqual(['1|20240104|3', '1|20240104|4']);
    expect(saved.map((r) => r.hr_no)).toEqual(['0000009']);
  });

  it('요청 실패는 기록하고 다음 날짜로 계속', async () => {
    const { client } = fakeClient({ '1|20240104|1': 'fail', '1|20240105|1': ['0000005'] });
    const { store, saved } = fakeStore();
    const rep = await backfillGateTests(client, store, 20240104, 20240105, { meets: [1] });
    expect(rep.failures).toEqual(['m1 20240104 회차1']);
    expect(saved.map((r) => r.hr_no)).toEqual(['0000005']);
  });

  it('빈 표가 끝내 안 나와도 MAX_TRNO에서 멈춘다', async () => {
    const rounds: Record<string, string[]> = {};
    for (let t = 1; t <= MAX_TRNO + 5; t++) rounds[`1|20240104|${t}`] = [`00000${t}`];
    const { client, calls } = fakeClient(rounds);
    await backfillGateTests(client, fakeStore().store, 20240104, 20240104, { meets: [1] });
    expect(calls).toHaveLength(MAX_TRNO);
  });
});

describe('syncRecentGateTests', () => {
  it('목록에서 DB에 없는 회차만 받는다', async () => {
    const { client, calls } = fakeClient(
      { '1|20261001|2': ['0000002'] },
      { 1: listHtml([{ date: 20261001, trnos: [1, 2], entries: 2 }]) },
    );
    const { store, saved } = fakeStore([{ test_date: 20261001, meet: 1, trno: 1 }]);
    const rep = await syncRecentGateTests(client, store, { meets: [1] });
    expect(calls).toEqual(['list1', '1|20261001|2']);
    expect(saved).toHaveLength(1);
    expect(rep).toMatchObject({ rounds: 1, rows: 1, failures: [], shortfalls: [] });
  });

  it('저장 행 수가 편성두수보다 적으면 shortfall', async () => {
    const { client } = fakeClient(
      { '1|20261001|1': ['0000001'] },
      { 1: listHtml([{ date: 20261001, trnos: [1], entries: 10 }]) },
    );
    const rep = await syncRecentGateTests(client, fakeStore().store, { meets: [1] });
    expect(rep.shortfalls).toEqual(['m1 20261001 저장 1/편성 10']);
  });

  it('목록이 비었거나(점검 페이지) 실패하면 failures에 남긴다 — 조용히 0건 금지', async () => {
    const { client } = fakeClient({}, { 1: '<html>점검</html>', 3: 'fail' });
    const rep = await syncRecentGateTests(client, fakeStore().store, { meets: [1, 3] });
    expect(rep.failures).toEqual(['목록 m1', '목록 m3']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/sync/gateTestSync.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/sync/gateTestSync.ts`:
```ts
/**
 * 주행심사 수집 — 백필(날짜 훑기)과 최근분(목록 기반). I/O는 주입.
 * 스펙 docs/superpowers/specs/2026-10-05-gate-test-collection-design.md §4~6
 */
import { parseGateRound, parseGateList, type GateClient, type GateTestRow } from '../kra/gateTest.js';

export interface GateStore {
  existing(from: number, to: number): Promise<Array<{ test_date: number; meet: number; trno: number }>>;
  upsert(rows: GateTestRow[]): Promise<void>;
}

export interface GateSyncReport { rounds: number; rows: number; skippedRows: number; failures: string[]; shortfalls: string[]; }

export const MAX_TRNO = 20;
const DEFAULT_MEETS = [1, 3];

export function eachDate(from: number, to: number): number[] {
  const out: number[] = [];
  const d = new Date(Date.UTC(Math.floor(from / 10000), Math.floor(from / 100) % 100 - 1, from % 100));
  for (;;) {
    const n = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    if (n > to) return out;
    out.push(n);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

const emptyReport = (): GateSyncReport => ({ rounds: 0, rows: 0, skippedRows: 0, failures: [], shortfalls: [] });
const key = (date: number, meet: number, trno: number) => `${date}|${meet}|${trno}`;

/** 한 회차를 받아 저장. 반환: 저장 행 수(0 = 빈 표). 요청 실패는 throw. */
async function fetchAndStore(client: GateClient, store: GateStore, rep: GateSyncReport, meet: number, date: number, trno: number): Promise<number> {
  const { rows, skipped } = parseGateRound(await client.fetchRound(meet, date, trno), meet, date, trno);
  rep.skippedRows += skipped;
  if (rows.length === 0) return 0;
  await store.upsert(rows);
  rep.rounds += 1;
  rep.rows += rows.length;
  return rows.length;
}

export async function backfillGateTests(
  client: GateClient, store: GateStore, from: number, to: number,
  opts: { meets?: number[]; log?: (m: string) => void } = {},
): Promise<GateSyncReport> {
  const log = opts.log ?? (() => {});
  const rep = emptyReport();
  const have = new Set((await store.existing(from, to)).map((r) => key(r.test_date, r.meet, r.trno)));
  for (const meet of opts.meets ?? DEFAULT_MEETS) {
    for (const date of eachDate(from, to)) {
      let got = 0;
      for (let trno = 1; trno <= MAX_TRNO; trno++) {
        if (have.has(key(date, meet, trno))) continue;
        try {
          const n = await fetchAndStore(client, store, rep, meet, date, trno);
          if (n === 0) break;
          got += n;
        } catch {
          rep.failures.push(`m${meet} ${date} 회차${trno}`);
          break;
        }
      }
      if (got) log(`m${meet} ${date}: ${got}두`);
    }
  }
  return rep;
}

export async function syncRecentGateTests(
  client: GateClient, store: GateStore,
  opts: { meets?: number[]; log?: (m: string) => void } = {},
): Promise<GateSyncReport> {
  const log = opts.log ?? (() => {});
  const rep = emptyReport();
  for (const meet of opts.meets ?? DEFAULT_MEETS) {
    let list;
    try {
      list = parseGateList(await client.fetchList(meet));
    } catch {
      list = [];
    }
    if (list.length === 0) { rep.failures.push(`목록 m${meet}`); continue; }
    const dates = list.map((e) => e.date);
    const rows = (await store.existing(Math.min(...dates), Math.max(...dates))).filter((r) => r.meet === meet);
    const have = new Set(rows.map((r) => key(r.test_date, meet, r.trno)));
    const perDate = new Map<number, number>();
    for (const r of rows) perDate.set(r.test_date, (perDate.get(r.test_date) ?? 0) + 1);
    for (const e of list) {
      for (const trno of e.trnos) {
        if (have.has(key(e.date, meet, trno))) continue;
        try {
          const n = await fetchAndStore(client, store, rep, meet, e.date, trno);
          perDate.set(e.date, (perDate.get(e.date) ?? 0) + n);
          if (n) log(`m${meet} ${e.date} 회차${trno}: ${n}두`);
        } catch {
          rep.failures.push(`m${meet} ${e.date} 회차${trno}`);
        }
      }
      const n = perDate.get(e.date) ?? 0;
      if (n < e.entries) rep.shortfalls.push(`m${meet} ${e.date} 저장 ${n}/편성 ${e.entries}`);
    }
  }
  return rep;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/sync/gateTestSync.test.ts`
Expected: PASS (8)

- [ ] **Step 5: 커밋**

```bash
git add src/sync/gateTestSync.ts src/sync/gateTestSync.test.ts
git commit -m "feat(gate): 주행심사 백필·최근분 동기화 로직 (회차 단위 이어받기)

끊긴 날짜도 남은 회차부터 재개, 목록 빈 페이지는 실패로 집계, 편성두수 대비 누락 경고.
다음: migration·진입점·미러."
```

---

### Task 4: 테이블·진입점·미러·문서

**Files:**
- Create: `supabase/migrations/019_gate_tests.sql`
- Create: `scripts/gateTestSync.ts`
- Modify: `package.json` (`"sync:gate": "tsx scripts/gateTestSync.ts",`를 `"sync:jockey"` 다음 줄)
- Modify: `src/db/mirror/tableSpecs.ts` (증분 블록에 `gate_tests` 추가)
- Modify: `src/db/mirror/tableSpecs.test.ts` (증분 목록 기대값에 `'gate_tests'`)
- Modify: `docs/api_spec.md` (§1.11 주행심사 결과(홈페이지) + §2.1 `gate_tests` 스키마)

**Interfaces:**
- Consumes: Task 2 `createGateClient`; Task 3 `backfillGateTests`, `syncRecentGateTests`, `GateStore`, `GateSyncReport`; `getSupabaseAdmin()` (`src/db/supabase.ts`)

- [ ] **Step 1: 미러 테스트 먼저 수정(실패 확인용)**

`src/db/mirror/tableSpecs.test.ts`의 증분 목록 기대값을:
```ts
    expect(inc).toEqual([
      'combo_dividends', 'gate_tests', 'predictions', 'race_entries',
      'shadow_predictions', 'training_logs',
    ]);
```
테스트 이름 `'증분 대상은 spec §4의 5개'`는 `'증분 대상 6개'`로.

Run: `npx vitest run src/db/mirror/tableSpecs.test.ts`
Expected: FAIL (`gate_tests` 없음)

- [ ] **Step 2: tableSpecs 추가 + 통과 확인**

`src/db/mirror/tableSpecs.ts` 증분 블록 `shadow_predictions` 줄 다음에:
```ts
  gate_tests:         { mode: 'incremental', dateCol: 'test_date',  orderCols: ['meet', 'trno', 'hr_no'] },
```
Run: `npx vitest run src/db/mirror/tableSpecs.test.ts`
Expected: PASS

- [ ] **Step 3: migration 작성**

`supabase/migrations/019_gate_tests.sql`:
```sql
-- ============================================
-- 019_gate_tests.sql
-- 주행심사 결과 (마사회 홈페이지 전용 — 공공 API 없음)
--
-- scripts/gateTestSync.ts가 백필(날짜 훑기)·일일(목록 기반)로 멱등 upsert.
-- 값은 원문 보존(부담중량·도착차·주로상태). 해석은 피처 단계에서.
-- 스펙: docs/superpowers/specs/2026-10-05-gate-test-collection-design.md
-- ============================================

CREATE TABLE IF NOT EXISTS gate_tests (
  test_date      INT          NOT NULL,   -- 심사일 YYYYMMDD
  meet           INT          NOT NULL,   -- 1=서울, 3=부산경남
  trno           INT          NOT NULL,   -- 그날 회차 번호
  hr_no          VARCHAR(10)  NOT NULL,   -- race_entries.hr_no와 같은 형식
  hr_name        VARCHAR(50)  NOT NULL,
  rank           INT,
  gate_no        INT,
  reason         VARCHAR(40),             -- 심사사유 ('주행미합(신)', '장기휴양(재)' 등)
  origin         VARCHAR(20),
  sex            VARCHAR(4),
  age            INT,
  burden         VARCHAR(20),
  jockey         VARCHAR(30),
  trainer        VARCHAR(30),
  owner          VARCHAR(50),
  body_weight    INT,
  time_sec       NUMERIC,                 -- '1:03.4' → 63.4
  margin         VARCHAR(20),
  verdict        VARCHAR(20)  NOT NULL,   -- 합격·불합격·출전제외·출전취소·연습주행·연습취소
  verdict_reason VARCHAR(100),
  track_cond     VARCHAR(30),
  fetched_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (test_date, meet, trno, hr_no)
);

CREATE INDEX IF NOT EXISTS gate_tests_hr_no_idx ON gate_tests (hr_no, test_date);

-- RLS (015 관례): anon 읽기, 쓰기는 service_role만
ALTER TABLE gate_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read" ON gate_tests;
CREATE POLICY "anon_read" ON gate_tests FOR SELECT TO anon USING (true);

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4: 진입점 작성**

`scripts/gateTestSync.ts`:
```ts
/**
 * 주행심사 결과 수집 (마사회 홈페이지).
 *   npm run sync:gate                                   # 최근분(목록 1페이지) — 매일 캐치업 잡
 *   npm run sync:gate -- --from 20220101 --to 20261004  # 백필(날짜 훑기, 재실행 시 이어받기)
 * 실패(요청 실패·목록 비어 있음)가 있으면 종료코드 1. 누락(편성두수 대비)은 경고만.
 */
import 'dotenv/config';
import { getSupabaseAdmin } from '../src/db/supabase.js';
import { createGateClient, type GateTestRow } from '../src/kra/gateTest.js';
import { backfillGateTests, syncRecentGateTests, type GateStore } from '../src/sync/gateTestSync.js';

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

function supabaseStore(): GateStore {
  const sb = getSupabaseAdmin();
  return {
    async existing(from, to) {
      const out: Array<{ test_date: number; meet: number; trno: number }> = [];
      const PAGE = 1000;
      for (let off = 0; ; off += PAGE) {
        const { data, error } = await sb.from('gate_tests')
          .select('test_date, meet, trno')
          .gte('test_date', from).lte('test_date', to)
          .order('test_date').order('meet').order('trno').order('hr_no')
          .range(off, off + PAGE - 1);
        if (error) throw error;
        out.push(...((data ?? []) as typeof out));
        if (!data || data.length < PAGE) return out;
      }
    },
    async upsert(rows: GateTestRow[]) {
      const { error } = await sb.from('gate_tests').upsert(rows, { onConflict: 'test_date,meet,trno,hr_no' });
      if (error) throw error;
    },
  };
}

async function main(): Promise<void> {
  const client = createGateClient();
  const store = supabaseStore();
  const from = arg('--from');
  const t0 = Date.now();
  const rep = from
    ? await backfillGateTests(client, store, Number(from), Number(arg('--to') ?? from), { log: console.log })
    : await syncRecentGateTests(client, store, { log: console.log });
  console.log(`\n주행심사 ${from ? '백필' : '최근분'}: ${rep.rounds}회차 ${rep.rows}행 저장 · 파싱 제외 ${rep.skippedRows}행 · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
  if (rep.shortfalls.length) console.warn(`⚠️ 편성두수 대비 누락 ${rep.shortfalls.length}건:\n  ${rep.shortfalls.join('\n  ')}`);
  if (rep.failures.length) {
    console.error(`❌ 실패 ${rep.failures.length}건 (다시 실행하면 이어서 받음):\n  ${rep.failures.join('\n  ')}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error('💥', e); process.exit(1); });
```
`package.json`: `"sync:jockey"` 줄 다음에 `"sync:gate": "tsx scripts/gateTestSync.ts",`.

- [ ] **Step 5: api_spec 갱신**

`docs/api_spec.md` §1.10 다음에 추가:
```markdown
### 1.11 주행심사 결과 — 마사회 홈페이지 (공공 API 없음)

| 항목 | 값 |
|---|---|
| 용도 | 데뷔 전·휴양 복귀 전 주행심사 회차별 결과 → `gate_tests` |
| 상세 | `POST https://race.kra.co.kr/referee/RacingTrainCheckScoreTable.do` body `trno, date(YYYYMMDD), meet, Act=07, Sub=8` |
| 목록 | `POST https://race.kra.co.kr/referee/RacingTrainCheckList.do?Act=07&Sub=8&meet={1|3}` body `pageIndex` (최근 약 6개월, 10일/페이지) |
| 인코딩 | EUC-KR |
| 수집 | `npm run sync:gate` (최근분, 매일 캐치업 잡) / `-- --from --to` (백필) |

> ⚠️ **Quirk:** 심사 요일이 고정이 아님(서울 2022~23 금 → 2024~ 목, 부경 ~2024 토 → 이후 목·금). 목록에 없는 과거도 날짜 직접 지정 시 열림(2022-01 확인). 빈 날짜·회차 = 빈 표(~31KB). 영천(meet=4) 목록은 비어 있음(부경에서 심사). 마번은 마명 링크 `goPage1('0056500', …)`에만 있다. 시간제한 없는 요청이 무한 대기한 적 있음 → 30초 제한.
```
§2.1 `combo_dividends` 다음에 `gate_tests` 스키마 표(019 SQL의 열·설명 그대로)를 추가.

- [ ] **Step 6: 타입체크 + 전체 테스트**

Run: `npm run build && npm run test:run`
Expected: tsc 무에러, 전체 통과(기존 + 신규 22: 파서 9·클라이언트 5·동기화 8).

- [ ] **Step 7: 커밋**

```bash
git add supabase/migrations/019_gate_tests.sql scripts/gateTestSync.ts package.json src/db/mirror/tableSpecs.ts src/db/mirror/tableSpecs.test.ts docs/api_spec.md
git commit -m "feat(gate): gate_tests 테이블(019)·sync:gate 진입점·미러 증분 대상

백필(--from/--to)·최근분 두 모드, 실패 시 종료코드 1. 다음: 019 적용(사용자)·일일 잡 연결."
```

---

### Task 5: 일일 잡 연결 + 적용·백필(사용자) + 문서

**Files:**
- Modify: `.github/workflows/sync.yml` (결과 캐치업 잡 `catchupSync` 단계 다음)
- Modify: `docs/pipeline_guide.md` (명령어 목록에 `sync:gate` 한 줄), `docs/status/05-data-infra.md` (현재 상태에 한 줄), `TODO.md` (W-008에 ① 완료 표시)

- [ ] **Step 1: 워크플로 단계 추가**

`.github/workflows/sync.yml`의 resultsCatchup 잡 `- name: catchupSync` / `run: npm run sync:catchup` 바로 다음에:
```yaml
      # 주행심사 최근분(마사회 홈페이지) — 실패해도 결과 캐치업 잡은 성공 처리.
      # 목록이 약 6개월치를 보여주므로 며칠 연속 실패해도 다음 성공 때 메워진다.
      - name: gateTestSync (주행심사 최근분)
        continue-on-error: true
        run: npm run sync:gate
```
⚠️ 다른 세션 브랜치 `fix/card-window`가 같은 파일을 수정 중일 수 있다 — 머지 전 `git diff main...fix/card-window -- .github/workflows/sync.yml`로 충돌 여부 확인.

- [ ] **Step 2: 문서 갱신**

- `docs/pipeline_guide.md` 전체 명령어 목록에: `npm run sync:gate  # 주행심사 결과(홈페이지) 최근분 / --from --to 백필`
- `docs/status/05-data-infra.md` 현재 상태에: `주행심사 gate_tests(019) — 홈페이지 수집, 2022-01~ 백필, 매일 캐치업 잡 단계(continue-on-error). 스펙 2026-10-05-gate-test-collection-design.md`
- `TODO.md` W-008 항목 끝에: `  - ① 수집 파이프라인 구현(2026-10-05, 브랜치 feat/gate-test-collection) — 019 적용·백필 후 ②피처·A/B, ③화면.`

- [ ] **Step 3: 빌드·테스트 후 커밋**

```bash
npm run build && npm run test:run
git add .github/workflows/sync.yml docs/pipeline_guide.md docs/status/05-data-infra.md TODO.md
git commit -m "feat(gate): 매일 캐치업 잡에 주행심사 최근분 단계 추가 (실패 격리)

다음: 사용자 019 적용 → 백필 실행 → 연도별 집계 검증 → 머지."
```

- [ ] **Step 4: 사용자 실행 단계 안내 (Claude는 실행하지 않음)**

1. Supabase SQL Editor에서 `supabase/migrations/019_gate_tests.sql` 실행.
2. 최근분 시험: `npm run sync:gate` → "N회차 M행 저장", 실패 0 확인.
3. 백필: `npm run sync:gate -- --from 20220101 --to <어제>` (3~4시간, 끊기면 같은 명령 재실행).
4. 미러: `npm run db:pull -- --table gate_tests`.

- [ ] **Step 5: 백필 검증 (Claude, 로컬 미러)**

```bash
cat > scratch_gatecheck.ts <<'EOF'
import { DuckDBInstance } from '@duckdb/node-api';
const c = await (await DuckDBInstance.create('data/local.duckdb', { access_mode: 'READ_ONLY' })).connect();
const q = async (s: string) => (await c.runAndReadAll(s)).getRowObjectsJson();
console.table(await q(`select test_date // 10000 y, meet, count(distinct test_date) days, count(distinct test_date*100+trno) rounds, count(*) n from gate_tests group by 1,2 order by 1,2`));
console.table(await q(`select count(*) n, sum(case when hr_no is null then 1 else 0 end) no_hr from gate_tests`));
EOF
npx tsx scratch_gatecheck.ts; rm -f scratch_gatecheck.ts
```
Expected: 2024·2025 서울·부경 각 98일 내외(스파이크와 일치), 2022·2023도 연 90~100일 수준, 행 7천/2년 수준. 크게 다르면 누락 날짜를 찾아 그 구간만 `--from --to` 재실행.
