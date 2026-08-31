-- Screen recordings share the existing secure video storage and playback
-- pipeline, but remain a distinct resource kind throughout the product.
alter table content_resources drop constraint content_resources_type_check;
alter table content_resources add constraint content_resources_type_check
  check (type in ('video', 'screen_recording', 'file', 'scorm', 'xapi', 'external_video'));
