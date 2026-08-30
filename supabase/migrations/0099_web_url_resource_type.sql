-- Generic web links are stored resources, distinct from canonicalized
-- YouTube/Vimeo embeds. Both URL-backed types carry external_url and no
-- storage path; uploaded resource types retain the inverse invariant.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'screen_recording', 'file', 'scorm', 'xapi', 'external_video', 'web_url'));

alter table content_resources drop constraint content_resources_storage_or_external_check;
alter table content_resources add constraint content_resources_storage_or_external_check
  check (
    (
      type in ('external_video', 'web_url')
      and storage_path is null
      and external_url is not null
      and external_url ~ '^https?://'
    )
    or (type not in ('external_video', 'web_url') and storage_path is not null and external_url is null)
  );
