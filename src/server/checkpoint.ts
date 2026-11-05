import 'server-only';
import { CLASSES, GREEN_DURATION, MAX_ENHANCEMENT, MAX_LEVEL, MONSTERS, POTION_INTERVAL, RESPAWN_MS, WORLD_HEIGHT, WORLD_WIDTH, XP_TABLE, ZONES } from '../game/config';
import type { GameState, Monster, ZoneId } from '../game/types';
import { spawnMonsters } from '../game/world';
import { ApiError } from './errors';
import type { GameStore, StoredGame } from './store';

export const CHECKPOINT_MAX_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVALID = '저장할 캐릭터 정보가 올바르지 않습니다. 페이지를 닫지 말고 다시 저장해주세요.';
const CONFLICT = '다른 창이나 기기에서 저장한 기록이 있습니다. 이 창의 기록으로 덮어쓰지 않았습니다. 게임 창 하나만 사용하고 최신 기록을 다시 불러와주세요.';
const zones = Object.keys(ZONES) as ZoneId[];
const effectKinds = ['slash', 'arrow', 'hit', 'death', 'level', 'transform', 'enhanceSuccess', 'enhanceFail', 'heal', 'nova', 'cleave', 'pierce', 'respawn'];

function reject(): never { throw new ApiError(400, INVALID); }
function record(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !allowed.includes(key))) reject();
  return result;
}
function number(value: unknown, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) reject();
  return value;
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') reject(); return value; }
function text(value: unknown, max: number): string { if (typeof value !== 'string' || value.length > max) reject(); return value; }
function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) reject();
  return value as T;
}
function point(value: Record<string, unknown>) {
  number(value.x, 0, WORLD_WIDTH); number(value.y, 0, WORLD_HEIGHT);
}
function timestamp(value: unknown, max: number): number { return number(value, 0, max); }

export interface CheckpointInput { requestId: string; revision: number; state: unknown }
export interface CheckpointResult { revision: number; savedAt: number; state: GameState }

export function validateCheckpointEnvelope(value: unknown): CheckpointInput {
  const body = record(value, ['requestId', 'revision', 'state']);
  if (typeof body.requestId !== 'string' || !UUID.test(body.requestId)) reject();
  return { requestId: body.requestId, revision: number(body.revision, 0, Number.MAX_SAFE_INTEGER - 1, true), state: body.state };
}

function validateMonsters(value: unknown, zone: ZoneId, time: number): Monster[] {
  const expected = spawnMonsters(zone);
  if (!Array.isArray(value) || value.length !== expected.length) reject();
  value.forEach((item, index) => {
    const m = record(item, ['id', 'kind', 'hp', 'maxHp', 'homeX', 'homeY', 'alive', 'aggro', 'respawnAt', 'nextAttackAt', 'generation', 'x', 'y']);
    const template = expected[index];
    if (m.id !== template.id || m.kind !== template.kind || m.homeX !== template.homeX || m.homeY !== template.homeY || m.maxHp !== template.maxHp) reject();
    const alive = bool(m.alive);
    number(m.hp, alive ? 1 : 0, alive ? template.maxHp : 0, true);
    bool(m.aggro); point(m);
    timestamp(m.respawnAt, time + RESPAWN_MS + 1000);
    timestamp(m.nextAttackAt, time + MONSTERS[template.kind].attackInterval + 1000);
    number(m.generation, 0, Number.MAX_SAFE_INTEGER, true);
  });
  return value as Monster[];
}

/**
 * 부드러운 로컬 전투를 위한 저장 경계입니다. 값의 범위·계정·버전은 검증하지만,
 * 클라이언트의 사냥/강화 이력을 서버에서 재연산하는 부정행위 방지 기능은 아닙니다.
 */
export function validateCheckpointState(value: unknown, previous: GameState, now: number): GameState {
  const s = record(value, ['version', 'player', 'monsters', 'zone', 'time', 'targetId', 'moveDestination', 'movePath', 'nextAttackAt', 'nextPotionAt', 'greenWarningSent', 'sequence', 'logs', 'effects', 'zoneMonsters']);
  if (s.version !== 1) reject();
  const time = timestamp(s.time, now + 30_000);
  const zone = oneOf(s.zone, zones);
  const p = record(s.player, ['nickname', 'class', 'level', 'xp', 'hp', 'adena', 'enhancement', 'bestEnhancement', 'scrolls', 'kills', 'potions', 'autoPotion', 'greenUntil', 'x', 'y']);
  if (p.nickname !== previous.player.nickname || p.class !== previous.player.class) reject();
  const characterClass = oneOf(p.class, ['knight', 'elf'] as const);
  const level = number(p.level, previous.player.level, MAX_LEVEL, true);
  const xp = number(p.xp, 0, level === MAX_LEVEL ? 0 : XP_TABLE[level] - 1, true);
  if (level === previous.player.level && xp < previous.player.xp) reject();
  const enhancement = number(p.enhancement, 0, MAX_ENHANCEMENT, true);
  number(p.bestEnhancement, Math.max(previous.player.bestEnhancement, enhancement), MAX_ENHANCEMENT, true);
  number(p.hp, 1, CLASSES[characterClass].hp + (level - 1) * CLASSES[characterClass].hpPerLevel, true);
  number(p.adena, 0, Number.MAX_SAFE_INTEGER, true);
  number(p.scrolls, 0, Number.MAX_SAFE_INTEGER, true);
  number(p.kills, previous.player.kills ?? 0, Number.MAX_SAFE_INTEGER, true);
  point(p);
  const potions = record(p.potions, ['red', 'orange', 'clear', 'green']);
  for (const kind of ['red', 'orange', 'clear', 'green']) number(potions[kind], 0, 1_000_000, true);
  const auto = record(p.autoPotion, ['enabled', 'kind']);
  bool(auto.enabled); oneOf(auto.kind, ['red', 'orange', 'clear', 'green']);
  timestamp(p.greenUntil, time + GREEN_DURATION + 1000);
  const monsters = validateMonsters(s.monsters, zone, time);
  if (s.targetId !== null && !monsters.some(m => m.id === s.targetId && m.alive)) reject();
  if (s.moveDestination !== undefined && s.moveDestination !== null) point(record(s.moveDestination, ['x', 'y']));
  if (s.movePath !== undefined) {
    if (!Array.isArray(s.movePath) || s.movePath.length > 200) reject();
    for (const waypoint of s.movePath) point(record(waypoint, ['x', 'y']));
  }
  timestamp(s.nextAttackAt, time + 2000);
  timestamp(s.nextPotionAt, time + POTION_INTERVAL + 1000);
  bool(s.greenWarningSent);
  const sequence = number(s.sequence, 0, Number.MAX_SAFE_INTEGER, true);
  if (!Array.isArray(s.logs) || s.logs.length > 60 || !Array.isArray(s.effects) || s.effects.length > 100) reject();
  for (const item of s.logs) {
    const entry = record(item, ['id', 'time', 'text', 'kind']);
    number(entry.id, 0, sequence, true); timestamp(entry.time, time + 1000);
    text(entry.text, 500); oneOf(entry.kind, ['info', 'combat', 'reward', 'success', 'warning']);
  }
  for (const item of s.effects) {
    const effect = record(item, ['id', 'time', 'kind', 'x', 'y', 'toX', 'toY', 'value', 'text']);
    number(effect.id, 0, sequence, true); timestamp(effect.time, time + 1000);
    oneOf(effect.kind, effectKinds); point(effect);
    if (effect.toX !== undefined) number(effect.toX, 0, WORLD_WIDTH);
    if (effect.toY !== undefined) number(effect.toY, 0, WORLD_HEIGHT);
    if (effect.value !== undefined) number(effect.value, 0, Number.MAX_SAFE_INTEGER);
    if (effect.text !== undefined) text(effect.text, 100);
  }
  if (s.zoneMonsters !== undefined) {
    const cached = record(s.zoneMonsters, zones);
    if (Object.hasOwn(cached, zone)) reject();
    for (const [cachedZone, items] of Object.entries(cached)) validateMonsters(items, cachedZone as ZoneId, time);
  }
  const result = structuredClone(value) as GameState;
  // 저장 시각과 남은 가속 시간은 서버 시계를 상한으로 사용합니다.
  result.time = now;
  result.player.greenUntil = result.player.greenUntil <= now ? 0 : Math.min(result.player.greenUntil, now + GREEN_DURATION);
  result.nextAttackAt = Math.min(result.nextAttackAt, now + 2000);
  result.nextPotionAt = Math.min(result.nextPotionAt, now + POTION_INTERVAL);
  return result;
}

function acknowledge(current: StoredGame, revision: number): CheckpointResult {
  // 영수증은 존재하지만 그 뒤 다른 기기가 저장했다면 최신 revision을 넘기지 않습니다.
  if (current.revision !== revision + 1) throw new ApiError(409, CONFLICT);
  return { revision: current.revision, savedAt: current.state.time, state: current.state };
}

export async function saveCheckpoint(store: GameStore, owner: string, value: unknown, now: number): Promise<CheckpointResult> {
  const input = validateCheckpointEnvelope(value);
  const current = await store.read(owner, input.requestId);
  if (!current) throw new ApiError(404, '먼저 캐릭터를 만들어주세요.');
  if (current.duplicate) return acknowledge(current, input.revision);
  if (current.revision !== input.revision) throw new ApiError(409, CONFLICT);
  const next = validateCheckpointState(input.state, current.state, now);
  const result = await store.commit(owner, input.revision, input.requestId, next, true);
  if (result.status === 'rate_limited') throw new ApiError(429, '저장 요청이 너무 빠릅니다. 잠시 후 다시 저장해주세요.');
  if (result.status === 'conflict') throw new ApiError(409, CONFLICT);
  return acknowledge(result, input.revision);
}

/** Content-Length가 없는 요청도 스트리밍 중 실제 바이트 수를 제한합니다. */
export async function readCheckpointJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > CHECKPOINT_MAX_BYTES) throw new ApiError(413, '저장 요청이 너무 큽니다.');
  if (!request.body) throw new ApiError(400, INVALID);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CHECKPOINT_MAX_BYTES) {
        await reader.cancel();
        throw new ApiError(413, '저장 요청이 너무 큽니다.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, '저장 내용을 읽을 수 없습니다.'); }
}
