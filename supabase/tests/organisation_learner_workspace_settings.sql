\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, email_confirmed_at)
values
  ('73000000-0000-0000-0000-000000000001', 'workspace-admin@example.com', now()),
  ('73000000-0000-0000-0000-000000000002', 'workspace-member@example.com', now()),
  ('73000000-0000-0000-0000-000000000003', 'workspace-outsider@example.com', now()),
  ('73000000-0000-0000-0000-000000000004', 'workspace-org-admin@example.com', now()),
  ('73000000-0000-0000-0000-000000000005', 'other-org-admin@example.com', now());

insert into public.organisations (id, name)
values ('73000000-0000-0000-0000-000000000010', 'Workspace Org'),
       ('73000000-0000-0000-0000-000000000020', 'Other Org');

insert into public.employer_members (employer_id, user_id, role, status) values
  ('73000000-0000-0000-0000-000000000010', '73000000-0000-0000-0000-000000000001', 'admin', 'active'),
  ('73000000-0000-0000-0000-000000000010', '73000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('73000000-0000-0000-0000-000000000020', '73000000-0000-0000-0000-000000000005', 'admin', 'active');

insert into public.organisation_members (organisation_id, user_id, role, status)
values ('73000000-0000-0000-0000-000000000010', '73000000-0000-0000-0000-000000000004', 'admin', 'active');

-- A member can't create the settings.
select set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000002', true);
set local role authenticated;
do $$
begin
  begin
    insert into public.organisation_learner_workspace_settings (organisation_id)
    values ('73000000-0000-0000-0000-000000000010');
    raise exception 'a plain member created learner workspace settings';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- The admin can, and who/when is stamped server-side.
select set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000001', true);
set local role authenticated;
insert into public.organisation_learner_workspace_settings
  (organisation_id, section_order, hidden_sections, landing_section, section_labels, welcome_message, pinned_links, catalogue_enrolment, updated_by)
values (
  '73000000-0000-0000-0000-000000000010',
  array['learning', 'home', 'role', 'catalogue'],
  array['catalogue'],
  'learning',
  '{"learning": "My development"}',
  'Welcome to Workspace Org.',
  '[{"label": "Handbook", "url": "https://example.com/handbook"}]',
  'browse_only',
  '73000000-0000-0000-0000-000000000003'
);

-- Invalid settings are refused by the table itself.
do $$
declare
  bad record;
begin
  for bad in
    select * from (values
      ('hiding Home', $q$update public.organisation_learner_workspace_settings set hidden_sections = array['home']$q$),
      ('landing on a hidden section', $q$update public.organisation_learner_workspace_settings set landing_section = 'catalogue'$q$),
      ('a section missing from the order', $q$update public.organisation_learner_workspace_settings set section_order = array['home', 'learning', 'role', 'role']$q$),
      ('an over-long section name', $q$update public.organisation_learner_workspace_settings set section_labels = '{"role": "A section name that is far too long to fit"}'$q$),
      ('an unknown section name key', $q$update public.organisation_learner_workspace_settings set section_labels = '{"admin": "Admin"}'$q$),
      ('a non-https link', $q$update public.organisation_learner_workspace_settings set pinned_links = '[{"label": "Old", "url": "http://example.com"}]'$q$),
      ('a link hiding its real host', $q$update public.organisation_learner_workspace_settings set pinned_links = '[{"label": "Sign in", "url": "https://login.example.com@evil.example/"}]'$q$),
      ('a contact email carrying mailto parameters', $q$update public.organisation_learner_workspace_settings set contact_email = 'hr@corp.example?bcc=x%40evil.example'$q$),
      ('a javascript link', $q$update public.organisation_learner_workspace_settings set pinned_links = '[{"label": "Bad", "url": "javascript:alert(1)"}]'$q$),
      ('an invalid contact email', $q$update public.organisation_learner_workspace_settings set contact_email = 'not-an-email'$q$),
      ('an unknown enrolment mode', $q$update public.organisation_learner_workspace_settings set catalogue_enrolment = 'approval'$q$)
    ) as cases(label, statement)
  loop
    begin
      execute bad.statement;
      raise exception 'accepted %', bad.label;
    exception when check_violation then null;
    end;
  end loop;
end
$$;
reset role;

do $$
begin
  if (select updated_by from public.organisation_learner_workspace_settings
      where organisation_id = '73000000-0000-0000-0000-000000000010') <> '73000000-0000-0000-0000-000000000001' then
    raise exception 'updated_by was taken from the client instead of the signed-in admin';
  end if;
end
$$;

-- The member can read them (to render the workspace) but not change them.
select set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000002', true);
set local role authenticated;
do $$
declare
  changed integer;
begin
  if not exists (select 1 from public.organisation_learner_workspace_settings) then
    raise exception 'a member could not read their organisation''s workspace settings';
  end if;
  update public.organisation_learner_workspace_settings set welcome_message = 'Hijacked';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'a plain member changed the workspace settings';
  end if;
end
$$;
reset role;

-- An admin of the organisation itself (organisation_members) can change them too.
select set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000004', true);
set local role authenticated;
do $$
declare
  changed integer;
begin
  update public.organisation_learner_workspace_settings set announcement = 'Payroll training opens Monday.';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'an organisation admin could not change the workspace settings';
  end if;
end
$$;
reset role;

-- Another organisation's admin can't see, take over or move onto this row.
select set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000005', true);
set local role authenticated;
do $$
declare
  changed integer;
begin
  if exists (select 1 from public.organisation_learner_workspace_settings where organisation_id = '73000000-0000-0000-0000-000000000010') then
    raise exception 'another organisation''s admin could read these settings';
  end if;
  update public.organisation_learner_workspace_settings set welcome_message = 'Hijacked'
  where organisation_id = '73000000-0000-0000-0000-000000000010';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'another organisation''s admin changed these settings';
  end if;
  begin
    insert into public.organisation_learner_workspace_settings (organisation_id, welcome_message)
    values ('73000000-0000-0000-0000-000000000010', 'Hijacked')
    on conflict (organisation_id) do update set welcome_message = excluded.welcome_message;
    raise exception 'another organisation''s admin upserted these settings';
  exception when insufficient_privilege then null;
  end;
  insert into public.organisation_learner_workspace_settings (organisation_id)
  values ('73000000-0000-0000-0000-000000000020');
  begin
    update public.organisation_learner_workspace_settings set organisation_id = '73000000-0000-0000-0000-000000000010'
    where organisation_id = '73000000-0000-0000-0000-000000000020';
    raise exception 'an admin moved their settings onto another organisation';
  exception when insufficient_privilege or unique_violation then null;
  end;
end
$$;
reset role;

-- Members can't read which admin last edited.
select set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000002', true);
set local role authenticated;
do $$
begin
  begin
    perform updated_by from public.organisation_learner_workspace_settings;
    raise exception 'a member could read updated_by';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- Someone outside the organisation can't see them at all.
select set_config('request.jwt.claim.sub', '73000000-0000-0000-0000-000000000003', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.organisation_learner_workspace_settings) then
    raise exception 'a non-member could read another organisation''s workspace settings';
  end if;
end
$$;
reset role;

rollback;
