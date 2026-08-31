-- Subjects may be recorded with exact dates, a human-readable study
-- duration, or both. Other experience types retain the app's required-date
-- behaviour even though the column must become nullable for subjects.

alter table public.experience
  alter column start_date drop not null,
  add column study_duration text;

alter table public.experience
  add constraint experience_subject_timing_check check (
    (
      type = 'subject'
      and (start_date is not null or length(trim(study_duration)) > 0)
      and (end_date is null or start_date is not null)
    )
    or (
      type <> 'subject'
      and start_date is not null
      and study_duration is null
    )
  );
