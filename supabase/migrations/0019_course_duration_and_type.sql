-- Free-text duration ("6 weeks", "40 hours", "3 years"...) rather than a
-- structured value+unit pair -- durations for courses are reported in
-- wildly different units and a single text field keeps the form simple.
alter table courses add column duration text;

-- Course type/modality (Online, Degree, Blended, Seminar...). Free text
-- rather than a fixed enum so it stays extensible without a migration,
-- matching the same input+datalist "suggest, don't restrict" pattern
-- already used for skill categories.
alter table courses add column course_type text;
