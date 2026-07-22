# 설정탭 정직한 재작성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 또는 executing-plans.
> 스펙: docs/superpowers/specs/2026-07-22-settings-rewrite-design.md

**Goal:** 죽은 목업 설정탭을 실데이터 시스템 현황 + GitHub Actions 딥링크 수동 동기화로 재작성.

**Architecture:** 클라 정적 + Supabase 직접 조회. 신규 훅 `useSyncStatus()` + 순수 포맷터 `ymdToDisplay`. 수동 동기화는 Actions Run workflow 페이지 새 탭 링크.

**Tech Stack:** React, @tanstack/react-query, supabase-js, Tailwind, lucide-react, vitest.

## Global Constraints

- 리포/워크플로 상수: `https://github.com/deanoh533/horseRacing/actions/workflows/sync.yml`.
- cron 스케줄 문구(정확히): 출마표 수·목·금 15:00 KST(주말 금·토·일 3일치) · 결과 토·일·월 01:00 KST.
- 학습 정책 문구: 재학습 동결 — v7 라이브 1분기 누적 + probe:v7-accuracy 판정까지, 이후 분기 1회 수동. 자동 재학습 없음.
- 쓰기·초기화·키편집·즉시재학습 버튼 절대 추가 안 함(클라 범위 밖).
- 기존 라우팅(`/settings`)·`Section`/`Row` 헬퍼 형태 유지.

---

### Task 1: `ymdToDisplay` 순수 포맷터 + 테스트

**Files:**
- Modify: `client/src/lib/week.ts` (함수 추가)
- Test: `client/src/lib/week.test.ts` (기존 파일에 describe 추가; 없으면 생성)

**Interfaces:**
- Produces: `ymdToDisplay(ymd: number | null | undefined): string`

- [ ] **Step 1: 실패 테스트 작성** — `client/src/lib/week.test.ts`에 추가

```ts
import { ymdToDisplay } from './week';

describe('ymdToDisplay', () => {
  it('YYYYMMDD 정수를 대시 날짜로', () => {
    expect(ymdToDisplay(20260712)).toBe('2026-07-12');
  });
  it('한 자리 월·일 zero-pad', () => {
    expect(ymdToDisplay(20260101)).toBe('2026-01-01');
  });
  it('null/undefined/0 → 대시', () => {
    expect(ymdToDisplay(null)).toBe('—');
    expect(ymdToDisplay(undefined)).toBe('—');
    expect(ymdToDisplay(0)).toBe('—');
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd client && npx vitest run src/lib/week.test.ts` → FAIL (ymdToDisplay 미정의)

- [ ] **Step 3: 구현** — `client/src/lib/week.ts`에 추가

```ts
/** YYYYMMDD 정수 → "YYYY-MM-DD" 표시용. null/0 → "—". */
export function ymdToDisplay(ymd: number | null | undefined): string {
  if (!ymd || ymd <= 0) return '—';
  const s = String(ymd);
  if (s.length !== 8) return '—';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
```

- [ ] **Step 4: 통과 확인** — `cd client && npx vitest run src/lib/week.test.ts` → PASS

- [ ] **Step 5: 커밋** — `git add client/src/lib/week.ts client/src/lib/week.test.ts && git commit -m "feat(settings): ymdToDisplay 날짜 포맷터 + 테스트"`

---

### Task 2: `useSyncStatus()` 훅

**Files:**
- Modify: `client/src/lib/queries.ts` (훅 + 인터페이스 추가)

**Interfaces:**
- Consumes: 기존 `supabase` import.
- Produces:
```ts
export interface SyncStatus {
  latestCardDate: number | null;
  raceCount: number;
  latestResultDate: number | null;
  lastCreatedAt: string | null;
}
export function useSyncStatus(): ReturnType<typeof useQuery<SyncStatus>>;
```

- [ ] **Step 1: 훅 구현** — `client/src/lib/queries.ts` 끝부분에 추가. 각 조회는 개별 `try/catch→null`로 감싸 하나가 실패해도 패널이 안 깨지게.

```ts
export interface SyncStatus {
  latestCardDate: number | null;
  raceCount: number;
  latestResultDate: number | null;
  lastCreatedAt: string | null;
}

/** 설정탭 동기화 현황 — 최신 출마표 경주일 / 누적 경주 수 / 결과 기록 경주일 / 마지막 수집 시각 */
export function useSyncStatus() {
  return useQuery({
    queryKey: ['sync-status'],
    queryFn: async (): Promise<SyncStatus> => {
      const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
        try { return await fn(); } catch { return fallback; }
      };
      const [latestCardDate, raceCount, latestResultDate, lastCreatedAt] = await Promise.all([
        safe(async () => {
          const { data } = await supabase.from('races')
            .select('race_date').order('race_date', { ascending: false }).limit(1).maybeSingle();
          return (data?.race_date as number | undefined) ?? null;
        }, null),
        safe(async () => {
          const { count } = await supabase.from('races')
            .select('*', { count: 'exact', head: true });
          return count ?? 0;
        }, 0),
        safe(async () => {
          const { data } = await supabase.from('predictions')
            .select('race_date').not('actual_ord', 'is', null)
            .order('race_date', { ascending: false }).limit(1).maybeSingle();
          return (data?.race_date as number | undefined) ?? null;
        }, null),
        safe(async () => {
          const { data } = await supabase.from('race_entries')
            .select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle();
          return (data?.created_at as string | undefined) ?? null;
        }, null),
      ]);
      return { latestCardDate, raceCount, latestResultDate, lastCreatedAt };
    },
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 2: 타입체크** — `cd client && npm run build` → 통과

- [ ] **Step 3: 커밋** — `git add client/src/lib/queries.ts && git commit -m "feat(settings): useSyncStatus 훅 — 동기화 현황 실조회"`

---

### Task 3: Settings.tsx 전면 재작성

**Files:**
- Rewrite: `client/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `useActiveModelVersion`(기존), `useSyncStatus`(Task 2), `ymdToDisplay`(Task 1), `Link`(react-router-dom).

- [ ] **Step 1: 상단 imports·상수 교체.** 기존 mock `ALL_ITEMS`/`DEFAULT_INSIGHTS`/useState 4종 삭제. 추가:

```tsx
import { RefreshCw, Brain, Cpu, KeyRound, ExternalLink, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useActiveModelVersion, useSyncStatus } from '../lib/queries';
import { ymdToDisplay } from '../lib/week';

const ACTIONS_URL =
  'https://github.com/deanoh533/horseRacing/actions/workflows/sync.yml';
```

- [ ] **Step 2: 본문 재작성.** `Settings()` 함수를 아래 구조로. `Section`/`Row` 헬퍼는 유지(파일 하단). `Toggle`/`RadioButton`/`ExportButton`은 사용처 없으면 삭제.

```tsx
export function Settings() {
  const { data: model, isLoading: modelLoading } = useActiveModelVersion();
  const { data: sync } = useSyncStatus();

  const itemCount = model?.weights ? Object.keys(model.weights).length : null;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">⚙️ 설정 · 시스템 현황</h1>

      {/* 활성 모델 */}
      <Section title="활성 모델" icon={<Cpu className="w-4 h-4 text-[var(--color-accent-cyan)]" />}>
        {modelLoading ? (
          <div className="text-sm text-[var(--color-text-secondary)]">모델 로딩 중…</div>
        ) : model ? (
          <div className="space-y-1.5">
            <Row label="모델" value={`${model.label} (id=${model.id})`} />
            <Row label="학습 소스" value={model.source} />
            {itemCount != null && <Row label="항목 수" value={`${itemCount}개`} />}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Link to="/versions" className="px-3 py-1.5 bg-[var(--color-bg-elevated)] rounded hover:text-[var(--color-accent-cyan)]">버전 비교 →</Link>
              <Link to="/insights" className="px-3 py-1.5 bg-[var(--color-bg-elevated)] rounded hover:text-[var(--color-accent-cyan)]">인사이트 →</Link>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[var(--color-text-secondary)]">활성 모델 없음 (마이그레이션 확인)</div>
        )}
      </Section>

      {/* 데이터 동기화 */}
      <Section title="데이터 동기화" icon={<RefreshCw className="w-4 h-4 text-[var(--color-accent-cyan)]" />}>
        <div className="space-y-1.5 text-sm">
          <Row label="최신 출마표 경주일" value={ymdToDisplay(sync?.latestCardDate)} />
          <Row label="누적 경주 수" value={sync ? `${sync.raceCount.toLocaleString()} 경주` : '—'} />
          <Row label="결과 기록된 최신 경주일" value={ymdToDisplay(sync?.latestResultDate)} />
          <Row label="마지막 출마표 수집" value={sync?.lastCreatedAt ? new Date(sync.lastCreatedAt).toLocaleString('ko-KR') : '—'} />
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--color-bg-elevated)]">
          <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">자동 스케줄 (무인 cron)</h3>
          <ul className="text-xs text-[var(--color-text-secondary)] space-y-1 list-disc pl-4">
            <li>출마표 — 수·목·금 15:00 KST (주말 금·토·일 3일치)</li>
            <li>결과 — 토·일·월 01:00 KST</li>
          </ul>
        </div>

        <div className="mt-4 pt-4 border-t border-[var(--color-bg-elevated)]">
          <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">수동 실행 (GitHub Actions)</h3>
          <div className="flex flex-wrap gap-2">
            <a href={ACTIONS_URL} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black rounded transition-colors">
              출마표 수동 실행 <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <a href={ACTIONS_URL} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-[var(--color-bg-elevated)] hover:bg-[var(--color-accent-cyan)] hover:text-black rounded transition-colors">
              결과 수동 실행 <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          <div className="mt-2 px-3 py-2 bg-[var(--color-bg-elevated)] rounded flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
            <Info className="w-4 h-4 text-[var(--color-warning)] flex-shrink-0 mt-0.5" />
            <span><strong>Run workflow</strong>에서 target(<code>racecard</code>=출마표 / <code>results</code>=결과)·date 선택 후 실행. 결과는 수 분 내 반영.</span>
          </div>
        </div>
      </Section>

      {/* 가중치 학습 */}
      <Section title="가중치 학습" icon={<Brain className="w-4 h-4 text-[var(--color-accent-gold)]" />}>
        <div className="text-sm text-[var(--color-text-secondary)] space-y-2">
          <p><strong className="text-white">재학습 동결.</strong> v7-shape 라이브 성적 1개 분기(~12주) 누적 + <code>probe:v7-accuracy</code> 첫 판정까지 재학습·승격 동결.</p>
          <p>이후 분기 1회 <strong className="text-white">수동</strong> 사이클: db:snapshot → learn:candidate → benchmark → promote. 자동 재학습 없음.</p>
        </div>
        <div className="mt-3 text-xs">
          <Link to="/versions" className="px-3 py-1.5 bg-[var(--color-bg-elevated)] rounded hover:text-[var(--color-accent-cyan)]">버전 비교 →</Link>
        </div>
      </Section>

      {/* 관리 */}
      <Section title="자격증명 관리" icon={<KeyRound className="w-4 h-4 text-[var(--color-text-secondary)]" />}>
        <div className="px-3 py-2 bg-[var(--color-bg-elevated)] rounded flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
          <Info className="w-4 h-4 text-[var(--color-warning)] flex-shrink-0 mt-0.5" />
          <span>KRA API 키·Supabase 자격증명은 <strong>GitHub Secrets</strong> / 로컬 <code>.env</code> 에서 관리합니다(웹에서 편집 불가).</span>
        </div>
      </Section>

      {/* 푸터 */}
      <div className="text-center text-xs text-[var(--color-text-disabled)] pt-4 pb-8">
        KRA Analyzer{model ? ` · 활성 모델 ${model.label}${itemCount != null ? ` (${itemCount}개 항목)` : ''}` : ''}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 미사용 헬퍼 정리.** 재작성 후 참조 없는 `Toggle`/`RadioButton`/`ExportButton` 함수 삭제. `Section`/`Row` 유지. 미사용 import(lucide 아이콘 등) 제거.

- [ ] **Step 4: 타입체크** — `cd client && npm run build` → 통과 (미사용 변수·import 0)

- [ ] **Step 5: 전체 테스트** — 루트 `npm run test:run` → 통과

- [ ] **Step 6: 커밋** — `git add client/src/pages/Settings.tsx && git commit -m "feat(settings): 설정탭 정직한 재작성 — 실현황·수동동기화 딥링크"`

---

### Task 4: 육안 확인 + 마무리

- [ ] **Step 1: dev 서버** — `npm run client:dev`, `/settings` 열어 활성 모델·동기화 현황 실값·수동 버튼(새 탭 Actions) 확인.
- [ ] **Step 2:** 사용자에게 화면 확인 요청 → 머지.

## Self-Review (작성자 체크)

- 스펙 커버리지: 활성모델·동기화현황·수동트리거·학습정책·자격증명안내·푸터·목업제거 전부 Task로 매핑됨. ✅
- Placeholder: 없음. 모든 스텝에 실제 코드. ✅
- 타입 일관: `useActiveModelVersion` 반환 `{id,label,weights,source}` — `weights`로 항목 수, created_at은 미사용(등록일 표시 생략, 스펙의 "있으면"을 미표시로 확정). `useSyncStatus` 반환 4필드 Settings에서 그대로 소비. ✅
