# Loading Skeleton — Design Spec

**Date:** 2026-05-30  
**Scope:** U-001 — 예상지(PredictionSheet) HorseCard 영역 로딩 스켈레톤  
**Status:** Approved

---

## Goal

예상지 화면에서 말 데이터 로딩 중 `<Loader2 animate-spin>` 스피너를 제거하고, 실제 HorseCard 레이아웃을 모사한 skeleton placeholder로 교체한다.

---

## Scope

- **적용 화면:** `PredictionSheet.tsx` — HorseCard 목록 영역만
- **제외:** 포디엄 카드, ComboBetBox, Dashboard, RaceEntries, HorseDetail, RaceDetail

---

## Component Design

### `HorseCardSkeleton`

`PredictionSheet.tsx` 내부(파일 상단 유틸 섹션)에 함수 컴포넌트로 추가. 별도 파일 분리 없음.

**데스크탑 (md+) — 4열 grid:**

| 열 | 비율 | 내용 |
|---|---|---|
| Col 1 | 2fr | 아바타 원형 + 이름 bar 2개 + 하단 bar 2개 |
| Col 2 | 1.2fr | badge chip + bar 3개 |
| Col 3 | 3fr | 차트 높이 block(42px) + bar 3개 |
| Col 4 | 2fr | heading bar + bar 3개 |

실제 HorseCard 의 `grid-template-columns: 2fr_1.2fr_3fr_2fr` 와 동일한 비율.  
열 구분선: `border-r border-[var(--color-bg-elevated)]`

**모바일 (< md) — 막대형:**

카드 내부에 `padding: 14px`, 막대 3개 (60% / 100% / 80% 너비).

**Animation:**

Tailwind `animate-pulse`. 색상: `bg-white/[.07]` (현재 다크 테마 `--color-bg-surface` 대비).  
추가 패키지 없음.

**카드 수:** 8개 고정 (`Array.from({ length: 8 })`).  
8은 서울·부경 통상 경주 마릿수(8~12마) 기준 최솟값.

---

## Replacement

`PredictionSheet` 렌더링 부분에서:

```tsx
// Before
{isLoading && (
  <div className="flex items-center justify-center py-16 gap-2 text-sm" ...>
    <Loader2 className="w-4 h-4 animate-spin" />
    불러오는 중...
  </div>
)}
```

```tsx
// After
{isLoading && (
  <div className="space-y-3">
    {Array.from({ length: 8 }).map((_, i) => (
      <HorseCardSkeleton key={i} />
    ))}
  </div>
)}
```

`Loader2` import는 다른 곳에서 쓰이지 않으면 함께 제거.

---

## File Changes

| 파일 | 변경 |
|---|---|
| `client/src/pages/PredictionSheet.tsx` | `HorseCardSkeleton` 컴포넌트 추가, `isLoading` 블록 교체, `Loader2` import 제거(필요 시) |

---

## Non-goals

- RaceEntries, Dashboard 등 다른 화면의 스피너 — 별도 태스크
- 스켈레톤 공용 컴포넌트(`Skeleton.tsx`) 분리 — 현 시점 오버엔지니어링
- 애니메이션 커스터마이징 — Tailwind 기본 `animate-pulse` 충분
