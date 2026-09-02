-- Employer console "Providers" tab (foundation only): lets an employer admin
-- record additional provider organisations linked to their employer, beyond
-- the one auto-provisioned/attached provider org every employer already gets
-- (employers.provider_organisation_id, create_employer -- 20260902090000).
--
-- Deliberately narrow: this is purely a listing/linking mechanism for now.
-- Linking a provider has NO functional effect elsewhere yet -- it doesn't
-- widen course-assignment eligibility (assign_course_to_employer_members,
-- 20260902180000/190000, is untouched), doesn't grant the linked provider
-- any access to the employer or its members, and needs no consent from the
-- linked provider organisation. organisations is already an openly browsable
-- directory to any authenticated user ("Authenticated users can view
-- organisations", 0065) -- an employer admin linking any existing provider
-- org unilaterally is consistent with that existing openness, not a new
-- exposure. A later phase can build real functionality (and, if ever
-- needed, provider-side consent) on top of this association without
-- changing its shape.
create table employer_linked_providers (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references employers(id) on delete cascade,
  provider_organisation_id uuid not null references organisations(id) on delete cascade,
  linked_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (employer_id, provider_organisation_id)
);

create index employer_linked_providers_employer_idx on employer_linked_providers (employer_id);
create index employer_linked_providers_provider_idx on employer_linked_providers (provider_organisation_id);

alter table employer_linked_providers enable row level security;

-- Any active member of the employer can see which providers it has linked --
-- mirrors employer_skill_suggestions'/course_assignments' own admin-facing
-- roster read, just extended to any active member (not just admins) since
-- this is informational, not a privileged view.
create policy "Employer members can view linked providers"
  on employer_linked_providers for select
  to authenticated
  using (is_employer_member(employer_id, (select auth.uid())));

-- Only an employer admin can link a provider. Any existing organisations row
-- is linkable -- the foreign key alone ensures it's a real provider org;
-- application code additionally filters out the employer's own attached
-- provider_organisation_id and already-linked rows for a sane picker, but
-- that's a UI convenience, not a security boundary (linking the employer's
-- own attached org here would be inert, not unsafe).
create policy "Employer admins can link providers"
  on employer_linked_providers for insert
  to authenticated
  with check (is_employer_admin(employer_id, (select auth.uid())));

-- Only an employer admin can unlink. No update policy -- a link is either
-- present or absent, nothing about an existing row is ever edited in place.
create policy "Employer admins can unlink providers"
  on employer_linked_providers for delete
  to authenticated
  using (is_employer_admin(employer_id, (select auth.uid())));

grant select, insert, delete on table employer_linked_providers to authenticated;
