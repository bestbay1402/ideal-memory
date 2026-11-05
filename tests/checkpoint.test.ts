import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyAction, createGame } from '../src/game/engine';
import { GREEN_DURATION, WORLD_HEIGHT, WORLD_WIDTH } from '../src/game/config';
import type { GameState } from '../src/game/types';
import { spawnMonsters } from '../src/game/world';
import type { CommitResult, GameStore, StoredGame } from '../src/server/store';
import { CHECKPOINT_MAX_BYTES, readCheckpointJson, saveCheckpoint, validateCheckpointEnvelope, validateCheckpointState } from '../src/server/checkpoint';
import { ApiError } from '../src/server/errors';
import * as supabase from '../src/server/supabase';
import { POST } from '../src/app/api/checkpoint/route';

const NOW = 1_000_000;
const tick = { type: 'tick', dx: 0, dy: 0 } as const;
function command(state: GameState, revision = 0, requestId = randomUUID()) { return { requestId, revision, state }; }
function progressed(state = createGame('저장기사', 'knight', NOW)) {
  const next = structuredClone(state);
  next.player.adena += 350;
  next.player.kills += 7;
  next.player.xp += 10;
  next.player.scrolls += 2;
  return next;
}

class MemoryStore implements GameStore {
  rows = new Map<string, StoredGame>([
    ['alice', { state: createGame('저장기사', 'knight', NOW), revision: 0 }],
    ['bob', { state: createGame('저장요정', 'elf', NOW), revision: 0 }],
  ]);
  receipts = new Set<string>();
  writes = 0;
  limited = false;
  async read(owner: string, requestId?: string) {
    const row = this.rows.get(owner);
    return row ? structuredClone({ ...row, duplicate: this.receipts.has(`${owner}:${requestId}`) }) : null;
  }
  async commit(owner: string, revision: number, requestId: string, state: GameState, mutation: boolean): Promise<CommitResult> {
    expect(mutation).toBe(true);
    const row = this.rows.get(owner)!;
    if (this.receipts.has(`${owner}:${requestId}`)) return structuredClone({ ...row, status: 'duplicate' });
    if (row.revision !== revision) return structuredClone({ ...row, status: 'conflict' });
    if (this.limited) return structuredClone({ ...row, status: 'rate_limited' });
    this.writes++;
    const next = structuredClone({ state, revision: revision + 1 });
    this.rows.set(owner, next);
    this.receipts.add(`${owner}:${requestId}`);
    return structuredClone({ ...next, status: 'ok' });
  }
}

describe('checkpoint envelope and bounded state validation', () => {
  it.each(['island', 'temple', 'volcano', 'tower'] as const)('accepts +0 weapons in %s and preserves movement and green auto-use', zone => {
    const initial = createGame('저장기사', 'knight', NOW);
    const state = structuredClone(initial);
    state.zone = zone;
    state.monsters = spawnMonsters(zone);
    state.moveDestination = { x: 600, y: 500 };
    state.movePath = [{ x: 220, y: 500 }, { x: 600, y: 500 }];
    state.player.autoPotion = { enabled: true, kind: 'green' };
    const saved = validateCheckpointState(state, initial, NOW);
    expect(saved).toMatchObject({ zone, moveDestination: state.moveDestination, movePath: state.movePath });
    expect(saved.player).toMatchObject({ enhancement: 0, autoPotion: { enabled: true, kind: 'green' } });
  });

  it('accepts existing saves without movement fields and bounded empty or full paths', () => {
    const legacy = createGame('저장기사', 'knight', NOW);
    delete legacy.moveDestination;
    delete legacy.movePath;
    expect(validateCheckpointState(legacy, legacy, NOW)).toEqual(legacy);
    const stopped = { ...legacy, moveDestination: null, movePath: [] };
    expect(validateCheckpointState(stopped, legacy, NOW)).toEqual(stopped);
    const longestPath = { ...legacy, moveDestination: { x: WORLD_WIDTH, y: WORLD_HEIGHT }, movePath: Array.from({ length: 200 }, () => ({ x: 0, y: 0 })) };
    expect(validateCheckpointState(longestPath, legacy, NOW).movePath).toHaveLength(200);
  });

  it('rejects malformed, unbounded and oversized movement data', () => {
    const initial = createGame('저장기사', 'knight', NOW);
    const corrupt = [
      { moveDestination: { x: -1, y: 0 } }, { moveDestination: { x: 0, y: WORLD_HEIGHT + 1 } },
      { moveDestination: { x: Infinity, y: 0 } }, { moveDestination: { x: 0 } },
      { moveDestination: { x: 0, y: 0, owner: 'bob' } }, { moveDestination: [0, 0] },
      { movePath: null }, { movePath: {} }, { movePath: [null] },
      { movePath: [{ x: WORLD_WIDTH + 1, y: 0 }] }, { movePath: [{ x: 0, y: NaN }] },
      { movePath: [{ x: 0, y: 0, speed: 999 }] },
      { movePath: Array.from({ length: 201 }, () => ({ x: 0, y: 0 })) },
    ];
    for (const movement of corrupt) expect(() => validateCheckpointState({ ...initial, ...movement }, initial, NOW)).toThrow(ApiError);
  });

  it('accepts an actual playthrough snapshot, including all region monster caches', () => {
    const initial = createGame('저장기사', 'knight', NOW);
    let state = initial;
    for (let i = 1; i <= 6; i++) state = applyAction(state, { type: 'enhance' }, NOW + i * 200, () => 0);
    state = applyAction(state, { type: 'travel', zone: 'temple' }, NOW + 1400);
    state = applyAction(state, { type: 'travel', zone: 'island' }, NOW + 1600);
    state = applyAction(state, { type: 'usePotion', kind: 'green' }, NOW + 1800);
    state = applyAction(state, { type: 'target', id: state.monsters[0].id }, NOW + 2000);
    for (let i = 1; i <= 120; i++) state = applyAction(state, tick, NOW + 2000 + i * 200, () => 0.5);
    const before = structuredClone(state);
    const saved = validateCheckpointState(state, initial, NOW + 30_000);
    expect(saved.player.kills).toBeGreaterThan(0);
    expect(saved.zoneMonsters?.temple).toHaveLength(10);
    expect(saved.time).toBe(NOW + 30_000);
    expect(state).toEqual(before);
  });

  it('rejects forged account fields, bad request ids and invalid revisions', () => {
    const input = command(progressed());
    expect(validateCheckpointEnvelope(input).revision).toBe(0);
    for (const invalid of [
      { ...input, owner: 'bob' }, { ...input, requestId: 'nope' },
      { ...input, revision: -1 }, { ...input, revision: 0.5 }, { ...input, revision: Infinity },
    ]) expect(() => validateCheckpointEnvelope(invalid)).toThrow(ApiError);
  });

  it('rejects out-of-range game data and nested unknown fields', () => {
    const initial = createGame('저장기사', 'knight', NOW);
    const corrupt: ((s: GameState) => void)[] = [
      s => { s.player.level = 100; }, s => { s.player.enhancement = 11; },
      s => { s.player.hp = 999999; }, s => { s.player.adena = -1; },
      s => { s.player.scrolls = 0.1; }, s => { s.player.kills = NaN; },
      s => { s.player.potions.red = 1_000_001; }, s => { s.player.x = Infinity; },
      s => { s.player.y = -1; }, s => { s.player.greenUntil = NOW + GREEN_DURATION + 1001; },
      s => { s.monsters[0].id = 'other-0'; }, s => { s.monsters[0].hp = s.monsters[0].maxHp + 1; },
      s => { s.monsters[0].maxHp = 100000; }, s => { s.monsters[0].homeX = 0; },
      s => { s.monsters.pop(); }, s => { s.monsters[0].alive = false; },
      s => { s.zone = 'tower'; }, s => { s.targetId = 'nonexistent'; },
      s => { s.time = NOW + 30_001; }, s => { s.nextPotionAt = NOW + 10_000; },
      s => { s.logs[0].text = 'a'.repeat(501); },
      s => { (s.player as unknown as Record<string, unknown>).owner_id = 'bob'; },
    ];
    for (const change of corrupt) {
      const state = structuredClone(initial); change(state);
      expect(() => validateCheckpointState(state, initial, NOW)).toThrow(ApiError);
    }
  });

  it('preserves nickname, class, cumulative kills, level, xp and best enhancement', () => {
    const previous = progressed();
    previous.player.level = 4; previous.player.enhancement = 3; previous.player.bestEnhancement = 7;
    const mutations: ((s: GameState) => void)[] = [
      s => { s.player.nickname = '다른사람'; }, s => { s.player.class = 'elf'; },
      s => { s.player.kills--; }, s => { s.player.level--; },
      s => { s.player.xp--; }, s => { s.player.bestEnhancement--; },
    ];
    for (const mutate of mutations) {
      const state = structuredClone(previous); mutate(state);
      expect(() => validateCheckpointState(state, previous, NOW)).toThrow(ApiError);
    }
    const failedEnhancement = structuredClone(previous);
    failedEnhancement.player.enhancement = 3;
    expect(validateCheckpointState(failedEnhancement, previous, NOW).player.bestEnhancement).toBe(7);
  });

  it('bounds active potion duration by server time and expires old buffs', () => {
    const state = createGame('저장기사', 'knight', NOW + 1000);
    state.player.greenUntil = state.time + GREEN_DURATION;
    expect(validateCheckpointState(state, state, NOW).player.greenUntil).toBe(NOW + GREEN_DURATION);
    expect(validateCheckpointState(state, state, NOW + GREEN_DURATION + 2000).player.greenUntil).toBe(0);
  });

  it('rejects malformed JSON and enforces actual streamed UTF-8 bytes even without a length header', async () => {
    await expect(readCheckpointJson(new Request('http://localhost', { method: 'POST', body: '{' }))).rejects.toMatchObject({ status: 400 });
    const request = new Request('http://localhost', { method: 'POST', body: '가'.repeat(Math.ceil(CHECKPOINT_MAX_BYTES / 3)) });
    await expect(readCheckpointJson(request)).rejects.toMatchObject({ status: 413 });
    await expect(readCheckpointJson(new Request('http://localhost', { method: 'POST', body: '{}', headers: { 'Content-Length': String(CHECKPOINT_MAX_BYTES + 1) } }))).rejects.toMatchObject({ status: 413 });
    const valid = command(progressed());
    expect(await readCheckpointJson(new Request('http://localhost', { method: 'POST', body: JSON.stringify(valid) }))).toEqual(valid);
  });
});

describe('checkpoint concurrency and authenticated ownership', () => {
  afterEach(() => vi.restoreAllMocks());
  it('saves a complete snapshot and leaves another account untouched', async () => {
    const store = new MemoryStore(), bob = await store.read('bob');
    const state = progressed();
    state.zone = 'tower'; state.monsters = spawnMonsters('tower');
    state.moveDestination = { x: 500, y: 500 }; state.movePath = [{ x: 220, y: 500 }, { x: 500, y: 500 }];
    state.player.autoPotion = { enabled: true, kind: 'green' };
    const result = await saveCheckpoint(store, 'alice', command(state), NOW + 100);
    expect(result.revision).toBe(1);
    expect(result.savedAt).toBe(NOW + 100);
    expect((await store.read('alice'))!.state).toEqual(result.state);
    expect(await store.read('bob')).toEqual(bob);
    expect(result.state.player.kills).toBe(7);
    expect(result.state.zone).toBe('tower');
    expect(result.state.movePath).toEqual(state.movePath);
    expect(result.state.player.autoPotion).toEqual({ enabled: true, kind: 'green' });
    await expect(saveCheckpoint(store, 'bob', command(result.state), NOW + 200)).rejects.toMatchObject({ status: 400 });
  });

  it('acknowledges retries after a lost response without double-counting rewards', async () => {
    const store = new MemoryStore(), input = command(progressed());
    const first = await saveCheckpoint(store, 'alice', input, NOW + 100);
    const retry = await saveCheckpoint(store, 'alice', input, NOW + 200);
    expect(retry).toEqual(first);
    expect(store.writes).toBe(1);
    expect(retry.state.player.adena).toBe(2350);
    expect(retry.state.player.kills).toBe(7);
  });

  it('only permits one of two concurrent snapshots from the same revision', async () => {
    const store = new MemoryStore();
    const results = await Promise.allSettled([
      saveCheckpoint(store, 'alice', command(progressed()), NOW + 100),
      saveCheckpoint(store, 'alice', command(progressed()), NOW + 100),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.status).toBe(409);
    expect(store.writes).toBe(1);
  });

  it('acknowledges identical concurrent requests but rejects an old receipt after a newer device save', async () => {
    const store = new MemoryStore(), input = command(progressed());
    const [a, b] = await Promise.all([
      saveCheckpoint(store, 'alice', input, NOW + 100),
      saveCheckpoint(store, 'alice', input, NOW + 100),
    ]);
    expect(a).toEqual(b); expect(store.writes).toBe(1);
    await saveCheckpoint(store, 'alice', command(progressed(a.state), 1), NOW + 200);
    await expect(saveCheckpoint(store, 'alice', input, NOW + 300)).rejects.toMatchObject({ status: 409 });
    expect(store.rows.get('alice')!.revision).toBe(2);
    expect(store.rows.get('alice')!.state.player.kills).toBe(14);
  });

  it('does not change state on missing character, rate limit or stale revision', async () => {
    const store = new MemoryStore(), before = await store.read('alice');
    await expect(saveCheckpoint(store, 'missing', command(progressed()), NOW)).rejects.toMatchObject({ status: 404 });
    await expect(saveCheckpoint(store, 'alice', command(progressed(), 1), NOW)).rejects.toMatchObject({ status: 409 });
    store.limited = true;
    await expect(saveCheckpoint(store, 'alice', command(progressed()), NOW)).rejects.toMatchObject({ status: 429 });
    expect(await store.read('alice')).toEqual(before);
  });

  it('requires authentication before accessing the checkpoint store', async () => {
    vi.spyOn(supabase, 'authenticate').mockRejectedValue(new ApiError(401, '로그인이 필요합니다.'));
    const database = vi.spyOn(supabase, 'databaseStore');
    const response = await POST(new Request('http://localhost/api/checkpoint', { method: 'POST', body: JSON.stringify(command(progressed())) }));
    expect(response.status).toBe(401);
    expect(database).not.toHaveBeenCalled();
  });
});

describe('checkpoint persistence and leaderboard on real PostgreSQL', () => {
  let db: PGlite;
  let store: GameStore;
  const owner = '33333333-3333-4333-8333-333333333333';
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      insert into auth.users values ('${owner}');`);
    for (const filename of ['001_game.sql', '003_monster_kills.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${filename}`, import.meta.url), 'utf8'));
    }
    await db.query('select public.create_game($1,$2::jsonb)', [owner, JSON.stringify(createGame('저장기사', 'knight', NOW))]);
    store = {
      async read(account, requestId) {
        return (await db.query<{ result: StoredGame | null }>('select public.load_game($1,$2) result', [account, requestId ?? null])).rows[0].result;
      },
      async commit(account, revision, requestId, state, mutation) {
        return (await db.query<{ result: CommitResult }>('select public.commit_game($1,$2,$3,$4::jsonb,$5) result', [account, revision, requestId, JSON.stringify(state), mutation])).rows[0].result;
      },
    };
  }, 30000);
  afterAll(async () => { await db?.close(); });

  it('atomically saves stats, kill count and unchanged power formula; duplicate checkpoints do not add them again', async () => {
    const state = progressed();
    state.player.level = 99; state.player.xp = 0; state.player.enhancement = 10; state.player.bestEnhancement = 10;
    const input = command(state);
    const saved = await saveCheckpoint(store, owner, input, NOW + 100);
    const duplicate = await saveCheckpoint(store, owner, input, NOW + 500);
    expect(duplicate).toEqual(saved);
    const ranking = (await db.query<{ power: number; kills: number; level: number }>('select power,kills,level from public.public_leaderboard')).rows[0];
    expect(ranking).toMatchObject({ power: 19900, kills: 7, level: 99 });
    expect((await store.read(owner))!.state.player).toEqual(saved.state.player);
    expect((await db.query<{ count: number }>('select count(*)::integer count from public.game_receipts')).rows[0].count).toBe(1);
  });
});
