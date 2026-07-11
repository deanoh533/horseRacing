# 🔀 예측 모드 — 사전 vs 사후

> `predictRace()` 하나가 **`race_entries.ord` NULL 여부**로 자동 분기.
> 이 문서는 두 모드에서 데이터 출처가 어떻게 달라지는지 정리합니다.

---

## 1. 한 줄 요약

| 모드 | 트리거 | 용도 |
|---|---|---|
| **사전** | `ord` IS NULL | 베팅 전 화면 예측 (수~경기 직전) |
| **사후** | `ord` IS NOT NULL | 백테스트, Spearman 학습 |

코드 분기점: [src/engine/scorePredictor.ts:5-7](../src/engine/scorePredictor.ts#L5)

```typescript
// race_entries 테이블에서 사전/사후 자동 분기
//   - ord가 null  → 사전 모드 (출주표 기반 예측)
//   - ord가 있음  → 사후 모드 (결과 포함 백테스트)
```

별도 플래그·함수 분기 없음 — 같은 함수가 같은 입력 빌더로 동작.

---

## 2. 데이터 흐름 비교

### 사전 모드 (수~경기 직전)

```
race_entries 한 row
├─ pthr_no, hr_name, ratg, gndr, ag, burd_wgt   (출마표에서 INSERT)
├─ jcky_no, trar_no, owner_nm                    (출마표)
├─ erng_sump, sump_rcod_*                        (출마표)
└─ ord = NULL, rc_time = NULL, win_odds = NULL   ← 아직 안 뜀

       ↓
buildEngineInput()이 같은 hr_name으로 과거 race_entries 조회
   (where ord IS NOT NULL, ORDER BY race_date DESC LIMIT 5)
       ↓
ScoreEngine.calculateScores(input)
       ↓
predictions row 생성 (actual_ord = NULL)
```

### 사후 모드 (경기 후)

```
race_entries 같은 row, 결과 컬럼이 UPDATE된 상태
├─ ord = 3, rc_time = 712.0, win_odds = 5.4, popularity = 6
├─ se_g1f_acc_time, se_g3f_acc_time, sj_*_ord  (서울 경주면)
└─ bu_*_acc_time, bu_*_ord                       (부경 경주면)

       ↓ buildEngineInput()은 같은 로직
       ↓ ord IS NOT NULL 필터 그대로
       ↓
ScoreEngine.calculateScores(input)
       ↓
predictions UPDATE (actual_ord = 3)
```

**핵심:** 모드 차이는 "결과를 입력에 쓰는가"가 아니라 **"같은 경주의 actual_ord를 predictions에 기록할 수 있는가"**에 있습니다. 본인 경주의 결과 컬럼은 점수 산식에 들어가지 않습니다 (당연 — 미래 정보 누설).

---

## 3. 항목별 입력 출처표

| # | 항목 | 사전 입력 | 사후 입력 | 출처 |
|---|---|---|---|---|
| ① | 레이팅 | `ratg` | 동일 | 출마표 (API314/316) |
| ② | 마체중 변화 | 과거 `wg_hr_diff[5]` | 동일 | 과거 race_entries |
| ③ | 착순 추세 | 과거 `ord[5]` | 동일 | 과거 race_entries (ord IS NOT NULL) |
| ④ | 구간 시간 | 과거 rcTime + lastFurlong | 동일 | 과거 race_entries ⚠️ |
| ⑤ | 후반 순위 | 과거 startOrd, finishOrd | 동일 | 과거 race_entries ⚠️ |
| ⑥ | 거리 적성 | 과거 같은 거리 `ord[]` | 동일 | 과거 race_entries |
| ⑦ | 주로 적응 | 과거 전체 + 같은 주로 `ord[]` | 동일 | 과거 race_entries |
| ⑧ | 부담중량 | `burd_wgt` + 과거 burdens | 동일 | 출마표 + 과거 |
| ⑨ | 기수 폼 | 기수 최근 30일 `ord[]` | 동일 | race_entries |
| ⑩ | 조교사 폼 | 조교사 최근 60일 `ord[]` | 동일 | race_entries |
| ⑪ | 경주 간격 | (rcDate - 직전경주.race_date) | 동일 | 과거 race_entries |
| ⑫ | 출발번호 | `pthr_no`, 총두수, 거리 | 동일 | 출마표 |
| ⑬ | 나이×거리×성 | `ag`, `gndr`, rc_dist | 동일 | 출마표 |
| ⑭ | 혈통 | API284 `dsa*` | 동일 | API284 사전 fetch |
| ⑮ | 계절 패턴 | 같은 계절 과거 `ord[]` | 동일 | 과거 race_entries |
| ⑯ | 기수-말 궁합 | 말 전체 + 조합 `ord[]` | 동일 | 과거 race_entries |
| ⑰ | 배당률 | **과거 5경주 popularity[]** | 동일 | 과거 race_entries (당일 win_odds 미사용) |
| ⑱ | 수득상금 | `erng_sump` | 동일 | 출마표 |

→ **사전·사후 입력은 사실상 동일.** 사후가 더 가진 것은 *그 경주의 결과 컬럼*뿐이며, 그 결과는 점수에 안 들어갑니다.

---

## 4. 사후 모드만 가능한 일

1. **predictions.actual_ord 기록** → 적중률 계산 가능
2. **Spearman 학습** → 가중치 업데이트
3. **항목 알고리즘 검증** → 같은 입력으로 다양한 산식 테스트 가능

---

## 5. 사전 모드의 한계

- ⑰ 배당률: 당일 win_odds·인기는 사후에만 채워지므로, 사전에는 **과거 인기 패턴**으로 대용
- ④⑤ 구간기록: 본인 경주의 구간기록도 사후에만 들어옴 — 단 이건 다른 경주(과거)의 구간기록을 입력으로 쓰니까 모드와 무관

---

## 6. 화면에서의 노출

| 화면 | 사용 데이터 | 적용 모드 |
|---|---|---|
| `Dashboard` | races + race_entries 카운트 | (둘 다) |
| `RaceDetail` (AI 예측) | predictions | 사전 우선, 사후도 동일 표시 |
| `RaceEntries` (출마정보) | race_entries + horses + jockey_stats + training_logs | (둘 다) |
| `HorseDetail` | race_entries 통산 | (둘 다) |

→ 사용자 입장에서는 화면이 모드별로 분리되어 있지 않음. 그저 `ord`가 채워졌는지 여부가 시각적으로만 다름 (착순 컬럼이 비어있냐 vs 숫자가 있냐).

---

## 7. 자주 헷갈리는 포인트

> **Q. 사후 모드라고 더 정확한가?**
> A. 같은 산식, 같은 과거 데이터 → 점수 자체는 동일. 다만 사후엔 `actual_ord` 비교가 가능해 "맞췄는지"를 알 수 있을 뿐.

> **Q. 사전 예측 후 결과가 들어오면 점수가 바뀌나?**
> A. **2026-07-11부터 안 바뀜 (변경됨).** 이전에는 `dailySync`가 결과 컬럼 UPDATE 후 predictions을
> DELETE→INSERT로 재계산했다. v7 라이브 적중률을 정직하게 추적하려면 "수요일에 실제로 뭘 찍었는가"가
> 보존돼야 하므로, 지금은 `dailySync`가 예측값 필드(`predicted_rank`·`total_score`·`p_top3`·`p_win`·
> `item_scores`)를 절대 재계산하지 않고 `predictions.actual_ord`만 UPDATE한다(결과 기록 전용).
> backfill(`skipPredictions` 무관하게 별도 스크립트)을 돌려야만 점수가 바뀐다. → §8 참고.

> **Q. 사전 모드에서 ⑰을 당일 win_odds로 바꿀 수 있나?**
> A. 기술적으로 가능하지만 출마표 발표 직후엔 win_odds가 없음. 경주 직전 1~2시간에만 들어오므로, 일관성을 위해 **과거 popularity 기반**으로 통일했음.

---

## 8. predictions 쓰기 전략 변경 (2026-07-11, v7 라이브 추적 L-001)

수요일(사전)·금요일(사후) **데이터 입력**은 §1~§7 그대로다. 바뀐 건 predictions **테이블에 언제 쓰는가**.

- **금요일 `dailySync`는 예측을 재계산하지 않는다.** 이미 예측이 있는 경주는 건드리지 않고
  `race_entries.ord`(결과)만 채운 뒤, `predictions.actual_ord`만 UPDATE한다.
- **예측이 없는 경주만 보충한다.** 수요일 `raceCardSync`가 실패했거나 건너뛴 경주는 금요일에
  `predictRace(sb, rcDate, meet, rcNo, { forcePrecompetition: true })`로 사전 모드를 강제해 계산한 뒤 INSERT.
  `forcePrecompetition`은 `gatherRaceInputs()`가 `race_entries.ord`를 실제 값과 무관하게 `null`로
  취급하게 만드는 옵션 — 결과가 이미 나온 경주라도 "경기 전이었다면 어떻게 예측했을지"를 재현한다.
  단, ord 스크럽 외의 결과 필드(예: `wg_hr` 등 경기 후 수집 필드)까지 완전히 사전 상태로 되돌리진
  않는다 — 알려진 한계(`src/engine/scorePredictor.ts` Task 1 커밋 참고).
- **판정은 별도 스크립트로.** `npm run probe:v7-accuracy`가 predictions × race_entries(ord)를 조인해
  강추/주목/전체 적중률을 계산한다 (`docs/accuracy_metrics.md §8.6`).

상세 설계: `docs/superpowers/specs/2026-07-11-v7-live-tracking-design.md`.
