/**
 * 경마장 묶음 — `meet`은 **개최지**다(말의 소속이 아니다).
 *
 * 1=서울 · 3=부산경남 · 4=영천(2026-09-13 개장).
 * 영천은 "권역형 순회경마" — 부경 상주마·기수가 매주 일요일 이동해 경주한다.
 * 그래서 **부경과 영천은 같은 말·기수 풀**이고, 기수 성적처럼 사람 단위로 묶는
 * 통계는 둘을 합쳐야 한다. 나누면 같은 기수가 금(부경)·일(영천)로 갈려 양쪽 다
 * 표본이 모자란다.
 *
 * ⚠️ 서버 쪽 정본은 `src/types/index.ts`의 `YEONGNAM_MEETS`다. 클라이언트 tsconfig가
 * `client/src`만 포함해 import를 못 해서 규칙만 옮겨 적었다 — 한쪽을 고치면 다른 쪽도 고칠 것.
 *
 * 말 단위 집계는 이 함수가 필요 없다. `horse_sectional_ability` 등은 `hr_name`으로만
 * 묶어서 경마장을 아예 안 본다(실측: 서울·부경 양쪽 출전 말 267마리가 이미 합산 중).
 */
/**
 * 화면에 쓰는 경마장 이름 — 여기가 단일 출처다.
 * 2026-09-22까지 화면 5곳에 따로 복사돼 있어서 영천을 추가하려면 5곳을 다 고쳐야 했다.
 */
export const MEET_NAMES: Record<number, string> = { 1: '서울', 3: '부경', 4: '영천' };

/** 경주 목록을 경마장별로 묶을 때 쓰는 빈 틀 (표시 순서 = 코드 순서) */
export const MEET_CODES: readonly number[] = [1, 3, 4];

export function meetGroup(meet: number): number[] {
  return meet === 3 || meet === 4 ? [3, 4] : [meet];
}

/**
 * `jockey_stats`(KRA 자체 통산)를 볼 때 쓸 meet.
 *
 * 이 테이블은 우리가 집계한 게 아니라 KRA가 **소속 본부**별로 내려주는 통산 성적이다.
 * 영천은 개최지일 뿐 기수 소속이 아니라서 meet=4 행이 아예 없다 → 부경 행을 본다.
 * (`meetGroup`처럼 둘을 합치면 안 된다 — 같은 기수의 통산이 두 행으로 잡혀 하나가 덮인다.)
 */
export function jockeyStatsMeet(meet: number): number {
  return meet === 4 ? 3 : meet;
}
