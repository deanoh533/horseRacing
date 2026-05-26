# KRA 경마 분석 도구 — Claude 컨텍스트

> 새 세션에서 이 파일을 먼저 읽어주세요.  
> 마지막 업데이트: 2026-05-26 (race_entries 통합 완료)

---

## 프로젝트 개요

개인용 KRA(한국마사회) 경마 예측·분석 도구. 수요일에 나오는 출마정보로 주말 경주를 예측하고, 경기 후 실제 착순과 비교해 적중률을 측정한다.

- **프론트엔드:** React + Vite + Tailwind, `client/` 디렉터리
- **백엔드/스크립트:** Node.js + TypeScript, `src/` 디렉터리
- **DB:** Supabase (PostgreSQL)
- **배포:** Vercel (`horse-racing-xi-one.vercel.app`)

---

## 핵심 아키텍처: race_entries 통합 테이블

### 2026-05-26 완료된 마이그레이션

**이전 구조(폐기):**
- `race_cards` — 수요일 출마정보
- `horse_results` — 경기 후 결과

**현재 구조:**
- `race_entries` — 사전 + 사후 통합 테이블 (PK: race_date, meet, rc_no, pthr_no)

```
[수요일] raceCardSync
  → race_entries INSERT (사전 컬럼만)
  → races INSERT (race_date, meet, rc_no)
  → 웹에서 즉시 출전마 목록 표시 가능

[경기 후] dailySync
  → race_entries UPDATE (결과 컬럼: ord, rc_time, wg_hr 등)
  → races UPDATE (rc_dist, track_type, weather 등)
  → predictions upsert
```

### race_entries 컬럼 구조

| 컬럼 | 타입 | 설명 | 채워지는 시점 |
|------|------|------|--------------|
| race_date, meet, rc_no, pthr_no | INT | PK | 수요일 |
| hr_name | VARCHAR | 말 이름 | 수요일 |
| ag, gndr, prds | INT/VARCHAR | 연령·성별·생산지 | 수요일 |
| burd_wgt, ratg | DECIMAL/INT | 부담중량·레이팅 | 수요일 |
| jcky_no, jcky_nm | VARCHAR | 기수 번호·이름 | 수요일 (no는 경기 후 채워짐) |
| trar_no, trar_nm | VARCHAR | 조교사 번호·이름 | 수요일 |
| erng_sump, erng_loy, erng_lsm | BIGINT | 수득상금 통산/1년/6개월 | 수요일 |
| rc_dist, track_type | INT/VARCHAR | 경주 거리·주로 | 경기 후 |
| ord | INT | 최종 착순 (null=경기 전 or 취소) | 경기 후 |
| rc_time, wg_hr, wg_hr_diff | DECIMAL/INT | 기록·마체중·증감 | 경기 후 |
| wg_jk, win_odds, plc_odds | INT/DECIMAL | 기수체중·단승·연승배당 | 경기 후 |
| popularity | INT | 인기순위 | 경기 후 |
| bu_*_acc_time, bu_*_ord | DECIMAL/INT | 구간기록·구간순위 (7+5개) | 경기 후 |
| result_at | TIMESTAMPTZ | 결과 UPDATE 시각 (null=경기 전) | 경기 후 |

### 사전/사후 판별 방법

```typescript
// scorePredictor.ts, queries.ts 모두 동일 방식
const isPreRace = entry.result_at === null;  // 또는 entry.ord === null
```

---

## 주요 파일 맵

### 백엔드 sync
| 파일 | 역할 |
|------|------|
| `src/sync/raceCardSync.ts` | 수요일 출마정보 → race_entries + races |
| `src/sync/dailySync.ts` | 경기 후 결과 → race_entries UPDATE + races UPDATE + predictions |
| `src/sync/transformer.ts` | KRA API 응답 → DB row 변환 (`toRaceEntryRow`, `toRaceEntryResultRow`) |

### Score Engine
| 파일 | 역할 |
|------|------|
| `src/engine/scorePredictor.ts` | race_entries 기반 예측 (ord=null이면 사전모드 자동) |
| `src/engine/index.ts` | ScoreEngine 클래스 (18개 항목 계산) |
| `scripts/backfill_predictions.ts` | predictions 전체 재계산 |

### 프론트엔드
| 파일 | 역할 |
|------|------|
| `client/src/lib/supabase.ts` | RaceEntry 타입 정의 |
| `client/src/lib/queries.ts` | React Query 훅 (race_entries 기반) |
| `client/src/pages/RaceDetail.tsx` | 경주 상세 (사전=예측만, 사후=결과+예측) |
| `client/src/pages/HorseDetail.tsx` | 말 상세 + 이력 + 항목 점수 |

---

## DB 현황 (2026-05-26 기준)

| 테이블 | rows | 비고 |
|--------|------|------|
| race_entries | 38,517 | 통합 완료 |
| races | 3,585 | 경주 메타 |
| predictions | 38,517 | backfill 완료 |
| race_cards | 29,194 | 구버전 (아직 DROP 안 함) |
| horse_results | 38,331 | 구버전 (아직 DROP 안 함) |

> `race_cards`와 `horse_results`는 검증 후 DROP 예정. 현재 코드는 두 테이블을 더 이상 읽지 않음.

---

## KRA API 컬럼명 주의사항

`docs/kra_api_quirks.md` 참고. 핵심만:
- KRA API의 `chulNo` = race_entries의 `pthr_no` (게이트 번호, 진짜 말번호)
- `hrNo`는 말 고유번호 (race_entries의 `hr_no`)
- race_cards/horse_results 시절 컬럼명과 race_entries 컬럼명이 다름:
  - `chul_no` → `pthr_no`
  - `age` / `sex` → `ag` / `gndr`
  - `wg_budam` → `burd_wgt`
  - `rating` → `ratg`
  - `jk_no` / `jk_name` → `jcky_no` / `jcky_nm`
  - `tr_no` / `tr_name` → `trar_no` / `trar_nm`

---

## 운영 시나리오

```
[수~목]
  npx tsx src/sync/raceCardSync.ts --date 20260530
  → race_entries + races 사전 채움 → 웹에서 즉시 표시

[금~일 경기 전]
  웹에서 예측 확인 → 베팅 결정

[일 밤, 경기 후]
  npx tsx src/sync/dailySync.ts --date 20260530
  → race_entries 결과 UPDATE → predictions 갱신

[가중치 학습]
  npx tsx scripts/apply_learned_weights.ts
```

---

## 미완료 항목

- [ ] `race_cards`, `horse_results` 테이블 DROP (데이터 검증 후)
- [ ] jockeys / trainers 테이블 별도 동기화
- [ ] AI 인사이트 (Claude API 연동, Phase 2)
