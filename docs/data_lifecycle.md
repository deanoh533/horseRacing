# 📆 데이터 라이프사이클 — 출마표·결과 도착 시점

> 이 프로그램의 한 주기는 KRA가 출마표를 발표하는 순간부터 시작해
> 경주 결과가 들어올 때 끝납니다. 그 시간표를 정리합니다.

---

## 1. 한 주의 흐름

```
일  월  화  수          목  금      토      일
            ↑           │   │       │       │
        주말 출마표      │  경기(금) 경기(토) 경기(일)
        일괄 발표        │
        (서울+부경 동시) │
```

**출주표는 수요일에 주말(금·토·일) 3일치가 한 번에 발표됩니다** — 서울+부경 동시:

| 경주 요일 | 발표일 | 리드타임 |
|---|---|---|
| 금요일 경마 | **수요일** | D-2 |
| 토요일 경마 | **수요일** | D-3 |
| 일요일 경마 | **수요일** | D-4 |

발표 시각은 보통 **수요일 오후(≈14:30)**. 정확한 분 단위는 시즌·경마장마다 다를 수 있음.
(일부 시즌엔 금경이 없을 수 있음.)

> 💡 실데이터로 확인하려면 `race_entries.created_at` 분포를 보세요.
> ```sql
> SELECT EXTRACT(DOW FROM TO_DATE(race_date::text, 'YYYYMMDD')) AS race_dow,
>        EXTRACT(DOW FROM created_at) AS insert_dow,
>        COUNT(*) FROM race_entries GROUP BY 1, 2 ORDER BY 1, 2;
> ```

---

## 2. 데이터별 도착 시점

| 데이터 | API | 도착 시점 | 무엇이 채워짐 |
|---|---|---|---|
| 출마표 (말·기수·조교사·부담·레이팅·상금) | API26_2 (서울+부경 동시) | 수요일 일괄 (경주 D-2~D-4) | race_entries 사전 컬럼 + races |
| 혈통 지수 | API284 | 신규 말 발견 시 1회 | horses.dsa* |
| 훈련 정보 | API18_1 | 일별 | training_logs |
| 기수 통산 | jkpresult | 임의 (매주 권장) | jockey_stats |
| 경주 결과 (착순·기록·구간) | API214_1 | **경주 직후** (수 시간 내) | race_entries 사후 컬럼 + races UPDATE |
| 배당률·인기 | API214_1 | 결과와 함께 | race_entries.win_odds, popularity |

> ⚠️ 당일 win_odds는 경주 시작 전엔 조회 불가. 사전 모드에서 ⑰ 배당률 항목이 "과거 popularity 기반"인 이유.

---

## 3. 운영 시나리오 (일주일)

```
[화요일 밤 또는 수요일 오전]
  • 다음 주말 경주 미리보기 없음 (출마표 미발표)

[수요일 오후 — 주말 출마표 일괄 발표 (서울+부경 동시)]
  npm run sync:racecard -- --date 20260529   # 금경
  npm run sync:racecard -- --date 20260530   # 토경
  npm run sync:racecard -- --date 20260531   # 일경
  → race_entries 사전 INSERT + races (3일치 한 번에)

[금요일 저녁 — 금경 결과 들어옴]
  npm run sync:daily -- --date 20260529
    → race_entries UPDATE (ord, rc_time, 구간기록, win_odds)
    → predictions upsert
    → races UPDATE (rc_dist, track_type)

[토요일]
  • 저녁: 토경 결과
    npm run sync:daily -- --date 20260530

[일요일]
  • 저녁: 일경 결과
    npm run sync:daily -- --date 20260531

[월요일 — 주 정리]
  npx tsx scripts/accuracy_stats.ts
  npx tsx scripts/apply_learned_weights.ts   # 데이터 충분히 누적되면
```

(스크립트 이름이 정확한지 npm scripts 정의 확인 필요)

---

## 4. 데이터 backfill 정책

| 데이터 | 빈도 | 명령 |
|---|---|---|
| predictions 전체 재계산 | 알고리즘 수정 시 | `npx tsx scripts/backfill_predictions.ts` |
| 서울 구간기록 backfill | 누락분 발견 시 | `npx tsx scripts/backfill_sectional.ts --start YYYYMMDD --end YYYYMMDD` |
| 혈통 누락분 | 신규 말 자동 동기 외 수동 | `npx tsx scripts/fetch_pedigree.ts` |
| 가중치 학습 | 데이터 누적 + 정기 | `npx tsx scripts/apply_learned_weights.ts` |

---

## 5. 실패·재시도 정책 (현재 상태)

- 자동 재시도 없음. 수동 재실행.
- `dailySync` 멱등성: 같은 date 재실행 안전 (race_entries UPDATE는 컬럼 덮어쓰기, predictions은 upsert).
- `raceCardSync` 멱등성: PK 충돌 시 UPDATE.

추후 CI/cron 자동화 검토.

---

## 6. 시점 관련 검증해볼 만한 항목

- [ ] **실제 출주표 발표 정확한 시각** — DB `created_at` 분포로 확인
- [ ] **결과 도착 지연** — 경주 시각 vs `result_at` 차이 분포
- [ ] **win_odds 변동** — 경주 직전 변동까지 캡처할지 (현재는 final만)
- [ ] **결과 누락** — 결과가 안 들어온 경주가 있는지 (api 실패·휴장)

조회용 SQL은 사용자가 SQL Editor에서 직접 실행 권장.
