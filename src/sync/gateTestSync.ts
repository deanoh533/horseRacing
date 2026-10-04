/**
 * 주행심사 수집 — 백필(날짜 훑기)과 최근분(목록 기반). I/O는 주입.
 * 스펙 docs/superpowers/specs/2026-10-05-gate-test-collection-design.md §4~6
 */
import { parseGateRound, parseGateList, type GateClient, type GateListEntry, type GateTestRow } from '../kra/gateTest.js';

export interface GateStore {
  /** 저장된 말 행 1개당 요소 1개(회차 단위 아님) — 최근분의 편성두수 비교가 이 개수에 의존한다. */
  existing(from: number, to: number): Promise<Array<{ test_date: number; meet: number; trno: number }>>;
  upsert(rows: GateTestRow[]): Promise<void>;
}

export interface GateSyncReport { rounds: number; rows: number; skippedRows: number; failures: string[]; shortfalls: string[]; }

export const MAX_TRNO = 20;
const DEFAULT_MEETS = [1, 3];

export function eachDate(from: number, to: number): number[] {
  const out: number[] = [];
  const d = new Date(Date.UTC(Math.floor(from / 10000), Math.floor(from / 100) % 100 - 1, from % 100));
  for (;;) {
    const n = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    if (n > to) return out;
    out.push(n);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

const emptyReport = (): GateSyncReport => ({ rounds: 0, rows: 0, skippedRows: 0, failures: [], shortfalls: [] });
const key = (date: number, meet: number, trno: number) => `${date}|${meet}|${trno}`;

/** 한 회차를 받아 저장. 반환: 저장 행 수(0 = 빈 표). 요청 실패는 throw. */
async function fetchAndStore(client: GateClient, store: GateStore, rep: GateSyncReport, meet: number, date: number, trno: number): Promise<number> {
  const { rows, skipped } = parseGateRound(await client.fetchRound(meet, date, trno), meet, date, trno);
  rep.skippedRows += skipped;
  if (rows.length === 0) return 0;
  await store.upsert(rows);
  rep.rounds += 1;
  rep.rows += rows.length;
  return rows.length;
}

export async function backfillGateTests(
  client: GateClient, store: GateStore, from: number, to: number,
  opts: { meets?: number[]; log?: (m: string) => void } = {},
): Promise<GateSyncReport> {
  const log = opts.log ?? (() => {});
  const rep = emptyReport();
  const have = new Set((await store.existing(from, to)).map((r) => key(r.test_date, r.meet, r.trno)));
  for (const meet of opts.meets ?? DEFAULT_MEETS) {
    for (const date of eachDate(from, to)) {
      let got = 0;
      for (let trno = 1; trno <= MAX_TRNO; trno++) {
        if (have.has(key(date, meet, trno))) continue;
        try {
          const n = await fetchAndStore(client, store, rep, meet, date, trno);
          if (n === 0) break;
          got += n;
        } catch {
          rep.failures.push(`m${meet} ${date} 회차${trno}`);
          break;
        }
      }
      if (got) log(`m${meet} ${date}: ${got}두`);
    }
  }
  return rep;
}

export async function syncRecentGateTests(
  client: GateClient, store: GateStore,
  opts: { meets?: number[]; log?: (m: string) => void } = {},
): Promise<GateSyncReport> {
  const log = opts.log ?? (() => {});
  const rep = emptyReport();
  for (const meet of opts.meets ?? DEFAULT_MEETS) {
    let list: GateListEntry[];
    try {
      list = parseGateList(await client.fetchList(meet));
    } catch {
      list = [];
    }
    if (list.length === 0) { rep.failures.push(`목록 m${meet}`); continue; }
    const dates = list.map((e) => e.date);
    const rows = (await store.existing(Math.min(...dates), Math.max(...dates))).filter((r) => r.meet === meet);
    const have = new Set(rows.map((r) => key(r.test_date, meet, r.trno)));
    const perDate = new Map<number, number>();
    for (const r of rows) perDate.set(r.test_date, (perDate.get(r.test_date) ?? 0) + 1);
    for (const e of list) {
      for (const trno of e.trnos) {
        if (have.has(key(e.date, meet, trno))) continue;
        try {
          const n = await fetchAndStore(client, store, rep, meet, e.date, trno);
          perDate.set(e.date, (perDate.get(e.date) ?? 0) + n);
          if (n) log(`m${meet} ${e.date} 회차${trno}: ${n}두`);
        } catch {
          rep.failures.push(`m${meet} ${e.date} 회차${trno}`);
        }
      }
      const n = perDate.get(e.date) ?? 0;
      if (n < e.entries) rep.shortfalls.push(`m${meet} ${e.date} 저장 ${n}/편성 ${e.entries}`);
    }
  }
  return rep;
}
