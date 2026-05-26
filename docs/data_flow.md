# 🔄 데이터 흐름

**목적:** KRA API → DB → Score Engine → predictions → UI 의 전체 흐름 정리.

> 2026-05-26 업데이트: race_cards + horse_results → **race_entries 통합** 완료

---

## 큰 그림

```
[KRA 공공데이터 API]
  │
  ├─ API314 (서울 출주표)      ─┐
  └─ API316 (부산경남 출주표)  ─┤─→ raceCardSync.ts ─→ race_entries (사전)
                                │                   └→ races (race_date/meet/rc_no)
  ├─ API214_1 (경기 결과)      ─┤
  └─ racedetailresult (상세)   ─┘─→ dailySync.ts   ─→ race_entries (결과 UPDATE)
                                                   └→ races (rc_dist, track_type 등)
                                                   └→ predictions (upsert)

[race_entries]  ←── Score Engine ── predictRace()
                                        │
                                        ↓
                                  [predictions]
                                        │
                    ┌───────────────────┼───────────────────┐
                    ↓                   ↓                   ↓
            [Frontend UI]      [weightLearner]       [적중률 통계]
            (React + Vite)    (Spearman 학습)
                                        │
                                        ↓
                                [weight_history]
```

---

## 핵심: race_entries 통합 테이블

이전에는 `race_cards` (사전)와 `horse_results` (사후)가 분리되어 있었다.
현재는 `race_entries` 하나로 통합. **수요일부터 웹에서 출전마 표시 가능.**

```
pthr_no  hr_name   burd_wgt  ratg  jcky_nm  erng_sump  │  ord   rc_time  win_odds  result_at
───────  ────────  ────────  ────  ───────  ─────────  │  ───   ───────  ────────  ─────────
1        마사춘향  57.0      85    박태종    50000000   │  null  null     null      null       ← 경기 전
2        청풍명월  55.0      92    조성곤    120000000  │  1     712.0    3.20      2026-05-25 ← 경기 후
```

### 사전/사후 판별

```typescript
const isPreRace = entry.result_at === null;
// 또는: entry.ord === null
```

---

## 예측 모드

`predictRace()` 하나로 사전/사후 자동 분기.

```typescript
// src/engine/scorePredictor.ts
const entries = await sb.from('race_entries')...
// ord가 null → 사전 예측 (출전마는 있지만 결과 없음)
// ord가 있음 → 사후 모드 (백테스트, 학습)
```

과거 이력도 race_entries에서: `.not('ord', 'is', null)` 필터로 결과 있는 것만 사용.

---

## 운영 시나리오

```
[수~목요일]
  npx tsx src/sync/raceCardSync.ts --date YYYYMMDD
  → race_entries (사전 컬럼) + races INSERT
  → 웹 /dashboard 에서 해당 날짜 경주 즉시 표시

[금~일 경기 전]
  웹에서 예측 1-3위 + 항목 점수 확인 → 베팅

[일요일 밤, 경기 후]
  npx tsx src/sync/dailySync.ts --date YYYYMMDD
  → race_entries 결과 컬럼 UPDATE (ord, rc_time, wg_hr 등)
  → races UPDATE (rc_dist, track_type, weather)
  → predictions 재계산

[가중치 학습]
  npx tsx scripts/apply_learned_weights.ts
  → Spearman 상관계수 기반 가중치 재계산
  → weight_history 저장 + predictions total_score 갱신
```

---

## DB 테이블 의존성

| 테이블 | PK | 주 용도 | 채움 방식 |
|--------|----|---------|---------| 
| `race_entries` | (race_date, meet, rc_no, pthr_no) | 사전+사후 통합 | raceCardSync / dailySync |
| `races` | (race_date, meet, rc_no) | 경주 메타 (거리/주로/날씨) | raceCardSync / dailySync |
| `predictions` | (race_date, meet, rc_no, hr_name) | Score Engine 결과 | dailySync / backfill |
| `weight_history` | (id) | 학습 가중치 변천 | apply_learned_weights |
| `race_cards` | — | **구버전, 미사용** | — |
| `horse_results` | — | **구버전, 미사용** | — |

---

## sync/backfill 명령어

| 명령 | 동작 | 빈도 |
|------|------|------|
| `npx tsx src/sync/raceCardSync.ts --date YYYYMMDD` | 출마정보 fetch → race_entries + races | 수~목 |
| `npx tsx src/sync/dailySync.ts --date YYYYMMDD` | 결과 fetch → race_entries UPDATE + predictions | 경기 후 |
| `npm run backfill` | predictions 전체 재계산 | 알고리즘 변경 시 |
| `npm run backfill -- --date YYYYMMDD` | 특정 날짜만 | 필요 시 |
| `npx tsx scripts/apply_learned_weights.ts` | Spearman 학습 + 가중치 적용 | 데이터 누적 후 |

---

## 변경 이력

| 일자 | 변경 |
|------|------|
| 2026-05-25 | 초안: 2-모드 + 운영 시나리오 정리 |
| 2026-05-26 | race_entries 통합 완료로 전면 재작성 |
