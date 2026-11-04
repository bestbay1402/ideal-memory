-- 클래식: 범죄와의 전쟁 — Supabase SQL Editor에서 전체 실행
-- 실제 게임 데이터와 공개 랭킹만 저장합니다. 데모/가짜 회원은 추가하지 않습니다.
begin;

create table if not exists public.game_states (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  rate_started timestamptz not null default clock_timestamp(),
  rate_count integer not null default 0,
  recent_tick_ids uuid[] not null default '{}',
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.game_receipts (
  owner_id uuid not null references public.game_states(owner_id) on delete cascade,
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, request_id)
);
-- 구매·강화 등의 영수증은 삭제하지 않으므로 오래된 요청을 재전송해도 재소모되지 않습니다.
create table if not exists public.character_rankings (
  owner_id uuid primary key references public.game_states(owner_id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 14),
  class text not null check (class in ('knight', 'elf')),
  level integer not null check (level between 1 and 99),
  xp bigint not null check (xp >= 0),
  enhancement integer not null check (enhancement between 0 and 10),
  best_enhancement integer not null check (best_enhancement between 0 and 10),
  power integer generated always as (level * 100 + enhancement * 1000) stored,
  updated_at timestamptz not null default clock_timestamp()
);
create unique index if not exists character_nickname_unique on public.character_rankings (lower(nickname));
create index if not exists character_power_index on public.character_rankings (power desc, level desc);

alter table public.game_states enable row level security;
alter table public.game_receipts enable row level security;
alter table public.character_rankings enable row level security;
-- 의도적으로 브라우저 역할용 정책을 만들지 않습니다. 서버 service_role만 접근합니다.
revoke all on public.game_states, public.game_receipts, public.character_rankings from anon, authenticated;
grant all on public.game_states, public.game_receipts, public.character_rankings to service_role;

-- view 소유자의 권한으로 제한된 공개 필드만 읽습니다. 원본 테이블/계정 UUID는 공개하지 않습니다.
create or replace view public.public_leaderboard with (security_barrier = true) as
  select nickname, class, level, xp, enhancement, best_enhancement, power
  from public.character_rankings;
grant select on public.public_leaderboard to anon, authenticated, service_role;

create or replace function public.sync_game_ranking(p_owner uuid, p_state jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.character_rankings(owner_id,nickname,class,level,xp,enhancement,best_enhancement)
  values (p_owner,p_state->'player'->>'nickname',p_state->'player'->>'class',
    (p_state->'player'->>'level')::integer,(p_state->'player'->>'xp')::bigint,
    (p_state->'player'->>'enhancement')::integer,(p_state->'player'->>'bestEnhancement')::integer)
  on conflict (owner_id) do update set
    level=excluded.level, xp=excluded.xp, enhancement=excluded.enhancement,
    best_enhancement=excluded.best_enhancement, updated_at=clock_timestamp();
$$;

create or replace function public.create_game(p_owner uuid, p_state jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  insert into public.game_states(owner_id,state) values(p_owner,p_state);
  perform public.sync_game_ranking(p_owner,p_state);
  return p_state;
end;
$$;

create or replace function public.load_game(p_owner uuid, p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.game_states%rowtype;
begin
  select * into g from public.game_states where owner_id=p_owner;
  if not found then return null; end if;
  return jsonb_build_object('state',g.state,'revision',g.revision,'duplicate',
    coalesce(p_request_id=any(g.recent_tick_ids),false) or exists(
      select 1 from public.game_receipts where owner_id=p_owner and request_id=p_request_id));
end;
$$;

create or replace function public.commit_game(
  p_owner uuid, p_revision bigint, p_request_id uuid, p_state jsonb, p_mutation boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.game_states%rowtype;
  stamp timestamptz := clock_timestamp();
  next_ids uuid[];
begin
  -- 행 잠금 + 버전 비교 + 보상/랭킹/영수증 업데이트가 한 트랜잭션입니다.
  select * into g from public.game_states where owner_id=p_owner for update;
  if not found then raise exception 'character missing'; end if;
  if p_request_id=any(g.recent_tick_ids) or exists(
    select 1 from public.game_receipts where owner_id=p_owner and request_id=p_request_id
  ) then
    return jsonb_build_object('status','duplicate','state',g.state,'revision',g.revision);
  end if;
  if g.revision <> p_revision then
    return jsonb_build_object('status','conflict','state',g.state,'revision',g.revision);
  end if;
  if stamp-g.rate_started >= interval '1 second' then
    g.rate_started := stamp;
    g.rate_count := 0;
  end if;
  if g.rate_count >= 12 then
    return jsonb_build_object('status','rate_limited','state',g.state,'revision',g.revision);
  end if;
  -- 동일 캐릭터의 직업/이름은 생성 후 변경하지 않습니다.
  if (p_state->'player'->>'class') is distinct from (g.state->'player'->>'class')
     or (p_state->'player'->>'nickname') is distinct from (g.state->'player'->>'nickname') then
    raise exception 'immutable character identity';
  end if;
  next_ids := g.recent_tick_ids;
  if p_mutation then
    insert into public.game_receipts(owner_id,request_id) values(p_owner,p_request_id);
  else
    next_ids := array_append(next_ids,p_request_id);
    if cardinality(next_ids)>128 then next_ids:=next_ids[(cardinality(next_ids)-127):cardinality(next_ids)]; end if;
  end if;
  update public.game_states set state=p_state, revision=g.revision+1,
    rate_started=g.rate_started,rate_count=g.rate_count+1,recent_tick_ids=next_ids,updated_at=stamp
    where owner_id=p_owner;
  perform public.sync_game_ranking(p_owner,p_state);
  return jsonb_build_object('status','ok','state',p_state,'revision',g.revision+1);
end;
$$;

-- SECURITY DEFINER 함수의 기본 PUBLIC 실행 권한은 반드시 제거합니다.
revoke all on function public.sync_game_ranking(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.create_game(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.load_game(uuid,uuid) from public, anon, authenticated;
revoke all on function public.commit_game(uuid,bigint,uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.sync_game_ranking(uuid,jsonb) to service_role;
grant execute on function public.create_game(uuid,jsonb) to service_role;
grant execute on function public.load_game(uuid,uuid) to service_role;
grant execute on function public.commit_game(uuid,bigint,uuid,jsonb,boolean) to service_role;
commit;
