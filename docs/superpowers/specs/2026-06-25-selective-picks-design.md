# 선별 표시·베팅 (Selective Picks) — 설계

> 작성: 2026-06-25
> 트랙: 적중률 향상 방향 "C. 선별 표시·베팅" (위험 0, 부분집합 적중률↑·커버리지↓)
> 선행: Platt 라이브 캘리브레이션 배포 완료 (`predictions.p_win`/`p_top3`, 39,331행 100%)
> 관련 메모: [[project_market_edge_strategy]] · [[project_market_dominance_ceiling]]

---

## 1. 한 줄 요약

이미 라이브에 적재된 보정 확률 `p_top3`(연승)를 기준으로, 데이터로 결정한 임계값을 넘는
개별 마에 **강추 / 주목** 2단계 라벨을 붙여 UI에 노출하고, "선별 적중률이 실제로 오른다"를
1회성 probe + 상시 추적으로 검증한다. **랭킹·점수·예측 파이프라인은 일절 건드리지 않는다(읽기 레이어만 추가).**

---

## 2. 결정 사항 (브레인스토밍 합의)

| 항목 | 결정 |
|---|---|
| 강추 단위 | **마 단위** (한 경주에 0~여러 마리) |
| 기준 지표 | **연승 `p_top3`** 중심, 단승 `p_win`은 부수 지표로 함께 표시·리포트 |
| 임계값 기준 | **목표 적중률 고정** → 그 적중률을 주는 최저 `p_top3`를 probe 곡선에서 역산 |
| 등급 구조 | **2단계 티어: 강추 / 주목** |
| UI 노출 | 기존 화면 뱃지 + 신규 `/picks` '오늘의 강추' 모음 뷰 |
| 검증 | **1회성 probe + 상시 추적 둘 다** |
| 접근법 | **A (config 기반·얇은 UI)** — 임계값은 `config/selective_picks.json` 단일 출처 |

---

## 3. 아키텍처 (읽기 레이어만 추가)

```
config/selective_picks.json   ← 단일 출처(강추/주목 임계값 + 메타)
        │
        ├─ scripts/probe_selective_picks.ts   (DuckDB 로컬 미러, egress 0)
        │     · 곡선 모드 : 임계값별 (연승 적중률·커버리지·건수·단승 적중률)
        │     · --track   : 최근 N분기 강추/주목 실측 적중률 (상시 추적, 오프라인)
        │
        ├─ client/src/lib/selectivePicks.ts   (JSON 읽어 classifyPick)
        │     → <PickBadge> → PredictionSheet · RaceEntries · /picks · Statistics
        │
        └─ tests : config↔클라이언트 임계값 일치 + classify 경계 + probe 집계
```

설계 원칙: 임계값(튜닝 잦은 값)은 **설정에**, raw 지표(p_top3)는 **원천(predictions)에** 둔다.

---

## 4. config 단일 출처

`config/selective_picks.json` — 클라이언트(Vite JSON import)·스크립트(Node) 양쪽이 읽는 루트 설정.

```json
{
  "version": 1,
  "fitAt": "2026-06-25",
  "metric": "p_top3",
  "tiers": {
    "strong": { "minProb": 0.0, "targetHit": 0.85, "label": "강추" },
    "watch":  { "minProb": 0.0, "targetHit": 0.75, "label": "주목" }
  },
  "fitMeta": { "rows": 0, "from": 0, "to": 0 }
}
```

- `minProb` : probe 곡선 산출 후 채운다(초기 0.0 = 사실상 비활성).
- `targetHit` 0.85/0.75 는 **예시** — probe 곡선을 함께 보고 그 자리에서 확정·기입(데이터 기반).
- classify 로직(p_top3 vs minProb)은 trivial하므로 클라이언트/스크립트에 각각 3줄 함수로 두되,
  **숫자(minProb)는 JSON 단일 출처**. 회귀 테스트가 두 소비처의 임계값 일치를 검증한다.

---

## 5. probe 스크립트 — `scripts/probe_selective_picks.ts` (`npm run probe:picks`)

데이터 출처: **로컬 DuckDB 미러** (`predictions`), `actual_ord IS NOT NULL AND p_top3 IS NOT NULL` (사후).

### 5.1 곡선 모드 (기본)
임계값 0.55~0.90을 5%p 간격으로 스윕하여 출력:

| p_top3 ≥ | 강추 건수 | 연승 적중률 | 커버리지(≥1마 경주%) | 단승 적중률(부수) |
|---|---|---|---|---|
| 0.90 | … | … | … | … |
| … | | | | |

- 연승 적중 = `actual_ord BETWEEN 1 AND 3`
- 단승 적중(부수) = `actual_ord = 1`
- 커버리지 = (해당 임계값 이상 마가 1마리라도 있는 경주 수) / (전체 경주 수)
- 전체 베이스라인(무선별 연승 적중률)도 함께 출력 → 리프트 가시화.

목표 적중률(강추/주목)을 만족하는 **최저 임계값**을 곡선에서 역산 → config `minProb` 기입.

### 5.2 --track 모드 (상시 추적, 오프라인)
config의 확정 임계값으로 최근 N분기 사후 예측을 티어 분류 → 티어별
(건수·연승 적중률·단승 적중률·커버리지) + 전체 대비 리프트 출력.
임계값이 시간이 지나도 유효한지 감시.

### 5.3 순수 함수 분리
집계 로직(`buildSelectionCurve(rows)`, `trackTierAccuracy(rows, config)`)을 I/O와 분리한
순수 함수로 두고 단위 테스트.

---

## 6. 클라이언트 공통 로직 — `client/src/lib/selectivePicks.ts`

```ts
import config from '../../../config/selective_picks.json';
export type PickTier = 'strong' | 'watch' | null;
export function classifyPick(pTop3: number | null): PickTier {
  if (pTop3 == null) return null;
  if (pTop3 >= config.tiers.strong.minProb && config.tiers.strong.minProb > 0) return 'strong';
  if (pTop3 >= config.tiers.watch.minProb  && config.tiers.watch.minProb  > 0) return 'watch';
  return null;
}
export const tierLabel = (t: PickTier) => t ? config.tiers[t].label : null;
```
(minProb===0 = 비활성 가드 → probe 전 무노출. Vite JSON import 경로는 구현 시 확정.)

---

## 7. UI

### 7.1 `<PickBadge>` (`client/src/components/PickBadge.tsx`)
`classifyPick(p_top3)` → 칩. 강추=강조색(amber solid 등), 주목=옅은 색, null=미렌더.
기존 "우승 X% · 연승 Y%" 텍스트는 **유지**하고 그 앞에 칩만 추가.
- 삽입 위치: PredictionSheet (line ~306, ~1046), RaceEntries 확률 표시부.

### 7.2 `/picks` '오늘의 강추' 뷰 (`client/src/pages/TodayPicks.tsx`)
- App.tsx Route + nav 링크 추가.
- 가장 가까운 미래 경주일(`actual_ord IS NULL` = 사전)의 예측 중 `p_top3 ≥ 주목 임계값`인 마를
  경주별로 묶어 카드 리스트. 강추 먼저, 주목 다음.
- 행: 경주(meet·rc_no) · 마명 · 연승% · 단승%(부수) · 뱃지 · 해당 sheet로 링크.
- 강추/주목 0건 → "이번 주 강추 없음(기준 미달)" 빈 상태. **억지 추천 금지(정직성).**

### 7.3 Statistics "선별 적중률" 섹션
사후 예측을 가져와 `classifyPick`으로 티어 분류 → 티어별
(건수·연승 적중률·단승 적중률·커버리지) + 전체 대비 리프트 표.
probe `--track`과 **같은 config·같은 로직** → 웹/스크립트 수치 일치.
전체 history 부하 회피 위해 최근 N분기 윈도우로 스코프.

---

## 8. 테스트 (TDD)

- `selectivePicks.test.ts` — classifyPick 경계값(임계값 직전/직후/null), 강추⊂주목 단조성.
- probe 순수 집계 함수 단위 테스트(샘플 행 → 곡선·티어 적중률 기대값).
- config↔클라이언트 임계값 일치 회귀 테스트.
- `npm run build`(tsc 전체 타입체크) · `npm run test:run`(vitest) 통과 후 커밋.

---

## 9. 구현 순서 (의존성)

1. **probe 곡선** → 목표 적중률로 강추/주목 임계값 확정 → config `minProb`·`fitMeta` 기입.
   (이 단계 산출물을 사용자와 함께 보고 목표 적중률 숫자 확정 — 데이터 기반.)
2. config + `selectivePicks.ts`(classify) + `<PickBadge>` → PredictionSheet·RaceEntries 뱃지.
3. `/picks` '오늘의 강추' 뷰 + 라우트/nav.
4. Statistics "선별 적중률" 섹션 + probe `--track`.

각 단위 = 한 커밋(빌드·테스트 통과 후).

---

## 10. 범위 밖 (YAGNI)

- 베팅 금액·켈리·ROI 계산 (단복승 ROI 트랙은 이미 음성 종결 — [[project_benter_blend]]).
- 예측 시점 tier 저장(`pick_tier` 컬럼)·SQL view (접근법 B 기각: 재백필 비용·blast radius).
- 알림/푸시.

---

## 11. 리스크 / 메모

- **흡수 천장과 무관**: 이 트랙은 시장을 이기려는 게 아니라, 이미 가진 보정 확률을 "정직하게 선별
  노출"하는 서비스 가치. 부분집합 적중률↑·커버리지↓·위험 0이 성공 기준.
- 임계값 단일 출처(JSON)에서 클라이언트/스크립트 두 소비처로 흐르므로, 일치 회귀 테스트 필수.
- probe는 DuckDB 로컬 → egress 0. /picks·Statistics는 웹앱 REST(egress) 사용, 스코프 윈도우로 제한.
- 목표 적중률 숫자는 probe 곡선 전엔 미확정(placeholder) — 곡선 후 사용자와 확정.
