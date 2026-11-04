import type { SupabaseClient } from '@supabase/supabase-js';

export const CHAT_TOPIC = 'classic-world-chat';
export const CHAT_LIMIT = 100;
export const CHAT_MAX_LENGTH = 300;
export const CHAT_SEND_INTERVAL_MS = 2000;
export type ChatKind = 'user' | 'system' | 'golden';
export interface ChatMessage {
  id: number;
  nickname: string;
  body: string;
  kind: ChatKind;
  created_at: string;
}
export interface ChatIdentity { ticket: string; nickname: string }

// 서버의 길이 검사를 그대로 안내합니다. 서버는 별도로 다시 검증합니다.
export function prepareChatBody(value: string): string {
  const body = value.trim();
  if (!body) throw new Error('메시지를 입력해주세요.');
  if ([...body].length > CHAT_MAX_LENGTH) throw new Error(`메시지는 ${CHAT_MAX_LENGTH}자까지 입력할 수 있습니다.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) throw new Error('사용할 수 없는 문자가 포함되어 있습니다.');
  return body;
}

export function readChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.id) || Number(row.id) < 1 || typeof row.nickname !== 'string'
    || typeof row.body !== 'string' || typeof row.created_at !== 'string'
    || !['user', 'system', 'golden'].includes(String(row.kind)) || !Number.isFinite(Date.parse(row.created_at))) return null;
  if (!row.nickname || [...row.nickname].length > 32 || !row.body || [...row.body].length > CHAT_MAX_LENGTH) return null;
  return { id: Number(row.id), nickname: row.nickname, body: row.body, kind: row.kind as ChatKind, created_at: row.created_at };
}

export function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const unique = new Map<number, ChatMessage>();
  for (const row of [...current, ...incoming]) unique.set(row.id, row);
  return [...unique.values()].sort((a, b) => a.id - b.id).slice(-CHAT_LIMIT);
}

export function presenceTickets(presence: Record<string, unknown[]>): string[] {
  const tickets = new Set<string>();
  for (const entries of Object.values(presence)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === 'object' && 'ticket' in entry
        && typeof entry.ticket === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.ticket)) tickets.add(entry.ticket);
    }
  }
  return [...tickets].slice(0, 100);
}

export async function fetchChatHistory(client: SupabaseClient): Promise<ChatMessage[]> {
  const { data, error } = await client.rpc('list_chat_messages');
  if (error) throw new Error('채팅 기록을 불러오지 못했습니다. 잠시 후 다시 연결합니다.');
  return (data ?? []).map(readChatMessage).filter((row: ChatMessage | null): row is ChatMessage => row !== null);
}

export async function sendChatMessage(client: SupabaseClient, value: string, requestId: string): Promise<ChatMessage> {
  const body = prepareChatBody(value);
  const { data, error } = await client.rpc('send_chat_message', { p_body: body, p_request_id: requestId });
  if (error) {
    if (error.message.includes('2초')) throw new Error('도배 방지를 위해 2초에 한 번 전송할 수 있습니다.');
    if (error.message.includes('캐릭터')) throw new Error('먼저 온라인 캐릭터를 만들어주세요.');
    throw new Error('메시지를 보내지 못했습니다. 연결 상태를 확인해주세요.');
  }
  const row = readChatMessage(Array.isArray(data) ? data[0] : data);
  if (!row) throw new Error('전송 결과를 확인하지 못했습니다.');
  return row;
}
