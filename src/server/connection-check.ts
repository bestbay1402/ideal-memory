import 'server-only';

export type ConnectionStatus = 'ok' | 'error' | 'warning' | 'skipped';
export interface ConnectionCheck {
  id: 'url' | 'publicKey' | 'serverKey' | 'auth' | 'database';
  label: string;
  status: ConnectionStatus;
  message: string;
}
export interface ConnectionReport {
  ok: boolean;
  checks: ConnectionCheck[];
  projectHost?: string;
  checkedAt: string;
}
type Environment = Partial<Record<'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY', string>>;
export interface ConnectionDependencies {
  env?: Environment;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}
const labels = { url: '프로젝트 주소', publicKey: '공개 연결 키', serverKey: '서버 저장 키', auth: '회원가입 서버 연결', database: '게임 데이터베이스' };

function check(id: ConnectionCheck['id'], status: ConnectionStatus, message: string): ConnectionCheck {
  return { id, label: labels[id], status, message };
}
function keyClaims(key: string): { role?: unknown; ref?: unknown } | null {
  try {
    const parts = key.split('.');
    if (parts.length !== 3 || parts[1].length > 8192) return null;
    const value: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}
function validateKey(id: 'publicKey' | 'serverKey', key: string, projectRef?: string): ConnectionCheck {
  const publicKey = id === 'publicKey';
  const envName = publicKey ? 'NEXT_PUBLIC_SUPABASE_ANON_KEY' : 'SUPABASE_SERVICE_ROLE_KEY';
  if (!key) return check(id, 'error', `Vercel에 ${envName} 값이 없습니다. 이 프로젝트의 키를 저장한 뒤 다시 배포해주세요.`);
  const claims = keyClaims(key);
  if (publicKey && (key.startsWith('sb_secret_') || claims?.role === 'service_role')) {
    return check(id, 'error', '공개 키 칸에 서버 비밀 키가 들어 있습니다. Supabase에서 노출된 서버 키를 교체하고, 이 칸에는 anon 또는 publishable 키를 넣어주세요.');
  }
  if (!publicKey && (key.startsWith('sb_publishable_') || claims?.role === 'anon')) {
    return check(id, 'error', '서버 저장 키 칸에 공개 키가 들어 있습니다. 이 프로젝트의 service_role 또는 secret 키로 변경해주세요.');
  }
  if (projectRef && typeof claims?.ref === 'string' && claims.ref !== projectRef) {
    return check(id, 'error', '주소와 키에 표시된 프로젝트가 서로 다릅니다. 같은 Supabase 프로젝트에서 주소와 키를 다시 복사해주세요.');
  }
  // JWT의 서명은 여기서 검증하지 않습니다. 실제 유효성은 아래 서버 응답으로 확인합니다.
  return check(id, 'ok', publicKey ? '공개 키가 등록되어 있습니다. 유효성은 회원가입 서버 연결 검사에서 확인합니다.' : '서버 키가 등록되어 있습니다. 저장 권한은 데이터베이스 검사에서 확인합니다.');
}
function networkMessage(error: unknown): string {
  const value = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } : {};
  const code = value.cause?.code ?? value.code;
  if (code === 'ENOTFOUND' || code === 'EAI_NONAME') {
    return '이 Supabase 주소의 서버를 찾을 수 없습니다. Supabase 프로젝트가 실행 중인지 확인하고 Data API의 Project URL을 다시 복사해주세요.';
  }
  if (value.name === 'TimeoutError' || value.name === 'AbortError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'Supabase 서버가 제한 시간 안에 응답하지 않았습니다. 프로젝트가 중지되었거나 복구 중인지 확인해주세요.';
  }
  return '게임 서버에서 Supabase에 연결하지 못했습니다. 프로젝트 실행 상태와 Project URL을 확인해주세요. 오류 원문이나 키는 공개하지 않습니다.';
}

/** 서버에 등록된 고정 목적지만 읽기 요청합니다. 사용자 입력·비밀번호·가입 요청은 받지 않습니다. */
export async function runConnectionChecks(dependencies: ConnectionDependencies = {}): Promise<ConnectionReport> {
  // process.env.NEXT_PUBLIC_* 직접 참조의 빌드 시 치환을 피하고 현재 서버 설정을 읽습니다.
  const runtimeEnvironment = process.env;
  const env = dependencies.env ?? {
    NEXT_PUBLIC_SUPABASE_URL: runtimeEnvironment.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: runtimeEnvironment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: runtimeEnvironment.SUPABASE_SERVICE_ROLE_KEY,
  };
  const fetcher = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const timeoutMs = dependencies.timeoutMs ?? 5000;
  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
  const serverKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  let url: URL | undefined;
  let urlCheck: ConnectionCheck;
  if (!rawUrl) {
    urlCheck = check('url', 'error', 'Vercel에 NEXT_PUBLIC_SUPABASE_URL 값이 없습니다. Supabase의 Project URL을 저장하고 다시 배포해주세요.');
  } else {
    try {
      const candidate = new URL(rawUrl);
      if (candidate.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(candidate.hostname)
        || candidate.username || candidate.password || candidate.port || candidate.search || candidate.hash
        || candidate.pathname.replace(/\/+$/, '') !== '') throw new Error('Invalid project URL');
      url = new URL(candidate.origin);
      urlCheck = check('url', 'ok', '프로젝트 주소 형식이 올바릅니다. 실제 연결 여부를 아래에서 확인합니다.');
    } catch {
      urlCheck = check('url', 'error', '프로젝트 주소 형식이 올바르지 않습니다. Supabase → Settings → Data API의 https://프로젝트ID.supabase.co 주소 전체를 복사해주세요. 주소 외의 글자·따옴표·괄호는 넣지 마세요.');
    }
  }
  const projectRef = url?.hostname.split('.')[0];
  const publicCheck = validateKey('publicKey', publicKey, projectRef);
  const serverCheck = validateKey('serverKey', serverKey, projectRef);

  async function authCheck(): Promise<ConnectionCheck> {
    if (!url || publicCheck.status !== 'ok') return check('auth', 'skipped', '위 프로젝트 주소와 공개 키 설정을 먼저 수정해주세요.');
    try {
      const response = await fetcher(new URL('/auth/v1/settings', url), {
        headers: { apikey: publicKey, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store',
      });
      if (response.status === 401 || response.status === 403) return check('auth', 'error', 'Supabase가 공개 연결 키를 거부했습니다. 같은 프로젝트의 anon 또는 publishable 키인지 확인하고 다시 배포해주세요.');
      if (response.status === 404) return check('auth', 'error', '이 주소에서 Supabase 인증 서버를 찾을 수 없습니다. 프로젝트 주소와 실행 상태를 확인해주세요.');
      if (!response.ok) return check('auth', 'error', response.status >= 500 ? 'Supabase 인증 서버가 현재 정상 응답하지 않습니다. Supabase 프로젝트가 Paused 또는 복구 중인지 확인해주세요.' : 'Supabase 인증 설정을 읽지 못했습니다. 프로젝트의 인증 설정을 확인해주세요.');
      const body = await response.json() as { external?: { email?: unknown }; disable_signup?: unknown };
      if (!body || typeof body !== 'object' || typeof body.external?.email !== 'boolean') return check('auth', 'error', '인증 서버에서 예상한 설정 응답을 받지 못했습니다. Supabase의 Project URL이 정확한지 확인해주세요.');
      if (body.external.email === false) return check('auth', 'error', '이메일 로그인이 꺼져 있습니다. Supabase → Authentication → Sign In / Providers에서 Email을 켜주세요.');
      if (body.disable_signup === true) return check('auth', 'error', '새 회원가입이 차단되어 있습니다. Supabase 인증 설정에서 Allow new users to sign up을 켜주세요.');
      return check('auth', 'ok', '게임 서버에서 Supabase 인증 서버까지 연결되었고 이메일 회원가입이 활성화되어 있습니다.');
    } catch (error) { return check('auth', 'error', networkMessage(error)); }
  }
  async function databaseCheck(): Promise<ConnectionCheck> {
    if (!url || serverCheck.status !== 'ok') return check('database', 'skipped', '위 프로젝트 주소와 서버 저장 키 설정을 먼저 수정해주세요.');
    try {
      // limit=0: 실제 계정 행은 읽거나 반환하지 않고 필수 스키마와 서버 키 권한만 확인합니다.
      const response = await fetcher(new URL('/rest/v1/public_leaderboard?select=nickname,kills&limit=0', url), {
        headers: { apikey: serverKey, ...(serverKey.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${serverKey}` }), Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store',
      });
      if (response.status === 401 || response.status === 403) return check('database', 'error', '서버 저장 키가 거부되었거나 권한이 부족합니다. SUPABASE_SERVICE_ROLE_KEY가 같은 프로젝트의 서버 키인지 확인해주세요.');
      if (response.status === 404 || response.status === 400) {
        const body = await response.json().catch(() => null) as { code?: unknown } | null;
        if (response.status === 404 || ['PGRST204', 'PGRST205', '42703', '42P01'].includes(String(body?.code))) {
          return check('database', 'error', '게임 데이터베이스 설치가 완료되지 않았습니다. Supabase SQL Editor에서 001_game.sql → 002_chat.sql → 003_monster_kills.sql 순서로 실행해주세요.');
        }
      }
      if (!response.ok) return check('database', 'error', '게임 데이터베이스가 정상 응답하지 않습니다. Supabase 프로젝트 실행 상태와 SQL 설치 결과를 확인해주세요.');
      const body: unknown = await response.json();
      if (!Array.isArray(body)) return check('database', 'error', '게임 데이터베이스에서 예상한 응답을 받지 못했습니다. Project URL을 확인해주세요.');
      return check('database', 'ok', '게임 랭킹과 누적 처치 수 저장 구조에 접근할 수 있습니다. 실제 캐릭터 생성·저장은 로그인 후 확인해주세요.');
    } catch (error) { return check('database', 'error', networkMessage(error)); }
  }
  const [auth, database] = await Promise.all([authCheck(), databaseCheck()]);
  const checks = [urlCheck, publicCheck, serverCheck, auth, database];
  return {
    ok: checks.every(item => item.status === 'ok'), checks,
    ...(url ? { projectHost: url.hostname } : {}), checkedAt: new Date(now()).toISOString(),
  };
}
