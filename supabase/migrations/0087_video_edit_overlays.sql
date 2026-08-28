-- Non-destructive video editing (trim/filter/speed + text & sticker
-- overlays) for provider training videos: the edit is stored as data and
-- applied at playback time (EditedVideoPlayer.jsx), never baked into the
-- uploaded file itself -- no re-encoding, no new storage write path, and
-- the original upload stays byte-for-byte untouched. Lives directly on
-- content_resources (one video = one edit) rather than a new table, since
-- it's never queried independently of its resource and inherits that
-- table's existing RLS ("Org members manage their own organisation's
-- resources") with no policy changes needed.
alter table content_resources add column video_edit jsonb;
