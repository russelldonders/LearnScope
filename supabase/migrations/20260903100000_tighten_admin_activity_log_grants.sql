-- Hygiene follow-up, not a live vulnerability fix: 20260903090000 only ever
-- added `grant select on admin_activity_log to authenticated`, never
-- explicitly revoking Supabase's default GRANT ALL to anon/authenticated
-- that a new table gets automatically. RLS already made this safe in
-- practice -- confirmed live against Staging: an unauthenticated INSERT is
-- rejected ("new row violates row-level security policy", no INSERT policy
-- exists for any role) and an unauthenticated SELECT returns [] (the one
-- SELECT policy requires is_platform_admin(auth.uid()), null for anon).
-- Tightening anyway for consistency with every other table's explicit
-- revoke-then-grant convention established this session, and as defense in
-- depth against a future policy change ever combining with this leftover
-- grant to create a real gap.
revoke all on admin_activity_log from anon, authenticated;
grant select on admin_activity_log to authenticated;
