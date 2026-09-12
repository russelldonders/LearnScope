import { supabase } from './supabaseClient'

// account_type/employer_id (person_auth_accounts) record how the account
// ORIGINATED -- set once, by addEmployerMember, for an account it actually
// creates via invite -- and are deliberately not a live "who has access
// now" list. Currently active employer relationships come from
// employer_members separately, since an account's employer ties can change
// (and multiply) after it was first provisioned. Returns null for a
// personal (self-signup) account with nothing to show.
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

export async function claimPersonalAccountOwnership() {
  const { error } = await supabase.rpc('claim_personal_account_ownership')
  if (error) throw error
}
