import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/AppHeader'
import AccessibleDialog from '../components/AccessibleDialog'
import {
  getSearchPrivacySettings,
  updateSearchPrivacySettings,
  listSearchableSkillIds,
  setSkillSearchable,
} from '../lib/skillDiscovery'
import {
  listMyEmployerDataAccessStatus,
  shareDataWithEmployer,
  revokeEmployerDataAccess,
  updateSharedEmployerSkills,
  listSharedEmployerSkillIds,
} from '../lib/admin/employers'
import {
  createProfileShareLink,
  listMyProfileShareLinks,
  revokeProfileShareLink,
  profileShareLinkUrl,
} from '../lib/profileShareLinks'
import { formatAbsoluteDate } from '../lib/dates'
import ShareSkillsModal from '../components/ShareSkillsModal'

// Presets shown in the "Share via link" duration select -- deliberately
// short-lived options only; create_profile_share_link still enforces a hard
// 90-day server-side cap regardless of what a client sends.
const SHARE_LINK_DURATIONS = [
  { value: '1', label: '1 day' },
  { value: '3', label: '3 days' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
]

function shareLinkStatus(link) {
  if (link.revoked_at) return 'revoked'
  if (new Date(link.expires_at) <= new Date()) return 'expired'
  return 'active'
}

function shareLinkDescription(link) {
  if (link.label) return link.label
  if (link.share_skills && link.share_experience) return 'Skills + Experience'
  if (link.share_skills) return 'Skills'
  if (link.share_experience) return 'Experience'
  return 'Shared profile'
}

const VISIBILITY_OPTIONS = [
  {
    value: 'hidden',
    label: "Don't show me in skill searches",
    detail: "You won't appear when other learners search for people tracking the same skill.",
  },
  {
    value: 'all',
    label: 'Show me for all my skills',
    detail: 'Anyone tracking the same skill as you can find you in that skill’s search, and send a connection request.',
  },
  {
    value: 'selective',
    label: 'Choose which skills to show',
    detail: 'Pick individual skills below — you can also control this from each skill’s own settings.',
  },
]

export default function ProfilePrivacy() {
  const { user, employerMemberships } = useAuth()
  const [skillsProfileVisible, setSkillsProfileVisible] = useState(false)
  const [activityFeedVisible, setActivityFeedVisible] = useState(false)
  const [profileVisibleToMatches, setProfileVisibleToMatches] = useState(false)
  const [searchVisibility, setSearchVisibility] = useState('hidden')
  const [autoIncludeNewSkills, setAutoIncludeNewSkills] = useState(false)
  const [loading, setLoading] = useState(true)
  const [privacySaving, setPrivacySaving] = useState(false)
  const [privacyError, setPrivacyError] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Phase 5: employer data-access sharing state, loaded alongside the rest
  // of this page's privacy settings.
  const [employers, setEmployers] = useState([])
  const [dataAccessByEmployer, setDataAccessByEmployer] = useState({})
  const [dataAccessActingId, setDataAccessActingId] = useState(null)
  const [dataAccessError, setDataAccessError] = useState(null)
  // Per-skill sharing: how many skills are currently shared under each
  // approved request (keyed by employer_data_access_requests.id, not
  // employer id, since that's what employer_data_access_shared_skills rows
  // point at), the learner's own skills (for the share/edit picker), and
  // which employer the picker is currently open for.
  const [sharedSkillCountByRequest, setSharedSkillCountByRequest] = useState({})
  const [mySkills, setMySkills] = useState([])
  const [skillShareModal, setSkillShareModal] = useState(null)

  // "Share via link" -- proactive, token-based, no-account-required share
  // links (20260902300000_profile_share_links.sql), independent of the
  // employer data-access flow above.
  const [shareLinks, setShareLinks] = useState([])
  const [shareLinksLoading, setShareLinksLoading] = useState(true)
  const [shareLinkError, setShareLinkError] = useState(null)
  const [newLinkSkills, setNewLinkSkills] = useState(false)
  const [newLinkExperience, setNewLinkExperience] = useState(false)
  const [newLinkSkillIds, setNewLinkSkillIds] = useState(new Set())
  const [newLinkDuration, setNewLinkDuration] = useState(SHARE_LINK_DURATIONS[2].value)
  const [newLinkLabel, setNewLinkLabel] = useState('')
  const [creatingLink, setCreatingLink] = useState(false)
  const [createdLinkUrl, setCreatedLinkUrl] = useState(null)
  const [skillPickerForLinkOpen, setSkillPickerForLinkOpen] = useState(false)
  const [revokingLinkId, setRevokingLinkId] = useState(null)
  const [copiedLinkId, setCopiedLinkId] = useState(null)

  const activeEmployerIds = useMemo(
    () => (employerMemberships ?? []).map((m) => m.employer_id),
    [employerMemberships]
  )

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    loadEmployerDataAccess()
  }, [activeEmployerIds.join(',')])

  useEffect(() => {
    loadShareLinks()
  }, [])

  async function loadShareLinks() {
    setShareLinksLoading(true)
    try {
      const rows = await listMyProfileShareLinks()
      setShareLinks(rows)
    } catch (err) {
      setShareLinkError(err.message)
    } finally {
      setShareLinksLoading(false)
    }
  }

  async function load() {
    try {
      const [{ data }, searchSettings, { data: skillsData, error: skillsError }] = await Promise.all([
        supabase.from('profiles').select('skills_profile_visible').eq('id', user.id).single(),
        getSearchPrivacySettings(user.id),
        supabase.from('skills').select('id, name').eq('user_id', user.id).order('name', { ascending: true }),
      ])
      if (skillsError) throw skillsError
      setSkillsProfileVisible(data?.skills_profile_visible ?? false)
      setActivityFeedVisible(searchSettings?.activity_feed_visible ?? false)
      setProfileVisibleToMatches(searchSettings?.profile_visible_to_skill_matches ?? false)
      setSearchVisibility(searchSettings?.skill_search_visibility ?? 'hidden')
      setAutoIncludeNewSkills(searchSettings?.auto_include_new_skills_in_search ?? false)
      setMySkills(skillsData ?? [])
    } catch (err) {
      setPrivacyError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Every employer the learner is currently an active member of, joined to
  // their current data-access status with that employer (if any request or
  // share has ever happened). employerMemberships (useAuth) only carries
  // employer_id/role, not the employer's name, so that's fetched separately
  // here -- scoped by "Employer members can view their employer" RLS, same
  // as listEmployers relies on elsewhere.
  async function loadEmployerDataAccess() {
    if (activeEmployerIds.length === 0) {
      setEmployers([])
      setDataAccessByEmployer({})
      setSharedSkillCountByRequest({})
      return
    }
    try {
      const [{ data: employersData, error: employersError }, statusRows] = await Promise.all([
        supabase.from('employers').select('id, name').in('id', activeEmployerIds),
        listMyEmployerDataAccessStatus(user.id),
      ])
      if (employersError) throw employersError
      setEmployers(employersData ?? [])
      setDataAccessByEmployer(Object.fromEntries(statusRows.map((r) => [r.employer_id, r])))

      // Skill-count summary, so a learner can see at a glance what each
      // approved employer can currently see -- one query across every
      // approved request rather than one round trip per employer.
      const approvedRequestIds = statusRows.filter((r) => r.status === 'approved').map((r) => r.id)
      if (approvedRequestIds.length === 0) {
        setSharedSkillCountByRequest({})
      } else {
        const { data: sharedRows, error: sharedError } = await supabase
          .from('employer_data_access_shared_skills')
          .select('request_id')
          .in('request_id', approvedRequestIds)
        if (sharedError) throw sharedError
        const counts = {}
        for (const row of sharedRows ?? []) {
          counts[row.request_id] = (counts[row.request_id] ?? 0) + 1
        }
        setSharedSkillCountByRequest(counts)
      }
    } catch (err) {
      setDataAccessError({ id: null, message: err.message })
    }
  }

  // Opens ShareSkillsModal for a brand-new share (nothing preselected).
  function handleOpenShare(employerId) {
    setDataAccessError(null)
    setSkillShareModal({ employerId, requestId: null, initialSkillIds: [] })
  }

  // Opens ShareSkillsModal pre-filled with the employer's current shared
  // skills, so the learner can add/remove without starting over.
  async function handleOpenEditShared(employerId, requestId) {
    setDataAccessError(null)
    setDataAccessActingId(employerId)
    try {
      const skillIds = await listSharedEmployerSkillIds(requestId)
      setSkillShareModal({ employerId, requestId, initialSkillIds: skillIds })
    } catch (err) {
      setDataAccessError({ id: employerId, message: err.message })
    } finally {
      setDataAccessActingId(null)
    }
  }

  // Confirm handler for ShareSkillsModal -- branches on whether this is a
  // fresh share (share_data_with_employer, may also accept a pending
  // request in the same call) or editing an already-approved grant
  // (update_shared_employer_skills). Throws back to the modal on error so
  // it stays open and shows the message inline, matching its own pattern.
  async function handleConfirmSkillShare(skillIds) {
    const { employerId, requestId } = skillShareModal
    if (requestId) {
      await updateSharedEmployerSkills(requestId, skillIds)
      setSharedSkillCountByRequest((prev) => ({ ...prev, [requestId]: skillIds.length }))
    } else {
      const row = await shareDataWithEmployer(employerId, skillIds)
      setDataAccessByEmployer((prev) => ({ ...prev, [employerId]: row }))
      setSharedSkillCountByRequest((prev) => ({ ...prev, [row.id]: skillIds.length }))
    }
    setSkillShareModal(null)
  }

  async function handleRevoke(employerId, requestId) {
    setDataAccessError(null)
    setDataAccessActingId(employerId)
    try {
      await revokeEmployerDataAccess(requestId)
      setDataAccessByEmployer((prev) => ({ ...prev, [employerId]: { ...prev[employerId], status: 'revoked' } }))
      setSharedSkillCountByRequest((prev) => {
        const next = { ...prev }
        delete next[requestId]
        return next
      })
    } catch (err) {
      setDataAccessError({ id: employerId, message: err.message })
    } finally {
      setDataAccessActingId(null)
    }
  }

  async function handleCreateShareLink(e) {
    e.preventDefault()
    setShareLinkError(null)
    if (!newLinkSkills && !newLinkExperience) {
      setShareLinkError('Choose at least one thing to share.')
      return
    }
    setCreatingLink(true)
    try {
      const days = Number(newLinkDuration)
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
      const row = await createProfileShareLink({
        shareSkills: newLinkSkills,
        shareExperience: newLinkExperience,
        skillIds: newLinkSkills ? [...newLinkSkillIds] : [],
        expiresAt,
        label: newLinkLabel.trim(),
      })
      setShareLinks((prev) => [row, ...prev])
      setCreatedLinkUrl(profileShareLinkUrl(row.token))
      setNewLinkSkills(false)
      setNewLinkExperience(false)
      setNewLinkSkillIds(new Set())
      setNewLinkLabel('')
      setNewLinkDuration(SHARE_LINK_DURATIONS[2].value)
    } catch (err) {
      setShareLinkError(err.message)
    } finally {
      setCreatingLink(false)
    }
  }

  async function handleRevokeShareLink(linkId) {
    setShareLinkError(null)
    setRevokingLinkId(linkId)
    try {
      await revokeProfileShareLink(linkId)
      setShareLinks((prev) =>
        prev.map((l) => (l.id === linkId ? { ...l, revoked_at: new Date().toISOString() } : l))
      )
    } catch (err) {
      setShareLinkError(err.message)
    } finally {
      setRevokingLinkId(null)
    }
  }

  async function handleCopyShareLink(linkId, token) {
    try {
      await navigator.clipboard.writeText(profileShareLinkUrl(token))
      setCopiedLinkId(linkId)
      setTimeout(() => setCopiedLinkId((current) => (current === linkId ? null : current)), 2000)
    } catch {
      // Clipboard API may be unavailable (e.g. insecure context) -- the URL
      // is still visible/selectable in the UI, so this is a soft failure.
    }
  }

  async function handlePrivacyToggle(checked) {
    setPrivacyError(null)
    setPrivacySaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ skills_profile_visible: checked, updated_at: new Date().toISOString() })
      .eq('id', user.id)
    if (error) {
      setPrivacyError(error.message)
    } else {
      setSkillsProfileVisible(checked)
    }
    setPrivacySaving(false)
  }

  async function handleActivityFeedToggle(checked) {
    setPrivacyError(null)
    setPrivacySaving(true)
    try {
      await updateSearchPrivacySettings(user.id, { activity_feed_visible: checked })
      setActivityFeedVisible(checked)
    } catch (err) {
      setPrivacyError(err.message)
    }
    setPrivacySaving(false)
  }

  async function handleProfileVisibleToggle(checked) {
    setPrivacyError(null)
    setPrivacySaving(true)
    try {
      await updateSearchPrivacySettings(user.id, { profile_visible_to_skill_matches: checked })
      setProfileVisibleToMatches(checked)
    } catch (err) {
      setPrivacyError(err.message)
    }
    setPrivacySaving(false)
  }

  async function handleVisibilityChange(value) {
    setPrivacyError(null)
    setPrivacySaving(true)
    try {
      await updateSearchPrivacySettings(user.id, { skill_search_visibility: value })
      setSearchVisibility(value)
    } catch (err) {
      setPrivacyError(err.message)
    }
    setPrivacySaving(false)
  }

  async function handleAutoIncludeToggle(checked) {
    setPrivacyError(null)
    setPrivacySaving(true)
    try {
      await updateSearchPrivacySettings(user.id, { auto_include_new_skills_in_search: checked })
      setAutoIncludeNewSkills(checked)
    } catch (err) {
      setPrivacyError(err.message)
    }
    setPrivacySaving(false)
  }

  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />

      <main id="main-content" tabIndex={-1} className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <h1 className="font-display text-xl text-ink mb-2">Privacy settings</h1>

        {loading ? (
          <p className="text-secondary">Loading…</p>
        ) : (
          <>
            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">Skills profile</h3>
              <p className="text-sm text-secondary mb-4">
                Control what people you're connected with can see about you.
              </p>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={skillsProfileVisible}
                  disabled={privacySaving}
                  onChange={(e) => handlePrivacyToggle(e.target.checked)}
                  className="mt-0.5 rounded border-hairline"
                />
                <span className="text-sm text-ink">
                  Let connections view your skills profile by clicking your name on their
                  Connections list
                  <span className="block text-xs text-secondary mt-0.5">
                    Shows only skill names, categories, and levels — not notes, evidence, or why
                    you're tracking them. Only visible to people you've already exchanged a skill
                    rating with. On by default — turn it off here if you'd rather keep it private.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3 mt-4 pt-4 border-t border-hairline">
                <input
                  type="checkbox"
                  checked={profileVisibleToMatches}
                  disabled={privacySaving}
                  onChange={(e) => handleProfileVisibleToggle(e.target.checked)}
                  className="mt-0.5 rounded border-hairline"
                />
                <span className="text-sm text-ink">
                  Show my profile to people I'm not connected with yet, if we track the same skill
                  <span className="block text-xs text-secondary mt-0.5">
                    Only applies to people who find you via skill search below — doesn't change
                    who can find you in the first place.
                  </span>
                </span>
              </label>
            </div>

            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">Activity feed</h3>
              <p className="text-sm text-secondary mb-4">
                Control whether your milestones show up in your connections' "What your
                connections are up to" feed.
              </p>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={activityFeedVisible}
                  disabled={privacySaving}
                  onChange={(e) => handleActivityFeedToggle(e.target.checked)}
                  className="mt-0.5 rounded border-hairline"
                />
                <span className="text-sm text-ink">
                  Let your connections see your activity
                  <span className="block text-xs text-secondary mt-0.5">
                    Shows things like skills confirmed, new skills or experience added, and
                    courses started — only to people you're already connected with. On by
                    default — turn it off here if you'd rather keep it private.
                  </span>
                </span>
              </label>
            </div>

            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">Skill search</h3>
              <p className="text-sm text-secondary mb-4">
                Control whether people tracking the same skill as you can find and connect with
                you, even before you're connected.
              </p>
              <div className="space-y-3">
                {VISIBILITY_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="skill-search-visibility"
                      checked={searchVisibility === opt.value}
                      disabled={privacySaving}
                      onChange={() => handleVisibilityChange(opt.value)}
                      className="mt-0.5"
                    />
                    <span className="text-sm text-ink">
                      {opt.label}
                      <span className="block text-xs text-secondary mt-0.5">{opt.detail}</span>
                    </span>
                  </label>
                ))}
              </div>

              {searchVisibility === 'selective' && (
                <div className="mt-4 pt-4 border-t border-hairline space-y-3">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={autoIncludeNewSkills}
                      disabled={privacySaving}
                      onChange={(e) => handleAutoIncludeToggle(e.target.checked)}
                      className="mt-0.5 rounded border-hairline"
                    />
                    <span className="text-sm text-ink">Show in searches for any newly added skills</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper"
                  >
                    Choose which skills…
                  </button>
                </div>
              )}
            </div>

            {employers.length > 0 && (
              <div className="bg-card border border-hairline rounded-lg p-6">
                <h3 className="font-display text-lg text-ink mb-1">Employers</h3>
                <p className="text-sm text-secondary mb-4">
                  Control which specific skills an employer you belong to can see. This is
                  separate from any training they've assigned you — sharing here also lets their
                  admins see the skills you choose and the evidence behind them. You choose which
                  skills, and you can change your selection or revoke access entirely at any
                  time; revoking only removes what you've explicitly shared here — it doesn't
                  affect anything the employer already sees automatically from training they've
                  assigned you.
                </p>
                <ul className="space-y-3">
                  {employers.map((employer) => {
                    const access = dataAccessByEmployer[employer.id]
                    const isShared = access?.status === 'approved'
                    const sharedCount = isShared ? (sharedSkillCountByRequest[access.id] ?? 0) : 0
                    const acting = dataAccessActingId === employer.id
                    return (
                      <li
                        key={employer.id}
                        className="flex items-center justify-between gap-3 pt-3 border-t border-hairline first:border-0 first:pt-0"
                      >
                        <div>
                          <p className="text-sm text-ink">{employer.name}</p>
                          <p className="text-xs text-secondary">
                            {isShared
                              ? sharedCount > 0
                                ? `Shared — ${sharedCount} skill${sharedCount === 1 ? '' : 's'} visible to this employer`
                                : 'Shared — no skills selected yet'
                              : access?.status === 'pending'
                                ? 'This employer has requested access — respond from your Actions page, or share directly below'
                                : 'Not shared'}
                          </p>
                          {dataAccessError?.id === employer.id && (
                            <p className="text-xs text-red-700 mt-1">{dataAccessError.message}</p>
                          )}
                        </div>
                        {isShared ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleOpenEditShared(employer.id, access.id)}
                              disabled={acting}
                              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60 whitespace-nowrap"
                            >
                              Edit shared skills
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRevoke(employer.id, access.id)}
                              disabled={acting}
                              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60 whitespace-nowrap"
                            >
                              {acting ? 'Revoking…' : 'Revoke access'}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleOpenShare(employer.id)}
                            disabled={acting}
                            className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
                          >
                            Share my skills profile
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            <div className="bg-card border border-hairline rounded-lg p-6">
              <h3 className="font-display text-lg text-ink mb-1">Share via link</h3>
              <p className="text-sm text-secondary mb-4">
                Generate a link you can send to anyone — they don't need a LearnScope account to
                view it. Links expire automatically and you can revoke one at any time.
              </p>

              <form onSubmit={handleCreateShareLink} className="space-y-3">
                <div className="space-y-2">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={newLinkSkills}
                      disabled={creatingLink}
                      onChange={(e) => setNewLinkSkills(e.target.checked)}
                      className="rounded border-hairline"
                    />
                    <span className="text-sm text-ink">Skills</span>
                  </label>
                  {newLinkSkills && (
                    <div className="ml-7">
                      <button
                        type="button"
                        onClick={() => setSkillPickerForLinkOpen(true)}
                        disabled={creatingLink}
                        className="rounded-md border border-hairline text-ink py-1 px-3 text-xs font-medium hover:bg-paper disabled:opacity-60"
                      >
                        {newLinkSkillIds.size > 0
                          ? `${newLinkSkillIds.size} skill${newLinkSkillIds.size === 1 ? '' : 's'} selected`
                          : 'Choose skills…'}
                      </button>
                    </div>
                  )}
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={newLinkExperience}
                      disabled={creatingLink}
                      onChange={(e) => setNewLinkExperience(e.target.checked)}
                      className="rounded border-hairline"
                    />
                    <span className="text-sm text-ink">Experience</span>
                  </label>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-secondary mb-1" htmlFor="share-link-duration">
                      Expires after
                    </label>
                    <select
                      id="share-link-duration"
                      value={newLinkDuration}
                      disabled={creatingLink}
                      onChange={(e) => setNewLinkDuration(e.target.value)}
                      className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                    >
                      {SHARE_LINK_DURATIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-secondary mb-1" htmlFor="share-link-label">
                      Label (optional)
                    </label>
                    <input
                      id="share-link-label"
                      type="text"
                      value={newLinkLabel}
                      disabled={creatingLink}
                      onChange={(e) => setNewLinkLabel(e.target.value)}
                      placeholder="e.g. For Acme Corp interview"
                      className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-moss"
                    />
                  </div>
                </div>

                {shareLinkError && <p className="text-sm text-red-700">{shareLinkError}</p>}

                <button
                  type="submit"
                  disabled={creatingLink}
                  className="rounded-md bg-moss text-paper py-1.5 px-3 text-sm font-medium hover:opacity-90 disabled:opacity-60"
                >
                  {creatingLink ? 'Creating…' : 'Create link'}
                </button>
              </form>

              {createdLinkUrl && (
                <div className="mt-4 pt-4 border-t border-hairline">
                  <p className="text-xs text-secondary mb-1">Share this link:</p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={createdLinkUrl}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 min-w-0 rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink"
                    />
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(createdLinkUrl)}
                      className="shrink-0 rounded-md border border-hairline text-ink py-2 px-3 text-sm font-medium hover:bg-paper"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}

              {!shareLinksLoading && shareLinks.length > 0 && (
                <ul className="mt-4 pt-4 border-t border-hairline space-y-3">
                  {shareLinks.map((link) => {
                    const status = shareLinkStatus(link)
                    const acting = revokingLinkId === link.id
                    return (
                      <li
                        key={link.id}
                        className="flex items-center justify-between gap-3 pt-3 border-t border-hairline first:border-0 first:pt-0"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-ink truncate">{shareLinkDescription(link)}</p>
                          <p className="text-xs text-secondary">
                            {status === 'active' && `Expires ${formatAbsoluteDate(link.expires_at)}`}
                            {status === 'expired' && `Expired ${formatAbsoluteDate(link.expires_at)}`}
                            {status === 'revoked' && 'Revoked'}
                          </p>
                        </div>
                        {status === 'active' && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleCopyShareLink(link.id, link.token)}
                              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper whitespace-nowrap"
                            >
                              {copiedLinkId === link.id ? 'Copied!' : 'Copy link'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRevokeShareLink(link.id)}
                              disabled={acting}
                              className="rounded-md border border-hairline text-ink py-1.5 px-3 text-sm font-medium hover:bg-paper disabled:opacity-60 whitespace-nowrap"
                            >
                              {acting ? 'Revoking…' : 'Revoke'}
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {privacyError && <p className="text-sm text-red-700">{privacyError}</p>}
          </>
        )}
      </main>

      {pickerOpen && <SearchableSkillsModal userId={user.id} onClose={() => setPickerOpen(false)} />}

      {skillShareModal && (
        <ShareSkillsModal
          skills={mySkills}
          initiallySelectedIds={skillShareModal.initialSkillIds}
          title={skillShareModal.requestId ? 'Edit shared skills' : 'Choose skills to share'}
          description={
            skillShareModal.requestId
              ? 'Add or remove which of your skills this employer can see.'
              : 'Pick which of your skills this employer can see. You can change this any time.'
          }
          confirmLabel={skillShareModal.requestId ? 'Save' : 'Share'}
          onConfirm={handleConfirmSkillShare}
          onClose={() => setSkillShareModal(null)}
        />
      )}

      {skillPickerForLinkOpen && (
        <ShareSkillsModal
          skills={mySkills}
          initiallySelectedIds={[...newLinkSkillIds]}
          title="Choose skills to share"
          description="Pick which of your skills this link's viewer can see."
          confirmLabel="Confirm"
          onConfirm={(ids) => {
            setNewLinkSkillIds(new Set(ids))
            setSkillPickerForLinkOpen(false)
          }}
          onClose={() => setSkillPickerForLinkOpen(false)}
        />
      )}
    </div>
  )
}

function SearchableSkillsModal({ userId, onClose }) {
  const [skills, setSkills] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [savingId, setSavingId] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase.from('skills').select('id, name').eq('user_id', userId).order('name', { ascending: true }),
      listSearchableSkillIds(userId),
    ])
      .then(([{ data, error: skillsError }, searchableIds]) => {
        if (skillsError) throw skillsError
        setSkills(data ?? [])
        setSelected(searchableIds)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [userId])

  async function toggle(skillId, checked) {
    setSavingId(skillId)
    setError(null)
    try {
      await setSkillSearchable(userId, skillId, checked)
      setSelected((prev) => {
        const next = new Set(prev)
        if (checked) next.add(skillId)
        else next.delete(skillId)
        return next
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <AccessibleDialog
      labelledBy="search-skills-dialog-title"
      onClose={onClose}
      panelClassName="w-full max-w-md bg-card border border-hairline rounded-lg p-6 max-h-[90vh] overflow-y-auto overscroll-contain"
    >
        <div className="flex items-center justify-between mb-4">
          <h2 id="search-skills-dialog-title" className="font-display text-2xl text-ink">Skills shown in search</h2>
          <button type="button" onClick={onClose} className="text-secondary hover:text-ink text-sm">
            Close
          </button>
        </div>
        {loading && <p className="text-sm text-secondary">Loading…</p>}
        {error && <p role="alert" className="text-sm text-red-700 mb-2">{error}</p>}
        {!loading && skills.length === 0 && <p className="text-sm text-secondary">You haven't added any skills yet.</p>}
        <ul className="space-y-2">
          {skills.map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  disabled={savingId === s.id}
                  onChange={(e) => toggle(s.id, e.target.checked)}
                  className="rounded border-hairline"
                />
                <span className="text-sm text-ink">{s.name}</span>
              </label>
            </li>
          ))}
        </ul>
    </AccessibleDialog>
  )
}
