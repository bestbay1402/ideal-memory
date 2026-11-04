import 'server-only';

/** 인증 REST 요청만 같은 출처의 게임 서버를 거칩니다. 서비스 역할 키는 사용하지 않습니다. */
type GatewayEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  VERCEL?: string;
};
type GatewayOptions = {
  env?: GatewayEnvironment;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};
const MAX_BODY_BYTES = 8192;
const METHODS: Record<string, readonly string[]> = {
  signup: ['POST'], token: ['POST'], logout: ['POST'], user: ['GET', 'PUT'],
  recover: ['POST'], resend: ['POST'], verify: ['POST'], settings: ['GET'],
};
const QUERY_KEYS: Record<string, readonly string[]> = {
  signup: ['redirect_to'], token: ['grant_type'], logout: ['scope'],
  recover: ['redirect_to'], resend: ['redirect_to'], verify: [], user: [], settings: [],
};
const HEADERS = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', 'Content-Type': 'application/json' };

function failure(status: number, error_code: string, msg: string, extraHeaders?: HeadersInit) {
  return Response.json({ error_code, msg }, { status, headers: { ...HEADERS, ...extraHeaders } });
}
function config(env: GatewayEnvironment): { origin: string; key: string } | null {
  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!rawUrl || !key) return null;
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/i.test(url.hostname)
    || url.username || url.password || url.port || url.search || url.hash || !/^\/*$/.test(url.pathname)) return null;
  if (/\s/.test(key) || key.startsWith('sb_secret_')) return null;
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
      if (payload.role !== 'anon' || (typeof payload.ref === 'string' && payload.ref !== url.hostname.split('.')[0])) return null;
    } catch { return null; }
  } else if (!key.startsWith('sb_publishable_')) return null;
  return { origin: url.origin, key };
}
async function readLimitedBody(request: Request): Promise<string | null> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

/** 인스턴스별 보조 제한입니다. Supabase의 인증/이메일/CAPTCHA 제한을 그대로 유지합니다. */
export function createAuthGateway(options: GatewayOptions = {}) {
  const buckets = new Map<string, { start: number; count: number }>();
  const now = options.now ?? Date.now;
  let globalStart = 0, globalCount = 0;
  return async (request: Request): Promise<Response> => {
    const env = options.env ?? {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      VERCEL: process.env.VERCEL,
    };
    const incoming = new URL(request.url);
    const endpoint = /^\/api\/auth\/([a-z]+)$/.exec(incoming.pathname)?.[1];
    if (!endpoint || !Object.hasOwn(METHODS, endpoint)) return failure(404, 'auth_route_missing', '지원하지 않는 인증 요청입니다.');
    if (!METHODS[endpoint].includes(request.method)) return failure(405, 'auth_method_invalid', '지원하지 않는 인증 요청 방식입니다.');
    const origin = request.headers.get('origin');
    if ((origin && origin !== incoming.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return failure(403, 'auth_origin_invalid', '게임 페이지에서 다시 로그인해주세요.');
    }
    const upstream = config(env);
    if (!upstream) return failure(503, 'auth_configuration_invalid', '로그인 서버 연결 설정을 확인해야 합니다. 게임의 연결 확인 페이지에서 결과를 확인해주세요.');
    const params = new URLSearchParams();
    for (const [key, value] of incoming.searchParams) {
      if (!QUERY_KEYS[endpoint].includes(key) || params.has(key) || value.length > 2048) {
        return failure(400, 'auth_query_invalid', '올바르지 않은 인증 요청입니다.');
      }
      if (key === 'grant_type' && !['password', 'refresh_token', 'pkce', 'id_token'].includes(value)) return failure(400, 'auth_query_invalid', '지원하지 않는 인증 방식입니다.');
      if (key === 'scope' && !['global', 'local', 'others'].includes(value)) return failure(400, 'auth_query_invalid', '올바르지 않은 로그아웃 요청입니다.');
      if (key === 'redirect_to') {
        try {
          const redirect = new URL(value);
          if (redirect.origin !== incoming.origin || redirect.username || redirect.password) throw new Error();
        } catch { return failure(400, 'auth_redirect_invalid', '게임 주소로만 로그인 확인을 연결할 수 있습니다.'); }
      }
      params.set(key, value);
    }
    const stamp = now();
    // Vercel이 덮어쓰는 전용 헤더만 사용합니다. 일반 X-Forwarded-For는 신뢰하지 않습니다.
    const address = env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim().slice(0,64) ?? 'shared' : 'shared';
    if (stamp - globalStart >= 60_000) { globalStart = stamp; globalCount = 0; }
    const previous = buckets.get(address);
    const bucket = previous && stamp - previous.start < 60_000 ? previous : { start: stamp, count: 0 };
    // 공유 IP의 친구 4명과 토큰 갱신을 허용하되 과도한 요청은 제한합니다.
    if (bucket.count >= 40 || globalCount >= 180) return failure(429, 'over_request_rate_limit', '로그인 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', { 'Retry-After': '60' });
    bucket.count++; globalCount++; buckets.set(address, bucket);
    if (buckets.size > 2048) {
      for (const [key, entry] of buckets) if (stamp - entry.start >= 60_000) buckets.delete(key);
      if (buckets.size > 2048) buckets.delete(buckets.keys().next().value!);
    }
    const headers = new Headers({ apikey: upstream.key, 'Content-Type': 'application/json' });
    const bearer = request.headers.get('authorization');
    if (bearer && (!/^Bearer [A-Za-z0-9_.~-]+$/.test(bearer) || bearer.length > 8192)) return failure(400, 'auth_token_invalid', '로그인 정보 형식이 올바르지 않습니다.');
    // 가입/토큰 발급은 공개 키만 사용하고, 사용자 확인/변경/로그아웃만 세션 토큰을 전달합니다.
    if (['user', 'logout'].includes(endpoint) && bearer) headers.set('Authorization', bearer);
    else if (upstream.key.split('.').length === 3) headers.set('Authorization', `Bearer ${upstream.key}`);
    const apiVersion = request.headers.get('x-supabase-api-version');
    if (apiVersion && /^\d{4}-\d{2}-\d{2}$/.test(apiVersion)) headers.set('x-supabase-api-version', apiVersion);
    let body: string | undefined;
    if (request.method !== 'GET') {
      if (request.body && !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return failure(415, 'auth_content_type_invalid', '인증 요청 형식이 올바르지 않습니다.');
      try {
        const raw = await readLimitedBody(request);
        if (raw === null) return failure(413, 'auth_body_too_large', '인증 요청이 너무 큽니다.');
        if (raw) {
          const value = JSON.parse(raw);
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          body = raw;
        }
      } catch { return failure(400, 'auth_json_invalid', '인증 요청 내용을 읽을 수 없습니다.'); }
    }
    const target = new URL(`/auth/v1/${endpoint}`, upstream.origin);
    target.search = params.toString();
    try {
      const response = await (options.fetcher ?? fetch)(target, {
        method: request.method, headers, body, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(Math.min(8000, options.timeoutMs ?? 8000)),
      });
      if (response.status === 204) return new Response(null, { status: 204, headers: HEADERS });
      // CDN 장애 HTML/리다이렉트는 SDK에 토큰 응답으로 전달하지 않습니다.
      if (!response.headers.get('content-type')?.includes('application/json')) {
        return failure(503, 'auth_upstream_unavailable', '로그인 서버가 정상적으로 응답하지 않습니다. 연결 확인 페이지에서 상태를 확인해주세요.');
      }
      const result = await response.text();
      const responseHeaders = new Headers(HEADERS);
      const version = response.headers.get('x-supabase-api-version');
      if (version && /^\d{4}-\d{2}-\d{2}$/.test(version)) responseHeaders.set('x-supabase-api-version', version);
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter && /^\d{1,5}$/.test(retryAfter)) responseHeaders.set('retry-after', retryAfter);
      return new Response(result, { status: response.status, headers: responseHeaders });
    } catch {
      return failure(503, 'auth_connection_unavailable', '게임 서버에서 계정 서버에 연결하지 못했습니다. 연결 확인 페이지를 열어주세요.');
    }
  };
}

export const handleAuthGateway = createAuthGateway();
