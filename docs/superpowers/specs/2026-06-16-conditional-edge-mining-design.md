# 조건부 엣지 마이닝 도구 — 설계

> 2026-06-16. 두 천장([[project_market_dominance_ceiling]]) 위 방법론 전환 후보 (c) 조건부 엣지.
> 관련: `docs/strategy/2026-06-16-market-edge-and-korean-winning-conditions.md` A4(c)·A5-3 / [[project_market_edge_strategy]]

## 1. 목적

"전 경주에서 모델>시장"은 −7.4%p로 기각 확정(집계 천장). 그러나 **특정 조건의 경주 부분집합에서만** 모델 정면대결이 시장을 이길 수 있다. 이 도구는 경주를 조건 구간으로 쪼개 **모델 1순위 vs 인기 1순위** 우위를 측정하되, **여러 분기에서 반복되는 구간만** 진짜로 인정해 거짓 발견을 막는다.

이것은 **읽기 전용 발굴/진단 도구**다. 모델·DB·라이브 경로를 바꾸지 않는다. 발견된 구간은 N1처럼 별도 brainstorm/게이트를 거쳐야 채택 후보가 된다.

## 2. 확정된 설계 결정 (brainstorm Q1~Q4)

| # | 결정 | 값 |
|---|---|---|
| Q1 마이닝 원자 | **경주 단위** — 모델 top1 vs 인기 top1(최저 win_odds) 정면대결 |
| Q2 판정 지표 | **3면**: 단승(1착)·2착내·연승(3착내). 단일 픽이라 `Tally`(win/place/show) 그대로 재사용. 주 정렬축 = 연승 |
| Q3 조건 차원 | 인기1위 배당대 · 출전두수 · 거리대 · 불일치 강도 |
| Q3b 조합 | 단일 차원 **+ 2차 조합**. 3차 이상은 범위 밖 |
| Q4 가드 | **분기 안정성** — 구간 엣지가 표본 충분한 분기들의 다수에서 +. 풀링 단발 불신 |

## 3. 데이터 (실측 2026-06-16)

- 범위: **2024-05-24 ~ 2026-06-13**, **9분기**(2024Q2 부분 216경주 ~ 2026Q2 부분). 분기당 ~430경주.
- `win_odds` 보유율 **100%** (모든 경주). 시장 비교 결손 없음.
- 2024Q2(부분)는 포함하되 최소표본 가드가 약한 셀을 자동 배제 → 별도 제외 불필요.
- 왼쪽 절단(데이터 시작 전 이력 미관측)은 학습 전용 구간에만 영향, 본 도구는 *결과 분포*만 보므로 무관.

## 4. 아키텍처 (부품별 1책임 · 독립 테스트)

신규 코드는 `src/engine/eval/edgeMining.ts`(순수 로직)에 모으고, `scripts/mine_conditional_edge.ts`(CLI·I/O)가 호출. 기존 `collectRaces`·`loadVersion`·`rankHorses`·`rankByOdds`·`rollingBlocks` 재사용.

### 4.1 Conditioner — `race → 조건 라벨`
순수 함수. 한 경주의 말 목록 + win_odds + 모델 순위를 받아 차원별 버킷 라벨을 낸다.

- **favOddsBand**: 인기1위(최저 win_odds)의 배당. **probe 확정(2026-06-16, 분위수 p25=1.8·p50=2.3·p75=2.9)**: `≤1.8 강한본명 / (1.8,2.3] / (2.3,2.9] / >2.9 혼전`. (KRA 인기1위 배당은 대부분 ≤3.4라 분위수 기반으로 4등분.)
- **fieldBand**: 출전두수. 잠정 `≤9 / 10–11 / ≥12` (실측 분포: 대부분 10–12, 8–9 일부). probe 확정.
- **distBand**: `≤1400 단 / 1401–1700 중 / >1700 장` (기존 일관).
- **disagreeStrength**: 모델 순위에서 인기1위가 몇 등인가. `2등=약한 불일치 / 3등=중 / ≥4등=강한 반대`. 불일치 경주에서만 정의.

### 4.2 EdgeRecorder — `races → 결과행[]`
모델 top1 ≠ 인기 top1 인 경주만 추려, 각 경주를 1행으로:
`{ quarterKey, labels, modelPickOrd, favPickOrd }`. (착순 결측·취소마 제외)

### 4.3 StabilityAggregator — `결과행[] → 구간 통계[]`
구간(segment) = 차원 버킷의 특정 조합. 단일 차원 각 버킷 + 2차 조합 각 셀.
각 구간 × 분기로 묶어:
- 분기별: n, 모델픽 win/top2/top3 비율, 인기픽 win/top2/top3 비율, **연승 엣지 = 모델픽 top3율 − 인기픽 top3율**.
- 구간 종합:
  - `qualifyingQuarters` = 분기 n ≥ `MIN_CELL_N` 인 분기 수
  - `positiveQuarters` = qualifying 중 연승 엣지 > 0 인 분기 수
  - `pooled*Edge` = 전 분기 합산 엣지(단·2착·연승)
  - **판정**: `qualifyingQuarters ≥ MIN_QUARTERS` 이고 `positiveQuarters / qualifyingQuarters ≥ POSITIVE_RATIO` → **채택후보** / 표본 부족(`qualifyingQuarters < MIN_QUARTERS`) → **보류** / 그 외 → **혼조**

파라미터(상수·CLI 조정): `MIN_CELL_N`(잠정 20), `MIN_QUARTERS`(잠정 6, 완전분기 8개 기준), `POSITIVE_RATIO`(잠정 0.6). 잠정값은 첫 실행 분포 보고 조정.

### 4.4 Reporter — `구간 통계[] → 콘솔`
ASCII 표. 정렬: 채택후보 우선 → 풀링 연승 엣지 desc. 컬럼:
`구간 | 총n | qualifying분기 | 양수분기(예 6/8) | 연승엣지 | 단승엣지 | 2착엣지 | 판정`
+ 분기별 +/− 스파크라인(예 `+ + − + + + − +`)으로 한눈에 안정성 확인.

## 5. CLI

`scripts/mine_conditional_edge.ts` → `package.json` `"mine:edge": "tsx scripts/mine_conditional_edge.ts"`.
플래그: `--champion <id>`(기본 is_active), `--min-n <N>`, `--no-combos`(단일 차원만), `--single <dim>`(한 차원만).

## 6. 테스트 (TDD)

- **Conditioner**: 버킷 경계값(배당 2.0/3.5, 두수 9/12, 거리 1400/1700, 불일치 2/4등).
- **EdgeRecorder**: 불일치 판정(동일픽 제외), 착순 기록, 결측 제외.
- **StabilityAggregator**(핵심): 합성 분기 입력으로 — 5/6 양수+표본충분 → 채택후보 / 3/6 → 혼조 / 표본부족 → 보류 / 풀링 엣지 계산 정확.
- **Reporter**: 스모크(정렬·포맷).

## 7. 범위 밖 (YAGNI)

- **말 단위 순위격차 마이닝**(brainstorm 옵션 B) — 단일 픽서 신호 보이면 후속.
- **EV/베팅 ROI·실제 복승 배당** — 환급률 천장 별개 트랙. 본 도구는 정확도 엣지만.
- **3차 이상 조합** — 다중비교 폭증.
- **자동 채택** — 발견은 brainstorm/게이트로 넘김(N1 선례).

## 8. 성공 기준

도구가 9분기 데이터에서 각 단일/2차 구간의 분기 안정성 표를 출력하고, "채택후보"로 분류된 구간이 있으면 그 조건분포를 사람이 해석할 수 있다. **흡수 천장 재확인(채택후보 0)도 유효한 결과** — N1처럼 정직한 음성도 메타패턴에 기록한다.
