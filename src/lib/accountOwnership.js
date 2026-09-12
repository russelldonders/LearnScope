import { supabase } from './supabaseClient'

// account_type/employer_id (person_auth_accounts) record how the account
// ORIGINATED -- set once, by addEmployerMember, for an account it actually
// creates via invite -- and are deliberately not a live "who currently has
// access" list. Currently active employer relationships come from
// employer_members separately, since an account's employer ties can change
// (and multiply) after it was first provisioned. "Personal ownership" is
// read straight off the existing account-linking feature (verified_account
// _links, src/pages/account-linking/) -- once this account has been
// verified-linked to another one, the learner has an independent login of
// their own to fall back to, and can use the existing transfer flow to
// choose what carries over to it. Returns null for a personal (self-signup)
// account with nothing to show.
export async function getMyAccountOwnership() {
  const { data, error } = await supabase.rpc('get_my_account_ownership')
  if (error) throw error
  const row = data?.[0]
  if (!row || row.account_type === 'personal') return null

  return {
    originEmployerName: row.origin_employer_name,
    personalOwnershipClaimedAt: row.personal_ownership_claimed_at,
    activeEmployerNames: row.active_employer_names ?? [],
  }
}
