import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 공개 환경변수는 빌드 시점에 고정됩니다. 서버 비밀 키는 이 모듈에서 읽지 않습니다.
const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
export const onlineConfigured = Boolean(publicUrl && publicKey);
export function getAuthConfigurationError(): string | null {
  if (!publicUrl || !publicKey) return '온라인 계정 연결 설정이 아직 완료되지 않았습니다.';
  try {
    const url = new URL(publicUrl);
    if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/i.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash || !/^\/*$/.test(url.pathname)) throw new Error();
    if (/\s/.test(publicKey) || publicKey.startsWith('sb_secret_')) throw new Error();
    if (publicKey.split('.').length === 3) {
      const encoded = publicKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(encoded));
      if (payload.role !== 'anon' || (payload.ref && payload.ref !== url.hostname.split('.')[0])) throw new Error();
    } else if (!publicKey.startsWith('sb_publishable_')) throw new Error();
    return null;
  } catch { return '온라인 연결 주소 또는 공개 키 설정을 확인해야 합니다. 연결 확인 페이지를 열어주세요.'; }
}

/** 브라우저 인증 요청만 같은 출처로 보냅니다. DB/Realtime 및 다른 URL은 수정하지 않습니다. */
export function createAuthGatewayFetch(supabaseUrl: string, fetcher: typeof fetch = (...args) => globalThis.fetch(...args)): typeof fetch {
  const origin = new URL(supabaseUrl).origin;
  return async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try { url = new URL(rawUrl); } catch { return fetcher(input, init); }
    if (url.origin !== origin || !url.pathname.startsWith('/auth/v1/')) return fetcher(input, init);
    const target = `/api/auth/${url.pathname.slice('/auth/v1/'.length)}${url.search}`;
    if (input instanceof Request) {
      // SDK는 현재 URL 문자열을 사용하지만 Request 입력도 본문과 헤더를 보존합니다.
      const request = new Request(input, init);
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
      return fetcher(target, { method: request.method, headers: request.headers, body, signal: request.signal, cache: 'no-store' });
    }
    return fetcher(target, { ...init, cache: 'no-store' });
  };
}

let authClient: SupabaseClient | null = null;
export function getAuthClient(): SupabaseClient | null {
  if (getAuthConfigurationError()) return null;
  if (!authClient) {
    authClient = createClient(new URL(publicUrl).origin, publicKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: createAuthGatewayFetch(publicUrl) },
    });
  }
  return authClient;
}
