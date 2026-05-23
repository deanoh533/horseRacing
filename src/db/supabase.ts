/**
 * Supabase 클라이언트
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '@utils/env.js';

let _client: SupabaseClient | null = null;
let _adminClient: SupabaseClient | null = null;

/**
 * 일반 클라이언트 (anon key, RLS 적용)
 */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const env = getEnv();
  _client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
    },
  });
  return _client;
}

/**
 * 관리자 클라이언트 (service_role, RLS 우회)
 * → 서버 사이드 동기화 작업용
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient;
  const env = getEnv();
  _adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
    },
  });
  return _adminClient;
}
