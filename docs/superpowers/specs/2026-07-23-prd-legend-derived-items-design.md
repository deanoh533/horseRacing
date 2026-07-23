# PRD legend 파생 항목 5개 (T-011) — 마주·조교사 금일 출전 현황 설계 스펙

> 2026-07-23 브레인스토밍 승인. `docs/PRD_v6.1_race_info_legend.md`의 "🆕 derived (5개)" 그룹
> (⑨⑩⑬⑮⑰) 중 남은 항목 처리.
> - ⑬(기수 최근 3개월 전적)·⑮(출주간격)은 이미 구현돼 있어 이번 세션에서 예상지(PredictionSheet)로
>   포팅만 완료(커밋 `bf7a174`, `14eca31`). 이 스펙 대상에서 제외.
> - 이 스펙은 **⑨⑩(마주 금일 출전) + ⑰(조교사 금일 출전마필·기수)** 신규 구현만 다룬다.

---

## 1. 목적·범위 (사용자 확정)

- ⑨⑩ "마주의 금일 출주두수 / 출전경주와 마필" → **하나의 기능**으로 통합: 같은 마주가 오늘(같은
  `race_date`+`meet`) 출전시킨 **다른** 말들의 목록(경주번호·마번·마명). 개수는 목록 길이로 대체
  ("총 출주두수"는 소유 마필 전체 규모를 뜻할 수 있으나 DB에 소유관계 테이블이 없어 범위 밖 — 생략).
- ⑰ "해당조 금일 출전마필과 기수" → 같은 조교사가 오늘(같은 `race_date`+`meet`) 출전시킨 **다른**
  말들의 목록(경주번호·마번·마명·기수명).
- 두 화면 동시 구현: **출마정보(RaceEntries)**의 기존 펼침 패널 + **예상지(PredictionSheet)**의
  마정보 컬럼.
- 서버·DB·마이그레이션 변경 없음. `race_entries` 기존 컬럼(`owner_nm`, `trar_nm`, `rc_no`, `pthr_no`,
  `hr_name`, `jcky_nm`)만으로 클라이언트 집계.

## 2. 스코프 결정 (동명이인 리스크)

- `owner_nm`/`trar_nm`은 이름 문자열만 있고 고유 ID가 없음 → 완전한 식별은 불가능.
- **범위를 같은 날짜(`race_date`) + 같은 경마장(`meet`)으로 한정**해 동명이인 충돌 가능성을 최소화
  (사용자 확정 — 전국 통합은 채택 안 함. 서울/부경은 별개 경주라 대부분 마주·조교사도 한 경마장에
  소속).
- 현재 보고 있는 말 자신은 목록에서 **제외**(자기 자신을 "다른 출전마"에 넣는 건 의미 없음).

## 3. 데이터 훅 (`client/src/lib/queries.ts`)

```ts
export interface StablemateEntry {
  rc_no: number;
  pthr_no: number;
  hr_name: string;
  jcky_nm: string | null;
}
```

- **`useOwnerTodayEntries(ownerNm: string, meet: number, rcDate: number, excludePthrNo: number)`**
  — RaceEntries 펼침 패널(HorsePanel)용 단건 훅. `race_entries`에서
  `.eq('owner_nm', ownerNm).eq('meet', meet).eq('race_date', rcDate)` → `pthr_no !== excludePthrNo`
  필터 → `rc_no` 오름차순 정렬 → `StablemateEntry[]`.
- **`useOwnerTodayEntriesBatch(owners: { ownerNm: string; pthrNo: number }[], meet: number, rcDate: number)`**
  — PredictionSheet용 배치 훅. `owner_nm in (...)` 한 번 조회 후 클라에서 `ownerNm`별로 그룹핑,
  각 그룹에서 해당 말 자신(`pthrNo`)만 제외. `Map<string, StablemateEntry[]>` (키: `ownerNm`) 반환.
  같은 마주 이름이 이 경주 안에 두 마리 있으면(동명이인 극단 케이스) 그룹이 섞이지만 발생 확률 낮고
  발생해도 표시만 다소 부정확 — 허용.
- **`useTrainerTodayEntries(trarNm, meet, rcDate, excludePthrNo)`** / **`useTrainerTodayEntriesBatch(...)`**
  — 위와 동일 구조, `trar_nm` 기준, `jcky_nm`도 select에 포함(이미 `StablemateEntry`에 있음).
- 4개 훅 모두 `staleTime: 10 * 60 * 1000`(경주 당일 데이터, 짧게), `enabled`는 이름/meet/rcDate 존재
  여부로 가드 — 기존 `useJockeyStatsBatch` 등과 동일한 관례.
- 쿼리 예산: RaceEntries는 펼침 시 1개씩(요청 시에만, 기존 JockeyPanel/TrainerPanel 패턴), PredictionSheet는
  페이지 로드 시 2개 배치 쿼리 추가(마주용 1개 + 조교사용 1개) — 기존 배치 쿼리 수와 같은 자릿수.

## 4. UI — 출마정보 (RaceEntries.tsx)

- **`HorsePanel`**(마주 관련) — 기존 "기본 정보" `DetailCard`에 마주 KV 있음. 그 아래 새
  `DetailCard` 추가:
  - 제목: `마주 오늘 출전` (아이콘: 기존 `Award` 재사용 또는 `Users`류 — 컴포넌트 작성 시 결정)
  - 내용: `useOwnerTodayEntries(entry.owner_nm ?? '', meet, rcDate, entry.pthr_no)` 결과
    - 빈 배열 → "오늘 다른 출전 없음"
    - 있으면 각 항목을 `{rc_no}R {hr_name}({pthr_no}번)` 형태로 나열(KV 여러 줄 또는 리스트)
    - `entry.owner_nm`이 없으면 카드 자체 스킵
- **`TrainerPanel`**(조교사 관련) — 기존 "조교사 최근 2년 성적" 카드 옆에 새 `DetailCard` 추가:
  - 제목: `조 금일 출전마필`
  - 내용: `useTrainerTodayEntries(entry.trar_nm ?? '', meet, rcDate, entry.pthr_no)` 결과
    - 각 항목: `{rc_no}R {hr_name}({pthr_no}번, {jcky_nm ?? '기수 미정'})`
    - 빈 배열 → "오늘 다른 출전 없음"

## 5. UI — 예상지 (PredictionSheet.tsx)

- 메인 컴포넌트에서 배치 훅 2개 호출 (기존 `jckyNos`/`trainerNames` memo 재사용):
  ```ts
  const owners = useMemo(() => (horses ?? []).map(h => ({ ownerNm: h.owner_nm ?? '', pthrNo: h.pthr_no })).filter(o => o.ownerNm), [horses]);
  const { data: ownerEntriesMap } = useOwnerTodayEntriesBatch(owners, meet, rcDate);
  const { data: trainerEntriesMap } = useTrainerTodayEntriesBatch(
    (horses ?? []).map(h => ({ trarNm: h.trar_nm ?? '', pthrNo: h.pthr_no })).filter(t => t.trarNm),
    meet, rcDate
  );
  ```
- `ColHorseInfo`에 두 개 옵셔널 prop 추가: `ownerTodayEntries?: StablemateEntry[]`,
  `trainerTodayEntries?: StablemateEntry[]`.
- 표시 위치: 기존 "조교사 · 마주" 줄(마주 이름 뒤) 아래에 한 줄씩 추가, 목록이 비어있으면 줄 자체
  생략(공간 절약 — 예상지는 이미 밀도가 높음):
  - `{count}두 더 · {rc_no}R·{rc_no}R…` 형태 축약 텍스트 (예: "오늘 1R·5R 2두 더")
  - 마주 줄: 회색 톤(`text-[var(--color-text-disabled)]`), `fontSize: '10px'`
  - 조교사 줄도 동일 스타일, 기수명까지는 공간상 생략하고 경주번호만(전체 목록은 RaceEntries에서 확인)

## 6. 에러·엣지 케이스

- `owner_nm`/`trar_nm`이 `null`/빈 문자열 → 훅 `enabled: false`, 빈 배열 취급, UI 생략.
- 오늘 출전이 이 말 하나뿐(마주/조교사가 다른 말이 없음) → 빈 배열 → "다른 출전 없음"(RaceEntries)
  / 줄 생략(PredictionSheet).
- 동명이인 마주/조교사가 실제로 같은 날 같은 경마장에 있는 극단 케이스 → 목록에 섞여 들어감(허용,
  §2에 명시).

## 7. 테스트

- 그룹핑 로직(배치 훅의 owner_nm/trar_nm별 그룹핑 + 자기 자신 제외)은 순수 함수로 분리해
  `client/src/lib/queries.test.ts`(신설 또는 기존 파일)에 유닛 테스트: 같은 마주 2건 중 1건 제외
  확인, 마주 없음(빈 배열) 확인, 여러 마주 섞인 배열에서 정확히 그룹 분리 확인.
- 컴포넌트 자체는 기존 관례대로 유닛 테스트 없음 — 타입체크 + Playwright 스크린샷으로 실제 렌더
  확인(이번 세션 페이스 배지·기수 최근폼 검증과 동일 방식).

## 8. 범위 밖

- "마주의 총 출주두수(소유 마필 전체 규모)" — 소유관계 데이터 없어 생략(§1).
- 전국(서울+부경) 통합 집계 — 이번엔 같은 경마장으로 한정(§2). 필요성이 확인되면 후속.
- 마주/조교사 고유 ID 도입(KRA API에 있다면) — 별도 조사 필요, 이번 스펙 범위 아님.

## 9. 참고

- 원본 문서: `docs/PRD_v6.1_race_info_legend.md` (항목 ⑨⑩⑪⑫⑬ 정의), TODO.md T-011.
- 기존 단일/배치 훅 페어 선례: `useJockeyStats`/`useJockeyStatsBatch`,
  `useTrainerStats`/`useTrainerStatsBatch`, 이번 세션에 추가한
  `useJockeyRecentForm`/`useJockeyRecentFormBatch`.
- RaceEntries 펼침 패널 구조: `HorsePanel`/`TrainerPanel`/`JockeyPanel` (`client/src/pages/RaceEntries.tsx`).
