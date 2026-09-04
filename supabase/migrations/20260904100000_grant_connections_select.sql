-- Fix found while adding SQL allow/deny tests for
-- 20260904090000_learning_profile_access_helper.sql: 0058_skill_discovery_
-- and_connections.sql enabled RLS and added a "Users can view their own
-- connections" policy on connections, but never granted the authenticated
-- role table-level SELECT. Every existing helper that reads connections
-- (is_connected, used by the "Connections can view visible skills profiles"
-- and "Skills open to being asked to validate are discoverable" policies on
-- skills) runs SECURITY INVOKER, so any RLS evaluation that needs to check
-- someone else's skill visibility via a connection throws "permission
-- denied for table connections" instead of correctly evaluating to false/
-- true. This silently broke the connections-based skill-sharing feature
-- for any row where the cheap auth.uid() = user_id check didn't already
-- short-circuit visibility.
--
-- The RLS policy on connections already scopes visible rows to the caller's
-- own connections, so a blanket SELECT grant is safe here -- this is the
-- same pattern already used for is_skill_validator's dependency table.

grant select on public.connections to authenticated;
