# earnings 누수 해소 — as-of 클래스 신호 대체 Design

> 작성: 2026-06-05 · 브랜치 `feat/score-learning-redesign`
> 관련 메모리: `reference-earnings-asof-leak`, `project-score-learning-redesign`

## 1. 배경 / 문제

`race_entries`의 누적 커리어 필드(`erng_sump` 등 수득상금)는 **그 경주 시점의 as-of 값이 아니라 그 말의 현재(최종) 총액**이 모든 과거 행에 똑같이 박혀 있다(출마표 API가 호출 시점 현재값만 주고 backfill이 전 행에 복사). → **백테스트 평가에서만 발생하는 미래누수**(라이브는 수요일 출마표 as-of라 깨끗).

피처로 실제 쓰는 오염 필드는 `earnings_log`(⑱ 수득상금) 하나. ablation 결과:
- 절대 피처로도 로지스틱 워크포워드 베이스라인에 **~3.8%p 기여**(거품).
- `earnings_log` 통째 제거 시 로지스틱 62.8 → 59.0%, **v1 대비 +5.2 → +1.4%p**.
- 즉 재설계 "정직 +5.2%p"의 상당분이 오염 earnings 덕. (단 v1(⑱)도 같은 누수 수혜자라 백테스트에서 v1 점수도 부풀려져 있음.)

도메인상 수득상금 = **클래스/능력 proxy**. `ratg`(레이팅)는 경주별 as-of라 이미 깨끗하지만, 클래스의 다른 축(통산 성적 이력)을 누수 없이 담을 깨끗한 대체 신호가 필요하다.

## 2. 목표

1. `earnings_log`(오염)를 **과거 ord 이력으로 직접 계산한 as-of 클래스 신호**로 대체.
2. 누수 제거 후 로지스틱 후보의 **정직값 재측정**(v1 동결 기준).
3. blast radius 최소: v1(프로덕션 활성) 무수정, 로지스틱 경로에만 영향.

**비목표:** v1 ⑱ 스코어러 변경, API155/라이브 스냅샷 적재(별도 후속), 항목 레지스트리 개명.

## 3. 아키텍처 결정

**새 모듈 없이 `src/engine/asOfHorseStats.ts` 확장.** 이미 `fetchAsOfHorseStats`가 그 말의 과거 경주(`race_date < beforeDate`, `ord not null`, 최근 60)를 가져와 `ord`·`fieldSize`를 들고 있다. 같은 `past[]` 배열에서 두 신호를 추가 계산 → **DB 호출 0 증가, 누수는 `lt('race_date', beforeDate)` 필터로 구조적 차단.**

(대안 기각: 별도 모듈 = 과거 경주 재조회 중복. computeAsOfHorseStats 재사용이 명백히 우월.)

## 4. 신호 정의 (computeAsOfHorseStats에 추가)

| 피처 | 정의 | 비고 |
|---|---|---|
| `career_finish_ratio` | 과거 `(ord-1)/(fieldSize-1)` 평균 (낮을수록 우수) | 출주두수 정규화, 연속값. `distFinishRatio`의 전거리판 |
| `career_place_rate` | 과거 KRA 연승 입상 비율 — 8두↑ 3착내 / 5~7두 2착내 / 4두↓ 제외(분모서도 제외) | 도메인 "입상", label(ord≤3)과 동계열 |
| `career_n` | 유효 과거 경주 수(fieldSize≥2 & ord 존재) | 모델이 소표본 할인하도록 |

- **둘 다 피처화 → L2 규제가 채택/가중 결정**(재설계 철학: 사람은 후보 제안, 모델이 선택).
- **하드 임계값 없음** — raw + 표본수만. 스무딩 없음(raw 보존).
- `career_n=0`(데뷔)이면 `career_finish_ratio` / `career_place_rate` 는 `__missing=1`·raw=0(toVector 패리티 규칙 그대로).
- place_rate 분모: 4두↓ 경주는 연승 미발매라 입상 판정 불가 → 분자·분모 모두 제외. fieldSize≥5인 과거 경주만 place_rate에 기여.

## 5. 교체 범위 (blast radius)

- `src/engine/features/buildFeatures.ts:150`의 `add('earnings_log', log1p(erngSump))` **제거** → `career_finish_ratio`·`career_place_rate`·`career_n`(+ `__missing`) 추가. **로지스틱 경로에만** 영향.
- v1(rho-legacy ⑱ `calculateEarningsScore`) 및 `erng_sump` 수집 흐름 **무수정** → v1 동결.
- `featureItemMap.ts`: `earnings_log` 매핑 줄을 `career_finish_ratio`/`career_place_rate`/`career_n` → `'18_earnings'`로 교체(레지스트리 안정). ⚠️ UI "⑱ 수득상금" 항목이 이제 클래스 기여도를 표시 — 라벨 약간 불일치(추후 '클래스' 개명 여지, 이번 범위 밖).

## 6. 데이터 흐름

```
fetchAsOfHorseStats (과거 경주 fetch, race_date<예측일)
  → computeAsOfHorseStats: AsOfHorseStats { …, careerFinishRatio, careerPlaceRate, careerN }
  → ScoreEngineInput { …, careerFinishRatio?, careerPlaceRate?, careerN? }  (index.ts)
  → buildEngineInput (scorePredictor.ts) — asOf 결과를 input에 주입
  → buildFeatures — career_* 피처 emit / earnings_log 제거
```

라이브 예측·학습행렬 추출이 이 경로를 공유 → **자동 반영**. 단 학습행렬은 피처가 JSONL에 baked되므로 **재추출 필요**(§7-1).

## 7. 검증 (정직값 재측정)

1. 코드 변경 후 **학습행렬 재추출** — `npm run extract:matrix`(사용자 실행, 37k행·수분). 피처 변경 반영.
2. `npm run exp:logistic -- --walkforward` → **로지스틱-clean(earnings제거+클래스) vs v1(동결)** 연승·단승·ROI 분기별.
3. **누수 차단 단위테스트**: computeAsOfHorseStats에 현재 경주 행을 절대 넣지 않음을 확인(입력이 과거 배열뿐이라 구조적이나, fieldSize<2·ord null 제외 및 place_rate fieldSize 규칙을 테스트로 못박음).
4. **해석 기준:** 기존 거품값(+5.2%p)·earnings제거만(+1.4%p) 대비 클래스 신호로 회복되는 정도. 회복이 크면 "수득상금=클래스는 깨끗 신호로 대체 가능", 미미하면 "earnings 거품은 대부분 누수 그 자체였음" — 어느 쪽이든 정직 결론. **승격 판정은 사람 몫.**

## 8. 파일 / 작업 단위 (TDD)

| 파일 | 변경 |
|---|---|
| `src/engine/asOfHorseStats.ts` (+test) | `AsOfHorseStats`에 careerFinishRatio·careerPlaceRate·careerN 추가, computeAsOfHorseStats에서 past[]로 계산 |
| `src/engine/index.ts` | `ScoreEngineInput`에 3필드(optional) 추가 |
| `src/engine/scorePredictor.ts` | buildEngineInput에서 asOf 결과 → input 주입 |
| `src/engine/features/buildFeatures.ts` (+test) | earnings_log 제거, career_* 3피처 추가 |
| `src/engine/features/featureItemMap.ts` (+test) | earnings_log → career_* 매핑 교체 |

## 9. 리스크 / 주의

- **학습행렬 재추출 누락 시** 옛 earnings 피처가 남아 측정이 오염 → §7-1 필수.
- `career_place_rate` 소표본(n=1) 노이즈 → `career_n` 동반으로 모델이 할인(스무딩 대신).
- featureItemMap 라벨 불일치는 UI 표기상 문제일 뿐 점수엔 무영향.
- v1 무수정이므로 v1 백테스트도 여전히 누수 포함 — 비교는 "clean 로지스틱 vs leaky v1"임을 출력·해석에 명시(낙관적 하한 아님, 오히려 v1 쪽이 부풀려진 비교).
