# 설정탭 정직한 재작성 — 설계

> 2026-07-22 · 브랜치 예정 `feat/settings-rewrite`
> 승인: 사용자 2026-07-22 ("좋아")

## 배경 / 문제

`client/src/pages/Settings.tsx`는 거의 전부 **죽은 목업**(15번째 줄 `// ⚠️ Mock 데이터`).
동작하는 액션이 없고, 내용이 v5.1·2026-05-22 시절 그대로라 현재 시스템과 어긋난다.

| 항목 | 현재(목업) | 실제(2026-07) |
|---|---|---|
| 버전 | `v5.1 (17개 항목)` | v7-shape(id=7, is_active) · 로지스틱 학습 |
| 동기화 | "매일 새벽 3:00 자동", 마지막 2026-05-22 | 무인 cron: 출마표 수·목·금 15시(주말 3일치) · 결과 토·일·월 1시 |
| 학습 | "3개월마다 자동 · 다음 08-22 · 즉시 재학습" | 재학습 **동결**(L-003): v7 라이브 1분기 누적까지, 이후 수동 1회 |
| KRA 키 | 편집·확인 | GitHub Secrets / 로컬 `.env` 관리(클라 불가) |
| 인사이트 4개·알림·내보내기·초기화 | 버튼만, 미구현 | 동작 안 함 / 클라에서 불가 |

## 제약 (아키텍처)

- 클라이언트(Vercel 정적)는 **Supabase를 직접** 읽는다. 상시 서버·serverless 함수 없음(`api/` 디렉터리 없음).
- 동기화는 **GitHub Actions cron 또는 로컬 CLI**만 실행 — KRA 키·Node 필요, 브라우저에서 스크립트 실행 불가.
- 쓰기(service_role) 작업은 클라에서 안 함 → 초기화·재학습·키편집은 원천적으로 클라 범위 밖.

## 결정

1. **수동 동기화 = GitHub Actions Run workflow 딥링크.** 비밀번호 노출 0, 인프라 추가 0.
   워크플로 `sync.yml`에 이미 `workflow_dispatch`(target: racecard|results, date 선택) 존재.
2. **정직한 전면 재작성.** 죽은 목업 전부 제거, 실데이터/실동작만 남긴다.

## 새 페이지 구성

정직한 재작성 후 설정탭 = **시스템 현황(읽기) + 진짜 동작하는 액션**.

### 섹션 1 — 활성 모델 (읽기, 실조회)
- 출처: 기존 `useActiveModelVersion()` (`model_versions` where `is_active=true` → `id, label, weights, source`, created_at은 `ModelVersion` 타입에 있음 — 필요 시 select 확장).
- 표시: 모델 라벨 · id · source · (있으면)등록일 · 항목 수(`Object.keys(weights).length`).
- 링크: `버전 비교 →`(`/versions`), `인사이트 →`(`/insights`).
- 로딩/빈 상태: "모델 버전 로딩 중…" / "활성 모델 없음(마이그레이션 확인)".

### 섹션 2 — 데이터 동기화 (실조회 현황 + 수동 트리거)
- 출처: 신규 훅 `useSyncStatus()` (아래 계약).
- 표시:
  - 출마표: 최신 로드 경주일 `latestCardDate`(YYYY-MM-DD로 포맷) · 누적 경주 수 `raceCount` · 마지막 수집 시각 `lastCreatedAt`(로컬 일시).
  - 결과: 결과 기록된 최신 경주일 `latestResultDate`.
- 자동 스케줄(고정 안내, 읽기): "출마표 — 수·목·금 15:00 KST(주말 금·토·일 3일치) / 결과 — 토·일·월 01:00 KST".
- **수동 동기화** 버튼 2개 → 새 탭으로 GitHub Actions 열기:
  - `출마표 수동 실행 ↗` · `결과 수동 실행 ↗`
  - URL: `https://github.com/deanoh533/horseRacing/actions/workflows/sync.yml` (리포/워크플로는 상수).
  - 안내문: "GitHub Actions에서 **Run workflow** → target(racecard/results)·date 선택 후 실행. 결과는 수 분 내 Supabase 반영."
  - `target=`{racecard|results}를 URL 쿼리로 실을 수 없으므로(깃헙 UI 한계) 버튼 둘 다 같은 페이지를 열고, 각 버튼 옆 안내에 어느 target을 고르라고 명시.

### 섹션 3 — 가중치 학습 (읽기, 정책 안내)
- 고정 문구(L-003): "재학습 **동결** — v7-shape 라이브 성적 1개 분기(~12주) 누적 + `probe:v7-accuracy` 첫 판정까지 동결. 이후 분기 1회 **수동** 사이클(db:snapshot → learn:candidate → benchmark → promote). 자동 재학습 없음."
- 링크: `버전 비교 →`(`/versions`).
- "즉시 재학습" 버튼은 **넣지 않음**(동결 정책 + 클라 불가). 향후 로컬 CLI 복사버튼은 별도 후속.

### 섹션 4 — 관리(읽기 안내)
- KRA 키·Supabase 자격증명 한 줄 안내: "키·자격증명은 **GitHub Secrets / 로컬 `.env`** 에서 관리(웹에서 편집 불가)."

### 푸터
- 하드코딩 `v5.1` 제거 → 활성 모델 라벨·항목 수 동적: "KRA Analyzer · 활성 모델 {label} ({n}개 항목)". 활성 모델 없으면 "KRA Analyzer".

### 제거 (죽은 목업)
KRA API 키 편집/확인, 인사이트 지표 4개 선택, 외관(테마·언어), 알림, 데이터 내보내기, 초기화(가중치·전체삭제). 관련 미사용 컴포넌트(`Toggle`/`RadioButton`/`ExportButton`)는 재작성 후 사용처 없으면 삭제, `Section`/`Row`는 유지.

## 신규 훅 계약 — `useSyncStatus()` (client/src/lib/queries.ts)

```ts
export interface SyncStatus {
  latestCardDate: number | null;    // races 최신 race_date
  raceCount: number;                // races 총 행 수 (count exact)
  latestResultDate: number | null;  // predictions에서 actual_ord IS NOT NULL 최신 race_date
  lastCreatedAt: string | null;     // race_entries 최신 created_at (ISO)
}
export function useSyncStatus(): UseQueryResult<SyncStatus>;
```

구현: `Promise.all` 4개 소형 조회 —
- `races` `.select('race_date').order('race_date',{ascending:false}).limit(1).maybeSingle()`
- `races` `.select('*',{count:'exact',head:true})`
- `predictions` `.select('race_date').not('actual_ord','is',null).order('race_date',{ascending:false}).limit(1).maybeSingle()`
- `race_entries` `.select('created_at').order('created_at',{ascending:false}).limit(1).maybeSingle()`

`staleTime` 5분. 설정탭 저빈도라 egress 영향 미미.

## 순수 로직 (테스트 대상)

UI·Supabase 훅은 단위테스트 어려움(기존 queries.ts 훅도 무테스트). 유일한 순수 로직 =
날짜 포맷터를 분리해 테스트:
- `ymdToDisplay(ymd: number | null): string` — `20260712 → "2026-07-12"`, `null → "—"`. (client/src/lib/week.ts 또는 신규 유틸)
- 이미 `week.ts`에 YYYYMMDD 다루는 유틸 있음 → 거기 추가.

## 검증

- `cd client && npm run build`(tsc) 통과.
- `npm run test:run`(신규 포맷터 테스트 포함) 통과.
- 로컬 dev 서버로 설정탭 육안 확인: 활성 모델·동기화 현황 실값 표시, 수동 버튼이 올바른 Actions 페이지를 새 탭으로 엶.

## 범위 밖(후속 후보)

- serverless 원클릭 동기화, 로컬 CLI 복사버튼, 테마 토글 실구현, CSV 내보내기.
