-- Three roster-field improvements (20260911150000's base fields), all
-- requested together: language and location become proper selection lists
-- instead of free text, and the roster's own "Status" field becomes the
-- thing that actually controls an employer member's access -- previously
-- it was purely informational, disconnected from employer_members.status
-- (the column every access check in the app actually reads).

-- ----------------------------------------------------------------------------
-- Language / Location as select fields
-- ----------------------------------------------------------------------------

-- Mirrors src/lib/i18n/translations.js's INTERFACE_LANGUAGES labels -- kept
-- as a static snapshot here rather than read from that file at render time,
-- same tradeoff the pre-existing employment_status options already made
-- (a real value/label mapping would need the field-input renderer to carry
-- both, which nothing else in this feature needs yet).
update employer_field_definitions
set field_type = 'select',
    options = '["English", "Español", "Français", "Deutsch", "Italiano", "Nederlands", "中文"]'::jsonb
where employer_id is null and key = 'language';

-- Mirrors src/lib/countries.js's COUNTRIES list.
update employer_field_definitions
set field_type = 'select',
    options = '["Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Côte d''Ivoire","Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo (Congo-Brazzaville)","Costa Rica","Croatia","Cuba","Cyprus","Czechia","Democratic Republic of the Congo","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Holy See","Honduras","Hong Kong","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States of America","Uruguay","Uzbekistan","Vanuatu","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"]'::jsonb
where employer_id is null and key = 'location';

-- ----------------------------------------------------------------------------
-- Roster "Status" (employment_status) now actually controls access
-- ----------------------------------------------------------------------------

-- 'inactive' is new -- 'pending' is untouched and stays exclusively the
-- separate invite-acceptance state (decide_employer_invite, 20260902160000);
-- this trigger below never writes 'pending' and skips a pending row
-- entirely, so the two states can't collide.
alter table employer_members drop constraint employer_members_status_check;
alter table employer_members add constraint employer_members_status_check
  check (status in ('active', 'pending', 'inactive'));

-- Every access check that matters already reads employer_members.status --
-- AuthContext.refreshEmployerMemberships (and so EmployerAdminRoute/
-- EmployerMemberRoute), and Login.jsx's own employer-membership gate
-- (20260912090000) both already filter to status = 'active'. So syncing
-- employment_status into this column is enough to actually cut off
-- employer-scoped access for 'Inactive' -- deliberately doesn't touch
-- is_employer_member/is_employer_admin (used throughout this domain's RLS),
-- since neither currently distinguishes active from pending either; that's
-- a separate, wider-blast-radius tightening this migration isn't making.
--
-- 'On leave' intentionally still counts as active (only "Inactive" itself
-- revokes access) -- someone on leave is still employed, and this field
-- only ever affects employer-linked visibility, never the learner's own
-- LearnScope account otherwise (same boundary sync_employer_field_value_to_
-- profile, 20260912100000, already keeps for the name-seeding case).
create or replace function sync_employment_status_to_employer_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_current_status text;
begin
  select key into v_key from employer_field_definitions where id = new.field_definition_id;
  if v_key <> 'employment_status' then
    return new;
  end if;

  select status into v_current_status from employer_members where id = new.employer_member_id;
  if v_current_status = 'pending' then
    return new;
  end if;

  update employer_members
  set status = case when new.value = 'Inactive' then 'inactive' else 'active' end
  where id = new.employer_member_id;

  return new;
end;
$$;

create trigger sync_employment_status_to_employer_member_trigger
  after insert or update of value on employer_member_field_values
  for each row execute procedure sync_employment_status_to_employer_member();
