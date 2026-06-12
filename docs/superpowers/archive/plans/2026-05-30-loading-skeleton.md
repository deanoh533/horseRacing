# Loading Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 예상지 HorseCard 로딩 스피너를 4열 구조 반영 skeleton placeholder로 교체한다.

**Architecture:** `PredictionSheet.tsx` 단일 파일 수정. `HorseCardSkeleton` 함수 컴포넌트를 유틸 섹션(line ~119)에 추가하고, `isLoading` 블록(line ~1198)에서 `<Loader2>` 스피너를 8개 skeleton 카드로 교체한다.

**Tech Stack:** React, TypeScript, Tailwind CSS. 추가 패키지 없음.

---

### Task 1: `HorseCardSkeleton` 컴포넌트 추가 및 스피너 교체

**Files:**
- Modify: `client/src/pages/PredictionSheet.tsx`
  - line 14: `Loader2` import 제거
  - line ~119: `HorseCardSkeleton` 컴포넌트 추가
  - line ~1198: `isLoading` 블록 교체

---

- [ ] **Step 1: `Loader2` import에서 제거**

`client/src/pages/PredictionSheet.tsx` line 14:

찾을 코드:
```typescript
import { ChevronLeft, Loader2, LayoutList, Activity } from 'lucide-react';
```

교체할 코드:
```typescript
import { ChevronLeft, LayoutList, Activity } from 'lucide-react';
```

---

- [ ] **Step 2: `HorseCardSkeleton` 컴포넌트 추가**

`client/src/pages/PredictionSheet.tsx` 유틸 섹션(`// ─── 유틸 ─────` 주석 바로 다음 줄인 `function formatErng` 앞)에 삽입:

찾을 코드:
```typescript
// ─── 유틸 ────────────────────────────────────────────────────────────

function formatErng(v: number | null): string {
```

교체할 코드:
```typescript
// ─── 유틸 ────────────────────────────────────────────────────────────

function HorseCardSkeleton() {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-bg-elevated)' }}
    >
      {/* 데스크탑 (md+): 4열 grid — 실제 HorseCard 비율과 동일 */}
      <div className="hidden md:grid" style={{ gridTemplateColumns: '2fr 1.2fr 3fr 2fr' }}>
        {/* Col 1: 기수 정보 */}
        <div className="p-3 border-r border-[var(--color-bg-elevated)] flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/[.07] animate-pulse flex-shrink-0" />
            <div className="flex flex-col gap-1 flex-1">
              <div className="h-2.5 bg-white/[.07] animate-pulse rounded w-[70%]" />
              <div className="h-2 bg-white/[.07] animate-pulse rounded w-[50%]" />
            </div>
          </div>
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[80%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[55%]" />
        </div>
        {/* Col 2: 말 정보 */}
        <div className="p-3 border-r border-[var(--color-bg-elevated)] flex flex-col gap-2">
          <div className="h-4 bg-white/[.07] animate-pulse rounded-full w-11" />
          <div className="h-2.5 bg-white/[.07] animate-pulse rounded w-[85%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[65%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[72%]" />
        </div>
        {/* Col 3: 직전경주 / 점수 */}
        <div className="p-3 border-r border-[var(--color-bg-elevated)] flex flex-col gap-2">
          <div className="h-11 bg-white/[.07] animate-pulse rounded" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[90%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[70%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[80%]" />
        </div>
        {/* Col 4: 베팅 조합 */}
        <div className="p-3 flex flex-col gap-2">
          <div className="h-3 bg-white/[.07] animate-pulse rounded w-[75%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-full" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[85%]" />
          <div className="h-2 bg-white/[.07] animate-pulse rounded w-[60%]" />
        </div>
      </div>
      {/* 모바일 (<md): 막대형 */}
      <div className="md:hidden p-3 flex flex-col gap-2">
        <div className="h-3 bg-white/[.07] animate-pulse rounded w-[60%]" />
        <div className="h-2.5 bg-white/[.07] animate-pulse rounded w-full" />
        <div className="h-2 bg-white/[.07] animate-pulse rounded w-[80%]" />
      </div>
    </div>
  );
}

function formatErng(v: number | null): string {
```

---

- [ ] **Step 3: `isLoading` 블록 교체**

`client/src/pages/PredictionSheet.tsx` `isLoading` 스피너 블록을 찾아 교체:

찾을 코드:
```typescript
      {isLoading && (
        <div
          className="flex items-center justify-center py-16 gap-2 text-sm"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          불러오는 중...
        </div>
      )}
```

교체할 코드:
```typescript
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <HorseCardSkeleton key={i} />
          ))}
        </div>
      )}
```

---

- [ ] **Step 4: 타입체크 통과 확인**

```bash
cd "C:/Users/mjy76/Documents/projectFolder/client" && npx tsc --noEmit
```

Expected: 에러 없음. 에러 발생 시 해당 줄 수정.

---

- [ ] **Step 5: 시각 검증**

```bash
cd "C:/Users/mjy76/Documents/projectFolder" && npm run client:dev
```

브라우저에서 `/race/1/<최근날짜>/<rcNo>/sheet` 접근 후:
- 데이터 로딩 중 → 8개 skeleton 카드 표시 (스피너 없음)
- 데스크탑: 4열 pulse 블록이 보임
- 모바일(브라우저 개발자도구 375px): 막대 3개가 보임
- 로딩 완료 후 → 실제 HorseCard로 교체됨 (레이아웃 점프 없음)

---

- [ ] **Step 6: 커밋**

```bash
git add client/src/pages/PredictionSheet.tsx
git commit -m "feat(ui): 예상지 로딩 스피너 → 4열 skeleton으로 교체 (U-001)"
```
