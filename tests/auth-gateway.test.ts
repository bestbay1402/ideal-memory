import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createAuthGateway } from '../src/server/auth-gateway';
import { createAuthGatewayFetch } from '../src/lib/supabase';

const PROJECT = 'https://testproject.supabase.co';
const GAME = 'https://game.example';
const jwt = (payload: object) => [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'), Buffer.from(JSON.stringify(payload)).toString('base64url'), 'fixture-signature'].join('.');
const KEY = jwt({ role: 'anon', ref: 'testproject' });
const env = { NEXT_PUBLIC_SUPABASE_URL: PROJECT, NEXT_PUBLIC_SUPABASE_ANON_KEY: KEY };
const response = (body: object, status = 200) => Response.json(body, { status });
const request = (path = 'signup', body: unknown = { email: 'test@example.com', password: 'test-password' }, extras: RequestInit = {}) => new Request(`${GAME}/api/auth/${path}`, {
  method: 'POST', headers: { origin: GAME, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...extras,
});

describe('same-origin auth gateway security and forwarding', () => {
  it('forwards signup only to configured auth host with public key, preserving captcha payload', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ id: 'new-user' }));
    const gateway = createAuthGateway({ env: { ...env, NEXT_PUBLIC_SUPABASE_URL: ` ${PROJECT}/ ` }, fetcher });
    const body = { email: 'test@example.com', password: 'test-password', gotrue_meta_security: { captcha_token: 'captcha-fixture' } };
    const result = await gateway(request('signup', body, { headers: {
      origin: GAME, 'Content-Type': 'application/json', apikey: 'untrusted-override',
      Authorization: 'Bearer forged-token', Cookie: 'private=cookie', 'x-forwarded-for': 'forged-address',
    } }));
    expect(result.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`${PROJECT}/auth/v1/signup`);
    expect(JSON.parse(init!.body as string)).toEqual(body);
    const headers = new Headers(init!.headers);
    expect(headers.get('apikey')).toBe(KEY);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('x-forwarded-for')).toBe(false);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(init!.redirect).toBe('error');
  });
  it('supports publishable public keys without sending a non-JWT bearer key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ id: 'new-user' }));
    const gateway = createAuthGateway({ env: { ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_testfixture' }, fetcher });
    expect((await gateway(request())).status).toBe(200);
    const headers = new Headers(fetcher.mock.calls[0][1]!.headers);
    expect(headers.get('apikey')).toBe('sb_publishable_testfixture');
    expect(headers.has('authorization')).toBe(false);
  });
  it('preserves session bearer for user requests and supports no-content logout', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ id: 'user-id' })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const gateway = createAuthGateway({ env, fetcher });
    const result = await gateway(new Request(`${GAME}/api/auth/user`, { headers: { Authorization: 'Bearer session-token' } }));
    expect(result.status).toBe(200);
    expect(new Headers(fetcher.mock.calls[0][1]!.headers).get('authorization')).toBe('Bearer session-token');
    expect((await gateway(request('logout?scope=local', undefined, { headers: { Authorization: 'Bearer session-token' }, body: undefined }))).status).toBe(204);
  });
  it('rejects unknown routes, paths, method changes, foreign origins and arbitrary query targets', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const gateway = createAuthGateway({ env, fetcher });
    for (const incoming of [
      request('admin/users'), request('https://elsewhere.example'), request('signup?url=https://elsewhere.example'),
      request('token?grant_type=admin'), request('token?grant_type=password&grant_type=refresh_token'),
      request('signup?redirect_to=https://elsewhere.example/'),
      request('signup', {}, { method: 'DELETE' }),
      request('signup', {}, { headers: { Origin: 'https://elsewhere.example' } }),
      request('signup', {}, { headers: { 'sec-fetch-site': 'cross-site' } }),
    ]) expect((await gateway(incoming)).status).toBeGreaterThanOrEqual(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('allows only same-origin confirmation redirects and forwards valid grant parameters', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response({ id: 'user-id' }));
    const gateway = createAuthGateway({ env, fetcher });
    expect((await gateway(request(`signup?redirect_to=${encodeURIComponent(`${GAME}/`)}`))).status).toBe(200);
    expect((await gateway(request('token?grant_type=refresh_token', { refresh_token: 'refresh-fixture' }))).status).toBe(200);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('grant_type')).toBe('refresh_token');
  });
  it('rejects missing, markdown, foreign-host, privileged and mismatched project configuration', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const patch of [
      { NEXT_PUBLIC_SUPABASE_URL: '' },
      { NEXT_PUBLIC_SUPABASE_URL: `[${PROJECT}](${PROJECT})` },
      { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1' },
      { NEXT_PUBLIC_SUPABASE_URL: `${PROJECT}/dashboard` },
      { NEXT_PUBLIC_SUPABASE_URL: 'https://bad.supabase.co.evil.example' },
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_do-not-expose' },
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'service_role', ref: 'testproject' }) },
      { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon', ref: 'differentproject' }) },
    ]) {
      const result = await createAuthGateway({ env: { ...env, ...patch }, fetcher })(request());
      expect(result.status).toBe(503);
      const text = await result.text();
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('do-not-expose');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('limits JSON bodies by bytes and rejects malformed or non-JSON requests', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const gateway = createAuthGateway({ env, fetcher });
    expect((await gateway(request('signup', { password: '가'.repeat(3000) }))).status).toBe(413);
    expect((await gateway(request('signup', {}, { body: '{' }))).status).toBe(400);
    expect((await gateway(request('signup', [], {}))).status).toBe(400);
    expect((await gateway(request('signup', {}, { headers: { 'content-type': 'text/plain' } }))).status).toBe(415);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps upstream credential/email/captcha errors and retry hints intact without cookies', async () => {
    const payload = { code: 'email_not_confirmed', msg: 'Email not confirmed' };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload, { status: 400, headers: {
      'x-supabase-api-version': '2024-01-01', 'retry-after': '30', 'set-cookie': 'secret=value',
    } }));
    const result = await createAuthGateway({ env, fetcher })(request('token?grant_type=password'));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual(payload);
    expect(result.headers.get('x-supabase-api-version')).toBe('2024-01-01');
    expect(result.headers.get('retry-after')).toBe('30');
    expect(result.headers.has('set-cookie')).toBe(false);
  });
  it('reports network or upstream HTML failures safely in Korean', async () => {
    for (const fetcher of [
      vi.fn<typeof fetch>().mockRejectedValue(new Error('unsafe-internal-secret-details')),
      vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>unavailable</html>', { status: 502 })),
    ]) {
      const result = await createAuthGateway({ env, fetcher })(request());
      expect(result.status).toBe(503);
      const text = await result.text();
      expect(text).toContain('연결 확인');
      expect(text).not.toContain('unsafe-internal-secret-details');
    }
  });
  it('aborts stalled upstream requests and returns a retryable auth response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')), { once: true });
    }));
    const result = await createAuthGateway({ env, fetcher, timeoutMs: 15 })(request());
    expect(result.status).toBe(503);
    expect((await result.json()).error_code).toBe('auth_connection_unavailable');
  });
  it('applies a bounded per-instance request limit and resets after a minute', async () => {
    let now = 100_000;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response({}));
    const gateway = createAuthGateway({ env, fetcher, now: () => now });
    for (let i = 0; i < 40; i++) expect((await gateway(request())).status).toBe(200);
    const limited = await gateway(request());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    now += 60_001;
    expect((await gateway(request())).status).toBe(200);
  });
});

describe('browser auth routing and real Supabase SDK integration', () => {
  it('rewrites matching auth endpoints only, preserving Request bodies and cancellation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response({}));
    const transport = createAuthGatewayFetch(PROJECT, fetcher);
    const controller = new AbortController();
    await transport(new Request(`${PROJECT}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"test@example.com"}', signal: controller.signal,
    }));
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/token?grant_type=password');
    expect(new TextDecoder().decode(fetcher.mock.calls[0][1]!.body as ArrayBuffer)).toContain('test@example.com');
    expect(fetcher.mock.calls[0][1]!.signal).toBeInstanceOf(AbortSignal);
    for (const url of [`${PROJECT}/rest/v1/table`, `${PROJECT}/realtime/v1`, 'https://other.supabase.co/auth/v1/signup', '/api/game']) {
      await transport(url);
      expect(fetcher.mock.calls.at(-1)![0]).toBe(url);
    }
  });
  it('uses same-origin gateway for signup, password login, token refresh and logout with SDK session parsing', async () => {
    const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
      email: 'test@example.com', created_at: '2026-11-04T00:00:00Z', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {} };
    const token = jwt({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
    const upstream = vi.fn<typeof fetch>().mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/signup')) return response({ user, session: null });
      if (url.pathname.endsWith('/token')) return response({ user, access_token: token, refresh_token: 'refresh-fixture', expires_in: 3600, token_type: 'bearer' });
      if (url.pathname.endsWith('/user')) return response(user);
      if (url.pathname.endsWith('/logout')) return new Response(null, { status: 204 });
      throw new Error('Unexpected upstream path');
    });
    const gateway = createAuthGateway({ env, fetcher: upstream });
    const browser = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      expect(typeof input).toBe('string');
      expect(String(input)).toMatch(/^\/api\/auth\//);
      return gateway(new Request(new URL(String(input), GAME), init));
    });
    const client = createClient(PROJECT, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: createAuthGatewayFetch(PROJECT, browser) } });
    const signedUp = await client.auth.signUp({ email: user.email, password: 'test-password' });
    expect(signedUp.error).toBeNull();
    expect(signedUp.data.user?.id).toBe(user.id);
    expect(signedUp.data.session).toBeNull(); // 이메일 확인을 우회하지 않습니다.
    const signedIn = await client.auth.signInWithPassword({ email: user.email, password: 'test-password' });
    expect(signedIn.error).toBeNull();
    expect(signedIn.data.session?.access_token).toBe(token);
    const refreshed = await client.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    expect(refreshed.data.session?.refresh_token).toBe('refresh-fixture');
    expect((await client.auth.getUser()).data.user?.id).toBe(user.id);
    expect((await client.auth.signOut()).error).toBeNull();
    expect(upstream.mock.calls.map(([url]) => new URL(String(url)).pathname)).toContain('/auth/v1/logout');
    expect(browser).toHaveBeenCalledTimes(5);
  });
  it('returns gateway network failures through SDK as readable retryable errors', async () => {
    const gateway = createAuthGateway({ env, fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error('DNS unavailable')) });
    const browser: typeof fetch = (input, init) => gateway(new Request(new URL(String(input), GAME), init));
    const client = createClient(PROJECT, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: createAuthGatewayFetch(PROJECT, browser) } });
    const result = await client.auth.signUp({ email: 'test@example.com', password: 'test-password' });
    expect(result.error?.message).toContain('계정 서버에 연결하지 못했습니다');
    expect(result.error?.name).toBe('AuthRetryableFetchError');
    expect(result.data.session).toBeNull();
  });
});

// 공개 키 검사는 모듈 초기화 때 읽는 빌드 환경변수로 검증합니다.
describe('browser configuration failure handling', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it('returns null without crashing when the configured key is privileged or URL is malformed', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', PROJECT);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_secret_never-public');
    vi.resetModules();
    const configured = await import('../src/lib/supabase');
    expect(configured.onlineConfigured).toBe(true);
    expect(configured.getAuthConfigurationError()).toContain('공개 키');
    expect(configured.getAuthClient()).toBeNull();
  });
});
