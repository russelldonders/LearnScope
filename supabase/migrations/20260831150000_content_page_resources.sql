-- Authored content pages are reusable organisation resources, attached to
-- courses through the existing course_content_links relationship. Their
-- versioned block document lives on the resource row; unlike uploaded media
-- there is no storage object or external URL to manage.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'screen_recording', 'file', 'scorm', 'xapi', 'external_video', 'web_url', 'page'));

alter table content_resources add column page_content jsonb;

alter table content_resources drop constraint content_resources_storage_or_external_check;
alter table content_resources add constraint content_resources_storage_or_external_check
  check (
    (type in ('external_video', 'web_url') and storage_path is null and external_url is not null and external_url ~ '^https?://' and page_content is null)
    or (type = 'page' and storage_path is null and external_url is null and page_content is not null)
    or (type not in ('external_video', 'web_url', 'page') and storage_path is not null and external_url is null and page_content is null)
  );

alter table content_resources add constraint content_resources_page_content_check
  check (
    page_content is null
    or (
      jsonb_typeof(page_content) = 'object'
      and page_content->>'version' = '1'
      and jsonb_typeof(page_content->'blocks') = 'array'
      and jsonb_array_length(page_content->'blocks') <= 100
    )
  );
