/**
 * 미러 안 `_sync_state` — 원천이 준 날짜별 지문을 그대로 보관한다.
 * 다음 pull이 "원천 지금"을 여기 있는 "원천 그때"와 비교한다. spec §5.3.
 */
import type { Fingerprint } from './fingerprint.js';

export const SYNC_STATE_TABLE = '_sync_state';
/** 전량 테이블의 date_key — "마지막 전량 적재 시각" 한 줄만 남긴다 */
export const FULL_TABLE_DATE_KEY = -1;
/** 경마가 금·토·일 중심이라 3일이면 주말 하나를 놓쳤을 때 반드시 경고가 뜬다 */
export const MIRROR_STALE_DAYS = 3;

const esc = (s: string): string => s.replace(/'/g, "''");

/** ISO → DuckDB TIMESTAMP 리터럴 본문 (UTC 기준, tz 표기 제거) */
const tsLiteral = (iso: string): string => esc(iso.replace('T', ' ').replace('Z', ''));

export async function ensureSyncStateTable(conn: any): Promise<void> {
  await conn.run(`CREATE TABLE IF NOT EXISTS ${SYNC_STATE_TABLE} (
    table_name VARCHAR   NOT NULL,
    date_key   BIGINT    NOT NULL,
    row_count  BIGINT    NOT NULL,
    hash       VARCHAR   NOT NULL,
    synced_at  TIMESTAMP NOT NULL,
    PRIMARY KEY (table_name, date_key)
  )`);
}

async function hasSyncState(conn: any): Promise<boolean> {
  const r = await conn.runAndReadAll(
    `SELECT count(*) n FROM information_schema.tables WHERE table_name = '${SYNC_STATE_TABLE}'`
  );
  return Number((r.getRowObjects()[0] as { n: bigint | number }).n) > 0;
}

/** 구 미러(테이블 없음)에서도 터지지 않고 빈 배열을 준다. */
export async function readFingerprints(conn: any, table: string): Promise<Fingerprint[]> {
  if (!(await hasSyncState(conn))) return [];
  const r = await conn.runAndReadAll(
    `SELECT date_key, row_count, hash FROM ${SYNC_STATE_TABLE} ` +
    `WHERE table_name = '${esc(table)}' ORDER BY date_key`
  );
  return (r.getRowObjects() as Array<{ date_key: bigint; row_count: bigint; hash: string }>).map((x) => ({
    dateKey: Number(x.date_key),
    rowCount: Number(x.row_count),
    hash: x.hash,
  }));
}

/** 미러 전체에서 가장 최근 동기화 시각(ISO). 구 미러면 null. */
export async function readLastSyncedAt(conn: any): Promise<string | null> {
  if (!(await hasSyncState(conn))) return null;
  const r = await conn.runAndReadAll(`SELECT max(synced_at) AS m FROM ${SYNC_STATE_TABLE}`);
  const m = (r.getRowObjects()[0] as { m: unknown }).m;
  if (m == null) return null;
  // DuckDBTimestampValue{micros} → ISO (localDb.unwrapDuck과 같은 규칙)
  const micros = (m as { micros?: bigint }).micros;
  if (typeof micros === 'bigint') return new Date(Number(micros / 1000n)).toISOString();
  return String(m);
}

/** 트랜잭션 안에서 순서대로 실행할 SQL들. 지우고 다시 넣는다(멱등). */
export function writeFingerprintsSql(table: string, fps: Fingerprint[], syncedAtIso: string): string[] {
  if (fps.length === 0) return [];
  const values = fps
    .map((f) => `('${esc(table)}', ${f.dateKey}, ${f.rowCount}, '${esc(f.hash)}', TIMESTAMP '${tsLiteral(syncedAtIso)}')`)
    .join(', ');
  return [
    deleteFingerprintsSql(table, fps.map((f) => f.dateKey)),
    `INSERT INTO ${SYNC_STATE_TABLE} (table_name, date_key, row_count, hash, synced_at) VALUES ${values}`,
  ];
}

export function deleteFingerprintsSql(table: string, dateKeys: number[]): string {
  if (dateKeys.length === 0) return 'SELECT 1'; // 아무것도 안 지운다
  return `DELETE FROM ${SYNC_STATE_TABLE} WHERE table_name = '${esc(table)}' ` +
         `AND date_key IN (${dateKeys.join(', ')})`;
}

/** 마지막 동기화로부터 지난 일수(내림). 모르면 null. */
export function mirrorAgeDays(lastSyncedAtIso: string | null, now: Date): number | null {
  if (!lastSyncedAtIso) return null;
  const t = Date.parse(lastSyncedAtIso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/** 임계 초과일 때만 경고 문구. 막지 않는다 — 백테스트는 일부러 과거 미러로 돌린다. */
export function staleWarning(ageDays: number | null, lastSyncedAtIso: string | null): string | null {
  if (ageDays === null || ageDays <= MIRROR_STALE_DAYS) return null;
  const when = lastSyncedAtIso ? lastSyncedAtIso.slice(0, 10) : '알 수 없음';
  return `⚠️ 미러가 ${ageDays}일 묵었습니다 (마지막 db:pull: ${when})\n` +
         '   최신 결과가 필요하면 npm run db:pull 먼저 실행하세요';
}
