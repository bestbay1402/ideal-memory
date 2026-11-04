-- 001_game.sql 실행 후 Supabase SQL Editor에서 실행하세요.
-- 전체 채팅만 공유합니다. 캐릭터 위치/몬스터/전투 상태는 발행하지 않습니다.
begin;

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users(id) on delete set null,
  request_id uuid unique,
  nickname text not null,
  body text not null check (char_length(body) between 1 and 300),
  kind text not null check (kind in ('user', 'system', 'golden')),
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.chat_rate_limits (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  last_sent_at timestamptz not null
);
create table if not exists public.chat_presence_identities (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  ticket uuid not null unique default gen_random_uuid(),
  last_seen_at timestamptz not null default clock_timestamp()
);
alter table public.chat_presence_identities add column if not exists last_seen_at timestamptz not null default clock_timestamp();
alter table public.chat_messages enable row level security;
alter table public.chat_rate_limits enable row level security;
alter table public.chat_presence_identities enable row level security;
revoke all on public.chat_messages, public.chat_rate_limits, public.chat_presence_identities from anon, authenticated;
grant all on public.chat_messages, public.chat_rate_limits, public.chat_presence_identities to service_role;

-- 서비스/검증된 함수만 호출합니다. 전송·삭제는 하나의 트랜잭션입니다.
create or replace function public.append_chat_message(p_owner uuid, p_request uuid, p_nickname text, p_body text, p_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_message public.chat_messages; v_payload jsonb;
begin
  perform pg_advisory_xact_lock(721094182);
  insert into public.chat_messages(owner_id,request_id,nickname,body,kind)
    values(p_owner,p_request,p_nickname,p_body,p_kind) returning * into v_message;
  delete from public.chat_messages where id in
    (select id from public.chat_messages order by id desc offset 100);
  v_payload := jsonb_build_object('id',v_message.id,'nickname',v_message.nickname,
    'body',v_message.body,'kind',v_message.kind,'created_at',v_message.created_at);
  -- Realtime 장애가 기록 저장이나 게임 저장을 취소하지 않게 합니다.
  begin
    perform realtime.send(v_payload,'message','classic-world-chat',true);
  exception when others then
    raise warning 'Chat broadcast unavailable; durable history retained.';
  end;
  return v_payload;
end;
$$;
revoke all on function public.append_chat_message(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.append_chat_message(uuid,uuid,text,text,text) to service_role;

create or replace function public.send_chat_message(p_body text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_nickname text; v_last timestamptz; v_existing public.chat_messages;
begin
  if v_user is null then raise exception '로그인이 필요합니다.'; end if;
  p_body := btrim(p_body);
  if p_request_id is null or p_body is null or char_length(p_body) not between 1 and 300
    or p_body ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
    raise exception '메시지는 1~300자의 일반 텍스트여야 합니다.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text,721094183));
  select * into v_existing from public.chat_messages where request_id=p_request_id and owner_id=v_user;
  if found then
    return jsonb_build_object('id',v_existing.id,'nickname',v_existing.nickname,'body',v_existing.body,
      'kind',v_existing.kind,'created_at',v_existing.created_at);
  end if;
  select nickname into v_nickname from public.character_rankings where owner_id=v_user;
  if v_nickname is null then raise exception '온라인 캐릭터를 먼저 만들어주세요.'; end if;
  select last_sent_at into v_last from public.chat_rate_limits where owner_id=v_user;
  if v_last is not null and clock_timestamp() < v_last + interval '2 seconds' then
    raise exception '2초에 한 번 전송할 수 있습니다.';
  end if;
  insert into public.chat_rate_limits(owner_id,last_sent_at) values(v_user,clock_timestamp())
    on conflict(owner_id) do update set last_sent_at=excluded.last_sent_at;
  return public.append_chat_message(v_user,p_request_id,v_nickname,p_body,'user');
end;
$$;
revoke all on function public.send_chat_message(text,uuid) from public, anon;
grant execute on function public.send_chat_message(text,uuid) to authenticated;

create or replace function public.list_chat_messages()
returns table(id bigint,nickname text,body text,kind text,created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.id,m.nickname,m.body,m.kind,m.created_at from public.chat_messages m
  where auth.uid() is not null order by m.id asc limit 100;
$$;
revoke all on function public.list_chat_messages() from public, anon;
grant execute on function public.list_chat_messages() to authenticated;

-- 접속자 목록은 클라이언트가 보낸 닉네임을 신뢰하지 않고 서버의 닉네임으로 해석합니다.
-- 동일 계정의 여러 탭은 하나의 ticket으로 묶어 한 명으로 표시합니다.
create or replace function public.get_chat_identity()
returns table(ticket uuid,nickname text) language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception '로그인이 필요합니다.'; end if;
  if not exists(select 1 from public.character_rankings where owner_id=v_user) then
    raise exception '온라인 캐릭터를 먼저 만들어주세요.';
  end if;
  insert into public.chat_presence_identities(owner_id) values(v_user)
    on conflict(owner_id) do update set last_seen_at=clock_timestamp();
  return query select p.ticket,r.nickname from public.chat_presence_identities p
    join public.character_rankings r on r.owner_id=p.owner_id where p.owner_id=v_user;
end;
$$;
revoke all on function public.get_chat_identity() from public, anon;
grant execute on function public.get_chat_identity() to authenticated;

create or replace function public.resolve_chat_presence(p_tickets uuid[])
returns table(ticket uuid,nickname text) language sql stable security definer set search_path = '' as $$
  select p.ticket,r.nickname from public.chat_presence_identities p
    join public.character_rankings r on r.owner_id=p.owner_id
    where auth.uid() is not null and p.ticket=any(p_tickets[1:100])
      and p.last_seen_at > clock_timestamp() - interval '75 seconds' order by r.nickname;
$$;
revoke all on function public.resolve_chat_presence(uuid[]) from public, anon;
grant execute on function public.resolve_chat_presence(uuid[]) to authenticated;

create or replace function public.announce_game_milestone()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old_level integer := 0; v_old_enhancement integer := -1; v_weapon text;
begin
  if tg_op='UPDATE' then v_old_level:=old.level; v_old_enhancement:=old.enhancement; end if;
  v_weapon := case new.class when 'knight' then '싸울아비 장검' else '사이하의 활' end;
  -- 채팅 서비스의 문제가 전투 저장을 막지 않도록 이 부수효과만 격리합니다.
  begin
    if new.enhancement in (9,10) and new.enhancement <> v_old_enhancement then
      perform public.append_chat_message(null,null,'시스템',
        format('%s 님이 +%s %s 강화에 성공했습니다!',new.nickname,new.enhancement,v_weapon),
        case new.enhancement when 10 then 'golden' else 'system' end);
    end if;
    if new.level>=90 and v_old_level<90 then
      perform public.append_chat_message(null,null,'시스템',
        format('%s 님이 90레벨을 달성했습니다! 최종 변신이 시작됩니다.',new.nickname),'system');
    end if;
    if new.level>=99 and v_old_level<99 then
      perform public.append_chat_message(null,null,'시스템',
        format('%s 님이 99레벨을 달성했습니다! 절대자의 일격을 습득했습니다.',new.nickname),'system');
    end if;
  exception when others then
    raise warning 'Game milestone chat unavailable; game save preserved.';
  end;
  return new;
end;
$$;
revoke all on function public.announce_game_milestone() from public, anon, authenticated;
drop trigger if exists game_milestone_chat on public.character_rankings;
create trigger game_milestone_chat after insert or update on public.character_rankings
  for each row execute function public.announce_game_milestone();

-- 비공개 채널: 로그인 사용자만 수신/접속자 정보를 공유할 수 있습니다.
-- 클라이언트의 broadcast INSERT는 허용하지 않습니다. 메시지는 위 SQL 함수만 발행합니다.
drop policy if exists classic_chat_receive on realtime.messages;
create policy classic_chat_receive on realtime.messages for select to authenticated
  using ((select auth.uid()) is not null and (select realtime.topic())='classic-world-chat'
    and extension in ('broadcast','presence'));
drop policy if exists classic_chat_presence on realtime.messages;
create policy classic_chat_presence on realtime.messages for insert to authenticated
  with check ((select auth.uid()) is not null and (select realtime.topic())='classic-world-chat'
    and extension='presence');

commit;
