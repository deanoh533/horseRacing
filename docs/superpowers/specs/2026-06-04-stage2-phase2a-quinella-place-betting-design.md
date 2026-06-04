# Stage 2 Phase 2A — 복연승(QPL) value 백테스트 설계

> 작성: 2026-06-04 | 상태: 설계 승인됨, 구현 계획 대기
> 브랜치: `feat/score-learning-redesign`
> 관련: [[project-score-learning-redesign]] · [[reference-kra-dividend-api]] · `2026-06-04-stage2-phase1-value-betting-design.md`(Phase 1)

---

## 0. 한 줄 요약

Phase 1에서 "단순 연승은 takeout 못 넘음(게이트 음성)이나 모델 입상 선별력은 실재(takeout 대부분 회수)"로 확인됐다. 모델 강점("top3 집합 선별")을 **복연승(QPL: 2마리 모두 입상)** 으로 화폐화하면 ROI가 양수인지 검증한다. 사전 고정한 3개 선정규칙을 동시 백테스트해 다분기 일관성으로 판정.

---

## 1. 배경

- Phase 1: 중배당×모델상위터셀 연승 ROI 4-7 −4.5%(베이스라인 −17.1%). 그로스 엣지 ~+11%p이나 연승 takeout(~16%) 못 넘음.
- 복연승은 2마리 조합 → 배당이 커서, 같은 선별력이 **순수익으로 증폭**될 가능성. 모델은 P(top3)를 잘 매기므로 "둘 다 입상" 베팅과 정합.
- **데이터 확보(2026-06-04 probe):** `API160_1/integratedInfo_1`이 _모든 조합_의 복연승 확정배당을 과거치까지 제공. → 데이터 갭 0. 상세 [[reference-kra-dividend-api]].

---

## 2. 베팅 규칙 (사전 고정 3개)

각 경주에서 모델 P(top3)로 말을 점수화한 뒤:

| 규칙 | 정의 | 경주당 베팅수 |
|---|---|---|
| **R1 상위2픽** | 모델 점수 **상위 2마리** 1조합 | 1 |
| **R2 중배당가치** | 모델 **1픽** × {중배당(4-15) AND 상위터셀(train 컷오프)} 말 각각 | 0~여러 |
| **R3 상위터셀페어** | {중배당 AND 상위터셀} 말들의 **모든 2조합** | 0~여러 |

- "상위터셀" = Phase 1과 동일 정의: 각 win_odds 배당구간에서 **train 데이터로 정한 상위 1/3 컷오프**(`topTercileCutoffs`) 이상. 중배당 = 배당구간 `4-7`·`7-15`.
- R2의 "모델 1픽"은 그 경주 최고 점수 말. R2/R3에서 같은 조합 중복 시 1회로.

## 3. 정산

- 조합 (A,B): **A와 B 둘 다 입상**이면 win. 입상 판정 = `placePaid(ord, 출주두수)`(Phase 1 헬퍼 재사용; KRA 연승권: 8두↑ 3착내 / 5~7두 2착내 / 4두↓ 미발매·제외).
- payout = 해당 경주 **복연승 odds[(A,B)]** (조합은 무순 → `min,max` 정규화 키로 조회). 미입상 = 손실.
- flat 1000원. **ROI = Σ payout / 베팅수 − 1** (payout = win 시 odds, else 0). 규칙별·분기별 집계.
- **베이스라인:** 같은 후보 풀에서 무작정 조합(또는 전 마필 2조합)도 동시 출력해 모델 기여 비교.

## 4. 데이터·구현

- **배당 수집:** `scripts/collect_combo_dividends.ts` — test 기간(`rc_date >= split`) 경주별 `API160_1/integratedInfo_1` 호출, `pool=='복연승식'` 행만 추출 → `data/combo_dividends.jsonl`에 `{race_date,meet,rc_no,a,b,odds}` 저장(`a=min(chulNo,chulNo2)`, `b=max`). 페이지네이션(1397행/경주 → numOfRows 충분히), pLimit rate-limit. `meet` 파라미터=1/3, 응답 `meet`는 한글이므로 요청키로 매핑.
- **조인 키:** 행렬은 `hr_name`, 배당은 `chulNo`(=마번=`pthr_no`). race_entries에서 `(hr_name→pthr_no)` 매핑 로드(백테스트가 이미 race_entries 로드 중 → `pthr_no` select 추가).
- **모델 점수:** 행렬(`training_matrix.jsonl`) + Stage-1 로지스틱(`fitLogistic`/`predictLogit`), train<split 학습. Phase 0/1과 동일.
- **순수 헬퍼:** `src/engine/analysis/comboBacktest.ts` — 3 선정규칙 + 조합키 정규화 + 정산. 단위 테스트.
- **백테스트:** `scripts/backtest_combo_betting.ts` — 위를 조립, 규칙별/분기별 ROI 출력. 읽기 전용.
- 재사용: `topTercileCutoffs`·`isBet`·`placePaid`·`roi`(valueBacktest.ts), `oddsBand`(edgeProbe.ts).

## 5. 출력 & 게이트

규칙별 표:
```
규칙       | 베팅수 | 적중 | 적중율 | 평균배당 | ROI    | 분기일관성
R1 상위2픽 |  ...   | ...  |  ...  |   ...    | +X.X%  | n/m 양수
R2 중배당  | ...
R3 터셀페어| ...
베이스라인 | ...
```
+ 규칙별 분기 ROI 표.

- ✅ **양성:** 어떤 규칙이 ROI>0 + 다분기 일관(≈5/6↑) + 베팅수 충분 → 화폐화 성공 → **Phase 2B**(라이브 추천 UI: 예상지 복연승 추천).
- ❌ **음성:** 전 규칙 ROI≤0 또는 분기 들쭉날쭉 → 복연승으로도 화폐화 실패. value 트랙 재고(다른 승식 탐색 or 보류).

## 6. ⚠️ 정직성 장치

- **다중검정:** 규칙 3개 §2로 **사전 고정**, 즉흥 추가 금지. 판정은 다분기 일관성 + 베팅수로만. 단일 분기 큰 ROI=노이즈.
- **확정배당 근사:** 복연승 odds는 사후 확정 final → 베팅 시점 실제와 다를 수 있음. ROI는 **낙관적 상한**.
- **거래비용:** 복연승 배당은 KRA 공제율 반영된 순배당 → 별도 차감 불필요.
- **표본 경고:** 규칙×분기로 쪼개면 셀 작아짐. 베팅수 적은 셀 참고만.
- **look-ahead 없음:** 모델 train<split, 컷오프 train, 테스트 split~. 배당은 경주별 확정값.

## 7. 범위

- **본 Phase 2A:** 수집 스크립트 + 순수 헬퍼(테스트) + 백테스트 + 규칙별/분기별 출력. **복연승만**(복승·삼복은 미포함; 양성 시 확장 검토).
- **분리(별도, 양성 시):** Phase 2B = 라이브 복연승 추천 UI + calibration/스테이킹.
- **무관:** B3(Stage-1 프로덕션화) 독립 병렬 트랙.
