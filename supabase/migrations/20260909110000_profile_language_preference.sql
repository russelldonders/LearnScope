-- Learner's chosen display language, same shape as 0086's theme_preference:
-- follows the account across devices once signed in (see LanguageContext.jsx),
-- while an unauthenticated visitor's choice stays in localStorage only.
alter table profiles add column language_preference text not null default 'en'
  check (language_preference in ('en', 'es'));
