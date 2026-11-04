import type { Action, GameState } from '../game/types';
import { applyAction } from '../game/engine';
import { ApiError } from './errors';

export interface StoredGame { state: GameState; revision: number; duplicate?: boolean }
export interface CommitResult extends StoredGame { status: 'ok' | 'duplicate' | 'conflict' | 'rate_limited' }
export interface GameStore {
  read(owner: string, requestId?: string): Promise<StoredGame | null>;
  commit(owner: string, revision: number, requestId: string, state: GameState, mutation: boolean): Promise<CommitResult>;
}
/**
 * DB compare-and-swap가 유일한 저장 경로입니다. 같은 몬스터를 두 요청이 잡아도
 * 먼저 저장된 결과만 반영하고, 나머지는 최신 상태에서 다시 계산합니다.
 */
export async function executeCommand(
  store: GameStore, owner: string, action: Action, requestId: string,
  now: () => number, rng: () => number,
): Promise<GameState> {
  let current = await store.read(owner, requestId);
  if (!current) throw new ApiError(404, '먼저 캐릭터를 만들어주세요.');
  if (current.duplicate) return current.state;
  for (let attempt = 0; attempt < 6; attempt++) {
    let next: GameState;
    try { next = applyAction(current.state, action, now(), rng); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : '게임 명령을 처리할 수 없습니다.'); }
    const result = await store.commit(owner, current.revision, requestId, next, action.type !== 'tick');
    if (result.status === 'ok' || result.status === 'duplicate') return result.state;
    if (result.status === 'rate_limited') throw new ApiError(429, '요청이 너무 빠릅니다. 잠시 기다려주세요.');
    current = result;
  }
  throw new ApiError(409, '다른 창에서 캐릭터를 사용 중입니다. 게임 창 하나만 열어주세요.');
}
