import { validateAction } from '../game/engine';
import type { Action, CharacterClass } from '../game/types';
import { ApiError } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, '올바른 요청이 아닙니다.');
  return value as Record<string, unknown>;
}
function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new ApiError(400, '허용되지 않은 게임 데이터가 포함되어 있습니다.');
}
export function validateCreate(value: unknown): { nickname: string; class: CharacterClass } {
  const input = record(value);
  onlyKeys(input, ['nickname', 'class']);
  if (typeof input.nickname !== 'string') throw new ApiError(400, '닉네임을 입력해주세요.');
  const nickname = input.nickname.trim();
  if (!/^[\p{L}\p{N}_]{2,14}$/u.test(nickname)) throw new ApiError(400, '닉네임은 한글·영문·숫자·밑줄 2~14자로 입력해주세요.');
  if (input.class !== 'knight' && input.class !== 'elf') throw new ApiError(400, '기사 또는 요정을 선택해주세요.');
  return { nickname, class: input.class };
}
export function validateCommand(value: unknown): { requestId: string; action: Action } {
  const input = record(value);
  onlyKeys(input, ['requestId', 'action']);
  if (typeof input.requestId !== 'string' || !UUID.test(input.requestId)) throw new ApiError(400, '올바른 요청 번호가 아닙니다.');
  try {
    const raw = record(input.action);
    const allowed: Record<string, string[]> = {
      tick: ['type', 'dx', 'dy'], target: ['type', 'id'], travel: ['type', 'zone'],
      enhance: ['type'], buy: ['type', 'kind', 'quantity'],
      usePotion: ['type', 'kind'], autoPotion: ['type', 'enabled', 'kind'],
    };
    if (typeof raw.type !== 'string' || !Object.hasOwn(allowed, raw.type)) throw new Error('지원하지 않는 명령입니다.');
    onlyKeys(raw, allowed[raw.type]);
    return { requestId: input.requestId, action: validateAction(raw) };
  }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : '올바른 게임 명령이 아닙니다.'); }
}
export async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length && Number(length) > 4096) throw new ApiError(413, '요청이 너무 큽니다.');
  const text = await request.text();
  if (text.length > 4096) throw new ApiError(413, '요청이 너무 큽니다.');
  try { return JSON.parse(text); }
  catch { throw new ApiError(400, '요청 내용을 읽을 수 없습니다.'); }
}
