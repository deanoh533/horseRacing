# 🔄 데이터 흐름

**목적:** KRA API → DB → Score Engine → predictions → UI 의 전체 흐름과 두 가지 예측 모드를 한 곳에 정리.

---

## 큰 그림

```
[KRA 공공데이터 API]
  │
  ├─ API214_1 (결과) ──────────────┐
  ├─ racedetailresult (결과 상세) ┐│
  ├─ API284 (혈통, 사실상 미동기화)│
  ├─ horseinfohi (부마/모마) ─────┐│
  ├─ API314 (서울 출주표) ────────┐│
  └─ API316 (부산경남 출주표) ────┐│
                                  ↓↓
                          [Supabase DB]
                                  │
                ┌─────────────────┼──────────────────┐
                ↓                 ↓                  ↓
        race_cards          horse_results         horses
        (사전 출주표)        (사후 결과)         (정적 정보)
                │                 │                  │
                └─────────────────┼──────────────────┘
                                  ↓
                       [scorePredictor]
                                  │
                  ┌───────────────┴───────────────┐
                  ↓                               ↓
        predictFromCards                   predictRace
        (사전 예측)                        (사후 백테스트)
                  │                               │
                  └───────────────┬───────────────┘
                                  ↓
                            [predictions]
                                  │
                ┌─────────────────┼─────────────────┐
                ↓                 ↓                 ↓
        [Frontend UI]    [weightLearner]    [accuracy_stats]
        (React + Vite)   (Spearman 학습)    (적중률 측정)
                                  │
                                  ↓
                          [weight_history]
                                  │
                                  ↓
                       (apply_learned_weights)
                                  │
                                  ↓
                          predictions 재계산
```

---

## 두 가지 예측 모드

### 사후 모드 (predictRace)

**언제:** 경기 끝나고 `horse_results` 가 있을 때 (백테스트, 학습 데이터 생성).

**입력:**
- 이번 경주: `horse_results` (rating, jk_no, tr_no, wg_budam, 등)
- 과거 이력: `horse_results` (같은 hr_name 의 ord, rc_time)
- 보조: `race_cards.erng_sump` (⑱ 수득상금)

**결과:** PredictionRow `{ total_score, predicted_rank, actual_ord ≠ null }`

### 사전 모드 (predictFromCards)

**언제:** `horse_results` 가 없는데 `race_cards` 만 있을 때 (실제 운영, 미래 경주).

**입력:**
- 이번 경주: `race_cards` (rating, ag, gndr, burd_wgt, jcky_nm, trar_nm, erng_sump, 등)
- 과거 이력: `horse_results` (hr_name 기반)
- 보조: `jockeys` / `trainers` 테이블에서 이름 → no 매핑
- 보조: `races` 테이블에서 rc_dist, track_type

**결과:** PredictionRow `{ total_score, predicted_rank, actual_ord = null }` → 일 밤 결과 sync 후 actual_ord 채워짐.

### 자동 분기 (predictRace 함수)

```typescript
export async function predictRace(sb, rcDate, meet, rcNo) {
  // 1. horse_results 시도 (사후)
  const { data: horses } = await sb.from('horse_results')...
  if (horses.length === 0) {
    // 2. race_cards 로 사전 예측 fallback
    return predictFromCards(sb, rcDate, meet, rcNo)
  }
  // 사후 처리 (기존)
}
```

→ 같은 함수 호출 (predictRace) 로 두 모드 모두 처리.

상세: [src/engine/scorePredictor.ts](src/engine/scorePredictor.ts)

---

## 운영 시나리오 (실제 베팅 전 사전 예측)

```
[수~목]
  npm run sync:cards -- --date 20260530   ← 토요일 출주표
  npm run sync:cards -- --date 20260531   ← 일요일
  npm run backfill -- --date 20260530     ← predictFromCards 동작 (cards만 있음)

[금~일 경기 전]
  https://horse-racing-xi-one.vercel.app/
  → /dashboard 에서 예측 1-3위 + 종합 점수 확인
  → /race/1/20260530/N 에서 출전마 카드별 항목 점수 확인
  → 베팅 결정

[일 밤, 경기 끝나면]
  npm run sync -- --date 20260530   ← horse_results 채움 (이번엔 사후 모드)
  npm run backfill -- --date 20260530   ← actual_ord 채우면서 predictions 갱신

[누적 데이터로 학습]
  npx tsx scripts/apply_learned_weights.ts
  → weight_history 새 row + predictions total_score 재계산
```

---

## DB 테이블 의존성

| 테이블 | PK | 주 용도 | 채움 방식 |
|---|---|---|---|
| `races` | (race_date, meet, rc_no) | 경주 메타 | bulkSync / dailySync |
| `horse_results` | (race_date, meet, rc_no, hr_no) | 사후 결과 + 사전 정보 일부 | bulkSync / dailySync |
| `race_cards` | (race_date, meet, rc_no, **pthr_no**) | 사전 출주표 | raceCardSync |
| `horses` | (hr_no) | 정적 (부마/모마/출생일) | scripts/fetch_horse_info.ts |
| `jockeys` | (jk_no) | 정적 | (현재 미동기화, 추후) |
| `trainers` | (tr_no) | 정적 | (현재 미동기화, 추후) |
| `predictions` | (race_date, meet, rc_no, hr_name) | Score Engine 결과 | backfill_predictions |
| `weight_history` | (id, applied_at) | 학습 가중치 변천 | apply_learned_weights |

---

## sync/backfill 스크립트 매핑

| 명령 | 무엇을? | 빈도 |
|---|---|---|
| `npm run sync` | 어제 결과 (horse_results) | 매일 (자동화 가능) |
| `npm run sync:cards -- --date YYYYMMDD` | 특정 날짜 출주표 | 수~목 (다음 주말 분) |
| `npm run sync:cards:bulk` | 모든 과거 날짜 출주표 backfill | 일회성 (rate limit 분할) |
| `npm run backfill` | predictions 전체 재계산 | 알고리즘 변경 시 |
| `npm run backfill -- --date YYYYMMDD` | 특정 날짜만 | 단일 날짜 빠른 재계산 |
| `npx tsx scripts/apply_learned_weights.ts` | Spearman 학습 + 가중치 적용 | 큰 데이터 변화 후 |

---

## 알려진 한계

- **jockeys / trainers 테이블 미동기화**: 현재 race_cards 의 `jcky_nm`/`trar_nm` 으로 horse_results 의 최근 row 에서 jk_no/tr_no 역추정. 동명 기수가 있으면 잘못 매핑 가능.
- **출주표 KRA 발표 시점에 의존**: KRA 가 발표 안 하면 사전 예측 불가 (= 안내 페이지로 대체 또는 대기).
- **race_cards 100% 백필 안 됨**: 약 77% (2,994/4,302 horses) 까지 채워짐. 나머지는 KRA 일일 한도 회복 후 자동.
- **사전 모드의 입력 신뢰도**: rating=0, wg_jk=0 같은 누락 값 많음. UI 에서 0 은 숨김 처리.

---

## 변경 이력

| 일자 | 변경 |
|---|---|
| 2026-05-25 | 신규 작성. 2-모드 + 운영 시나리오 + DB 의존성 정리 |
