# 배포 가이드

KRA Analyzer 프론트엔드를 **Vercel** 에 배포하고, **GitHub Actions** 로 CI 를 돌리는 절차입니다.

---

## 1. 사전 준비

- GitHub 저장소에 코드가 푸시되어 있을 것
- Vercel 계정 (https://vercel.com — GitHub 로그인 가능)
- Supabase 프로젝트의 `URL` 과 `anon key` 를 미리 복사해 둘 것
  - Supabase Dashboard → Project Settings → API

---

## 2. Vercel 프로젝트 생성

1. https://vercel.com/new 접속
2. GitHub 저장소 선택 → **Import**
3. **Configure Project** 화면에서:
   - **Framework Preset**: `Vite` (자동 인식됨)
   - **Root Directory**: `./` (루트 그대로 — `vercel.json` 이 빌드 경로를 처리)
   - **Build Command / Output Directory / Install Command** 는 건드리지 않음 (`vercel.json` 이 우선 적용됨)
4. **Environment Variables** 펼치고 아래 2개 등록:

   | Key | Value | Environment |
   |-----|-------|-------------|
   | `VITE_SUPABASE_URL` | Supabase Project URL | Production, Preview, Development |
   | `VITE_SUPABASE_ANON_KEY` | Supabase anon public key | Production, Preview, Development |

5. **Deploy** 클릭 → 첫 배포 완료까지 대기

> ⚠️ **service_role key 는 절대 등록하지 말 것.** 프론트엔드는 anon key 만 사용하며, 데이터 보호는 RLS 정책이 담당합니다.

---

## 3. 자동 배포 동작 방식

Vercel 의 GitHub Integration 이 자동으로 처리합니다 — 별도 GitHub Actions 워크플로 불필요:

| 이벤트 | 배포 결과 |
|--------|-----------|
| `main` 푸시 | **Production** 으로 배포 |
| 그 외 브랜치 푸시 / PR | **Preview** 로 배포 (PR 코멘트에 URL 자동 게시) |

---

## 4. CI (GitHub Actions)

`.github/workflows/ci.yml` 이 PR 과 `main` 푸시에 대해 다음을 실행합니다:

**root job** (Node sync / engine 코드)
- `npm ci`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run test:run` (Vitest)

**client job** (Vite 프론트엔드)
- `npm ci`
- `npm run lint`
- `npx tsc -b --noEmit`

두 job 은 병렬로 돌며, 하나라도 실패하면 PR 머지가 차단됩니다 (GitHub Branch protection 설정 시).

### Branch protection 권장 설정

저장소 → Settings → Branches → `main` 에 대해:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
  - `Root (sync / engine)` 와 `Client (frontend)` 를 필수 체크로 추가

---

## 5. 환경 변수 매핑 표

| 변수 | 사용처 | 등록 위치 |
|------|--------|-----------|
| `KRA_API_KEY` | sync 작업 (로컬/스케줄러) | 로컬 `.env` |
| `SUPABASE_URL` | sync 작업 | 로컬 `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | sync 작업 (RLS 우회) | 로컬 `.env` — **절대 Vercel/Git 에 올리지 말 것** |
| `ANTHROPIC_API_KEY` | AI 인사이트 (백엔드) | 로컬 `.env` |
| `VITE_SUPABASE_URL` | 프론트엔드 빌드 | Vercel + `client/.env` |
| `VITE_SUPABASE_ANON_KEY` | 프론트엔드 빌드 | Vercel + `client/.env` |

---

## 6. 트러블슈팅

**Vercel 빌드가 `cannot find module` 로 실패**
→ `vercel.json` 의 `buildCommand` 가 `client/` 디렉토리로 들어가 빌드하는지 확인. 루트의 `node_modules` 는 빌드에 필요 없음.

**프론트가 떠도 데이터가 안 보임**
→ Vercel Environment Variables 의 `VITE_*` 두 개가 등록됐는지, 그리고 등록 후 **재배포** 했는지 확인 (env 변경은 자동 재배포되지 않음).

**CI 의 `npm ci` 가 lockfile 오류**
→ 로컬에서 `npm install` 후 `package-lock.json` 을 커밋. `client/` 의 lockfile 도 동일.
