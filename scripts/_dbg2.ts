import { DuckDBInstance } from '@duckdb/node-api';
const inst = await DuckDBInstance.create('data/local.duckdb');
const conn = await inst.connect();
const res = await conn.runAndReadAll(
  "SELECT id, CAST(artifact AS JSON) as artifact_json FROM model_versions WHERE is_active = true LIMIT 1"
);
const rows = res.getRowObjects();
const row = rows[0] as any;
const parsed = JSON.parse(row.artifact_json);
console.log('keys:', Object.keys(parsed));
console.log('features:', JSON.stringify(parsed.features)?.slice(0, 100));
console.log('coef keys count:', Object.keys(parsed.coef ?? {}).length);
