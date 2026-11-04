import { afterEach, describe, expect, it, vi } from 'vitest';
import { runConnectionChecks } from '../src/server/connection-check';

const ref = 'abcdefghijklmnopqrst';
const url = `https://${ref}.supabase.co`;
const jwt = (role: string, project = ref) => `header.${Buffer.from(JSON.stringify({ role, ref: project })).toString('base64url')}.signature`;
const env = {
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon'),
  SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'),
};
const success = () => vi.fn<typeof fetch>(async input => String(input).includes('/auth/')
  ? Response.json({ external: { email: true }, disable_signup: false }) : Response.json([]));
const statusOf = (report: Awaited<ReturnType<typeof runConnectionChecks>>, id: string) => report.checks.find(item => item.id === id)!;

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('safe deployment connection checks', () => {
  it('does not make requests when URL or keys are absent and explains exact missing setting', async () => {
    const fetcher = success();
    const report = await runConnectionChecks({ env: {}, fetch: fetcher });
    expect(report.ok).toBe(false);
    expect(statusOf(report, 'url').message).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(statusOf(report, 'publicKey').status).toBe('error');
    expect(statusOf(report, 'serverKey').status).toBe('error');
    expect(statusOf(report, 'auth').status).toBe('skipped');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    'http://127.0.0.1:3000', 'https://localhost', 'https://example.com',
    `${url}/auth/v1`, `${url}?key=do-not-echo`, `https://secret@${ref}.supabase.co`,
    `[${url}](${url})`, `'${url}'`, `${url}:444`,
  ])('rejects invalid or non-Supabase destinations without leaking the entered value: %s', async invalid => {
    const fetcher = success();
    const report = await runConnectionChecks({ env: { ...env, NEXT_PUBLIC_SUPABASE_URL: invalid }, fetch: fetcher });
    expect(statusOf(report, 'url').status).toBe('error');
    expect(report.projectHost).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain('do-not-echo');
    expect(JSON.stringify(report)).not.toContain('secret@');
  });
  it('checks only fixed read-only auth settings and zero rows with normalized config, without returning keys', async () => {
    const fetcher = success();
    const report = await runConnectionChecks({
      env: { ...env, NEXT_PUBLIC_SUPABASE_URL: ` ${url}/ `, NEXT_PUBLIC_SUPABASE_ANON_KEY: ` ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY} ` },
      fetch: fetcher, now: () => 1000,
    });
    expect(report.ok).toBe(true);
    expect(report.projectHost).toBe(`${ref}.supabase.co`);
    expect(report.checkedAt).toBe('1970-01-01T00:00:01.000Z');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [authCall, dbCall] = fetcher.mock.calls;
    expect(String(authCall[0])).toBe(`${url}/auth/v1/settings`);
    expect(authCall[1]).toMatchObject({ headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY }, redirect: 'error', cache: 'no-store' });
    expect(String(dbCall[0])).toBe(`${url}/rest/v1/public_leaderboard?select=nickname,kills&limit=0`);
    for (const [, options] of fetcher.mock.calls) { expect(options?.body).toBeUndefined(); expect(options?.method).toBeUndefined(); }
    expect(JSON.stringify(report)).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY);
    expect(JSON.stringify(report)).not.toContain(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  });
  it.each(['sb_secret_not-a-real-key', jwt('service_role')])('never sends a misplaced private key as the public key', async misplaced => {
    const fetcher = success();
    const report = await runConnectionChecks({ env: { ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: misplaced }, fetch: fetcher });
    expect(statusOf(report, 'publicKey').status).toBe('error');
    expect(statusOf(report, 'auth').status).toBe('skipped');
    expect(fetcher.mock.calls.every(([input]) => !String(input).includes('/auth/'))).toBe(true);
    expect(JSON.stringify(report)).not.toContain(misplaced);
  });
  it('rejects mismatched legacy project refs, before contacting a different project', async () => {
    const fetcher = success();
    const report = await runConnectionChecks({ env: { ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('anon', 'differentprojectrefxx') }, fetch: fetcher });
    expect(statusOf(report, 'publicKey').message).toContain('프로젝트가 서로 다릅니다');
    expect(statusOf(report, 'auth').status).toBe('skipped');
  });
  it('accepts new publishable/secret key formats and omits Bearer for a new server secret', async () => {
    const fetcher = success();
    const report = await runConnectionChecks({ env: { ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_example', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_example' }, fetch: fetcher });
    expect(report.ok).toBe(true);
    expect(fetcher.mock.calls[1][1]?.headers).not.toHaveProperty('Authorization');
  });
  it('does not claim server write readiness when an anon key is entered in server-key field', async () => {
    const report = await runConnectionChecks({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: jwt('anon') }, fetch: success() });
    expect(statusOf(report, 'serverKey').status).toBe('error');
    expect(statusOf(report, 'database').status).toBe('skipped');
  });
  it('distinguishes denied public key from unavailable network and redacts external responses', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ message: `never echo ${env.SUPABASE_SERVICE_ROLE_KEY}` }, { status: 401 }));
    const report = await runConnectionChecks({ env, fetch: fetcher });
    expect(statusOf(report, 'auth').message).toContain('공개 연결 키를 거부');
    expect(statusOf(report, 'database').message).toContain('서버 저장 키가 거부');
    expect(JSON.stringify(report)).not.toContain(env.SUPABASE_SERVICE_ROLE_KEY);
  });
  it.each([
    { body: { external: { email: false } }, text: '이메일 로그인이 꺼져' },
    { body: { external: { email: true }, disable_signup: true }, text: '새 회원가입이 차단' },
    { body: { wrongServer: true }, text: '예상한 설정 응답' },
  ])('reports unavailable email signup accurately: $text', async ({ body, text }) => {
    const fetcher = vi.fn<typeof fetch>(async input => String(input).includes('/auth/') ? Response.json(body) : Response.json([]));
    const report = await runConnectionChecks({ env, fetch: fetcher });
    expect(statusOf(report, 'auth').status).toBe('error');
    expect(statusOf(report, 'auth').message).toContain(text);
  });
  it.each([
    { error: new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }), text: '서버를 찾을 수 없습니다' },
    { error: new DOMException('Timed out', 'TimeoutError'), text: '제한 시간' },
    { error: new Error('private error with secret'), text: '연결하지 못했습니다' },
  ])('classifies network failure safely: $text', async ({ error, text }) => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw error; });
    const report = await runConnectionChecks({ env, fetch: fetcher });
    expect(statusOf(report, 'auth').message).toContain(text);
    expect(JSON.stringify(report)).not.toContain('private error with secret');
    expect(report.ok).toBe(false);
  });
  it.each([{ status: 404, code: 'PGRST205' }, { status: 400, code: '42703' }])('identifies missing SQL migration without exposing database errors: $code', async ({ status, code }) => {
    const fetcher = vi.fn<typeof fetch>(async input => String(input).includes('/auth/') ? Response.json({ external: { email: true } }) : Response.json({ code, details: 'private database internals' }, { status }));
    const report = await runConnectionChecks({ env, fetch: fetcher });
    expect(statusOf(report, 'database').message).toContain('001_game.sql');
    expect(statusOf(report, 'database').message).toContain('003_monster_kills.sql');
    expect(JSON.stringify(report)).not.toContain('private database internals');
  });
  it('the public route collapses parallel calls and caches diagnostics for30s with no browser cache', async () => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const fetcher = success();
    vi.stubGlobal('fetch', fetcher);
    const { GET } = await import('../src/app/api/connection/route');
    const [a, b] = await Promise.all([GET(), GET()]);
    const c = await GET();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(a.status).toBe(200);
    expect(b.headers.get('Cache-Control')).toBe('no-store');
    expect((await c.json()).ok).toBe(true);
  });
});
