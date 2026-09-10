-- Widen 20260909110000's language_preference check to the additional
-- interface languages being translated (see src/lib/i18n/translations.js).
alter table profiles drop constraint profiles_language_preference_check;
alter table profiles add constraint profiles_language_preference_check
  check (language_preference in ('en', 'es', 'fr', 'de', 'it', 'nl', 'zh'));
