# 수동 동기화 서버리스 실행 Implementation Plan

> REQUIRED SUB-SKILL: subagent-driven-development / executing-plans.
> 스펙: docs/superpowers/specs/2026-07-22-manual-sync-serverless-design.md

**Goal:** 설정탭 수동 동기화 버튼을 딥링크 → Vercel Edge 함수 통한 실제 workflow_dispatch 실행으로 전환.

**Architecture:** `api/sync.ts`(Edge) 가 GitHub 실행 API 대리 호출(토큰=Vercel 환경변수, 암구호 게이트). 클라 버튼이 함수 POST.

**Tech Stack:** Vercel Edge Function, Web fetch, React, vitest, tsc.

## Global Constraints

- 리포/워크플로: `deanoh533/horseRacing` · `sync.yml` · `ref: main`.
- 토큰·암구호는 코드/번들에 절대 하드코딩 금지 — `process.env.GH_DISPATCH_TOKEN`·`process.env.SYNC_SECRET`만.
- 성공 판정 = GitHub 응답 **204**.
- 로컬 dev엔 `/api` 없음 → 버튼 실동작은 프로덕션 전용. 로컬은 typecheck+순수테스트로만 검증.
- target 허용값 정확히 `racecard` | `results`. date는 `^\d{8}$`만.

---

### Task 1: 순수 파서 `parseSyncBody` + 테스트

**Files:**
- Create: `api/sync.ts` (일단 파서만; 핸들러는 Task 2에서)
- Create: `api/sync.test.ts`
- Modify: `vitest.config.ts` (include에 `'api/**/*.test.ts'` 추가)

**Interfaces:**
- Produces:
```ts
export type SyncParse =
  | { ok: true; inputs: { target: string; date?: string } }
  | { ok: false; error: string };
export function parseSyncBody(raw: unknown): SyncParse;
```

- [ ] **Step 1: vitest include 확장** — `vitest.config.ts`
```ts
include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts', 'client/src/lib/**/*.test.ts', 'api/**/*.test.ts'],
```

- [ ] **Step 2: 실패 테스트 작성** — `api/sync.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { parseSyncBody } from './sync';

describe('parseSyncBody', () => {
  it('racecard 허용, date 없으면 inputs.date 생략', () => {
    expect(parseSyncBody({ target: 'racecard' })).toEqual({ ok: true, inputs: { target: 'racecard' } });
  });
  it('results + 8자리 date 채택', () => {
    expect(parseSyncBody({ target: 'results', date: '20260712' })).toEqual({
      ok: true, inputs: { target: 'results', date: '20260712' },
    });
  });
  it('date가 8자리 아니면 생략(에러 아님)', () => {
    expect(parseSyncBody({ target: 'racecard', date: '2026' })).toEqual({ ok: true, inputs: { target: 'racecard' } });
  });
  it('target 미허용 → 에러', () => {
    const r = parseSyncBody({ target: 'nope' });
    expect(r.ok).toBe(false);
  });
  it('객체 아님 → 에러', () => {
    expect(parseSyncBody(null).ok).toBe(false);
    expect(parseSyncBody('x').ok).toBe(false);
  });
});
```

- [ ] **Step 3: 실패 확인** — `npx vitest run api/sync.test.ts` → FAIL (parseSyncBody 미정의)

- [ ] **Step 4: 파서 구현** — `api/sync.ts` (상단, 핸들러 없이 우선)
```ts
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
```

- [ ] **Step 5: 통과 확인** — `npx vitest run api/sync.test.ts` → PASS

- [ ] **Step 6: 커밋** — `git add api/sync.ts api/sync.test.ts vitest.config.ts && git commit -m "feat(sync): parseSyncBody 파서 + 테스트 (Task 1)"`

---

### Task 2: Edge 핸들러 + api tsconfig + typecheck 스크립트

**Files:**
- Modify: `api/sync.ts` (핸들러 추가)
- Create: `api/tsconfig.json`
- Modify: `package.json` (스크립트 `typecheck:api`)

- [ ] **Step 1: api/tsconfig.json 생성**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 2: package.json 스크립트 추가** — scripts에
```json
"typecheck:api": "tsc -p api/tsconfig.json",
```

- [ ] **Step 3: 핸들러 구현** — `api/sync.ts`의 파서 아래에 추가
```ts
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
  if (!secret || !token) return json({ error: '서버 환경변수 미설정(SYNC_SECRET/GH_DISPATCH_TOKEN)' }, 500);
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
    return json({ ok: true, target: parsed.inputs.target, date: parsed.inputs.date ?? '(자동)' }, 200);
  }
  const detail = (await gh.text()).slice(0, 300);
  return json({ error: `GitHub 응답 ${gh.status}`, detail }, 502);
}
```

- [ ] **Step 4: typecheck** — `npm run typecheck:api` → 통과 (Request/Response/fetch/process 인식)

- [ ] **Step 5: 커밋** — `git add api/sync.ts api/tsconfig.json package.json && git commit -m "feat(sync): api/sync Edge 핸들러 — workflow_dispatch 대리 호출 (Task 2)"`

---

### Task 3: vercel.json rewrite 제외

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: rewrite source 수정** — `/api` 제외
```json
"rewrites": [
  { "source": "/((?!api/).*)", "destination": "/index.html" }
]
```

- [ ] **Step 2: 커밋** — `git add vercel.json && git commit -m "fix(deploy): rewrite에서 /api 제외 — 서버리스 함수 라우팅 (Task 3)"`

---

### Task 4: 설정탭 실행 버튼 + 암구호

**Files:**
- Modify: `client/src/pages/Settings.tsx`

- [ ] **Step 1: import·상태 추가** — 상단 import에 `useState`, `useEffect` 추가. `Settings()` 내부에:
```tsx
const [syncKey, setSyncKey] = useState('');
const [syncMsg, setSyncMsg] = useState<{ tone: 'ok' | 'err' | 'run'; text: string } | null>(null);
const [running, setRunning] = useState<string | null>(null);

useEffect(() => {
  setSyncKey(localStorage.getItem('kra_sync_key') ?? '');
}, []);

const saveKey = (v: string) => {
  setSyncKey(v);
  localStorage.setItem('kra_sync_key', v);
};

const runSync = async (target: 'racecard' | 'results') => {
  if (!syncKey.trim()) {
    setSyncMsg({ tone: 'err', text: '먼저 암구호를 입력하세요.' });
    return;
  }
  setRunning(target);
  setSyncMsg({ tone: 'run', text: '실행 요청 중…' });
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-key': syncKey.trim() },
      body: JSON.stringify({ target }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) {
      setSyncMsg({ tone: 'ok', text: `✅ ${target === 'racecard' ? '출마표' : '결과'} 실행 시작됨 — 1~2분 뒤 반영.` });
    } else {
      setSyncMsg({ tone: 'err', text: `❌ 실패: ${data.error ?? res.status}` });
    }
  } catch (e) {
    setSyncMsg({ tone: 'err', text: `❌ 네트워크 오류: ${(e as Error).message}` });
  } finally {
    setRunning(null);
  }
};
```

- [ ] **Step 2: "수동 실행" 블록 교체** — 기존 딥링크 `<a>` 2개 블록을 아래로 교체(암구호칸 + 실행 버튼 + 상태 + 보조 링크):
```tsx
<div className="mt-4 pt-4 border-t border-[var(--color-bg-elevated)]">
  <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">수동 실행</h3>
  <div className="mb-2">
    <input
      type="password"
      value={syncKey}
      onChange={(e) => saveKey(e.target.value)}
      placeholder="암구호 (SYNC_SECRET)"
      className="w-full bg-[var(--color-bg-elevated)] px-3 py-2 rounded text-sm"
    />
  </div>
  <div className="flex flex-wrap gap-2">
    <button
      onClick={() => runSync('racecard')}
      disabled={running !== null}
      className="px-3 py-2 text-sm bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black rounded transition-colors disabled:opacity-50"
    >
      출마표 실행
    </button>
    <button
      onClick={() => runSync('results')}
      disabled={running !== null}
      className="px-3 py-2 text-sm bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black rounded transition-colors disabled:opacity-50"
    >
      결과 실행
    </button>
    <a
      href={ACTIONS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-accent-cyan)] rounded transition-colors"
    >
      Actions에서 보기 <ExternalLink className="w-3.5 h-3.5" />
    </a>
  </div>
  {syncMsg && (
    <div
      className={`mt-2 text-xs ${
        syncMsg.tone === 'ok'
          ? 'text-[var(--color-success)]'
          : syncMsg.tone === 'err'
          ? 'text-[var(--color-danger)]'
          : 'text-[var(--color-text-secondary)]'
      }`}
    >
      {syncMsg.text}
    </div>
  )}
  <div className="mt-2 px-3 py-2 bg-[var(--color-bg-elevated)] rounded flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
    <Info className="w-4 h-4 text-[var(--color-warning)] flex-shrink-0 mt-0.5" />
    <span>
      암구호는 이 브라우저에만 저장됩니다. 실행은 GitHub Actions에서 진행되며 결과는 수 분 내 반영.
      <strong> 로컬 dev 서버에선 동작하지 않고 배포본에서만</strong> 작동합니다.
    </span>
  </div>
</div>
```

- [ ] **Step 3: 타입체크** — `cd client && npm run build` → 통과 (미사용 import 0)

- [ ] **Step 4: 전체 테스트** — 루트 `npm run test:run` → 통과

- [ ] **Step 5: 커밋** — `git add client/src/pages/Settings.tsx && git commit -m "feat(settings): 수동 동기화 실행 버튼 + 암구호 (Task 4)"`

---

### Task 5: 최종 검증 + 마무리

- [ ] **Step 1:** `npm run typecheck:api` + `cd client && npm run build` + 루트 `npm run test:run` 모두 통과 재확인.
- [ ] **Step 2:** 사용자에게 셋업 안내(PAT 발급·Vercel 환경변수 2개·설정탭 암구호) 전달.
- [ ] **Step 3:** 머지 결정.

## Self-Review (작성자 체크)

- 스펙 커버리지: 함수·파서·핸들러·envگ이트·vercel rewrite·클라 버튼·암구호·typecheck·테스트 전부 Task 매핑. ✅
- Placeholder 없음, 전 스텝 실코드. ✅
- 타입 일관: `parseSyncBody` 반환 SyncParse를 핸들러가 소비, `inputs`를 GitHub 본문에 그대로 전달. ✅
- 보안: 토큰·암구호 env only, 번들 무노출. ✅
