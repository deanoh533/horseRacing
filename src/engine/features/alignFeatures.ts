import type { Feature } from './types.js';

/** 모든 행의 feature 이름 합집합(정렬). */
export function buildSchema(rows: Feature[][]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const f of r) set.add(f.name);
  return [...set].sort();
}

/** 한 행을 스키마 순서의 숫자 벡터로. 없으면 0. */
export function toVector(row: Feature[], schema: string[]): number[] {
  const m = new Map(row.map((f) => [f.name, f.value]));
  return schema.map((name) => m.get(name) ?? 0);
}
