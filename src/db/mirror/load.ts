/**
 * 미러 적재 — 증분 교체와 전량 재작성의 실제 쓰기 부분. spec §5.5.
 *
 * 불변식: **미러의 내용은 항상 `_sync_state`의 지문이 말하는 상태와 일치한다.**
 * 그래서 데이터 교체와 지문 갱신을 한 트랜잭션에 묶는다 — 중간에 끊기면 둘 다 롤백돼
 * 다음 pull이 같은 날짜를 다시 시도한다. 반쯤 반영된 상태가 존재할 수 없다.
 */
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Fingerprint } from './fingerprint.js';
import { deleteFingerprintsSql, writeFingerprintsSql } from './syncState.js';

/** 행을 임시 JSON으로 떨군다. 행이 없으면 null(파일을 안 만든다). */
export function writeRowsJson(table: string, rows: unknown[]): string | null {
  if (rows.length === 0) return null;
  const p = join(tmpdir(), `duckpull_${table}.json`).replace(/\\/g, '/');
  writeFileSync(p, JSON.stringify(rows));
  return p;
}

export function removeTmp(path: string | null): void {
  if (path && existsSync(path)) unlinkSync(path);
}

export async function tableExistsInMirror(conn: any, table: string): Promise<boolean> {
  const r = await conn.runAndReadAll(
    `SELECT count(*) n FROM information_schema.tables WHERE table_name = '${table.replace(/'/g, "''")}'`
  );
  return Number((r.getRowObjects()[0] as { n: bigint | number }).n) > 0;
}

export interface ApplyIncrementalArgs {
  conn: any;
  table: string;
  dateCol: string;
  /** 재적재할 날짜 */
  load: number[];
  /** 미러에서 지울 날짜 (원천에 없음) */
  remove: number[];
  /** load 날짜들의 행이 담긴 임시 JSON. 행이 없으면 null */
  rowsJsonPath: string | null;
  /** load 날짜들의 새 지문 */
  fingerprints: Fingerprint[];
  syncedAtIso: string;
}

/**
 * 바뀐 날짜만 교체한다. 실패하면 롤백하고 **그대로 throw** —
 * 호출부가 전량 폴백을 결정한다(조용히 넘어가지 않는다, spec §8.1).
 */
export async function applyIncremental(args: ApplyIncrementalArgs): Promise<void> {
  const { conn, table, dateCol, load, remove, rowsJsonPath, fingerprints, syncedAtIso } = args;
  const touched = [...load, ...remove];

  await conn.run('BEGIN TRANSACTION');
  try {
    if (touched.length > 0) {
      await conn.run(`DELETE FROM "${table}" WHERE "${dateCol}" IN (${touched.join(', ')})`);
    }
    if (rowsJsonPath) {
      // BY NAME — 컬럼 위치가 아니라 이름으로 맞춘다. 순서가 어긋나도 값이 제자리에 간다.
      await conn.run(`INSERT INTO "${table}" BY NAME SELECT * FROM read_json_auto('${rowsJsonPath}')`);
    }
    if (remove.length > 0) {
      await conn.run(deleteFingerprintsSql(table, remove));
    }
    for (const sql of writeFingerprintsSql(table, fingerprints, syncedAtIso)) {
      await conn.run(sql);
    }
    await conn.run('COMMIT');
  } catch (e) {
    await conn.run('ROLLBACK');
    throw e;
  }
}

/**
 * 전량 재작성 — 기존 db:pull과 같은 방식(DROP + CREATE TABLE AS).
 * 끝나고 지문을 남긴다. `fingerprints`가 비면(REST 폴백) 지문을 건드리지 않는다.
 */
export async function applyFullReload(args: {
  conn: any;
  table: string;
  rowsJsonPath: string | null;
  fingerprints: Fingerprint[];
  syncedAtIso: string;
}): Promise<void> {
  const { conn, table, rowsJsonPath, fingerprints, syncedAtIso } = args;

  await conn.run('BEGIN TRANSACTION');
  try {
    await conn.run(`DROP TABLE IF EXISTS "${table}"`);
    if (rowsJsonPath) {
      await conn.run(`CREATE TABLE "${table}" AS SELECT * FROM read_json_auto('${rowsJsonPath}')`);
    }
    // 이 테이블의 옛 지문은 통째로 무효 — 날짜 목록이 바뀌었을 수 있다.
    if (fingerprints.length > 0) {
      await conn.run(`DELETE FROM _sync_state WHERE table_name = '${table.replace(/'/g, "''")}'`);
      for (const sql of writeFingerprintsSql(table, fingerprints, syncedAtIso)) {
        await conn.run(sql);
      }
    }
    await conn.run('COMMIT');
  } catch (e) {
    await conn.run('ROLLBACK');
    throw e;
  }
}
