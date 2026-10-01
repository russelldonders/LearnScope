\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at) values
  ('75000000-0000-0000-0000-000000000001', 'requester@example.com', now()),
  ('75000000-0000-0000-0000-000000000002', 'person-confirmed@example.com', now()),
  ('75000000-0000-0000-0000-000000000003', 'ai-only@example.com', now()),
  ('75000000-0000-0000-0000-000000000004', 'earlier-requester@example.com', now()),
  ('75000000-0000-0000-0000-000000000005', 'private@example.com', now());

-- 002 was confirmed by a person; 003 only reached "validated" (e.g. an AI
-- check); 005 is validated but not offering to validate, so it's hidden.
insert into public.skills (id, user_id, name, level, lifecycle_stage, offer_validate_others) values
  ('75000000-0000-0000-0000-000000000012', '75000000-0000-0000-0000-000000000002', 'Coaching', 4, 'validated', true),
  ('75000000-0000-0000-0000-000000000013', '75000000-0000-0000-0000-000000000003', 'Coaching', 4, 'validated', true),
  ('75000000-0000-0000-0000-000000000014', '75000000-0000-0000-0000-000000000004', 'Coaching', 5, 'validated', false),
  ('75000000-0000-0000-0000-000000000015', '75000000-0000-0000-0000-000000000005', 'Coaching', 5, 'validated', false);

insert into public.skill_validation_requests (skill_id, requester_id, validator_id, target_level, status) values
  ('75000000-0000-0000-0000-000000000012', '75000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000004', 4, 'confirmed'),
  ('75000000-0000-0000-0000-000000000015', '75000000-0000-0000-0000-000000000005', '75000000-0000-0000-0000-000000000004', 5, 'confirmed');

select set_config('request.jwt.claim.sub', '75000000-0000-0000-0000-000000000001', true);
set local role authenticated;

do $$
begin
  if not (select person_confirmed from public.validator_directory where validator_id = '75000000-0000-0000-0000-000000000002') then
    raise exception 'a person-confirmed validator is not shown as person-confirmed';
  end if;
  if (select person_confirmed from public.validator_directory where validator_id = '75000000-0000-0000-0000-000000000003') then
    raise exception 'a validator with no confirmed validation is shown as person-confirmed';
  end if;
  if exists (select 1 from public.validator_directory where validator_id = '75000000-0000-0000-0000-000000000005') then
    raise exception 'a skill not offering to validate is listed';
  end if;
  if private.validator_skill_person_confirmed('75000000-0000-0000-0000-000000000015') is not null then
    raise exception 'the helper answers for a skill the caller cannot see';
  end if;
end
$$;

rollback;
