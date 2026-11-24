\set ON_ERROR_STOP on

-- Reviews of a coach (0337): only the learner, only after a session marked
-- done, one per coaching; named and shown while the coach offers coaching;
-- the coach can't change them.

begin;

insert into auth.users (id, email, email_confirmed_at) values
  ('e0000000-0000-0000-0000-000000000001', 'review-learner@example.com', now()),
  ('e0000000-0000-0000-0000-000000000002', 'review-coach@example.com', now()),
  ('e0000000-0000-0000-0000-000000000003', 'review-reader@example.com', now()),
  ('e0000000-0000-0000-0000-000000000004', 'review-validator@example.com', now());

update public.profiles set first_name = 'Rae', last_name = 'Learner' where id = 'e0000000-0000-0000-0000-000000000001';

insert into public.skill_library (id, name, status)
values ('e0000000-0000-0000-0000-0000000000a1', 'Coach reviews test skill', 'active');

insert into public.skills (id, user_id, name, level, lifecycle_stage, library_skill_id) values
  ('e0000000-0000-0000-0000-000000000011', 'e0000000-0000-0000-0000-000000000001', 'Mentoring', 1, 'identified', 'e0000000-0000-0000-0000-0000000000a1'),
  ('e0000000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-000000000002', 'Mentoring', 4, 'validated', 'e0000000-0000-0000-0000-0000000000a1'),
  ('e0000000-0000-0000-0000-000000000014', 'e0000000-0000-0000-0000-000000000004', 'Mentoring', 5, 'validated', 'e0000000-0000-0000-0000-0000000000a1');

insert into public.skill_validation_requests (skill_id, requester_id, validator_id, target_level, status) values
  ('e0000000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000004', 4, 'confirmed');
update public.skills set offer_coaching = true where id = 'e0000000-0000-0000-0000-000000000012';

insert into public.coaching_relationships (id, learner_id, coach_id, learner_skill_id, coach_skill_id, library_skill_id, skill_name, status, started_at)
values ('e0000000-0000-0000-0000-0000000000c1', 'e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000011', 'e0000000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-0000000000a1',
  'Coach reviews test skill', 'active', now());

insert into public.coaching_sessions (id, relationship_id, proposed_by, starts_at, duration_minutes, status)
values ('e0000000-0000-0000-0000-0000000000d1', 'e0000000-0000-0000-0000-0000000000c1', 'e0000000-0000-0000-0000-000000000001',
  now() - interval '1 day', 60, 'confirmed');

grant all on table public.skills, public.profiles to authenticated;

set local role authenticated;
set local search_path = public, extensions;

-- Not before a session has been marked done.
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
do $$
begin
  perform public.save_coach_review('e0000000-0000-0000-0000-0000000000c1', 5, 'Great');
  raise exception 'a review was saved before any session was done';
exception
  when others then
    if sqlerrm not like '%after a session%' then raise; end if;
end
$$;

reset role;
update public.coaching_sessions set status = 'done' where id = 'e0000000-0000-0000-0000-0000000000d1';
set local role authenticated;

-- Stars from 1 to 5 only.
do $$
begin
  perform public.save_coach_review('e0000000-0000-0000-0000-0000000000c1', 6, null);
  raise exception 'six stars were saved';
exception
  when others then
    if sqlerrm not like '%1 to 5 stars%' then raise; end if;
end
$$;

-- The coach can't review themselves, nor can anyone else.
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000002', true);
do $$
begin
  perform public.save_coach_review('e0000000-0000-0000-0000-0000000000c1', 5, null);
  raise exception 'the coach reviewed themselves';
exception
  when others then
    if sqlerrm not like '%Coaching not found%' then raise; end if;
end
$$;

-- The learner reviews, then changes it: still one review.
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
select public.save_coach_review('e0000000-0000-0000-0000-0000000000c1', 3, '  Helpful  ');
select public.save_coach_review('e0000000-0000-0000-0000-0000000000c1', 4, 'Very helpful');
do $$
begin
  if (select count(*) from public.coach_reviews) <> 1 or (select rating from public.coach_reviews) <> 4 then
    raise exception 'changing a review did not keep it as one review';
  end if;
end
$$;

-- Anyone sees it, named, while the coach offers coaching.
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
do $$
begin
  if exists (select 1 from public.coach_reviews) then
    raise exception 'another learner reads the table directly';
  end if;
  if (select review_count from public.list_coach_ratings('e0000000-0000-0000-0000-0000000000a1')) <> 1
     or (select average_rating from public.list_coach_ratings('e0000000-0000-0000-0000-0000000000a1')) <> 4 then
    raise exception 'the coach''s rating is not shown';
  end if;
  if (select reviewer_name from public.list_coach_reviews('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-0000000000a1')) <> 'Rae Learner'
     or (select comment from public.list_coach_reviews('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-0000000000a1')) <> 'Very helpful' then
    raise exception 'the review is not shown with the learner''s name';
  end if;
  begin
    perform public.delete_coach_review('e0000000-0000-0000-0000-0000000000c1');
    raise exception 'someone else deleted the review';
  exception
    when others then
      if sqlerrm not like '%Review not found%' then raise; end if;
  end;
end
$$;

-- Coached again by the same coach and reviewed again: that learner still
-- counts once, with their latest review.
reset role;
update public.coaching_relationships set status = 'ended', ended_at = now() where id = 'e0000000-0000-0000-0000-0000000000c1';
insert into public.coaching_relationships (id, learner_id, coach_id, learner_skill_id, coach_skill_id, library_skill_id, skill_name, status, started_at)
values ('e0000000-0000-0000-0000-0000000000c2', 'e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002',
  'e0000000-0000-0000-0000-000000000011', 'e0000000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-0000000000a1',
  'Coach reviews test skill', 'active', now());
insert into public.coaching_sessions (relationship_id, proposed_by, starts_at, duration_minutes, status)
values ('e0000000-0000-0000-0000-0000000000c2', 'e0000000-0000-0000-0000-000000000001', now() - interval '1 hour', 30, 'done');
update public.coach_reviews set updated_at = now() - interval '1 day';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
select public.save_coach_review('e0000000-0000-0000-0000-0000000000c2', 2, 'Less useful this time');
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
do $$
begin
  if (select review_count from public.list_coach_ratings('e0000000-0000-0000-0000-0000000000a1')) <> 1
     or (select average_rating from public.list_coach_ratings('e0000000-0000-0000-0000-0000000000a1')) <> 2
     or (select comment from public.list_coach_reviews('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-0000000000a1')) <> 'Less useful this time' then
    raise exception 'a learner coached twice counted twice, or not with their latest review';
  end if;
end
$$;

-- The coach sees it and is told, but can't change or delete it.
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000002', true);
do $$
begin
  if not exists (select 1 from public.list_my_recent_coach_reviews() where reviewer_name = 'Rae Learner') then
    raise exception 'the coach is not told about the review';
  end if;
  begin
    update public.coach_reviews set rating = 5;
  exception
    when insufficient_privilege then null;
  end;
  begin
    delete from public.coach_reviews;
  exception
    when insufficient_privilege then null;
  end;
  if (select count(*) from public.list_coach_reviews('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-0000000000a1')) <> 1 then
    raise exception 'the coach changed or deleted a review';
  end if;
end
$$;

-- Once the coach stops offering coaching, others no longer see it; the
-- coach still does.
update public.skills set offer_coaching = false where id = 'e0000000-0000-0000-0000-000000000012';
do $$
begin
  if not exists (select 1 from public.list_coach_reviews('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-0000000000a1')) then
    raise exception 'the coach can no longer see reviews about them';
  end if;
end
$$;
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true);
do $$
begin
  if exists (select 1 from public.list_coach_reviews('e0000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-0000000000a1'))
     or exists (select 1 from public.list_coach_ratings('e0000000-0000-0000-0000-0000000000a1')) then
    raise exception 'reviews are shown for someone no longer offering coaching';
  end if;
end
$$;

-- The learner deletes their review.
select set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true);
select public.delete_coach_review('e0000000-0000-0000-0000-0000000000c1');
do $$
begin
  if exists (select 1 from public.coach_reviews where relationship_id = 'e0000000-0000-0000-0000-0000000000c1') then
    raise exception 'deleting the review did not delete it';
  end if;
end
$$;

rollback;
