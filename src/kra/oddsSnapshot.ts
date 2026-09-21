/**
 * 조합배당 스냅샷 비교 — "경주 전 배당이 실시간으로 움직이나"를 판정한다 (TODO O-005).
 *
 * 배경: 2026-08-23에 API160_1이 아직 시행 안 된 경주에도 조합배당을 내려줬다.
 * 그게 발매 중 실시간 배당이면 [[project_odds_blend_candidate]]가 "라이브 배당 API 없음"으로
 * 보류한 전제가 깨진다(검증 당시 연승 +7~11.5%p 양성). 확정배당을 미리 노출한 것뿐이면 트랙 종결.
 *
 * 판정 방법은 하나뿐이다: 같은 경주를 발주 전 여러 시각에 불러 값이 바뀌는지 본다.
 * 이 모듈은 순수 비교 로직만 담고, KRA 호출·파일 저장은 scripts/probe_live_odds.ts가 한다.
 */
import type { KRAComboDividend } from './client.js';

/** 한 경주를 한 시각에 부른 결과 */
export interface OddsSnapshot {
  /** 호출 시각 ISO 문자열 (KST 오프셋 포함) */
  capturedAt: string;
  raceDate: number;
  meet: number;
  rcNo: number;
  items: KRAComboDividend[];
}

export interface PoolSummary {
  pool: string;
  count: number;
  minOdds: number;
  maxOdds: number;
}

export interface PoolDiff {
  pool: string;
  /** 뒤 스냅샷에만 있는 조합 수 — 발매가 진행되며 조합이 채워지는 신호 */
  added: number;
  /** 앞 스냅샷에만 있는 조합 수 */
  removed: number;
  /** 양쪽에 있는데 배당이 달라진 조합 수 */
  changed: number;
  /** 양쪽에 있고 배당도 같은 조합 수 */
  unchanged: number;
  /** 바뀐 조합 예시 (최대 5건) */
  samples: { combo: string; from: number; to: number }[];
}

const MAX_SAMPLES = 5;

/**
 * 조합 식별자. 3마리 조합(삼복승·삼쌍승)은 chulNo3까지 봐야 구분된다.
 * 순서가 의미 있는 pool(쌍승식)도 있으므로 정렬하지 않고 KRA가 준 순서 그대로 쓴다.
 */
function comboKey(it: KRAComboDividend): string {
  return it.chulNo3 ? `${it.chulNo}-${it.chulNo2}-${it.chulNo3}` : `${it.chulNo}-${it.chulNo2}`;
}

/** pool → (조합키 → 배당). 같은 키가 중복으로 오면 마지막 값을 쓴다. */
function indexByPool(items: KRAComboDividend[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const it of items) {
    let pool = out.get(it.pool);
    if (!pool) {
      pool = new Map();
      out.set(it.pool, pool);
    }
    pool.set(comboKey(it), it.odds);
  }
  return out;
}

/** pool별 건수·배당 범위 요약 (건수 많은 순) */
export function summarizePools(items: KRAComboDividend[]): PoolSummary[] {
  const byPool = new Map<string, number[]>();
  for (const it of items) {
    const arr = byPool.get(it.pool);
    if (arr) arr.push(it.odds);
    else byPool.set(it.pool, [it.odds]);
  }

  return [...byPool.entries()]
    .map(([pool, odds]) => ({
      pool,
      count: odds.length,
      minOdds: Math.min(...odds),
      maxOdds: Math.max(...odds),
    }))
    .sort((a, b) => b.count - a.count || a.pool.localeCompare(b.pool));
}

/** 두 스냅샷을 pool별로 비교한다 (한쪽에만 있는 pool도 낸다) */
export function diffSnapshots(prev: OddsSnapshot, next: OddsSnapshot): PoolDiff[] {
  const before = indexByPool(prev.items);
  const after = indexByPool(next.items);
  const pools = [...new Set([...before.keys(), ...after.keys()])].sort();

  return pools.map((pool) => {
    const b = before.get(pool) ?? new Map<string, number>();
    const a = after.get(pool) ?? new Map<string, number>();
    const diff: PoolDiff = { pool, added: 0, removed: 0, changed: 0, unchanged: 0, samples: [] };

    for (const [combo, from] of b) {
      const to = a.get(combo);
      if (to === undefined) {
        diff.removed++;
      } else if (to === from) {
        diff.unchanged++;
      } else {
        diff.changed++;
        if (diff.samples.length < MAX_SAMPLES) diff.samples.push({ combo, from, to });
      }
    }
    for (const combo of a.keys()) {
      if (!b.has(combo)) diff.added++;
    }
    return diff;
  });
}

/**
 * 배당이 "움직였나" 판정.
 * 조합이 늘어난 것(added)도 움직임으로 본다 — 발매가 진행되며 값이 채워지는 신호이기 때문.
 * 조합이 줄기만 한 것(removed)은 응답 누락일 수 있어 근거로 삼지 않는다.
 */
export function hasMovement(diffs: PoolDiff[]): boolean {
  return diffs.some((d) => d.changed > 0 || d.added > 0);
}
