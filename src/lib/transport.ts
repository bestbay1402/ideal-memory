import type { Action, CharacterClass, GameState } from '../game/types';
import type { CheckpointAck, CheckpointRequest } from './checkpoint-session';

export type RankingKind = 'power' | 'level' | 'weapon';
export interface RankingEntry {
  nickname: string;
  class: CharacterClass;
  level: number;
  xp: number;
  enhancement: number;
  bestEnhancement: number;
  power: number;
  kills: number;
}

async function request<T>(path: string, token?: string, body?: unknown, keepalive = false): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      signal: controller.signal,
      keepalive,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => {
      throw new Error('서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요.');
    }) as { error?: string } & T;
    if (!response.ok) throw Object.assign(new Error(result.error || '서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.'), { status: response.status });
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('서버 응답이 늦어 연결을 다시 확인하고 있습니다.');
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function loadGame(token: string): Promise<GameState | null> {
  return (await request<{ state: GameState | null }>('/api/game', token)).state;
}
export interface OnlineGame {
  state: GameState | null;
  revision: number;
  serverTime: number;
}
export function loadOnlineGame(token: string): Promise<OnlineGame> {
  return request<OnlineGame>('/api/game', token);
}
export function saveOnlineCheckpoint(token: string, body: CheckpointRequest, keepalive = false): Promise<CheckpointAck> {
  return request<CheckpointAck>('/api/checkpoint', token, body, keepalive);
}
export async function createOnlineGame(token: string, nickname: string, characterClass: CharacterClass): Promise<GameState> {
  return (await request<{ state: GameState }>('/api/game', token, { nickname, class: characterClass })).state;
}
// 한 브라우저 탭에서 요청 순서를 유지합니다. 서로 다른 탭/기기는 DB 트랜잭션으로 보호합니다.
let actionQueue: Promise<unknown> = Promise.resolve();
export function sendOnlineAction(token: string, action: Action): Promise<GameState> {
  const requestId = crypto.randomUUID();
  const next = actionQueue.catch(() => undefined).then(async () => {
    // 네트워크 응답 손실 시 같은 ID로 한 번 재시도하므로 구매/강화가 중복되지 않습니다.
    try {
      return (await request<{ state: GameState }>('/api/action', token, { action, requestId })).state;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return (await request<{ state: GameState }>('/api/action', token, { action, requestId })).state;
    }
  });
  actionQueue = next;
  return next;
}
export async function fetchRankings(kind: RankingKind = 'power'): Promise<RankingEntry[]> {
  return (await request<{ rankings: RankingEntry[] }>(`/api/rankings?sort=${kind}`)).rankings;
}
