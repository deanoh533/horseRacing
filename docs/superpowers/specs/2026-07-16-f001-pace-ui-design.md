# F-001 페이스 예측 UI (RacePaceBadge) — 설계 스펙

> 2026-07-15 브레인스토밍(표시 위치·깊이 사용자 확정) → 신호 검증 우선으로 보류 → 검증 기각 종결 후 2026-07-16 재개.
> 모델 기여 트랙은 종결: 페이스는 이미 피처로 학습돼 기여 ~0([[project_running_style_pace_map]]), 환경 조건부 전적도 기각([[project_pace_conditional_form_rejected]]) — **이 기능은 순수 UI(사람 참고용)로 확정.**

---

## 1. 목적

매 예측마다 계산되지만 화면에 안 보이던 경주 단위 페이스 예상(접전/보통/느슨)을 관전·베팅 참고용으로 노출한다. 근거(선두권 마릿수)와 실측 해석 한 줄을 함께 보여 "왜"까지 전달한다.

## 2. 표시 사양 (2026-07-15 사용자 확정)

- **위치**: ① 출마정보(RaceEntries) 경주 헤더 ② /picks(TodayPicks) 경주 그룹 — 같은 컴포넌트 재사용.
- **깊이**: 배지 + 근거 + 해석.
  - 배지: 🔥 접전 예상 / ➖ 보통 전개 / 🐢 느린 전개 예상
  - 근거: "선두권 N마리" (도주+선행 성향, 자유마 제외)
  - 해석: paceType별 고정 문구 1줄 (실측 근거 — §4)
- **판정 불가 상태**: 성향 데이터 보유 말이 출전마의 절반 미만이면 배지 대신 "페이스 판정 불가 — 성향 데이터 부족" 표시 (신마전 등 오판 방지 — 침묵이 오판보다 낫다). 이 커버리지 가드는 표시 전용 규칙이며 산식 변경이 아님.

## 3. 산식 — 서버와 동일 규칙 (일관성 원칙)

`src/engine/scorePredictor.ts:computePaceType`과 동일 상수·규칙을 클라이언트에서 재구현 (양쪽 주석 상호 참조):

- 말별 분류: 기존 `client/src/lib/runningStyle.ts:classifyRunningStyle` 재사용 (avg≤0.15 도주 / ≤0.35 선행 / std≥0.35 자유 우선 / avg null unknown).
- 선두권 카운트: `front | pace` (자유마·unknown 제외) — 서버의 `avg ≤ 0.35 && !isFree`와 동치.
- 판정: **frontCount ≥ 3 → HOT / ≤ 1 → SLOW / 그 외 NORMAL.**
- 산식 중복 관리: 말별 5분류도 이미 서버(`classifyRunningStyleFromData`)·클라(`classifyRunningStyle`) 병행이 기존 패턴. 두 곳에 상호 참조 주석 필수.

데이터 소스 차이 명시: 서버는 as-of(그 경주 이전) position_ratio, 클라는 `horse_sectional_ability` 뷰(현재 스냅샷). 오늘·미래 경주에선 사실상 동일, 과거 경주 조회 시 당시 판정과 다를 수 있음 — 기존 말별 배지와 같은 한계(허용).

## 4. 해석 문구 (실측 근거, `lib/pace.ts` 상수)

⑲ 실측(2026-06-16 교정 데이터: 도주+HOT 21% vs 추입+HOT 4%, 로지스틱 계수 환산 SCORE_MAP — closer+SLOW 0.20 최저·pace+NORMAL 0.90 최고) 기반 고정 문구:

- HOT: "접전 경주 실측: 도주마 승률 21% vs 추입마 4% — 선두권이 오히려 유리했던 게 실측"
- NORMAL: "보통 전개 실측: 선행마가 가장 안정적, 추입마는 평균 이하"
- SLOW: "느린 전개 실측: 추입마 최악(막판 가속 여지 없음), 선입마 유리"

문구는 단정 대신 "실측" 표기로 출처를 밝힌다. 툴팁이 아니라 배지 아래 보조줄(작은 글씨)로 상시 노출 — 모바일에서 툴팁 접근성 문제 회피.

## 5. 데이터 조달

- **RaceEntries**: 이미 로드하는 `useHorseSectionalAbilityByNames(hrNames)` 결과 재사용 — **새 쿼리 0**.
- **TodayPicks**: 픽 행에는 경주 전체 출전마가 없음 → 배치 쿼리 2개 추가:
  1. 오늘 픽 경주들의 출전마 명단: `race_entries` select(race_date·meet·rc_no·hr_name) `.in()` 배치 (React Query 훅 신설, `lib/queries.ts` 기존 패턴)
  2. 그 명단의 성향: 기존 `useHorseSectionalAbilityByNames` 재사용
  - egress: 주말 기준 수백 행 수준 — 허용. 픽 없는 날은 쿼리 스킵(enabled 가드).

## 6. 구현 구조

- `client/src/lib/pace.ts` 신설 — 순수 계산 + 문구 상수:
  - `computeRacePace(styles: RunningStyle[]): { paceType: 'HOT'|'NORMAL'|'SLOW'; frontCount: number; knownCount: number; total: number } | null` — null = 판정 불가(knownCount < total/2). 입력은 이미 분류된 스타일 배열(분류는 기존 함수 재사용).
  - `PACE_UI: Record<PaceType, { emoji; label; insight; className }>` — Tailwind 색은 STYLE_INFO 관례(bg-*/20 text-*-300 border-*/40) 따름.
- `client/src/components/RacePaceBadge.tsx` 신설 — `PickBadge.tsx` 선례 스타일. props: `styles: RunningStyle[]`(또는 computeRacePace 결과). 판정 불가 시 회색 안내.
- 부착: RaceEntries 경주 헤더(기존 `styleByName` 재사용), TodayPicks 경주 그룹 헤더(신설 훅 데이터).
- 테스트: `client/src/lib/pace.test.ts` — 루트 vitest로 실행(`PredictionSheet.test.ts` 선례). 케이스: HOT/SLOW/NORMAL 경계(3·1마리), 자유마·unknown 제외, 커버리지 가드(절반 미만 null), 서버 규칙 동치(동일 입력 → computePaceType 결과와 일치하는 표 기반 케이스).

## 7. 범위 밖

- 모델 피처화 — **종결** (기각 2건으로 확정, 재론 없음).
- 서버 paceType의 DB 저장·API 노출.
- 예상지(PredictionSheet) 부착 — styleByName이 이미 있어 공짜지만 화면 밀도 검토 후 후속 1줄 작업으로.
- 페이스 예측 적중률 측정(예상 페이스 vs 실측 s1f 라벨 대조) — 흥미로우나 후속. pacePar 인프라 재사용 가능.

## 8. 참고

- 서버 규칙: `src/engine/scorePredictor.ts` computePaceType (frontCount ≥3/≤1)
- 실측 해석 원천: `src/engine/scoreItems/19_running_style_pace.ts` SCORE_MAP 주석 + [[project_running_style_pace_map]]
- 선례: `client/src/components/PickBadge.tsx`(배지), `client/src/lib/runningStyle.ts`(분류·STYLE_INFO)
- 이전 논의: [2026-07-15 스펙](2026-07-15-pace-conditional-form-design.md) §7 (보류 기록)
