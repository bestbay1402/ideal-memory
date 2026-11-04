import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 이 두 공개 키만 브라우저로 전달됩니다. 서비스 역할 키는 서버에서만 사용합니다.
export const onlineConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
let authClient: SupabaseClient | null = null;
export function getAuthClient(): SupabaseClient | null {
  if (!onlineConfigured) return null;
  if (!authClient) {
    authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
    );
  }
  return authClient;
}
