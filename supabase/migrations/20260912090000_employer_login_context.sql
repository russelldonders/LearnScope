-- Resolves an organisation slug to the employer it belongs to (if any),
-- for gating login on an employer's own URL. Employers get a dedicated
-- organisation 1:1 (employers_provider_organisation_id_unique_idx,
-- 20260902090000's create_employer()) and that organisation already has
-- the public/branded page at /providers/:slug reused for login
-- (?org=:slug, Login.jsx) -- but until now that link carried branding
-- only, with no check that the signing-in account is actually a member of
-- that employer.
--
-- Deliberately a new, minimal RPC rather than reusing get_provider_profile
-- (0090+): that one is gated on public_profile_enabled (default false, an
-- opt-in marketing flag), but the login gate has to work regardless of
-- whether an employer has opted into a public storefront page. It also
-- can't be read from the client table directly -- employers' own select
-- policy ("Employer members can view employer members" / is_employer_member)
-- only allows a member to see their employer's row, which is exactly the
-- distinction Login.jsx needs to draw (an employer's own URL exists vs. the
-- signed-in account isn't a member of it), so a security-definer function is
-- required here the same way get_provider_profile needed one to bypass
-- organisations' own membership-scoped RLS for its public page.
create or replace function get_employer_login_context(p_slug text)
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object('id', e.id, 'name', e.name)
  from employers e
  join organisations o on o.id = e.provider_organisation_id
  where o.slug = p_slug
$$;

grant execute on function get_employer_login_context(text) to anon, authenticated;
