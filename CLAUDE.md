# KRA 경마 분석 도구 — Claude 컨텍스트

> 새 세션에서 이 파일을 가장 먼저 읽습니다.
> 마지막 업데이트: 2026-06-06 (earnings as-of 정화 완료 + 재설계 최종값 확정)

---

## 🎯 한 줄 요약

KRA(한국마사회) 출마정보를 한 화면에 비교하고, 21개 항목 알고리즘 × Spearman 학습 가중치로 종합점수를 만들어 경주 1·2·3위를 예측한 뒤 결과로 적중률을 측정하는 개인용 분석 도구.

미래 계획: 경주별 AI 코멘트 / PDF 보고서 / 유튜브 대본 자동 생성.

---

## 📐 4단계 핵심 흐름

```
   ① 수집              ② 점수화           ③ 학습              ④ 검증
┌─────────────┐    ┌─────────────┐   ┌─────────────┐    ┌─────────────┐
│  KRA Open   │ →  │ ScoreEngine │ → │WeightLearner│ →  │  적중률 통계 │
│    API      │    │ 21 항목     │   │ Spearman ρ  │    │ 단/연/복승, │
│             │    │ raw 0~1     │   │ → 가중치    │    │ TOP3 교집합 │
└─────────────┘    └─────────────┘   └─────────────┘    └─────────────┘
       ↓                 ↓                  ↓                  ↑
  race_entries     predictions        weight_history     predictions
```

---

## 🛠 기술 스택

- **프론트엔드:** React + Vite + Tailwind ([client/](client/))
- **백엔드/스크립트:** Node.js + TypeScript ([src/](src/), [scripts/](scripts/)) — **로컬 수동 실행 전용** (상시 서버 X). Vercel에는 `client/`만 배포.
- **DB:** Supabase (PostgreSQL)
- **배포:** Vercel — main push 시 자동 배포 (`horse-racing-xi-one.vercel.app`)

---

## ⚡ 개발 시작

```bash
# 1. 환경 변수 설정
cp .env.example .env  # 아래 키 필수 입력

# 2. 의존성 설치
npm install && cd client && npm install && cd ..

# 3. 개발 서버 실행 (각각 별도 터미널)
npm run dev          # 백엔드 (포트 3000)
npm run client:dev   # 프론트엔드 (포트 5173)

# 타입체크 / 테스트
npm run build        # tsc 전체 타입체크
npm run test:run     # vitest 단위 테스트
```

**필수 환경 변수** (`.env.example` 참고):
- `KRA_API_KEY` — data.go.kr 공공데이터 포털 발급
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — `sk-ant-...` 형식

---

## 🗂 핵심 테이블

| 테이블/뷰 | 역할 | 채움 |
|---|---|---|
| `race_entries` | **사전+사후 통합 테이블** (PK: race_date·meet·rc_no·pthr_no) | raceCardSync / dailySync |
| `races` | 경주 메타 (거리·주로·날씨) | raceCardSync / dailySync |
| `predictions` | 경주마별 종합점수 + 항목점수 | dailySync / backfill |
| `weight_history` | Spearman 학습 가중치 변천 | apply_learned_weights |
| `horse_sectional_ability` | 마별 통산 구간 능력치 (view) | 007 마이그레이션 |
| `horse_running_style_by_distance` | 거리별 마필 주행 성향 (view) | 008 마이그레이션 |
| `race_sectional_stats` | 경주별 페이스 통계 (view) | 007 마이그레이션 |
| `training_logs` | 일별 훈련 기록 | trainingSync (API18_1) |
| `jockey_stats` | 기수 통산 성적 | jockeySync (jkpresult) |
| `horses` | 말 정보 + 혈통 | fetch_horse_info |

→ 전체 구조·관계는 [docs/architecture.md §5](docs/architecture.md#5-데이터-모델-db)

---

## 🔀 예측 모드 — 사전/사후

같은 `predictRace()`가 **`race_entries.ord` NULL 여부**로 자동 분기.

| 시점 | `ord` | 모드 |
|---|---|---|
| 수~경기 직전 | NULL | 사전 (베팅 전 예측) |
| 경기 후 | 1·2·3·… | 사후 (백테스트·학습) |

상세 데이터 출처 차이 → [docs/prediction_mode.md](docs/prediction_mode.md)

---

## 📆 한 주의 흐름

| 요일 | 이벤트 | 명령 |
|---|---|---|
| 수 오후 | 금경 출마표 발표 | `sync:racecard --date YYYYMMDD` |
| 목 오후 | 토경 출마표 발표 | 〃 |
| 금 오후 | 일경 출마표 발표 | 〃 |
| 금 밤 | 금경 결과 도착 | `sync:daily --date YYYYMMDD` |
| 토 밤 | 토경 결과 도착 | 〃 |
| 일 밤 | 일경 결과 도착 | 〃 |
| 주중 | 가중치 학습 (선택) | `apply_learned_weights.ts` |

상세 → [docs/data_lifecycle.md](docs/data_lifecycle.md)

---

## 🤝 협업 모드 (Claude)

- **PM/기획** → 단계별 의논 필수, 추측 단독 작성 X
- **SQL 쿼리·대용량 분석** → 사용자가 Supabase SQL Editor에서 실행 (토큰 절감)
- **빌드·타입체크·git** → Claude 직접
- **출력 100줄 넘는 명령** → 사용자에게 부탁
- **서브에이전트 spawn** → `model: 'sonnet'` 명시 (메인 Opus 비용 분리)
- **선택지 제시** → AskUserQuestion 버튼 UI 사용

---

## 📚 문서 인덱스

### 큰그림·아키텍처
- [docs/architecture.md](docs/architecture.md) — **시스템 전체 그림** (시작 추천)
- [docs/data_flow.md](docs/data_flow.md) — KRA API → DB → ScoreEngine → UI 전체 흐름
- [docs/data_lifecycle.md](docs/data_lifecycle.md) — 출마표 발표·결과 도착 시점

### 알고리즘·예측
- [docs/score_algorithm.md](docs/score_algorithm.md) — 알고리즘 흐름 + **수정 가이드** (항목 목록·비중·산식은 roadmap·score_items 위임)
- [docs/score_roadmap.md](docs/score_roadmap.md) — **평가항목 고도화 로드맵** (클린 슬레이트 비교·변경 이력 Living Doc)
- [docs/prediction_mode.md](docs/prediction_mode.md) — 사전/사후 데이터 소스 차이
- [docs/accuracy_metrics.md](docs/accuracy_metrics.md) — 적중률 4개 지표 정의

### 화면·기능
- [docs/PRD_v6.1_entries_view.md](docs/PRD_v6.1_entries_view.md) — 출마정보 화면 PRD
- [docs/PRD_v6.1_race_info_legend.md](docs/PRD_v6.1_race_info_legend.md) — 에이스경마 1-34번 매핑

> **UI 현황 (2026-05-31):** 예상지 = 모바일 2+2 그리드 / 데스크탑 4열(`grid-cols-2 md:[grid-template-columns:2fr_1.2fr_3fr_2fr]`). 아코디언 레이아웃 미사용(사용자 확인). Col5Items = 가중치 상위 5개 동적 표시. RaceInfoBlock 공통 헤더(3개 화면 공유), 조교 이력 추가 완료. 대시보드 개발 용어 제거·모바일 버튼 개선 완료. **로딩 스켈레톤(U-001) 완료** — Loader2 스피너 → 4열 HorseCardSkeleton 8개. `lib/sectional.ts` 공통 유틸(getSectionalInfo·fmtSec·computeSameDistStats) 분리 완료. RaceEntries JockeyPanel(조합이력·최근3개월폼)·HorsePanel(구간기록·같은거리기록·조교·진료) 개선 완료.
>
> **HorseCard 컬럼 순서:** Col1=**마정보**(2fr) · Col2=**기수정보**(1.2fr) · Col3=**직전경주**(3fr) · Col4=**베팅조합**(2fr). skeleton·레이아웃 작업 시 혼동 주의.
>
> **구간기록 유틸:** `client/src/lib/sectional.ts` — `getSectionalInfo(entry)`, `fmtSec(t)`, `computeSameDistStats(history, dist)`. PredictionSheet·RaceEntries 공유. 페이지 파일에 재구현 금지.
>
> **training_logs 주의:** `st_time`/`sp_time`은 YYYYMMDDHHmmss 타임스탬프 (훈련 시작/종료 시각). 실제 소요시간은 `tr_term`(초). `pr_gubun` 범례: 이름=기수, 조=조교사, 관=주로조교, 생=교육생, 이름(트)=기수트랙라이더.

### 운영·디버깅
- [docs/api_spec.md](docs/api_spec.md) — **API 전체 명세 (SSOT)**: KRA 9개 엔드포인트·Supabase 스키마·React Query 훅·Claude API. ⚠️ **API 변경(엔드포인트·파라미터·필드·스키마) 시 이 문서를 함께 갱신**
- [docs/kra_api_quirks.md](docs/kra_api_quirks.md) — KRA API 컬럼명 함정
- [docs/troubleshooting.md](docs/troubleshooting.md) — 현재 발견된 의문·수정점
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — 배포 메모

### 세션 인계 (새 세션 정독 추천)
- [docs/working_style.md](docs/working_style.md) — **시니어 개발자 + 설계자 관점, 협업 패턴**
- [docs/running_style_insight.md](docs/running_style_insight.md) — 주행 성향 분류 큰그림·현재 위치·다음 단계 (⑤⑥⑫⑲ 완료 / ⑲ 스코어맵 재설계 대기)
- [docs/superpowers/specs/2026-05-28-score-redesign-design.md](docs/superpowers/specs/2026-05-28-score-redesign-design.md) — **점수 알고리즘 재설계 스펙** (3단계 전체 완료)

### 할일
- [TODO.md](TODO.md) — 우선순위별 할일

---

## ⚠️ 지금 알아야 할 핵심 이슈

> **2026-06-11 — class_move promote(라이브 반영) + 패리티 버그 수정 + PL 모델 (main 커밋)**
> 이 세션 흐름(시간순):
> 1. **신규 후보 3개 게이트** (직전대비 변화): **게이트A** — `away_meet` 탈락(전체 100% 상수=원정 0건, 다신 제안 X), dist_change·track_change 통과. **게이트B 단일분기**(2025 Q1) 둘 다 +로 통과처럼 보임.
> 2. **PL(Plackett-Luce) 모델 신규** — `src/engine/models/plackettLuce.ts`(TDD), `backtest:box`·`backtest:box:quarters`에 `--model logistic|pl|both` 추가(같은 후보 두 모델 비교). PL은 박스 ROI에서 분기마다 로지스틱과 우열 뒤집힘(2025 Q2·Q3은 PL 우위·Q3 유일 흑자). **박스/라이브 모델=로지스틱**, PL은 연승 트랙용(walkforward는 PL 미지원).
> 3. **★ 다분기가 게이트B 표준** — `backtest:box:quarters`로 보니 dist_change·track_change **둘 다 탈락**(2/5 분기, 평균 +0.4/+0.2%p=노이즈). 단일 holdout(2025 Q1)이 거짓양성을 줬음. **class_move는 강건**(4/5, +3.9%p; 단/연승도 +0.9/+0.5%p) → 채택 정당.
> 4. **죽은 피처 3개 제거**(away_meet·dist_change·track_change): buildFeatures·scorePredictor·featureItemMap·index·테스트.
> 5. **★ 패리티 버그 발견·수정**(체계적 디버깅): `scorePredictor` 기수·조교사 90일 쿼리가 `.range()`·`.order()` 없이 **Supabase 1000행 캡**에 걸려 비결정 잘림(실측 1038→1000) → jockey/trainer_recent 피처가 실행마다 달라져 refresh 패리티 80중 18 불일치. 평소 예측도 최근폼 잘렸음. → 페이지네이션+안정정렬. 상세 [[reference-db-schema-gotchas]].
> 6. **복승 배당 결손 보충** — 우리 키 쿼터 소진(2025-11-30까지만)→**친구 키**로 2025-12~2026-05-09 수집·concat. `data/quinella_dividends.jsonl`=2025-01~2026-05-09. 백업 `pre-gap.bak`.
> 7. **속도 조사** — extract 경주 병렬화 **무효**(Supabase 처리량 병목, 동시성↑ 손해). 진짜 지렛대=gatherRaceInputs 말별 쿼리 배치화(~5-10×, 라이브도)지만 보류(공유 경로 리팩터). [[reference-db-schema-gotchas]] 기록.
> 8. **재추출(고친 코드) → refresh:logistic 패리티 ✅0 → promote id=5**(logit-20260611) 활성. 미확정 595경주/6559행 재생성, 확정 과거 동결. 롤백=이전 id로 promote.
> 9. **적중률**(id=5 홀드아웃 walk-forward): **연승 60.1%/단승 28.9%** vs 시장 68.2/37.2 = **−8.1%p**(여전히 시장 못 이김). class_move·최근폼수정으로도 시장격차 안 좁혀짐.
> 10. **속도** ✅ — gatherRaceInputs 말별 쿼리 `.in()` 배치화: 경주당 ~150→~7 라운드트립, **187경주 224s→61s(3.7×), byte-identical**. extract 전체 ~30-60분→~8-16분. (경주 병렬화는 무효=Supabase 처리량 병목.)
> **다음 (우선순위):** ①**시장격차(−8%p) 좁힐 새 raw 신호** — 휴양·혈통·트랙이동 등, 다분기 게이트B(`backtest:box:quarters`)로. ②PL 연승 트랙(walkforward가 PL/artifact 미지원 → 지원 추가해야 PL을 연승·시장격차로 평가) ③복승 배당 마지막 4주(2026-05-10~06-05) 보충·복연승 트랙 ④더 짜낼 속도=asOf(fetchAsOfHorseStats) 배치화(누수민감, byte-identical 필수).
> **세션 끝 상태(다음 시작점):** 8커밋 전부 **로컬 main·미푸시**. **DB: model_versions id=5(logit-20260611) 활성**(롤백=이전 id promote). 데이터: `training_matrix.jsonl`=현재 깨끗(배치코드 산출)·`quinella_dividends.jsonl`=2025-01~2026-05-09(마지막 4주 결손)·**`combo_dividends.jsonl`=0바이트(복연승 truncate, 재수집 필요)**·`*.bak`/`*.gap`/`smoke` 등 정리대상 잔존. 우리 KRA_API_KEY는 어제 쿼터소진(오늘 리셋됐을 것), 복승 결손은 친구키로 보충했음(키 미저장).

> **2026-06-10 — 복승 박스 타깃 + 2단계 게이트로 신호 발굴 (진행 중, main 커밋)**
> - **목표:** 복승 3마리 박스 ROI. **라벨 top2 채택**(top3 대비 +8%p). **원칙:** 압축은 모델에 맡기고 사람은 raw만 공급(자체레이팅·Elo 폐기). 메모리 [[feedback-no-human-compression]]·[[project-feature-gate-findings]].
> - **2단계 게이트(표준):** A=`probe:corr`(후보↔기존 \|r\|>0.5 중복제외) → B=`backtest:box --label top2 --div data/quinella_dividends.jsonl`(holdout 복승박스 ROI). 게이트A 규칙 검증됨(겹침은 보강 안 함).
> - **신규 도구(main):** `extract:matrix`(z OFF·top2·후보 포함)·`probe:corr`·`backtest:box`(--candidate 격리)·`refresh:logistic`. 순수함수 `relativizeRace`(z 현재 OFF)·`settleBox`·`buildRaceFeatures`.
> - **채택:** **등급이동 `class_move`**(오늘−직전 등급밴드상한, raw 델타) — 게이트B 단독 **+2.2%p**(−25.0→−22.8), prize_cond 100% 사전가용 → **라이브 클린**. buildFeatures 반영(아직 promote 안 함).
> - **탈락:** z-score·구간후보6·경쟁강도3(편성탓 필드강도≈자기레이팅)·장구(게이트B ROI악화)·기수변경(combo_n과 0.59 중복)·class_dropped(사람임계값). 착순 기반 신호 포화 확인.
> - **보류:** 마체중 게이트B +7.2%p 통과했으나 `wg_hr`이 경기후 결과(`transformer.ts`)에만 채워짐=라이브 누수(계량=경기前이라 착순누설은 아님, 운영 타이밍).
> - **다음(재개시):** ①다분기 강건성(class_move·마체중 단일분기 → 행렬 ~20250930 확장) ②마체중 사전수집 가능성(KRA 직전정보 API) 조사 ③새 후보(휴양·원정·혈통; 조교 커버리지 미확인) ④class_move `refresh:logistic`→`promote`.
>
> **2026-06-06 — 재설계 최종값 확정 + earnings 트랙 종결** (브랜치 `feat/score-learning-redesign`, 미머지)
> - **최종 walkforward 결과:** 로지스틱 **연승 59.0%** / v1 57.6% / 시장 68.8%. 모델−v1 = **+1.4%p (±1.9%p 노이즈)**. 모델−시장 = **-9.8%p** (불일치 시 -20.8%p). GBDT 59.2%(로지스틱과 동률). ROI 전부 음수.
> - **★ 음성지식 확정:** earnings 누수→클래스→진짜as-of(API156) 순서로 정화했으나 수득상금 차원 자체가 예측력 없음. 재설계 "+5.2%p"는 전부 earnings 미래누수였음 — 1b·1a로 이중 확인.
> - **DB 상태:** 마이그012(model_type/artifact)·013(rk_purse/erng_sump_asof) 적용 완료. erng_sump_asof 38,627행 채워짐. 학습행렬 37,992행(`data/training_matrix.jsonl`) 재추출 완료.
> - **sync 버그 수정:** raceCardSync·dailySync에서 hrName 없는 API 항목 스킵 처리 (main 커밋 05342f8).
> - **다음 결정 (3択):**
>   - A) **B3 승격** — `npm run learn:logistic -- --label v4-logit` → `verify:logistic` → `promote`. 시장 못 이기지만 v1보다 나음(노이즈 범위, 방향은 맞음).
>   - B) **복연승 백테스트** — API160 복구됨. `npm run collect:combo -- --from 20250101` → `npm run backtest:combo -- --split 20250101`. ROI 양수 구간 있으면 Stage2 value 화폐화.
>   - C) **새 항목/신호 탐색** — 시장 격차 -9.8%p 좁히기. ⑧ 부담중량 산식(ρ=0.316) 또는 신규 항목.
> - 상세: 메모리 [[project-score-learning-redesign]] · [[reference-earnings-asof-leak]]
>
> **2026-06-03 — ⑳ 속도능력지수 신규 + 시장 벤치마크** (브랜치 `feat/speed-figure`, 미승격)
> - **시장 벤치마크 발견:** 모델이 인기1위(win_odds 최저)에 연승 11%p 뒤지고, 엇갈릴 때 22%p 더 틀림(부가가치 음). `walkforward_eval`에 시장·불일치·순위별·묶음 비교 추가. (용어: "1순위 3착내"=**연승**, 복승 아님 → `docs/score_items/20_speed_figure.md` §0)
> - **⑳ 속도능력지수**(par-time 절대 능력지수, `20_speed_figure`) 추가 → ρ=0.271(정직 4위). 후보 v3: 연승 57.7→61.2(+3.6%p, 6분기 전부 우세), **시장 격차 -11.1→-7.5%p**, 3순위는 시장 추월. **append-only**(v1 weight 0이라 backfill이 기존 점수 불변).
> - 도구: `npm run walkforward -- --candidate 3`(검증), `scripts/probe_speed_figure.ts`(분포), `backfill_speed_figure.ts`(키-추가). 상세: `docs/superpowers/specs/2026-06-03-speed-figure-design.md` + 메모리 [[project-market-benchmark]]·[[project-speed-figure]].
> - **다음 결정:** v3 승격 여부(사람 판단). 미완: 함수율·날씨 보정, ⑲ 재설계, 더 강한 항목 탐색.
>
> **2026-06-02 — 가중치 버전관리 도입 + 치팅 누수 수정 완료** (main 배포)
> - ⑤⑥⑫⑲가 전역 뷰로 "예측 대상 경주 결과"까지 평균에 넣던 **look-ahead 누수** 수정(`src/engine/asOfHorseStats.ts`, as-of 재계산). **옛 적중률(단32.5/연52.8/복65.9)은 누수 포함 거짓** — 정직값 복승 ~58%.
> - 라이브 예측은 코드 상수가 아니라 **`model_versions` 활성행 가중치** 사용, predictions에 `model_version` 도장(결과 확정 후 동결). v1=기준선(활성)·v2=2024학습 후보.
> - 도구: `npm run walkforward`(검증)·`learn:candidate`(후보)·`promote`(승격)·`build:rho-history`(ρ이력). **`npm run backfill`(전체)는 과거 동결 무시 덮어쓰기 주의.**
> - 상세·다음단계(미완: v2 승격, Stage C Phase 2b, 새 항목): 메모리 [[weight-versioning-design]] + `~/.claude/plans/reflective-honking-brooks.md`

항목별 상태(완료/진행/ρ 값/개선 후보)는 아래 문서가 **단일 출처(SSOT)**입니다. 여기에 중복 기재하지 않습니다.

- **할일·우선순위** → [TODO.md](TODO.md) (P0~P3 + 런치 게이팅 + 의문 Q)
- **21항목 ρ·가중치·개선 상태** → [docs/score_roadmap.md](docs/score_roadmap.md) (Living Doc, §1 마스터 상태표)
- **의문·검토 중** → [docs/troubleshooting.md](docs/troubleshooting.md)

> 현재 최우선 개선 후보: ⑧ 부담중량 산식(ρ=0.316, 자문 대기) · ⑲ 스코어맵 재설계(한국 실측 역전). 상세는 위 문서 참조.

---

## DB 현황 (2026-05-30 기준)

| 테이블/뷰 | rows |
|---|---|
| race_entries | 37,453 |
| races | 3,585 |
| predictions | 38,517 |
| training_logs | 6,540 |
| jockey_stats | 59 (서울 34·부경 25) |
| horses | 2,864 (모두 혈통 있음) |

서울 구간기록 backfill: 2024 100% / 2025 97.3% / 2026 97.9% (부경 99.9%) — 에러 ~3%는 KRA 원천 없음

**race_entries 구간 컬럼 현황 (2026-05-30):**
- 서울: 누적시간(se_s1f/g1f/g3f/1c~4c) + 순위(sj_s1f/g1f/g3f/1c~4c) ✅
- 부경: 누적시간(bu_s1f/g1f~g8f) + 순위(bu_g1f~g4f/s1f) + **개별 구간 타임(bu_s1f_time/bu_1fg~bu_10_8f_time) ✅ 신규**
- 부경 G5f·G6f·G7f·G8f 순위: KRA API 미제공 (구조적 공백)
