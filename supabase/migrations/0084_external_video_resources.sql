-- External video (YouTube/Vimeo) as a fifth content_resources type, alongside
-- video/file/scorm/xapi (0071, 0079) -- a link the provider pastes, not a
-- file they upload, so there's nothing to put in storage_path. Reuses the
-- same table/course_content_links attachment mechanism rather than a
-- parallel "linked resource" concept (see CLAUDE.md's domain-duplication
-- rule) -- an external video is just another kind of launchable content item.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'file', 'scorm', 'xapi', 'external_video'));

alter table content_resources alter column storage_path drop not null;

alter table content_resources add column external_url text;

-- external_video rows carry a URL and no storage; every other type carries
-- storage and no URL. The app stores its own canonicalized embed URL here
-- (youtube.com/embed/{id} or player.vimeo.com/video/{id}), not whatever the
-- provider originally pasted -- see courseContent.js's addExternalVideoResource.
alter table content_resources add constraint content_resources_storage_or_external_check
  check (
    (type = 'external_video' and storage_path is null and external_url is not null)
    or (type <> 'external_video' and storage_path is not null and external_url is null)
  );
