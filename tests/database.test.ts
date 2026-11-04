import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createGame } from '../src/game/engine';
import type { GameState } from '../src/game/types';
import { executeCommand, type CommitResult, type GameStore, type StoredGame } from '../src/server/store';

/** 실제 PostgreSQL 엔진에 SQL을 실행합니다. 외부 Supabase 통신을 모방하지 않습니다. */
describe('누적 처치 수 SQL 마이그레이션과 서버 저장', () => {
  let db: PGlite;
  let store: GameStore;
  const legacyOwner = randomUUID();
  const legacy = createGame('이전캐릭터', 'knight', 1000);
  let uniqueNickname = 0;
  async function createOwner(state: GameState) {
    const owner = randomUUID();
    state.player.nickname = `검증${++uniqueNickname}`;
    await db.query('insert into auth.users(id) values ($1)', [owner]);
    await db.query('select public.create_game($1,$2::jsonb)', [owner, JSON.stringify(state)]);
    return owner;
  }
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);`);
    await db.exec(await readFile(new URL('../supabase/migrations/001_game.sql', import.meta.url), 'utf8'));
    // 실제로 이전 형태의 저장 데이터를 먼저 만든 뒤 새 마이그레이션을 적용합니다.
    const oldShape = structuredClone(legacy) as GameState & { player: Record<string, unknown> };
    Reflect.deleteProperty(oldShape.player, 'kills');
    oldShape.player.adena = 12345;
    oldShape.player.enhancement = 7;
    oldShape.player.bestEnhancement = 9;
    oldShape.player.xp = 87;
    await db.query('insert into auth.users(id) values ($1)', [legacyOwner]);
    await db.query('select public.create_game($1,$2::jsonb)', [legacyOwner, JSON.stringify(oldShape)]);
    const migration = await readFile(new URL('../supabase/migrations/003_monster_kills.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // 다시 실행해도 이전 계정이나 값이 지워지지 않습니다.
    store = {
      async read(owner, requestId) {
        const result = await db.query<{ value: StoredGame }>('select public.load_game($1,$2) value', [owner, requestId ?? null]);
        return result.rows[0]?.value ?? null;
      },
      async commit(owner, revision, requestId, state, mutation) {
        const result = await db.query<{ value: CommitResult }>('select public.commit_game($1,$2,$3,$4::jsonb,$5) value', [owner, revision, requestId, JSON.stringify(state), mutation]);
        return result.rows[0].value;
      },
    };
  }, 30000);
  afterAll(async () => { await db?.close(); });

  it('기존 계정은 처치 수 0으로 시작하며 경험치·장비·아데나를 유지한다', async () => {
    const saved = (await store.read(legacyOwner))!.state;
    expect(saved.player).toMatchObject({ kills: 0, adena: 12345, enhancement: 7, bestEnhancement: 9, xp: 87 });
    const ranked = await db.query<{ nickname: string; kills: number; power: number }>('select nickname,kills,power from public.public_leaderboard where nickname=$1', ['이전캐릭터']);
    expect(Number(ranked.rows[0].kills)).toBe(0);
    expect(ranked.rows[0].power).toBe(7100);
  });

  it('동시 처치 요청은 경험치·아데나·처치 수를 한 번만 저장한다', async () => {
    const state = createGame('동시처치', 'knight', 1000);
    state.player.kills = 22;
    state.monsters[0].hp = 1;
    state.monsters[0].x = state.player.x + 20;
    state.monsters[0].y = state.player.y;
    state.targetId = state.monsters[0].id;
    const owner = await createOwner(state);
    const action = { type: 'tick' as const, dx: 0, dy: 0 };
    await Promise.all([
      executeCommand(store, owner, action, randomUUID(), () => 1200, () => 0),
      executeCommand(store, owner, action, randomUUID(), () => 1200, () => 0),
    ]);
    const saved = (await store.read(owner))!.state;
    expect(saved.player.kills).toBe(23);
    expect(saved.player.adena).toBe(state.player.adena + 40);
    expect(saved.player.xp).toBe(10);
    const ranking = await db.query<{ kills: number }>('select kills from public.public_leaderboard where nickname=$1', [state.player.nickname]);
    expect(Number(ranking.rows[0].kills)).toBe(23);
  });

  it('99레벨 일괄 처치는 살아 있던 수만 더하고 재전송·재접속에도 유지한다', async () => {
    const state = createGame('절대자의일격', 'elf', 1000);
    state.player.level = 99;
    state.player.kills = 101;
    state.monsters[0].x = state.player.x + 80;
    state.monsters[0].y = state.player.y;
    state.monsters[1].alive = false;
    state.monsters[1].hp = 0;
    state.monsters[1].respawnAt = 9000;
    state.targetId = state.monsters[0].id;
    const liveCount = state.monsters.filter(monster => monster.alive).length;
    const owner = await createOwner(state);
    const id = randomUUID();
    const attack = () => executeCommand(store, owner, { type: 'tick', dx: 0, dy: 0 }, id, () => 1200, () => 0);
    await Promise.all([attack(), attack()]);
    await attack();
    const freshLoad = (await store.read(owner))!.state;
    expect(freshLoad.player.kills).toBe(101 + liveCount);
    expect(freshLoad.player.adena).toBe(state.player.adena + liveCount * 40);
    expect(freshLoad.player.xp).toBe(0);
    expect(freshLoad.monsters.filter(monster => monster.alive)).toHaveLength(0);
    const ranking = await db.query<{ kills: number }>('select kills from public.public_leaderboard where nickname=$1', [state.player.nickname]);
    expect(Number(ranking.rows[0].kills)).toBe(101 + liveCount);
  });

  it('처치 수가 높은 계정이 전투력이 높은 계정보다 먼저 정렬되지 않는다', async () => {
    const weaker = createGame('처치많음', 'knight', 1000);
    weaker.player.kills = 100000;
    const stronger = createGame('전투력높음', 'elf', 1000);
    stronger.player.level = 99;
    stronger.player.enhancement = 10;
    stronger.player.bestEnhancement = 10;
    stronger.player.kills = 1;
    await createOwner(weaker);
    await createOwner(stronger);
    const result = await db.query<{ nickname: string }>('select nickname from public.public_leaderboard where nickname in ($1,$2) order by power desc,level desc,nickname asc', [weaker.player.nickname, stronger.player.nickname]);
    expect(result.rows.map(row => row.nickname)).toEqual([stronger.player.nickname, weaker.player.nickname]);
  });

  it('권한 없는 브라우저는 다른 사용자 또는 자기 처치 수를 수정하지 못한다', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.query('update public.character_rankings set kills=99999')).rejects.toThrow(/permission denied/);
        await expect(db.query(`update public.game_states set state=jsonb_set(state,'{player,kills}','99999')`)).rejects.toThrow(/permission denied/);
        await expect(db.query('select public.sync_game_ranking($1,$2::jsonb)', [legacyOwner, JSON.stringify(legacy)])).rejects.toThrow(/permission denied/);
        const result = await db.query<Record<string, unknown>>('select * from public.public_leaderboard');
        expect(Object.keys(result.rows[0]).at(-1)).toBe('kills');
        expect(result.rows[0]).not.toHaveProperty('owner_id');
      } finally { await db.exec('reset role'); }
    }
  });

  it('감소한 누적치를 거부하고 구버전의 누락 필드는 현재 누적치를 보존한다', async () => {
    const state = createGame('이전버전호환', 'knight', 1000);
    state.player.kills = 20;
    const owner = await createOwner(state);
    const invalid = structuredClone(state);
    invalid.player.kills = 0;
    await expect(store.commit(owner, 0, randomUUID(), invalid, true)).rejects.toThrow(/invalid lifetime/);
    const missing = structuredClone(state);
    Reflect.deleteProperty(missing.player, 'kills');
    await store.commit(owner, 0, randomUUID(), missing, true);
    expect((await store.read(owner))!.state.player.kills).toBe(20);
    const ranking = await db.query<{ kills: number }>('select kills from public.public_leaderboard where nickname=$1', [state.player.nickname]);
    expect(Number(ranking.rows[0].kills)).toBe(20);
  });
});
