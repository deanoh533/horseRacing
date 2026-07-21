# /picks 지난 경주 — 페이스 예측 vs 실측 표시 설계 스펙

> 2026-07-21 브레인스토밍 승인. F-001 페이스 배지(예측)에 "실제로 그 전개였나"를 붙인다.
> 근거: `probe:pace-actual`(2026-07-21) — 예측 vs 실측 3×3 일치 47%(기대 32%)·정반대 11%·방향 단조.
> 검증 상세 = 메모리 project_pace_prediction_validated.

---

## 1. 목적·범위 (사용자 확정)

- `/picks`의 **지난 경주 섹션**에서, 경주별 페이스 배지에 **예측 페이스 + 실측 페이스 + 3단계 일치 표시**를 붙인다.
- 실측 페이스 = 그 경주 초반 200m 평균시간(`race_sectional_stats.avg_s1f`)이 거리·경마장 기준선(par)보다 빨랐/느렸나 → HOT/NORMAL/SLOW (서버 `labelPastRacePace` 규칙과 동일).
- 3단계: 예측=실측 **정확(✅)** / 한 칸 차이 **근접(≈)** / 정반대 **빗나감(❌)**.
- 서버·DB·마이그레이션 변경 **없음**. F-001/F-004 선례대로 par 정적 JSON + 클라이언트 계산.

## 2. par 정적 JSON — 신설

- 파일: `client/src/config/pace_par.json` — `{ "<meet>|<rcDist>": <par_avg_s1f_seconds>, ... }` (예: `"1|1200": 13.82`). 키 형식 = 서버 `paceParKey(meet, rcDist)` (`src/engine/pacePar.ts`)와 동일 문자열.
- 값 = `buildPaceParMap(all-time)` 결과(버킷별 avg_s1f **중앙값**, 최소 30경주 버킷만 — 현재 15버킷). 
- 생성 스크립트: `scripts/export_pace_par.ts` = `npm run export:pace-par`. 로컬 미러(`getLocalDb`) 읽기 → `race_sectional_stats` 로드 → `buildPaceParMap(rows, 99991231)` → 키·값 그대로 JSON `stringify`(키 정렬, 값 소수 2자리 반올림) → `client/src/config/pace_par.json` 기록. **egress 0.**
- 드리프트: par는 전기간 중앙값이라 안정적. 새 경주 누적 시 미세 이동 → 가끔 재생성(pace-form이 임계값을 고정상수로 쓰는 것과 동일 수용). 스크립트 상단 주석에 "재생성: npm run export:pace-par" 명시.

## 3. 클라이언트 유틸 (`client/src/lib/pace.ts` 확장)

기존 `computeRacePace`(예측)·`PACE_UI`·`PaceType` 유지. 아래 추가:

- **`labelActualPace(avgS1f: number | null, meet: number, dist: number | null): PaceType | null`**
  - par JSON에서 `pace_par.json[`${meet}|${dist}`]` 조회. 없거나 `avgS1f`≤0/null이면 `null`.
  - `d = avgS1f - par`; `d <= -0.11 → 'HOT'`, `d >= 0.11 → 'SLOW'`, else `'NORMAL'`.
  - 임계값 −0.11/+0.11 = 서버 `PACE_HOT_DELTA`/`PACE_SLOW_DELTA`(`src/engine/features/paceForm.ts`) 미러 — 주석에 SSOT 명시. `computeRacePace`가 서버 `computePaceType`를 미러하는 것과 동형.
  - par JSON은 모듈 상단에서 `import paceParJson from '../config/pace_par.json'`로 정적 로드(쿼리 아님).
- **`paceMatchLevel(predicted: PaceType, actual: PaceType): 'exact' | 'adjacent' | 'opposite'`**
  - 순서 상수 `ORD = { HOT: 0, NORMAL: 1, SLOW: 2 }`. `diff = |ORD[pred] - ORD[actual]|`. 0→exact, 1→adjacent, 2→opposite.
- **`PACE_MATCH_UI: Record<'exact'|'adjacent'|'opposite', { symbol; label; className }>`**
  - exact: `✅` "예측 적중" (emerald), adjacent: `≈` "근접" (zinc/amber), opposite: `❌` "빗나감" (red). className은 기존 PickBadge/PACE_UI 톤 재사용.

## 4. 데이터 훅 (`client/src/lib/queries.ts`)

- **신규 `useRaceSectionalStatsByRange(from: number | null, to: number | null)`**
  - `race_sectional_stats`에서 `race_date, meet, rc_no, rc_dist, avg_s1f` select, `.gte('race_date', from).lte('race_date', to)`.
  - `enabled: from != null && to != null`. queryKey `['race-sectional-range', from, to]`. staleTime 10분.
  - 반환: 경주키(`${race_date}-${meet}-${rc_no}`)로 조회 가능한 형태(배열 그대로 반환, 소비측에서 Map 구성). 1000행 페이지네이션(주간이라 초과 거의 없지만 기존 `useRaceEntryNamesByRange` 패턴과 일관 유지).
- 기존 단일 경주 훅 `useRaceSectionalStats`는 그대로 둠(다른 화면 사용, RaceEntries).

## 5. 화면 (`client/src/components/RacePaceBadge.tsx` + `client/src/pages/TodayPicks.tsx`)

### RacePaceBadge 확장
- 새 옵셔널 prop: `actual?: { avgS1f: number | null; meet: number; dist: number | null }`.
- `actual`이 있고 예측(`computeRacePace`)도 `null`이 아닐 때만 실측 줄 렌더:
  - `const actualType = labelActualPace(actual.avgS1f, actual.meet, actual.dist)`.
  - `actualType == null`(par 없음/데이터 부족)이면 실측 줄 생략(예측 배지·근거는 그대로).
  - 있으면 둘째 줄: `실제 {PACE_UI[actualType].emoji} {label}` + `{PACE_MATCH_UI[level].symbol} {label}` (level = `paceMatchLevel(pace.paceType, actualType)`).
- `actual` 없으면(다가오는 경주·출마정보) 기존과 100% 동일 렌더(회귀 없음).

### TodayPicks 배선
- `useRaceSectionalStatsByRange(from, to)` 호출 — 훅 규칙 위해 항상 호출하되, 지난 경주가 없으면(`pastRaces.length === 0`) 인자 `null`로 스킵. (기존 `useRaceEntryNamesByRange`의 `hasPicks ? from : null` 패턴과 동일.)
- 결과를 경주키(`${race_date}-${meet}-${rc_no}`)→`{ avgS1f, meet, dist }` `Map`으로 구성(useMemo).
- **기존 `styles` 전달 패턴과 동일하게** TodayPicks가 경주별로 resolve: `RaceCard`에 새 옵셔널 prop `actual?: { avgS1f, meet, dist }` 추가. 지난 경주 카드에만 `actual={sectionalByRaceKey.get(key)}` 전달(없으면 `undefined`), `RaceCard`는 이를 그대로 `RacePaceBadge`에 넘김. 다가오는 경주 카드(`showResult=false`)는 `actual` 미전달 → 기존 렌더 유지.
- 쿼리 예산: 기존 3개 + 지난 경주 있을 때 1개 = 최대 4개(주간 바운드, 허용).

## 6. 테스트

- `client/src/lib/pace.test.ts`에 추가:
  - `labelActualPace`: par 있는 버킷에서 delta 경계(−0.11/+0.11 정확히, 그 안/밖) → HOT/NORMAL/SLOW, par 없는 키·avgS1f null → null.
  - `paceMatchLevel`: 9개 조합(HOT/NORMAL/SLOW × 2) → exact/adjacent/opposite 정확.
- RacePaceBadge/TodayPicks(컴포넌트) 유닛 테스트 없음 — 기존 관례대로(페이지·컴포넌트 유닛 테스트 부재). 타입체크 + 개발서버 수동 확인.
- `export_pace_par.ts`는 일회성 생성 스크립트라 유닛 테스트 없음(F-004 export 선례) — 생성된 JSON을 손으로 스팟체크(버킷 수·값 범위 ~13-15초).

## 7. 범위 밖

- 출마정보·경주 상세(PredictionSheet 등) 화면의 실측 표시 — /picks 확정 후 후속.
- 예측 라벨을 as-of로 다시 계산(F-001은 현재 성향 스냅샷 사용) — 기존 한계 유지, 이 스펙에서 변경 안 함. probe가 관계(47%·단조)를 검증했고 개별 표시엔 스냅샷으로 충분.
- 주간 실측 요약 통계(N경주 중 M 적중) — 필요 시 후속. `/statistics` 몫.
- 서버·DB·마이그레이션·모델 변경 없음.

## 8. 참고

- 검증 probe: `scripts/probe_pace_actual.ts` = `npm run probe:pace-actual`.
- 실측 라벨 규칙 SSOT: `src/engine/features/paceForm.ts` `labelPastRacePace`·`PACE_HOT_DELTA`/`PACE_SLOW_DELTA`.
- par 산식 SSOT: `src/engine/pacePar.ts` `buildPaceParMap`(중앙값·최소 30경주)·`paceParKey`.
- 예측 배지 원본: `docs/superpowers/specs/2026-07-16-f001-pace-ui-design.md`, `client/src/lib/pace.ts`.
- 정적 JSON 배포 선례: F-004 H7(`docs/superpowers/specs/2026-07-18-h7-insights-design.md`).
