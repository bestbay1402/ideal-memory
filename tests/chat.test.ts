import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createGame } from '../src/game/engine';
import { mergeChatMessages, prepareChatBody, presenceTickets, readChatMessage, type ChatMessage } from '../src/lib/chat';

const row = (id: number): ChatMessage => ({ id, nickname: '모험가', body: `메시지 ${id}`, kind: 'user', created_at: '2026-11-04T00:00:00.000Z' });
describe('chat client data boundary', () => {
  it('validates empty, oversized and control character messages by Unicode character count', () => {
    expect(prepareChatBody('  반가워요!  ')).toBe('반가워요!');
    expect(prepareChatBody('🐉'.repeat(300))).toHaveLength(600);
    for (const input of ['  ', '가'.repeat(301), '이름\u0001']) expect(() => prepareChatBody(input)).toThrow();
  });
  it('rejects malformed broadcasts and never interprets markup as HTML', () => {
    expect(readChatMessage({ ...row(1), body: '<script>alert(1)</script>' })?.body).toBe('<script>alert(1)</script>');
    for (const input of [null, {}, { ...row(1), id: -1 }, { ...row(1), kind: 'admin' }, { ...row(1), created_at: 'invalid' }, { ...row(1), body: '가'.repeat(301) }, { ...row(1), nickname: '' }]) expect(readChatMessage(input)).toBeNull();
  });
  it('merges out-of-order history and broadcasts once, keeping the newest 100', () => {
    const history = Array.from({ length: 100 }, (_, i) => row(i + 1));
    const merged = mergeChatMessages(history, [row(102), row(100), row(101)]);
    expect(merged).toHaveLength(100);
    expect(merged[0].id).toBe(3);
    expect(merged.at(-1)?.id).toBe(102);
    expect(new Set(merged.map(item => item.id)).size).toBe(100);
  });
  it('deduplicates multiple tabs by server identity ticket and ignores nickname claims', () => {
    const ticket = '11111111-1111-4111-8111-111111111111';
    expect(presenceTickets({ one: [{ ticket, nickname: '가짜' }], two: [{ ticket }, { ticket: 123 }, { nickname: '가짜' }, { ticket: '-'.repeat(36) }] })).toEqual([ticket]);
  });
});

describe('PostgreSQL chat authorization, rate limiting, retention and milestone integration', () => {
  let db: PGlite;
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  const noCharacter = '33333333-3333-4333-8333-333333333333';
  async function login(owner = alice) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.exec('set role authenticated');
  }
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema auth to public;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      insert into auth.users values ('${alice}'),('${bob}'),('${noCharacter}');
      create schema realtime; grant usage on schema realtime to public;
      create table realtime.messages (topic text, extension text, payload jsonb);
      alter table realtime.messages enable row level security;
      grant select,insert on realtime.messages to authenticated;
      create function realtime.topic() returns text language sql stable as
        $$ select current_setting('realtime.topic',true) $$;
      create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void
        language plpgsql as $$ begin
          if current_setting('test.fail_send',true)='yes' then raise exception 'test broadcast outage'; end if;
          insert into realtime.messages values(topic,'broadcast',payload);
        end $$;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/001_game.sql', import.meta.url), 'utf8'));
    await db.query('select public.create_game($1,$2::jsonb)', [alice, JSON.stringify(createGame('채팅기사', 'knight', 1000))]);
    await db.query('select public.create_game($1,$2::jsonb)', [bob, JSON.stringify(createGame('채팅요정', 'elf', 1000))]);
    await db.exec(await readFile(new URL('../supabase/migrations/002_chat.sql', import.meta.url), 'utf8'));
  }, 30_000);
  afterEach(async () => {
    await db.exec('reset role');
    await db.exec("select set_config('test.fail_send','no',false)");
  });
  afterAll(async () => { await db?.close(); });

  it('only authenticated real characters send, with a nickname selected by the server', async () => {
    await db.exec('set role anon');
    await expect(db.query('select public.send_chat_message($1,$2)', ['안녕하세요', randomUUID()])).rejects.toThrow(/permission denied/);
    await expect(db.query('select public.list_chat_messages()')).rejects.toThrow(/permission denied/);
    await login(noCharacter);
    await expect(db.query('select public.send_chat_message($1,$2)', ['안녕하세요', randomUUID()])).rejects.toThrow(/캐릭터/);
    await login(alice);
    const sent = await db.query<{ message: ChatMessage }>('select public.send_chat_message($1,$2) message', ['  반가워요  ', randomUUID()]);
    expect(sent.rows[0].message).toMatchObject({ nickname: '채팅기사', body: '반가워요', kind: 'user' });
    expect(sent.rows[0].message).not.toHaveProperty('owner_id');
    expect(sent.rows[0].message).not.toHaveProperty('request_id');
    await expect(db.query('select * from public.chat_messages')).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.append_chat_message(null,null,'시스템','가짜','golden')")).rejects.toThrow(/permission denied/);
  });
  it('enforces rate limits in SQL and retries a delivery id without duplicating it', async () => {
    const requestId = randomUUID();
    await login(bob);
    const sent = await db.query<{ message: ChatMessage }>('select public.send_chat_message($1,$2) message', ['첫 메시지', requestId]);
    const retry = await db.query<{ message: ChatMessage }>('select public.send_chat_message($1,$2) message', ['첫 메시지', requestId]);
    expect(retry.rows[0].message).toEqual(sent.rows[0].message);
    await expect(db.query('select public.send_chat_message($1,$2)', ['두 번째 메시지', randomUUID()])).rejects.toThrow(/2초/);
    await expect(db.query('select public.send_chat_message($1,$2)', ['x'.repeat(301), randomUUID()])).rejects.toThrow(/300/);
    await expect(db.query('select public.send_chat_message($1,$2)', ['금지\u0001문자', randomUUID()])).rejects.toThrow(/300/);
  });
  it('retains exactly the newest 100 messages and publishes only sanitized chat data', async () => {
    for (let i = 0; i < 104; i++) await db.query("select public.append_chat_message(null,null,'시스템',$1,'system')", [`기록-${i}`]);
    expect((await db.query<{ count: number }>('select count(*)::int count from public.chat_messages')).rows[0].count).toBe(100);
    await login(alice);
    const history = await db.query<ChatMessage>('select * from public.list_chat_messages()');
    expect(history.rows).toHaveLength(100);
    expect(history.rows[0].body).toBe('기록-4');
    expect(history.rows.at(-1)?.body).toBe('기록-103');
    expect(Object.keys(history.rows[0]).sort()).toEqual(['body', 'created_at', 'id', 'kind', 'nickname']);
    await db.exec('reset role');
    const broadcasts = await db.query<{ payload: ChatMessage }>("select payload from realtime.messages where extension='broadcast'");
    for (const message of broadcasts.rows) expect(Object.keys(message.payload).sort()).toEqual(['body', 'created_at', 'id', 'kind', 'nickname']);
  });
  it('authorizes receiving and Presence but rejects browser-forged broadcasts or another topic', async () => {
    await login(alice);
    await db.query("select set_config('realtime.topic',$1,false)", ['classic-world-chat']);
    expect((await db.query("select * from realtime.messages where extension='broadcast'")).rows.length).toBeGreaterThan(0);
    await db.query("insert into realtime.messages values('classic-world-chat','presence','{}')");
    await expect(db.query("insert into realtime.messages values('classic-world-chat','broadcast','{}')")).rejects.toThrow(/row-level security/);
    await db.query("select set_config('realtime.topic',$1,false)", ['some-other-room']);
    expect((await db.query('select * from realtime.messages')).rows).toHaveLength(0);
    await expect(db.query("insert into realtime.messages values('some-other-room','presence','{}')")).rejects.toThrow(/row-level security/);
  });
  it('resolves real player names from tickets, deduplicates tabs and expires absent users', async () => {
    await login(alice);
    const first = await db.query<{ ticket: string; nickname: string }>('select * from public.get_chat_identity()');
    const second = await db.query<{ ticket: string; nickname: string }>('select * from public.get_chat_identity()');
    expect(first.rows).toEqual(second.rows);
    const ticket = first.rows[0].ticket;
    const people = await db.query('select * from public.resolve_chat_presence($1)', [[ticket, ticket, randomUUID()]]);
    expect(people.rows).toEqual([{ ticket, nickname: '채팅기사' }]);
    await db.exec('reset role');
    await db.query("update public.chat_presence_identities set last_seen_at=clock_timestamp()-interval '76 seconds' where owner_id=$1", [alice]);
    await login(alice);
    expect((await db.query('select * from public.resolve_chat_presence($1)', [[ticket]])).rows).toEqual([]);
  });
  it('announces +9, +10 (gold), level90 and level99 once on authoritative transitions', async () => {
    await db.query('update public.character_rankings set enhancement=9 where owner_id=$1', [alice]);
    await db.query('update public.character_rankings set enhancement=9 where owner_id=$1', [alice]);
    await db.query('update public.character_rankings set enhancement=10,level=90 where owner_id=$1', [alice]);
    await db.query('update public.character_rankings set level=99 where owner_id=$1', [alice]);
    await db.query('update public.character_rankings set level=99 where owner_id=$1', [alice]);
    const milestones = await db.query<ChatMessage>("select * from public.chat_messages where body like '채팅기사 님%'");
    expect(milestones.rows).toHaveLength(4);
    expect(milestones.rows.filter(message => message.kind === 'golden')).toHaveLength(1);
    expect(milestones.rows.find(message => message.kind === 'golden')?.body).toContain('+10');
    expect(milestones.rows.map(message => message.body).join(' ')).toContain('90레벨');
    expect(milestones.rows.map(message => message.body).join(' ')).toContain('99레벨');
  });
  it('keeps durable chat and game updates working when Realtime publication fails', async () => {
    await db.exec("select set_config('test.fail_send','yes',false)");
    await db.query('update public.character_rankings set enhancement=9 where owner_id=$1', [bob]);
    const ranking = await db.query<{ enhancement: number }>('select enhancement from public.character_rankings where owner_id=$1', [bob]);
    expect(ranking.rows[0].enhancement).toBe(9);
    const saved = await db.query<ChatMessage>("select * from public.chat_messages where body like '채팅요정 님%'");
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0].body).toContain('+9');
  });
});
