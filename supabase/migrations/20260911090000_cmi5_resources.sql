-- cmi5 packages join scorm/xapi as a third "zip of files + launch_path"
-- resource type (src/lib/courseContent.js's uploadCmi5Resource). No change
-- needed to content_resources_storage_or_external_check -- its "any other
-- type" branch (storage_path required, external_url/page_content null)
-- already covers it once it's in this list, the same way scorm/xapi never
-- needed their own clause there either.
--
-- Launched the same simplified way this app's existing xAPI support
-- already uses (an auth token embedded directly in the iframe URL, ADL
-- Launch style) rather than cmi5's own formal fetch-URL/token-exchange
-- launch method and Initialized/Terminated statement lifecycle -- a
-- deliberate scope choice (see Cmi5Player.jsx), not an oversight.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'screen_recording', 'file', 'scorm', 'xapi', 'cmi5', 'external_video', 'web_url', 'page'));
