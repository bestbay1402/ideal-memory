import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { GameState } from '../game/types';
import type { CommitResult, GameStore, StoredGame } from './store';
import { ApiError } from './errors';

let client: SupabaseClient | null = null;
export function serverClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(503, '온라인 서버가 아직 연결되지 않았습니다. 로컬 데모로 먼저 플레이할 수 있습니다.');
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
export async function authenticate(request: Request): Promise<string> {
  const db = serverClient();
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ') || header.length > 8192) throw new ApiError(401, '로그인이 필요합니다.');
  const token = header.slice(7);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해주세요.');
  return data.user.id;
}
export function databaseStore(): GameStore {
  const db = serverClient();
  return {
    async read(owner, requestId) {
      const { data, error } = await db.rpc('load_game', { p_owner: owner, p_request_id: requestId ?? null });
      if (error) throw new ApiError(503, '저장소에 연결할 수 없습니다. Supabase 데이터베이스 설정을 확인해주세요.');
      return data as StoredGame | null;
    },
    async commit(owner, revision, requestId, state, mutation) {
      const { data, error } = await db.rpc('commit_game', {
        p_owner: owner, p_revision: revision, p_request_id: requestId, p_state: state, p_mutation: mutation,
      });
      if (error) throw new ApiError(503, '게임 저장에 실패했습니다. 잠시 후 다시 시도해주세요.');
      return data as CommitResult;
    },
  };
}
export async function insertGame(owner: string, state: GameState): Promise<GameState> {
  const { data, error } = await serverClient().rpc('create_game', { p_owner: owner, p_state: state });
  if (error) {
    if (error.code === '23505') throw new ApiError(409, '이미 캐릭터가 있거나 사용 중인 닉네임입니다.');
    throw new ApiError(503, '캐릭터 저장에 실패했습니다. 데이터베이스 설정을 확인해주세요.');
  }
  return data as GameState;
}
