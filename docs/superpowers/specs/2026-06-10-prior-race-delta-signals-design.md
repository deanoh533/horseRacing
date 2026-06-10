# 직전대비 변화 신호 묶음 — 설계 스펙

> 작성: 2026-06-10 · 토픽: prior-race-delta-signals
> 선행: class_move(등급이동) 채택 — 같은 "직전대비 변화" 족(族)의 후속 발굴.
> 원칙: [[feedback-no-human-compression]] — raw 델타만 공급, 방향·압축은 모델(게이트)이 판정.

---

## 0. 한 줄 요약

직전 경주 대비 **휴양일수·거리변경·주로/원정 이동**을 raw 델타 피처로 추가하고,
표준 2단계 게이트(A 상관 → B holdout 복승박스 ROI) + 다분기 강건성으로 채택 여부를 가린다.

---

## 1. 배경·동기

- `class_move`(오늘−직전 등급밴드 상한)가 게이트B 단독 +2.2%p·라이브 클린으로 채택됨.
- 그 채택 과정에서 `gatherRaceInputs`가 **직전 경주(`last = hist5[0]`)를 이미 조회**함을 확인.
  `last` 행에 `race_date·rc_dist·track_type·meet`가 모두 있어, 같은 족의 다른 델타를 **추가 쿼리 0**으로 만들 수 있다.
- 착순 기반 신호는 포화(게이트A서 기존과 0.8~0.99 중복). "직전대비 변화"는 착순 우물 밖 = 새 정보 가능성.

---

## 2. 신규 raw 피처

| 피처 | 산식 | 표현 | 사전가용(라이브 클린) |
|---|---|---|---|
| `rest_days` | 오늘 race_date − 직전 race_date (일수) | raw 연속값, **클리핑 없음** | ✅ 출전 일정 확정 |
| `dist_change` | 오늘 rc_dist − 직전 rc_dist (m) | raw 델타(±) | ✅ |
| `track_change` | 오늘 track_type ≠ 직전 track_type (1/0) | 이진 | ✅ |
| `away_meet` | 오늘 meet ≠ 직전 meet (1/0) | 이진 | ✅ |

- **날짜 → 일수 변환:** YYYYMMDD 정수 두 개를 일수 차로. `Date` 파싱(UTC) 후 `(a−b)/86400000`.
- **초출마(직전 경주 없음):** 4개 모두 `undefined` emit 안 함 — class_move의 `if (last)` 가드와 동일.
- **클리핑 없음(rest_days):** 장기 휴양의 큰 값을 그대로 둔다. 압축은 모델이. (relativizeRace z는 현재 OFF.)

### 희소 피처 사전 차단
`away_meet`(서울↔부경 이동)·`track_change`(잔디 경주 희소)는 **분산≈0 의심** → equip류 과적합 위험.
→ **probe(커버리지·분산)로 먼저 확인**, 분산이 너무 낮으면 게이트 진입 전 드롭(직관 단독배제, 데이터로 결정).

---

## 3. 플러밍 (class_move가 깐 경로 그대로)

1. `src/engine/scorePredictor.ts` `gatherRaceInputs` 반환에 `restDays·distChange·trackChange·awayMeet` 추가
   — `last`와 오늘 `e`/`rcDist`/`trackType`/`meet`에서 계산. **새 DB 쿼리 없음.**
2. `src/engine/index.ts` `ScoreEngineInput`에 4개 선택 필드 추가.
3. `src/engine/features/buildFeatures.ts`에 `add('rest_days', …)` 등 4줄 — `undefined` 가드.
4. (선택) `intentSignals.ts`에 날짜→일수 순수함수 `daysBetween(a, b)` 추가 + 단위테스트.

날짜·델타 계산은 순수함수로 분리해 TDD(class_move의 `buildFeatures.test.ts` 패턴).

---

## 4. 검증 흐름 (표준)

```
행렬 2차 재추출 (class_move + 새 델타 4개 동시 포함)
  → probe: 각 델타 커버리지·분산·분포 → 희소 드롭(away_meet·track_change 후보)
  → 게이트A  npm run probe:corr -- --new rest_days,dist_change,...
        (기존과 |r|>0.5 중복제외. 형제끼리는 판정 제외)
  → 게이트B  npm run backtest:box -- --candidate <생존자> --label top2 --div data/quinella_dividends.jsonl
        (baseline vs +후보, 단독·그룹 holdout 복승박스 ROI)
  → 생존자만 npm run backtest:box:quarters -- --candidate <피처> --label top2
        (5분기 walk-forward 강건성 — 전 분기 +방향이어야 채택)
```

**판정 기준(class_move 선례):** 게이트A 통과(새 정보) → 게이트B 단독 +ROI → 다분기 +방향 일관 → buildFeatures 채택.
게이트B 악화(equip 선례)나 분기 불일치면 탈락.

---

## 5. 진행 중 작업과의 관계

- 1차 행렬(class_move 전용, 38,068행·20240524~20260605, 완료)은 **class_move 다분기 강건성**에 사용(배당 수집 완료 대기 중).
- 새 델타는 구현 후 **2차 재추출**로 함께 게이트. 2차 행렬은 class_move도 포함하므로 다분기도 무료 재확인 가능.
- 추출 compute는 사용자 로컬(토큰 0) → 2회 무방.

---

## 6. 범위 밖 (YAGNI)

- 도메인 방향 사전 결정·점수맵 작성 X (raw만, 모델이 학습).
- rest_days 비선형 변환/버킷팅 X (raw 연속값으로 시작, 필요시 게이트 결과 보고 후속).
- 마체중·혈통·조교 후보는 별도 트랙(이 스펙 범위 밖).

---

## 7. 성공 기준

- 4개 중 ≥1개가 게이트A·B 통과 + 다분기 +방향 일관 → buildFeatures 채택.
- 전부 탈락이어도 **착순 우물 밖 신호 포화 여부**에 대한 음성지식 확보 = 유효 결과.
