\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at)
values
  ('72000000-0000-0000-0000-000000000001', 'rated-learner@example.com', now()),
  ('72000000-0000-0000-0000-000000000002', 'invited-rater@example.com', now());

insert into public.skills (id, user_id, name, level)
values ('72000000-0000-0000-0000-000000000010', '72000000-0000-0000-0000-000000000001', 'Facilitation', 2);

insert into public.skill_assessments (skill_id, user_id, level, source, axis, assessed_at)
values ('72000000-0000-0000-0000-000000000010', '72000000-0000-0000-0000-000000000001', 2, 'self', 'practical', now() - interval '1 day');

insert into public.connection_invites (inviter_id, skill_id, share_code, invite_type)
values ('72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000010', 'peer-rating-level-test', 'rate');

select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000002', true);
set local role authenticated;

select public.accept_invite_and_rate('peer-rating-level-test', 5, 'Excellent');

reset role;

do $$
begin
  if (select level from public.skills where id = '72000000-0000-0000-0000-000000000010') <> 2 then
    raise exception 'accepting a rating invite changed the learner''s current skill level';
  end if;

  if not exists (
    select 1 from public.skill_peer_ratings
    where skill_id = '72000000-0000-0000-0000-000000000010' and level = 5
  ) then
    raise exception 'the peer rating itself was not recorded';
  end if;

  if (select status from public.connection_invites where share_code = 'peer-rating-level-test') <> 'accepted' then
    raise exception 'the rating invite was not marked accepted';
  end if;
end
$$;

rollback;
