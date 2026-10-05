-- Members' own workspace (EmployerHome.jsx, Actions.jsx's ?org= header)
-- took its logo/colours from get_provider_profile, which only answers when
-- the organisation has opted into a public profile (public_profile_enabled,
-- default false). An organisation that keeps its public page off therefore
-- showed its own members an unbranded workspace.
--
-- get_employer_login_context already resolves the slug for those pages, so
-- it now also returns the branding -- but only to an active member of that
-- employer (is_employer_member, which also admits platform admins). Anonymous
-- and non-member callers (the login page) still get just {id, name}, exactly
-- as before, so this adds no new public org-lookup surface.
-- CREATE OR REPLACE keeps the function's existing grants.
CREATE OR REPLACE FUNCTION public.get_employer_login_context(p_slug text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object(
    'id', e.id,
    'name', e.name,
    'branding', case
      when auth.uid() is not null and is_employer_member(e.id, auth.uid()) then json_build_object(
        'name', e.name,
        'logoUrl', e.logo_url,
        'primaryColor', e.brand_primary_color,
        'secondaryColor', e.brand_secondary_color,
        'hoverColor', e.brand_hover_color,
        'backgroundColor', e.brand_background_color,
        'textColor', e.brand_text_color
      )
    end
  )
  from organisations e
  join organisations o on o.id = e.id
  where o.slug = p_slug
    and exists (
      select 1 from organisation_capabilities oc
      where oc.organisation_id = e.id and oc.capability = 'employs_people' and oc.status = 'active'
    )
$function$;
