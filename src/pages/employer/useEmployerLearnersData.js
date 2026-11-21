import { useEffect, useState } from 'react'
import { listEmployerMembers, listEmployerDataAccessRequests, listFieldDefinitionsForEmployer, listEmployerMemberFieldValues } from '../../lib/admin/employers'
import { listOrganisationMembers } from '../../lib/admin/organisations'

// The employer People panel's records: the employer's members, the attached
// training provider's staff, each member's data-access request and roster
// field values. load() and the setters are returned so the panel can reload
// or patch these after the admin changes something; error is shared with the
// panel's own add/remove actions.
export function useEmployerLearnersData(employerId, attachedProviderOrg) {
  const [members, setMembers] = useState([])
  const [trainingStaff, setTrainingStaff] = useState([])
  const [trainingStaffError, setTrainingStaffError] = useState(null)
  const [trainingStaffLoading, setTrainingStaffLoading] = useState(Boolean(attachedProviderOrg))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Phase 5: employer-side view of each member's data-access consent state.
  // Keyed by learner_id -- there's at most one row per (employer, learner)
  // pair (unique constraint), so a plain map is enough.
  const [dataAccessByLearner, setDataAccessByLearner] = useState({})

  // Roster field values (20260911130000) -- the employer's own record about
  // each member, separate from their actual LearnScope profile. Keyed by
  // employer_member_id (not user_id) since that's what the values table
  // itself is keyed to.
  const [fieldDefinitions, setFieldDefinitions] = useState([])
  const [fieldValuesByMember, setFieldValuesByMember] = useState({})

  useEffect(() => {
    let cancelled = false
    setTrainingStaff([])
    setTrainingStaffError(null)
    setTrainingStaffLoading(Boolean(attachedProviderOrg))
    if (attachedProviderOrg) {
      listOrganisationMembers(attachedProviderOrg.id)
        .then((staff) => { if (!cancelled) setTrainingStaff(staff) })
        .catch((err) => { if (!cancelled) setTrainingStaffError(err.message) })
        .finally(() => { if (!cancelled) setTrainingStaffLoading(false) })
    }
    return () => { cancelled = true }
  }, [attachedProviderOrg])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the listed values change; the loaders are recreated every render
  }, [employerId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [membersData, dataAccessData, fields, values] = await Promise.all([
        listEmployerMembers(employerId),
        listEmployerDataAccessRequests(employerId),
        listFieldDefinitionsForEmployer(employerId),
        listEmployerMemberFieldValues(employerId),
      ])
      setMembers(membersData)
      setDataAccessByLearner(Object.fromEntries(dataAccessData.map((r) => [r.learner_id, r])))
      setFieldDefinitions(fields)
      const byMember = {}
      for (const v of values) {
        byMember[v.employer_member_id] = { ...byMember[v.employer_member_id], [v.field_definition_id]: v.value }
      }
      setFieldValuesByMember(byMember)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return {
    members,
    trainingStaff,
    setTrainingStaff,
    trainingStaffError,
    setTrainingStaffError,
    trainingStaffLoading,
    loading,
    error,
    setError,
    dataAccessByLearner,
    setDataAccessByLearner,
    fieldDefinitions,
    fieldValuesByMember,
    setFieldValuesByMember,
    load,
  }
}
