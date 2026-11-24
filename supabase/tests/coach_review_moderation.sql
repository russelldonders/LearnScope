\set ON_ERROR_STOP on

-- Reporting and moderating coach reviews (0338): who can report, what admins
-- see and do, and that a removed review is gone for everyone but its author.

begin;

insert into auth.users (id, email, email_confirmed_at) values
  ('f0000000-0000-0000-0000-000000000001', 'mod-learner@example.com', now()),
  ('f0000000-0000-0000-0000-000000000002', 'mod-coach@example.com', now()),
  ('f0000000-0000-0000-0000-000000000003', 'mod-reader@example.com', now()),
  ('f0000000-0000-0000-0000-000000000004', 'mod-validator@example.com', now()),
  ('f0000000-0000-0000-0000-000000000005', 'mod-admin@example.com', now());

insert into public.platform_admins (user_id) values ('f0000000-0000-0000-0000-000000000005');

insert into public.skill_library (id, name, status)
values ('f0000000-0000-0000-0000-0000000000a1', 'Review moderation test skill', 'active');

insert into public.skills (id, user_id, name, level, lifecycle_stage, library_skill_id) values
  ('f0000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000001', 'Teaching', 1, 'identified', 'f0000000-0000-0000-0000-0000000000a1'),
  ('f0000000-0000-0000-0000-000000000012', 'f0000000-0000-0000-0000-000000000002', 'Teaching', 4, 'validated', 'f0000000-0000-0000-0000-0000000000a1'),
  ('f0000000-0000-0000-0000-000000000014', 'f0000000-0000-0000-0000-000000000004', 'Teaching', 5, 'validated', 'f0000000-0000-0000-0000-0000000000a1');
insert into public.skill_validation_requests (skill_id, requester_id, validator_id, target_level, status) values
  ('f0000000-0000-0000-0000-000000000012', 'f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000004', 4, 'confirmed');
update public.skills set offer_coaching = true where id = 'f0000000-0000-0000-0000-000000000012';

insert into public.coaching_relationships (id, learner_id, coach_id, learner_skill_id, coach_skill_id, library_skill_id, skill_name, status, started_at)
values ('f0000000-0000-0000-0000-0000000000c1', 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002',
  'f0000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000012', 'f0000000-0000-0000-0000-0000000000a1',
  'Review moderation test skill', 'active', now());
insert into public.coaching_sessions (relationship_id, proposed_by, starts_at, duration_minutes, status)
values ('f0000000-0000-0000-0000-0000000000c1', 'f0000000-0000-0000-0000-000000000001', now() - interval '1 day', 60, 'done');

grant all on table public.skills, public.profiles to authenticated;

set local role authenticated;
set local search_path = public, extensions;

select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000001', true);
select public.save_coach_review('f0000000-0000-0000-0000-0000000000c1', 1, 'Rude and unhelpful, avoid');

-- The author can't report their own review.
do $$
begin
  perform public.report_coach_review((select id from public.coach_reviews), 'other', null);
  raise exception 'the author reported their own review';
exception
  when others then
    if sqlerrm not like '%Review not found%' then raise; end if;
end
$$;

-- The coach and another learner can, once each; nobody reads reports
-- directly, and only admins list them.
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000002', true);
select public.report_coach_review(
  (select id from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1')),
  'misleading', 'We never met for most of this');
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000003', true);
select public.report_coach_review(
  (select id from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1')),
  'inappropriate', null);
select public.report_coach_review(
  (select id from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1')),
  'spam', null);
do $$
begin
  if not (select reported_by_me from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1')) then
    raise exception 'the review does not say the reader reported it';
  end if;
  begin
    perform 1 from public.coach_review_reports;
    raise exception 'a learner read the reports table';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform public.admin_list_coach_review_reports();
    raise exception 'a learner listed the reports';
  exception
    when insufficient_privilege then null;
  end;
  begin
    perform public.admin_resolve_coach_review_reports((select id from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1')), 'remove');
    raise exception 'a learner removed a review';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

-- The admin sees one reported review with both reports, then removes it.
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000005', true);
do $$
begin
  if (select count(*) from public.admin_list_coach_review_reports()) <> 1
     or (select report_count from public.admin_list_coach_review_reports()) <> 2
     or not (select reporter_is_coach from public.admin_list_coach_review_reports())
     or (select comment from public.admin_list_coach_review_reports()) <> 'Rude and unhelpful, avoid' then
    raise exception 'the admin does not see the reported review and its reports';
  end if;
end
$$;
select public.admin_resolve_coach_review_reports((select review_id from public.admin_list_coach_review_reports()), 'remove');
do $$
begin
  if exists (select 1 from public.admin_list_coach_review_reports()) then
    raise exception 'the removed review still has open reports';
  end if;
end
$$;
reset role;
do $$
begin
  if not exists (select 1 from public.admin_activity_log where action = 'coach_review.removed') then
    raise exception 'removing a review was not logged';
  end if;
end
$$;
set local role authenticated;

-- Gone for others and from the coach's stars.
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000003', true);
do $$
begin
  if exists (select 1 from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1'))
     or exists (select 1 from public.list_coach_ratings('f0000000-0000-0000-0000-0000000000a1')) then
    raise exception 'a removed review is still shown or counted';
  end if;
end
$$;
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000002', true);
do $$
begin
  if exists (select 1 from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1'))
     or exists (select 1 from public.list_my_recent_coach_reviews()) then
    raise exception 'the coach still sees a removed review';
  end if;
end
$$;

-- The author still sees it, marked removed, but not which admin removed it;
-- can't edit it back, can delete it -- and can't then write a new one.
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000001', true);
do $$
begin
  if (select moderation_removed_at from public.coach_reviews) is null then
    raise exception 'the author does not see their review was removed';
  end if;
  if not (select review_removed from public.list_my_coaching()) then
    raise exception 'the coaching does not say its review was removed';
  end if;
  begin
    perform (select moderation_removed_by from public.coach_reviews limit 1);
    raise exception 'the author can see which admin removed their review';
  exception
    when insufficient_privilege then null;
  end;
  perform public.save_coach_review('f0000000-0000-0000-0000-0000000000c1', 5, 'Changed my mind');
  raise exception 'a removed review was edited back';
exception
  when others then
    if sqlerrm not like '%moderators removed your review%' then raise; end if;
end
$$;
select public.delete_coach_review('f0000000-0000-0000-0000-0000000000c1');
do $$
begin
  perform public.save_coach_review('f0000000-0000-0000-0000-0000000000c1', 5, 'Rude and unhelpful, avoid');
  raise exception 'deleting a removed review made room to post it again';
exception
  when others then
    if sqlerrm not like '%moderators removed your review%' then raise; end if;
end
$$;

-- The report record survives the review being deleted.
reset role;
do $$
begin
  if (select count(*) from public.coach_review_reports where status = 'removed' and review_comment = 'Rude and unhelpful, avoid') <> 2 then
    raise exception 'the reports were lost with the review';
  end if;
end
$$;

-- Coached again later: that coaching can be reviewed.
update public.coaching_relationships set status = 'ended', ended_at = now() where id = 'f0000000-0000-0000-0000-0000000000c1';
insert into public.coaching_relationships (id, learner_id, coach_id, learner_skill_id, coach_skill_id, library_skill_id, skill_name, status, started_at)
values ('f0000000-0000-0000-0000-0000000000c2', 'f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002',
  'f0000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000012', 'f0000000-0000-0000-0000-0000000000a1',
  'Review moderation test skill', 'active', now());
insert into public.coaching_sessions (relationship_id, proposed_by, starts_at, duration_minutes, status)
values ('f0000000-0000-0000-0000-0000000000c2', 'f0000000-0000-0000-0000-000000000001', now() - interval '1 hour', 30, 'done');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000001', true);
select public.save_coach_review('f0000000-0000-0000-0000-0000000000c2', 4, 'Fair and clear');

-- Changed after being reported: the admin sees both versions.
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000003', true);
select public.report_coach_review(
  (select id from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1')),
  'other', null);
reset role;
update public.coach_reviews set comment = 'Toned down', updated_at = now() - interval '1 minute' where relationship_id = 'f0000000-0000-0000-0000-0000000000c2';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000005', true);
do $$
begin
  if (select reported_comment from public.admin_list_coach_review_reports()) <> 'Fair and clear'
     or (select comment from public.admin_list_coach_review_reports()) <> 'Toned down'
     or not (select changed_since_reported from public.admin_list_coach_review_reports()) then
    raise exception 'the admin does not see what was reported beside what it says now';
  end if;
end
$$;

-- Dismissing leaves a review as it is.
select public.admin_resolve_coach_review_reports((select review_id from public.admin_list_coach_review_reports()), 'dismiss');
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000003', true);
do $$
begin
  if (select comment from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1')) <> 'Toned down'
     or not (select reported_by_me from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1')) then
    raise exception 'dismissing the reports hid the review, or forgot it was reported';
  end if;
end
$$;

-- Changed again after the dismissal: it can be reported again, reopening it.
reset role;
update public.coach_reviews set comment = 'Abusive again', updated_at = now() + interval '1 hour' where relationship_id = 'f0000000-0000-0000-0000-0000000000c2';
set local role authenticated;
do $$
begin
  if (select reported_by_me from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1')) then
    raise exception 'a review changed since its reports were dismissed cannot be reported again';
  end if;
end
$$;
select public.report_coach_review(
  (select id from public.list_coach_reviews('f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1')),
  'inappropriate', null);
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000005', true);
do $$
begin
  if (select reported_comment from public.admin_list_coach_review_reports()) <> 'Abusive again' then
    raise exception 'reporting the changed review did not reopen the report';
  end if;
end
$$;

-- The author deletes it while reported: the report is closed as withdrawn.
select set_config('request.jwt.claim.sub', 'f0000000-0000-0000-0000-000000000001', true);
select public.delete_coach_review('f0000000-0000-0000-0000-0000000000c2');
reset role;
do $$
begin
  if exists (select 1 from public.coach_review_reports where status = 'open')
     or not exists (select 1 from public.coach_review_reports where status = 'withdrawn' and review_comment = 'Abusive again') then
    raise exception 'reports on a deleted review were left open';
  end if;
end
$$;

rollback;
