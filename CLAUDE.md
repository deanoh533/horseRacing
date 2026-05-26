# KRA 경마 분석 도구 — Claude 컨텍스트

> 새 세션에서 이 파일을 먼저 읽어주세요.
> 마지막 업데이트: 2026-05-26 (PRD v6.1 출마정보 화면 + 신규 API 통합 + 펼침 영역 6카드)

---

## 프로젝트 개요

개인용 KRA(한국마사회) 경마 예측·분석 도구. 수요일에 나오는 출마정보로 주말 경주를 예측하고, 경기 후 실제 착순과 비교해 적중률을 측정한다.

- **프론트엔드:** React + Vite + Tailwind, `client/`
- **백엔드/스크립트:** Node.js + TypeScript, `src/`
- **DB:** Supabase (PostgreSQL)
- **배포:** Vercel (`horse-racing-xi-one.vercel.app`) — main push 시 자동 배포

---

## 핵심 아키텍처: race_entries 통합 테이블

**현재 구조:**
- `race_entries` — 사전 + 사후 통합 테이블 (PK: race_date, meet, rc_no, pthr_no)

```
[수요일] raceCardSync       → race_entries INSERT (사전) + races INSERT
[경기 후] dailySync          → race_entries UPDATE (결과) + races UPDATE + predictions
```

### race_entries 컬럼 구조 (요약)

| 그룹 | 컬럼 | 채워지는 시점 |
|------|------|--------------|
| PK | race_date, meet, rc_no, pthr_no | 수요일 |
| 사전 | hr_name, ag, gndr, prds, burd_wgt, ratg, jcky_nm, trar_nm, owner_nm, erng_sump/loy/lsm, sump_rcod_* | 수요일 |
| 사후 | hr_no, ord, rc_time, wg_hr/diff, wg_jk, win_odds, plc_odds, popularity, rc_dist, track_type | 경기 후 |
| 부경 구간 (bu_*) | bu_g1f~g8f_acc_time, bu_s1f_acc_time, bu_g1f~g4f_ord, bu_s1f_ord | 경기 후 (부경 경주만) |
| 서울 구간 (se_*/sj_*) | se_g1f/g3f/s1f_acc_time, se_1c~4c_acc_time, sj_g1f/g3f/s1f_ord, sj_1c~4c_ord | 경기 후 (서울 경주만) |
| 메타 | result_at TIMESTAMPTZ | 경기 후 (null=경기 전) |

### 구간기록 컬럼 의미 (중요!)

KRA API214_1 응답에 포함됨. 별도 API 구독 불필요.

- **bu_/se_ 접두사**: 부경/서울 — 한 row에서 둘 중 한쪽만 채워짐 (경마장 따라)
- **G1F/G3F/S1F = 누적시간** (거리 의존): 출발부터 결승선 -200m/-600m/+200m 지점까지
- **1C/2C/3C/4C = 누적시간** (서울만): 코너 진입 지점까지 (거리에 따라 일부 NULL)
- **거리-무관 메트릭 = 차이값**:
  - `rc_time - g3f` = 마지막 600m 시간 (~40초, 추격력)
  - `rc_time - g1f` = 마지막 200m 시간 (~14초, 결승선 가속)
  - `s1f_acc_time` = 출발 200m (~14초)

> ⚠️ KRA가 미측정값을 0으로 보내는 경우 있음 → `zeroToNull` 헬퍼로 NULL 변환 (transformer)

---

## 핵심 SQL View (007 마이그레이션)

### horse_sectional_ability
마별 통산 구간 능력치. 거리-무관 차이값 기반.

```
hr_name, races, avg_s1f/best_s1f, avg_last_600m/best_last_600m,
avg_last_200m/best_last_200m, avg_*_rank, surge_score, avg_ord
```
- `surge_score`: 양수=추격형, 음수=선행형 (출발 순위 − 결승선 순위)
- 3경주 이상 출전 말만 (HAVING)

### race_sectional_stats
경주별 페이스 표준 통계 (API6_1 대체용).

```
race_date, meet, rc_no, rc_dist, track_type, horses,
best_last_600m/avg, best_last_200m/avg, best_s1f/avg
```

---

## 주요 파일 맵

### 백엔드 sync
| 파일 | 역할 |
|------|------|
| `src/kra/client.ts` | KRA API 클라이언트 (API214_1, API284, API314/316, API18_1, jkpresult) |
| `src/sync/raceCardSync.ts` | 수요일 출마정보 → race_entries + races |
| `src/sync/dailySync.ts` | 경기 후 결과 → race_entries UPDATE + predictions |
| `src/sync/transformer.ts` | KRA 응답 → DB row 변환 (`zeroToNull` 헬퍼 포함) |
| `src/sync/trainingSync.ts` | 일별 훈련 정보 (API18_1) → training_logs |
| `src/sync/jockeySync.ts` | 기수 통산 성적 (jkpresult) → jockey_stats |
| `src/sync/sectionalSync.ts` | (미사용 — 구간기록은 race_entries로 통합) |

### Score Engine
| 파일 | 역할 |
|------|------|
| `src/engine/scorePredictor.ts` | race_entries 기반 예측 (사전/사후 자동) |
| `src/engine/index.ts` | ScoreEngine (18 항목) |
| `scripts/backfill_predictions.ts` | predictions 전체 재계산 |
| `scripts/backfill_sectional.ts` | race_entries 서울/코너 컬럼 backfill (페이지네이션 포함) |

### 프론트엔드
| 파일 | 역할 |
|------|------|
| `client/src/lib/supabase.ts` | RaceEntry, Horse, HorseSectionalAbility, JockeyStat, TrainingLog 등 타입 |
| `client/src/lib/queries.ts` | useHorsesByRace, useHorseHistory, useHorseSectionalAbility, useJockeyStats, useHorseTraining, useHorseInfo 등 |
| `client/src/pages/Dashboard.tsx` | 경주 카드에 [AI 예측] / [출마정보] 두 입구 버튼 |
| `client/src/pages/RaceDetail.tsx` | 기존 AI 예측 화면 (변경 없음) |
| `client/src/pages/RaceEntries.tsx` | **신규 출마정보 비교 화면** + 행 클릭 시 펼침 영역 6카드 |
| `client/src/pages/HorseDetail.tsx` | 말 상세 (변경 없음) |

---

## RaceEntries 펼침 영역 6카드 (2026-05-26 완료)

행 클릭 시 표시:
1. 🏆 **기본 정보** — 출생지/마주/조교사/상금/통산전적
2. 🎯 **기수 통산** — jockey_stats 기반 (출주·1위·승률·입상률)
3. ⚡ **구간 능력치** — horse_sectional_ability view (출발·막판·추격 점수)
4. 📜 **최근 5경주** — useHorseHistory (날짜·거리·착순·기록 표)
5. 🔧 **최근 훈련 (30일)** — training_logs (횟수·조교사·달린 횟수)
6. 🩸 **혈통** — horses 테이블 (부마·모마·모부마·혈통지수)

---

## DB 현황 (2026-05-26 마지막 기준)

| 테이블/뷰 | rows | 비고 |
|----------|------|------|
| race_entries | 37,453 | 통합 완료 |
| races | 3,585 | 경주 메타 |
| predictions | 38,517 | backfill 완료 |
| training_logs | 6,540 | API18_1 sync 완료 (최근 7일) |
| jockey_stats | 59 | jkpresult sync 완료 (서울 34, 부경 25) |
| horses | 2,864 | 모두 혈통 정보 있음 |
| sectional_records | 0 | 미사용 — race_entries로 통합 |
| race_cards, horse_results | (구버전) | 코드는 더 이상 안 읽음 |

### race_entries 서울 구간기록 backfill 상태

| 연도 | 서울 total | with_se_g3f | 비고 |
|------|-----------|------------|------|
| 2024 | 6,437 | 6,437 (100%) | ✅ |
| 2025 | 10,723 | 5,470 (51%) | ⚠️ 절반 |
| 2026 | 4,416 | 107 (2.4%) | ⚠️ 거의 누락 (재실행 필요) |

부경(meet=3)은 99.9% 완전.

---

## 운영 시나리오

```
[수~목]  raceCardSync     → race_entries(사전) + races
[경기 후] dailySync         → race_entries 결과 UPDATE + predictions
[훈련]   npm run sync:training -- --date YYYYMMDD
[기수]   npm run sync:jockey
[가중치] npx tsx scripts/apply_learned_weights.ts
```

---

## KRA API 컬럼명 주의사항

`docs/kra_api_quirks.md` 참고. 핵심만:
- KRA `chulNo` = race_entries `pthr_no` (게이트 번호)
- `hrNo` = race_entries `hr_no` (말 고유번호)
- 구버전 horse_results 컬럼명과 race_entries 컬럼명이 다름:
  - `chul_no` → `pthr_no`, `age/sex` → `ag/gndr`
  - `wg_budam` → `burd_wgt`, `rating` → `ratg`
  - `jk_no/jk_name` → `jcky_no/jcky_nm`, `tr_no/tr_name` → `trar_no/trar_nm`

---

## 작업 방식 (협업 가이드)

- **SQL 쿼리** / 대용량 분석 → 사용자가 Supabase SQL Editor에서 직접 실행 (토큰 비용 절감)
- 빌드·타입체크·git 같은 작은 명령 → 메인이 빠름
- 출력 100줄 넘는 명령은 사용자 부탁
- 서브에이전트 spawn 시 `model: 'sonnet'` 명시 (메인은 Opus, 비용 분리)
- DATABASE_URL: 비밀번호에 특수문자 있으면 작은따옴표로 감싸기

---

## 미완료 항목 (다음 세션 우선순위 후보)

- [ ] **PRD v6.1 — Phase 2 (P1)**: HorseDetail 18항목 점수 → 원시값+맥락 표현
- [ ] **2025년 49% / 2026년 거의 모두 서울 구간기록 backfill 재시도**
  - `npx tsx scripts/backfill_sectional.ts --start 20250101 --end 20260524`
  - 서브에이전트로 진행 (Sonnet)
- [ ] **PRD legend의 derived 5개 항목** ([docs/PRD_v6.1_race_info_legend.md](docs/PRD_v6.1_race_info_legend.md))
  - ⑨ 마주의 금일 출주두수, ⑩ 출전경주와 마필
  - ⑬ 최근 3개월 성적, ⑮ 출주간격, ⑯⑰ 조교사 통계
  - SQL view 또는 client-side aggregation
- [ ] **PRD legend ㉚ 절대능력지수** — KRA 등급변동 API (#15058076) 조사
- [ ] **PRD legend ⑭⑱㉝㉞** — 외부 데이터 (조교상태/마필가격/복기평/경주로 빠르기)
- [ ] `race_cards`, `horse_results` 테이블 DROP (검증 완료, 시점 결정만)
- [ ] AI 인사이트 (Claude API 연동, Phase 2)
- [ ] `scripts/probe_*.ts` 정리 (탐색용, gitignore 또는 삭제)

---

## 관련 문서

- [docs/PRD_v6.1_entries_view.md](docs/PRD_v6.1_entries_view.md) — PRD v6.1 본문
- [docs/PRD_v6.1_race_info_legend.md](docs/PRD_v6.1_race_info_legend.md) — 에이스경마 1-34번 명칭 매핑
- [docs/data_flow.md](docs/data_flow.md) — 데이터 흐름
- [docs/kra_api_quirks.md](docs/kra_api_quirks.md) — KRA API 특이사항
