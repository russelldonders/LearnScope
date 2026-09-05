-- Make the composite-skill Data API contract explicit. The project does not
-- rely on public-schema default privileges, so remove inherited anon
-- privileges and grant the server role intentionally for future reporting
-- and administrative jobs. RLS continues to govern authenticated clients.

revoke all on table public.skill_composite_definitions from anon;
revoke all on table public.skill_composite_components from anon;

grant all on table public.skill_composite_definitions to service_role;
grant all on table public.skill_composite_components to service_role;
