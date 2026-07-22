# 수동 동기화 서버리스 실행 — 설계

> 2026-07-22 · 브랜치 예정 `feat/manual-sync-serverless`
> 승인: 사용자 2026-07-22 ("이대로 해보자") · 후속: [[project_launch_gating_ops]] · 스펙 [2026-07-22-settings-rewrite](2026-07-22-settings-rewrite-design.md)

## 배경 / 문제

설정탭의 수동 동기화가 GitHub Actions **페이지를 열어주기만** 하고(딥링크) 실제 실행은 사용자가
Actions UI에서 Run 해야 한다. "버튼 클릭 = 실제 실행"을 원함.

정적 클라이언트는 실행 API(`workflow_dispatch`) 호출에 필요한 `actions:write` 토큰을
안전하게 못 들고 있다(번들=공개). → 토큰을 숨길 **서버 측 자리**가 필요.

## 결정 (사용자 선택: A. 서버리스 함수)

Vercel 서버리스 함수 `api/sync`가 GitHub 실행 API를 대리 호출. 함수는 요청 시에만 실행
(상시 서버 아님). 토큰은 Vercel 환경변수(번들 밖). 남용 방지로 암구호 게이트.

## 아키텍처

```
[설정탭 버튼] --POST /api/sync {target,date?}, header x-sync-key--> [Edge 함수]
    │                                                                   │ SYNC_SECRET 검증
    │                                                                   │ GH_DISPATCH_TOKEN 사용
    │                                                                   ▼
    │                                     POST api.github.com/.../sync.yml/dispatches
    │                                                {ref:main, inputs:{target,date?}}
    └── 상태 표시(시작됨/실패)                                          ▼
                                                        Actions 실행 (기존 sync.yml)
```

## 함수 — `api/sync.ts` (Vercel Edge runtime)

- `export const config = { runtime: 'edge' }` — Web 표준 `Request`/`Response`/전역 `fetch` 사용, `@vercel/node` 의존 없음.
- 메서드: `POST`만(그 외 405).
- 환경변수: `SYNC_SECRET`(암구호), `GH_DISPATCH_TOKEN`(GitHub PAT). 둘 중 하나라도 없으면 500(서버 미설정).
- 인증: 헤더 `x-sync-key` !== `SYNC_SECRET` → 401.
- 본문 파싱(순수 헬퍼 `parseSyncBody`):
  - `target`이 `'racecard'|'results'` 아니면 에러.
  - `date`는 `/^\d{8}$/`일 때만 채택, 아니면 생략(워크플로 자동 기본값).
- GitHub 호출: `POST https://api.github.com/repos/deanoh533/horseRacing/actions/workflows/sync.yml/dispatches`
  헤더 `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`, `User-Agent`. 본문 `{ ref: 'main', inputs }`.
  - 성공 = **204 No Content** → `{ ok: true, target, date }` 200.
  - 그 외 → `{ error: 'GitHub <status>', detail }` 502.

### 순수 헬퍼 (테스트 대상)

```ts
export type SyncParse =
  | { ok: true; inputs: { target: string; date?: string } }
  | { ok: false; error: string };
export function parseSyncBody(raw: unknown): SyncParse;
```

- `raw`가 객체 아님 → error.
- `target` 미허용 → error.
- `date` 8자리 숫자면 inputs.date 포함, 아니면 생략(에러 아님).

## 클라 — 설정탭 수정 (`client/src/pages/Settings.tsx`)

- 딥링크 `<a>` 2개 → **실행 버튼** 2개(`출마표 실행` / `결과 실행`).
- **암구호 입력칸**: localStorage 키 `kra_sync_key`. 마운트 시 로드, 입력 시 저장.
- 클릭 핸들러 `runSync(target)`:
  - 암구호 없으면 "암구호를 먼저 입력" 안내.
  - `fetch('/api/sync', { method:'POST', headers:{'content-type':'application/json','x-sync-key':key}, body: JSON.stringify({target}) })`.
  - 상태: idle → 실행 중 → `✅ 실행 시작됨(1~2분 뒤 반영)` / `❌ <메시지>`.
- 보조로 `Actions에서 보기 ↗`(ACTIONS_URL) 링크 유지.
- **주의(문서화):** 로컬 dev(vite 5173)엔 `/api`가 없어 버튼은 프로덕션(Vercel)에서만 동작. 로컬은 typecheck·순수테스트로 검증.

## vercel.json

캐치올 rewrite가 `/api`를 삼키지 않도록 제외:
`"source": "/(.*)"` → `"source": "/((?!api/).*)"`.

## 타입체크 / 테스트 인프라

- `api/tsconfig.json`(신규): `noEmit`, `lib:["ES2022","DOM"]`, `types:["node"]`, strict, `include:["**/*.ts"]`.
- npm 스크립트 `typecheck:api` = `tsc -p api/tsconfig.json`.
- vitest `include`에 `'api/**/*.test.ts'` 추가 → `api/sync.test.ts`로 `parseSyncBody` 단위테스트.

## 사용자 셋업 (코드 밖 — 사용자 작업)

1. GitHub **파인그레인드 PAT**: 리포 `horseRacing`, 권한 **Actions: Read and write**.
2. Vercel 환경변수: `GH_DISPATCH_TOKEN`=PAT · `SYNC_SECRET`=암구호(임의 문자열).
3. 배포 후 설정탭에 같은 암구호 1회 입력.

## 검증

- `npm run typecheck:api` 통과.
- `cd client && npm run build`(tsc) 통과.
- `npm run test:run`(신규 parseSyncBody 테스트 포함) 통과.
- 배포 후 실기기: 설정탭 암구호 입력 → `출마표 실행` → GitHub Actions에 새 run 생김 확인.

## 범위 밖(후속)

- 날짜 지정 입력칸(현재 자동 기본값), 실행 이력/최근 run 상태 폴링, 여러 리포/브랜치 지원.
