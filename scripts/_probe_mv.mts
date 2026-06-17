import { DuckDBInstance } from '@duckdb/node-api';
const inst = await DuckDBInstance.create('data/local.duckdb');
const conn = await inst.connect();
async function q(sql: string): Promise<any[]> { const r = await conn.run(sql); return await r.getRowObjects(); }
const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='model_versions' ORDER BY ordinal_position`);
console.log('model_versions 컬럼:', cols.map((c:any)=>c.column_name).join(', '));
const active = await q(`SELECT id, label, model_type, is_active FROM model_versions WHERE is_active`);
console.log('활성 버전:', JSON.stringify(active));
