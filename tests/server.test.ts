import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createGame } from '../src/game/engine';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../src/game/config';
import type { GameState } from '../src/game/types';
import { executeCommand, type CommitResult, type GameStore, type StoredGame } from '../src/server/store';
import { validateCommand, validateCreate, readJson } from '../src/server/validation';
import { GET as loadRoute } from '../src/app/api/game/route';

class MemoryStore implements GameStore {
  rows = new Map<string, StoredGame>();
  receipts = new Set<string>();
  limited = false;
  constructor() {
    this.rows.set('alice', { state: createGame('기사테스트', 'knight', 1000), revision: 0 });
    this.rows.set('bob', { state: createGame('요정테스트', 'elf', 1000), revision: 0 });
  }
  async read(owner: string, requestId?: string) {
    const row = this.rows.get(owner);
    return row ? structuredClone({ ...row, duplicate: this.receipts.has(`${owner}/${requestId}`) }) : null;
  }
  async commit(owner: string, revision: number, requestId: string, state: GameState): Promise<CommitResult> {
    const row = this.rows.get(owner)!;
    if (this.receipts.has(`${owner}/${requestId}`)) return structuredClone({ ...row, status: 'duplicate' });
    if (this.limited) return structuredClone({ ...row, status: 'rate_limited' });
    if (row.revision !== revision) return structuredClone({ ...row, status: 'conflict' });
    const next = { state, revision: revision + 1 };
    this.rows.set(owner, structuredClone(next));
    this.receipts.add(`${owner}/${requestId}`);
    return structuredClone({ ...next, status: 'ok' });
  }
}

describe('server request boundary', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('accepts only character identity, never supplied progression', () => {
    expect(validateCreate({ nickname: '용사', class: 'knight' })).toEqual({ nickname: '용사', class: 'knight' });
    expect(() => validateCreate({ nickname: '용사', class: 'elf', level: 99 })).toThrow();
    expect(() => validateCreate({ nickname: '<script>', class: 'knight' })).toThrow();
    expect(() => validateCreate({ nickname: '용사', class: 'admin' })).toThrow();
  });
  it('rejects rewards, clock, forged owner and invalid numeric inputs', () => {
    const requestId = randomUUID();
    for (const action of [
      { type: 'reward', adena: 1000000 },
      { type: 'tick', dx: Infinity, dy: 0 },
      { type: 'tick', dx: 0, dy: 0, now: 99999999 },
      { type: 'enhance', success: true },
      { type: 'buy', kind: 'red', quantity: -1 },
      { type: 'buy', kind: 'red', quantity: 1.5 },
    ]) expect(() => validateCommand({ requestId, action })).toThrow();
    expect(() => validateCommand({ requestId, action: { type: 'enhance' }, owner: 'bob' })).toThrow();
  });
  it('accepts bounded movement commands and green auto-use while rejecting forged movement fields', () => {
    const requestId = randomUUID();
    for (const action of [
      { type: 'moveTo', x: 0, y: 0 }, { type: 'moveTo', x: WORLD_WIDTH, y: WORLD_HEIGHT },
      { type: 'autoPotion', enabled: true, kind: 'green' },
    ]) expect(validateCommand({ requestId, action })).toEqual({ requestId, action });
    for (const action of [
      { type: 'moveTo', x: -1, y: 0 }, { type: 'moveTo', x: 0, y: WORLD_HEIGHT + 1 },
      { type: 'moveTo', x: Infinity, y: 0 }, { type: 'moveTo', x: 0 },
      { type: 'moveTo', x: 0, y: 0, path: [{ x: 500, y: 500 }] },
    ]) expect(() => validateCommand({ requestId, action })).toThrow();
  });
  it('limits request body size and rejects malformed JSON', async () => {
    await expect(readJson(new Request('http://localhost', { method: 'POST', body: '{' }))).rejects.toThrow();
    await expect(readJson(new Request('http://localhost', { method: 'POST', body: 'x'.repeat(5000) }))).rejects.toThrow();
  });
  it('reports absent online configuration honestly as 503', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const response = await loadRoute(new Request('http://localhost/api/game'));
    expect(response.status).toBe(503);
    expect(await response.json()).toHaveProperty('error');
  });
});

describe('authoritative concurrency orchestration', () => {
  it('serializes simultaneous enhancements and cannot spend one scroll twice', async () => {
    const store = new MemoryStore();
    store.rows.get('alice')!.state.player.scrolls = 1;
    const results = await Promise.allSettled([
      executeCommand(store, 'alice', { type: 'enhance' }, randomUUID(), () => 1200, () => 0),
      executeCommand(store, 'alice', { type: 'enhance' }, randomUUID(), () => 1200, () => 0),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(store.rows.get('alice')!.state.player.enhancement).toBe(1);
    expect(store.rows.get('alice')!.state.player.scrolls).toBe(0);
  });
  it('retries the same mutation id without consuming items again, even after inventory empty', async () => {
    const store = new MemoryStore();
    store.rows.get('alice')!.state.player.scrolls = 1;
    const id = randomUUID();
    const run = () => executeCommand(store, 'alice', { type: 'enhance' }, id, () => 1200, () => 0);
    await Promise.all([run(), run()]);
    await run();
    expect(store.rows.get('alice')!.state.player.scrolls).toBe(0);
    expect(store.rows.get('alice')!.revision).toBe(1);
  });
  it('recalculates racing kills from latest state and rewards a monster once', async () => {
    const store = new MemoryStore();
    const state = store.rows.get('alice')!.state;
    const monster = state.monsters[0];
    monster.hp = 1; monster.x = state.player.x + 20; monster.y = state.player.y;
    state.targetId = monster.id;
    const before = state.player.adena;
    await Promise.all([
      executeCommand(store, 'alice', { type: 'tick', dx: 0, dy: 0 }, randomUUID(), () => 1200, () => 0),
      executeCommand(store, 'alice', { type: 'tick', dx: 0, dy: 0 }, randomUUID(), () => 1200, () => 0),
    ]);
    expect(store.rows.get('alice')!.state.player.adena - before).toBe(40);
    expect(store.rows.get('alice')!.state.player.xp).toBe(30);
    expect(store.rows.get('alice')!.state.monsters[0].alive).toBe(false);
  });
  it('keeps account state independent and returns saved state after reloading', async () => {
    const store = new MemoryStore();
    const bob = structuredClone(store.rows.get('bob'));
    const state = await executeCommand(store, 'alice', { type: 'buy', kind: 'red', quantity: 3 }, randomUUID(), () => 1200, () => 0);
    expect(store.rows.get('bob')).toEqual(bob);
    expect((await store.read('alice'))!.state).toEqual(state);
    expect(state.player.adena).toBe(1940);
  });
  it('does not advance game or inventory when DB rate limit rejects a commit', async () => {
    const store = new MemoryStore(); store.limited = true;
    await expect(executeCommand(store, 'alice', { type: 'enhance' }, randomUUID(), () => 1200, () => 0)).rejects.toMatchObject({ status: 429 });
    expect(store.rows.get('alice')!.state.player.enhancement).toBe(0);
  });
});

describe('real PostgreSQL schema, transactions and grants (PGlite)', () => {
  let db: PGlite;
  const ownerA = '11111111-1111-4111-8111-111111111111';
  const ownerB = '22222222-2222-4222-8222-222222222222';
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users (id uuid primary key);
      insert into auth.users values ('${ownerA}'), ('${ownerB}');`);
    await db.exec(await readFile(new URL('../supabase/migrations/001_game.sql', import.meta.url), 'utf8'));
  }, 30000);
  afterAll(async () => { await db?.close(); });
  it('creates both classes with private saved state and real public leaderboard rows', async () => {
    await db.query('select public.create_game($1,$2::jsonb)', [ownerA, JSON.stringify(createGame('기사SQL', 'knight', 1000))]);
    await db.query('select public.create_game($1,$2::jsonb)', [ownerB, JSON.stringify(createGame('요정SQL', 'elf', 1000))]);
    const result = await db.query('select * from public.public_leaderboard order by nickname');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).not.toHaveProperty('owner_id');
    expect(result.rows.map(row => (row as { class: string }).class).sort()).toEqual(['elf', 'knight']);
  });
  it('atomically commits progression, derived power and permanent idempotency receipts', async () => {
    const requestId = randomUUID();
    const state = createGame('기사SQL', 'knight', 1000);
    state.player.enhancement = 7; state.player.bestEnhancement = 7;
    const params = [ownerA, 0, requestId, JSON.stringify(state), true];
    const first = await db.query<{ result: CommitResult }>('select public.commit_game($1,$2,$3,$4::jsonb,$5) result', params);
    expect(first.rows[0].result.status).toBe('ok');
    const duplicate = await db.query<{ result: CommitResult }>('select public.commit_game($1,$2,$3,$4::jsonb,$5) result', params);
    expect(duplicate.rows[0].result.status).toBe('duplicate');
    expect(duplicate.rows[0].result.revision).toBe(1);
    const ranking = await db.query<{ power: number }>('select power from public.public_leaderboard where nickname=$1', ['기사SQL']);
    expect(ranking.rows[0].power).toBe(7100);
    const read = await db.query<{ result: StoredGame }>('select public.load_game($1,$2) result', [ownerA, requestId]);
    expect(read.rows[0].result.duplicate).toBe(true);
  });
  it('rejects stale concurrent revisions without overwriting committed rewards', async () => {
    const state = createGame('기사SQL', 'knight', 1000);
    state.player.adena = 999999;
    const result = await db.query<{ result: CommitResult }>('select public.commit_game($1,0,$2,$3::jsonb,true) result', [ownerA, randomUUID(), JSON.stringify(state)]);
    expect(result.rows[0].result.status).toBe('conflict');
    expect(result.rows[0].result.state.player.adena).toBe(2000);
    expect(result.rows[0].result.state.player.enhancement).toBe(7);
  });
  it('keeps writes and private state inaccessible to browser roles; public rankings remain readable', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await expect(db.query('select * from public.game_states')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from public.character_rankings')).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.load_game($1,null)', [ownerA])).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.create_game($1,$2::jsonb)', [ownerA, '{}'])).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.commit_game($1,0,$2,$3::jsonb,true)', [ownerA, randomUUID(), '{}'])).rejects.toThrow(/permission denied/);
      expect((await db.query('select * from public.public_leaderboard')).rows).toHaveLength(2);
      await db.exec('reset role');
    }
  });
  it('enforces unique nicknames, immutable class, and persistent per-player request limit', async () => {
    await expect(db.query('insert into public.character_rankings (owner_id,nickname,class,level,xp,enhancement,best_enhancement) values($1,$2,$3,1,0,0,0)', [ownerB, '기사SQL', 'elf'])).rejects.toThrow(/duplicate key/);
    const state = createGame('기사SQL', 'elf', 1000);
    await expect(db.query('select public.commit_game($1,1,$2,$3::jsonb,true)', [ownerA, randomUUID(), JSON.stringify(state)])).rejects.toThrow(/immutable character identity/);
    await db.query('update public.game_states set rate_count=12,rate_started=clock_timestamp() where owner_id=$1', [ownerA]);
    state.player.class = 'knight';
    const result = await db.query<{ result: CommitResult }>('select public.commit_game($1,1,$2,$3::jsonb,true) result', [ownerA, randomUUID(), JSON.stringify(state)]);
    expect(result.rows[0].result.status).toBe('rate_limited');
    expect(result.rows[0].result.revision).toBe(1);
  });
});
