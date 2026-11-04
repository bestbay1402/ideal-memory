-- 누적 몬스터 처치 수: 001_game.sql, 002_chat.sql 다음에 실행합니다.
-- 기존 계정/장비/경험치를 보존하며 기존 기록이 없는 캐릭터만 0부터 집계합니다.
begin;

alter table public.character_rankings
  add column if not exists kills bigint not null default 0
  check (kills between 0 and 9007199254740991);

update public.game_states
  set state=jsonb_set(state,'{player,kills}','0'::jsonb,true)
  where state->'player'->'kills' is null;
update public.character_rankings r
  set kills=coalesce((g.state->'player'->>'kills')::bigint,0)
  from public.game_states g where g.owner_id=r.owner_id;

-- 앞으로 누적치가 줄어들거나 음수가 저장되는 것을 DB에서도 차단합니다.
-- 이전 서버 버전에서 누락한 필드는 기존 누적치를 유지합니다.
create or replace function public.preserve_monster_kills()
returns trigger language plpgsql set search_path = '' as $$
declare previous_kills bigint := 0; next_kills bigint;
begin
  if tg_op='UPDATE' then
    previous_kills:=coalesce((old.state->'player'->>'kills')::bigint,0);
  end if;
  next_kills:=coalesce((new.state->'player'->>'kills')::bigint,previous_kills);
  if next_kills < previous_kills or next_kills < 0 or next_kills > 9007199254740991 then
    raise exception 'invalid lifetime monster kill count';
  end if;
  new.state:=jsonb_set(new.state,'{player,kills}',to_jsonb(next_kills),true);
  return new;
end;
$$;
revoke all on function public.preserve_monster_kills() from public,anon,authenticated;
drop trigger if exists preserve_monster_kills on public.game_states;
create trigger preserve_monster_kills before insert or update of state on public.game_states
  for each row execute function public.preserve_monster_kills();

create or replace function public.sync_game_ranking(p_owner uuid, p_state jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.character_rankings(owner_id,nickname,class,level,xp,enhancement,best_enhancement,kills)
  values (p_owner,p_state->'player'->>'nickname',p_state->'player'->>'class',
    (p_state->'player'->>'level')::integer,(p_state->'player'->>'xp')::bigint,
    (p_state->'player'->>'enhancement')::integer,(p_state->'player'->>'bestEnhancement')::integer,
    coalesce((select state->'player'->>'kills' from public.game_states where owner_id=p_owner)::bigint,0))
  on conflict (owner_id) do update set
    level=excluded.level, xp=excluded.xp, enhancement=excluded.enhancement,
    best_enhancement=excluded.best_enhancement, kills=excluded.kills, updated_at=clock_timestamp();
$$;
revoke all on function public.sync_game_ranking(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sync_game_ranking(uuid,jsonb) to service_role;

-- 전투력 계산 및 정렬은 그대로이며 공개 열 맨 오른쪽에만 처치 수를 추가합니다.
create or replace view public.public_leaderboard with (security_barrier = true) as
  select nickname,class,level,xp,enhancement,best_enhancement,power,kills
  from public.character_rankings;
grant select on public.public_leaderboard to anon,authenticated,service_role;

commit;
