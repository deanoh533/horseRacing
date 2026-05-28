# 🏆 KRA 경마 분석 도구 - PRD Overview

**서비스명:** KRA Analyzer (개인 분석 도구)
**사용자:** 본인 1명 (5년차 경마 분석가)
**목적:** 적중률 향상 → 수익 증대
**최종 업데이트:** 2026-05-26
**버전:** v6.1 (18개 항목 + race_entries 통합 단일 모드)
**배포:** [horse-racing-xi-one.vercel.app](https://horse-racing-xi-one.vercel.app/) ✅ 운영 중

---

## 🆕 v5.1 → v6.1 변경 (2026-05-25 ~ 26)

```
1. 17개 → 18개 항목
   - ⑱ 수득상금 (race_entries.erng_sump) 신규
   - ρ=0.239 (3번째 강한 신호)

2. ⑧ 부담중량 알고리즘 재설계
   - 기존: "가벼움 유리" 5-tier
   - 신규: handicap 극복 지수 (보정 착순)
   - ρ -0.13 → +0.317 (가장 강한 신호로 등극)

3. ⑫ 출발번호 입력 변경
   - 기존: stOrd (KRA의 "출발 순위" 필드)
   - 신규: chul_no = pthr_no (마구간 번호 = 진짜 게이트 번호)
   - 이유: stOrd가 결승순위와 100% 동일 = cheating 발견

4. DB 스키마 통합 (v6.1, 2026-05-26)
   - race_cards (사전) + horse_results (사후) → race_entries 단일 테이블
   - PK: (race_date, meet, rc_no, pthr_no)
   - result_at 으로 사전/사후 판별 (null = 경기 전)
   - 효과: 수요일부터 웹에서 출전마 즉시 표시 가능
   - 마이그레이션: 004_race_entries.sql (38,517 rows 통합 완료)

5. Score Engine 단일 모드
   - 듀얼 함수 (predictRace + predictFromCards) → predictRace 단일
   - race_entries.ord === null 이면 사전 모드 자동 분기
   - scorePredictor.ts -47% (310 → 165 줄)

6. 운영 가능
   - 수/목: raceCardSync (다음 주말 출주표 → race_entries 사전 채움)
   - 금~일: UI에서 사전 예측 확인 (베팅 결정)
   - 일 밤: dailySync (결과 → race_entries UPDATE + predictions 갱신)

7. 학습 시스템 정착
   - Spearman ρ 측정 → blend 0.5 적용
   - weight_history 누적
   - 진짜 베이스라인 25.8% → 학습 후 28.3% (랜덤 9.3%의 3배)
```

---

## 📁 문서 구조

```
docs/
├── PRD_overview.md             ← 현재 문서 (v6.0)
├── score_items/                ← 18개 점수 항목
│   ├── 01_rating.md ~ 17_market_odds.md
│   └── 18_earnings.md          ⭐ 신규
├── algorithms/
│   └── ai_insights.md
├── data_flow.md                ⭐ 신규 (2-모드, sync 흐름)
├── kra_api_quirks.md           ⭐ 신규 (endpoint 함정 + cheating 사례)
├── results_log.md              ⭐ 신규 (적중률/ρ 변천)
├── DEPLOYMENT.md
└── _archive/
```

---

## 🎯 핵심 정체성

```
사용자: 본인 1명 (개인 도구)
경력: 경마 전문 분석가 5년+
목적: 적중률 → 수익 향상
```

## 🏗️ 기술 스택

```
프론트엔드: React + Vite + Tailwind CSS (다크모드)
백엔드: 없음 (Supabase 직접 + 로컬 스크립트로 sync)
DB: Supabase PostgreSQL (500MB 무료)
AI: Claude API (선택된 4개 핵심에 대한 인사이트)
배포: Vercel (완전 무료, horse-racing-xi-one.vercel.app)
```

## 📊 18개 점수 항목

> ⚠️ **비중 합계 = 108.77점** (⑱ 추가 후 정규화 안 함).
> 학습 시스템이 항목별 ρ 기반으로 가중치 자동 재정규화 (실제 사용 시 합 100).

| # | 항목 | PRD 초기 | 학습 ρ | 학습 가중치 | 상태 | 파일 |
|---|---|---|---|---|---|---|
| 1 | 레이팅 | 17.54 | +0.119 | 5.68 | ✅ | [01_rating.md](score_items/01_rating.md) |
| 2 | 마체중 변화 | 4.21 | -0.007 | **0.00** ⚠️ | ⏸ 알고리즘 검토 | [02_weight_change.md](score_items/02_weight_change.md) |
| 3 | 착순 추세 | 4.21 | **+0.290** | 13.83 🥈 | ✅ | [03_recent_form.md](score_items/03_recent_form.md) |
| 4 | 구간 시간 단축 | 2.37 | +0.048 | 2.28 | ✅ | [04_sectional_time.md](score_items/04_sectional_time.md) |
| 5 | 후반 구간 순위 | 2.37 | 0.000 | **0.00** ⚠️ | 🚫 KRA 데이터 없음 | [05_late_position.md](score_items/05_late_position.md) |
| 6 | 거리 적성 | 8.77 | +0.120 | 5.75 | ⏳ 의논 대기 | [06_distance_fitness.md](score_items/06_distance_fitness.md) |
| 7 | 주로 적응 | 8.77 | +0.006 | 0.29 ⚠️ | ⏸ 알고리즘 검토 | [07_track_adaptation.md](score_items/07_track_adaptation.md) |
| 8 | **부담 극복 지수** | 4.39 | **+0.317** | 15.16 🥇 | ✅ 재설계 완료 | [08_burden_weight.md](score_items/08_burden_weight.md) |
| 9 | 기수 폼 | 10.53 | +0.188 | 9.00 | ⏳ 의논 대기 | [09_jockey_form.md](score_items/09_jockey_form.md) |
| 10 | 조교사 폼 | 7.02 | +0.135 | 6.44 | ⏳ 의논 대기 | [10_trainer_form.md](score_items/10_trainer_form.md) |
| 11 | 경주 간격 | 3.51 | +0.122 | 5.81 | ✅ | [11_race_interval.md](score_items/11_race_interval.md) |
| 12 | 출발번호 (**chul_no**) | 2.63 | +0.061 | 2.90 | ✅ | [12_starting_position.md](score_items/12_starting_position.md) |
| 13 | 나이×거리×성별 | 2.63 | -0.056 | **0.00** ⚠️ | ⏸ 임시 매트릭스 | [13_age_distance_gender.md](score_items/13_age_distance_gender.md) |
| 14 | 혈통 (3대) | 4.39 | 0.000 | **0.00** ⚠️ | 🚫 API284 미동기화 | [14_pedigree.md](score_items/14_pedigree.md) |
| 15 | 계절 패턴 | 4.39 | +0.153 | 7.33 | ✅ | [15_seasonal_pattern.md](score_items/15_seasonal_pattern.md) |
| 16 | 기수-말 궁합 | 3.51 | +0.059 | 2.83 | ⏳ 의논 대기 | [16_jockey_horse_chemistry.md](score_items/16_jockey_horse_chemistry.md) |
| 17 | 배당률 (인기도) | 8.77 | +0.236 | 11.28 | ✅ | [17_market_odds.md](score_items/17_market_odds.md) |
| **18** | **수득상금** ⭐ NEW | 8.77 | **+0.239** | 11.43 🥉 | ✅ | [18_earnings.md](score_items/18_earnings.md) |

**측정 시점:** 2026-05-25 (commit `febd5c3`). 자세한 학습 ρ 변천은 [results_log.md](results_log.md).

### 한눈에 보는 인사이트

- 🥇 **⑧ 부담 극복** (ρ +0.317): 사용자 도메인 통찰 (handicap 시스템) 으로 알고리즘 재설계 후 가장 강한 신호
- 🥈 **③ 착순 추세** (ρ +0.290): 최근 폼이 가장 직관적인 예측력
- 🥉 **⑱ 수득상금** (ρ +0.239): 신규 도입. race_entries 의 통산 상금 = 검증된 실력
- ⚠️ **② ⑤ ⑬ ⑭** (ρ ≤ 0): 학습 후 가중치 0. 알고리즘 또는 데이터 보강 필요

---

## 🔄 데이터 흐름 (race_entries 단일 모드)

상세: [data_flow.md](data_flow.md)

### 통합 흐름

```
[KRA 출주표 API314/316] → raceCardSync → race_entries (사전 컬럼 + result_at=null)
                                       → races (race_date, meet, rc_no)

[KRA 결과 API214_1] → dailySync → race_entries UPDATE (결과 컬럼 + result_at=NOW)
                               → races UPDATE (rc_dist, track_type 등)
                               → predictions upsert

[Score Engine] → predictRace(rcDate, meet, rcNo)
              → race_entries.ord === null ? 사전 모드 : 사후 모드 (자동 분기)
              → predictions
```

**사전/사후 판별**: `race_entries.result_at === null` (= 경기 전) 또는 `ord === null`.

### 운영 시나리오

```
[수~목]  npx tsx src/sync/raceCardSync.ts --date 20260530   ← 토요일 출주표
         npx tsx src/sync/raceCardSync.ts --date 20260531   ← 일요일 출주표
         npm run backfill -- --date 20260530                ← 사전 예측 채움
         npm run backfill -- --date 20260531

[금~일]  https://horse-racing-xi-one.vercel.app/dashboard
         → 예측 1-3위 + 종합 점수 + 항목별 점수 확인
         → 베팅 결정

[일 밤]  npx tsx src/sync/dailySync.ts --date 20260530      ← race_entries 결과 UPDATE
         npm run backfill                                   ← actual_ord 채움 + 적중 갱신

[누적 학습]
         npx tsx scripts/apply_learned_weights.ts
         → weight_history 새 row + predictions total_score 재계산
```

---

## 🧠 가중치 학습 시스템

상세: [results_log.md](results_log.md)

### 알고리즘

1. **Spearman 순위 상관계수 ρ**: 각 항목 raw_score 와 실제 ord 의 순위 일치도 측정
2. **적정 가중치 산출**: ρ ≥ 0 인 항목만 → ρ 비례로 100점 정규화 (음수는 0 클립)
3. **blend 비율**: 새 가중치 = `PRD × (1-α) + 학습 × α`. 현재 α=0.5 (절충)
4. **weight_history 저장**: 매 학습마다 새 row (period_start, period_end, race_count, weights, correlations)
5. **predictions 재계산**: 새 가중치로 raw_score × weight 재집계

### 측정된 효과

| 단계 | 단승 적중률 | 비고 |
|---|---|---|
| 초기 cheating 포함 | 26.9% | stOrd cheating |
| **정직 베이스라인** | **23.8%** | stOrd → chul_no |
| ⑧ 부담 극복 재설계 | 25.2% | +1.4%p |
| ⑱ 수득상금 신규 | 27.5% | +2.3%p |
| **+ 학습 (blend 0.5)** | **28.3%** | +0.8%p, 누적 +4.5%p |
| 랜덤 기대 | 9.3% | 평균 14.8마 |

→ **랜덤 대비 약 3배 적중률**.

---

## 🎯 두 가지 별개 시스템: 핵심 지표 vs 인사이트 지표

### 1️⃣ 핵심 지표 4개 (자동, UI 별표시) ⭐

가중치 학습 상위 4개 항목에 자동 ⭐ 표시. 데이터에 따라 자동 변경.

현재 학습 결과 기준:
```
⭐ 1순위: ⑧ 부담 극복 (15.16)
⭐ 2순위: ③ 착순 추세 (13.83)
⭐ 3순위: ⑱ 수득상금 (11.43)
⭐ 4순위: ⑰ 배당률 (11.28)
```

### 2️⃣ 인사이트 지표 4개 (사용자 수동 선택, AI 분석) 🤖

본인이 18개 중 자유롭게 4개 선택. Claude API 가 자연어 인사이트 자동 생성.

기본값:
```javascript
user_settings.insight_indicators = [
  "03_recent_form", "06_distance_fitness",
  "09_jockey_form", "16_jockey_horse_chemistry",
]
```

### 비교

| 구분 | 핵심 지표 ⭐ | 인사이트 지표 🤖 |
|---|---|---|
| 선정 | 자동 (학습 가중치 순) | 수동 (사용자 선택) |
| 변경 | 학습으로 자연 변경 | 사용자가 언제든 |
| 목적 | UI 강조 (영향력) | AI 분석 (관심사) |
| 표시 | ⭐ 별표 | AI 텍스트 |

---

## 🤖 AI 인사이트 (Claude API)

상세: [algorithms/ai_insights.md](algorithms/ai_insights.md)

```
사용자 선택 인사이트 지표 4개에 대해서만 자동 생성
배치 (매일 새벽 3시, 대시보드용) + Lazy (클릭 시, 말 상세용)
캐싱: race_insights (영구), horse_insights (24h TTL)
모델: Claude Haiku 4.5
월 비용: 약 $0.12 (160원)
```

**구현 상태:** 아직 미구현. PRD 만 정의된 상태.

---

## 🔌 검증된 KRA API (6개)

상세 및 함정: [kra_api_quirks.md](kra_api_quirks.md)

| API | 용도 | 파라미터 형식 | 주의 |
|---|---|---|---|
| API214_1 | 경주 결과 | `meet`, `rc_date` | |
| racedetailresult | stOrd 포함 상세 | `meet`, `rc_date`, `rc_no` | ⚠️ stOrd 가 사실 ord (cheating) |
| API284 | 혈통 지수 | `hr_no` | ⚠️ 필터링 안 됨 (사실상 미사용) |
| horseinfohi | 부마/모마 | **`hrno`** (camelCase!) | snake_case 보내면 필터 X |
| **API314** | 서울 출주표 | **`race_dt`**, **`race_no`** | snake_case + 다른 필드명 |
| **API316** | 부산경남 출주표 | **`race_dt`**, **`race_no`** | 동상 |

---

## ⚠️ 알려진 한계

### 데이터 측면

- **⑭ 혈통**: API284 가 `hr_no` 파라미터를 필터링하지 않음 → 데이터 사실상 수집 불가. 우회: horseinfohi 의 sireHrnm/damHrnm 으로 부마별 자손 거리 패턴 직접 통계 (scripts/analyze_sires.ts 분석 진행 중)
- **⑤ 후반 구간 순위**: KRA bu_*_ord 컬럼이 모두 0 으로 옴 → 데이터 자체 없음. 다른 endpoint 발견 시 보강 가능
- **race_entries 사전 컬럼 백필 77%**: KRA 일일 한도로 분할 진행 중 (2,994/4,302 horses, 약 30% 잔여). 누락된 row 는 ⑱ 수득상금에 영향
- **horses 70%**: 동일 (KRA 한도)

### 알고리즘 측면

- **② 마체중 변화** (ρ -0.007): 사실상 노이즈. 단순 절댓값 기반 알고리즘이 실제 패턴과 안 맞을 가능성. 추후 도메인 의견 필요
- **⑦ 주로 적응** (ρ +0.006): 같은 주로 이력이 5경주 중 1-2개라 통계적 노이즈. 데이터 누적 필요
- **⑬ 나이×거리×성별** (ρ -0.056): PRD 의 임시 매트릭스가 실측과 안 맞음. 도메인 자문 필요

### 운영 측면

- **jockeys/trainers 테이블 미동기화**: race_entries 의 jcky_nm 만 채워지고 jcky_no 는 결과 sync 후에야 채워짐. 동명 기수 매핑 오류 가능
- **사전 예측 vs 사후 백테스트의 데이터 차이**: race_entries 의 일부 컬럼 (wg_hr=경기직전 마체중, win_odds 등) 은 사전 모드에서 null → 약간의 정확도 차이 가능
- **구버전 테이블 잔존**: race_cards (29,194 rows), horse_results (38,331 rows) — 데이터 검증 후 DROP 예정. 현재 코드는 안 읽음

### 향후 계획

- [ ] ⑭ 혈통 부마별 거리 패턴 알고리즘 (horseinfohi 데이터 활용)
- [ ] ⑤ 후반 구간 데이터 보강 (KRA 별도 endpoint 발견 시)
- [ ] 운영 자동화 (GitHub Actions cron: 수/목 sync:cards, 일 밤 sync + backfill)
- [ ] AI 인사이트 (Claude API) 구현 — PRD 만 정의된 상태
- [ ] jockeys / trainers 테이블 sync 모듈

---

## 📚 변경 이력

| 일자 | 버전 | 변경 |
|---|---|---|
| 2026-05-26 | v6.1 | race_entries 통합 (race_cards + horse_results 합침) + scorePredictor 단일 모드 |
| 2026-05-26 | v6.0 | 18개 항목 + race_cards 사전 예측 + 학습 시스템 정착 + 측정 결과 |
| 2026-05-22 | v5.1 | 17개 항목 구조 + 사용자 선택 4개 핵심 |
| 2026-05-22 | v5.0 | 분리 문서 구조로 재편 |
| 2026-05-22 | v4.0 | PM 프레임워크 통합 |
| 2026-05-22 | v3.2 | Supabase + Vercel |
| 2026-05-22 | v3.1 | KRA API 검증 반영 |
| 2026-05 | v3.0 | 기술 스택 확정 |
| 2026-04 | v2.3 | 가중치 조정 로직 |
| 2026-04 | v1.0 | 모바일 Claude 초안 |
