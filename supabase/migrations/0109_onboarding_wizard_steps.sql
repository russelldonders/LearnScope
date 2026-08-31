-- Platform-admin-configurable first-login wizard: each row is one of the
-- steps Onboarding.jsx already knows how to render (CV/history import,
-- skills to learn), toggleable on/off from /admin/onboarding. `key` stays
-- fixed and matches the step identifiers in Onboarding.jsx -- this table
-- only controls which known steps show and in what order, not what a step
-- does, so no dynamic step-creation UI is needed.
create table onboarding_steps (
  key text primary key,
  label text not null,
  enabled boolean not null default true,
  order_index integer not null,
  updated_at timestamptz not null default now()
);
insert into onboarding_steps (key, label, order_index) values
  ('import', 'Import your CV or LinkedIn history', 0),
  ('skills', 'Choose skills you want to learn', 1);

alter table onboarding_steps enable row level security;

-- Every signed-in user needs to read this to render their own onboarding
-- wizard -- it's shared platform configuration, not private data.
create policy "Authenticated users can view onboarding steps"
  on onboarding_steps for select
  to authenticated
  using (true);

create policy "Platform admins can update onboarding steps"
  on onboarding_steps for update
  to authenticated
  using (is_platform_admin(auth.uid()))
  with check (is_platform_admin(auth.uid()));
