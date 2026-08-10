alter table skills add column source text
  not null default 'manual'
  check (source in ('manual', 'cv_import'));
