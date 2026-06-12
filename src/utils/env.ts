/**
 * 환경 변수 로딩 & 검증
 */
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // KRA API
  KRA_API_KEY: z.string().min(1, 'KRA_API_KEY 필수'),

  // Supabase
  SUPABASE_URL: z.string().url('SUPABASE_URL은 유효한 URL이어야 함'),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1).optional(),

  // Claude API
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-', 'Anthropic API 키는 sk-ant-로 시작'),
  ANTHROPIC_MONTHLY_LIMIT: z.coerce.number().default(5),
  ANTHROPIC_DAILY_LIMIT: z.coerce.number().default(0.2),

  // 앱
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // 동기화
  SYNC_CRON_SCHEDULE: z.string().default('0 3 * * *'),
  BACKTEST_DAYS: z.coerce.number().default(730),

  // DuckDB 로컬 미러
  DB_SOURCE: z.enum(['local', 'supabase']).default('supabase'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ 환경 변수 검증 실패:');
    console.error(result.error.format());
    throw new Error('환경 변수 검증 실패 - .env 파일 확인 필요');
  }

  cachedEnv = result.data;
  return cachedEnv;
}
