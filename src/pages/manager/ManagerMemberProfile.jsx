import { useCallback, useEffect, useState } from 'react'
import PersonAvatar from '../../components/PersonAvatar'
import GrowthRing from '../../components/GrowthRing'
import KnowledgeLevelBar from '../../components/KnowledgeLevelBar'
import MutationFeedback from '../../components/MutationFeedback'
import { LEVELS, LEVEL_LABELS, KNOWLEDGE_LEVEL_LABELS } from '../../lib/levels'
import { formatAbsoluteDate } from '../../lib/dates'
import { RateSkillDialog } from './ManagerTeamPanel'
import { useLanguage } from '../../context/LanguageContext'

const actionClass = 'rounded-md border border-hairline px-3 py-2 text-sm font-medium text-ink hover:bg-paper focus-visible:outline-2 focus-visible:outline-moss'

export default function ManagerMemberProfile({ member, initialSkillId = null, onBack, onRateSkill, onLoadSkillAssessments, onLoadSkillDetail, onSetTarget }) {
  const { t } = useLanguage()
  const [skillId, setSkillId] = useState(initialSkillId)
  const skill = member.sharedSkills?.find((item) => item.id === skillId)
  return <div className="space-y-6">
    <nav aria-label={t('managerTeam.profile.navLabel')} className="flex flex-wrap gap-3 text-sm">
      <button className="text-moss underline underline-offset-4" onClick={onBack}>{t('managerTeam.profile.backToTeam')}</button>
      {skill && <button className="text-moss underline underline-offset-4" onClick={() => setSkillId(null)}>{t('managerTeam.profile.backToSkills', { name: member.name })}</button>}
    </nav>
    <div className="flex items-center gap-3">
      <PersonAvatar name={member.name} avatarUrl={member.avatarUrl} size={10} />
      <div><h2 className="font-display text-2xl text-ink">{t('managerTeam.profile.heading', { name: member.name })}</h2>
        <p className="text-sm text-secondary">{t('managerTeam.profile.intro')}</p></div>
    </div>
    {skill ? <ManagerSkillDetail key={skill.id} member={member} skill={skill} onRateSkill={onRateSkill}
      onLoadSkillAssessments={onLoadSkillAssessments} onLoadSkillDetail={onLoadSkillDetail} onSetTarget={onSetTarget} />
      : <div className="divide-y divide-hairline border-y border-hairline">
        {member.sharedSkills?.length ? member.sharedSkills.map((item) => <button key={item.id}
          onClick={() => setSkillId(item.id)} aria-label={t('managerTeam.profile.viewDetailLabel', { skill: item.name })}
          className="flex w-full items-center gap-4 py-4 px-2 text-left hover:bg-card focus-visible:outline-2 focus-visible:outline-moss">
          <GrowthRing level={item.level} size={56} />
          <span className="min-w-0 flex-1"><span className="block font-medium text-ink">{item.name}</span>
            <span className="block text-sm text-secondary">{LEVEL_LABELS[item.level] ?? t('managerTeam.profile.notSelfAssessed')} · {t('managerTeam.profile.evidenceItems', { count: item.evidenceCount ?? 0 })}</span></span>
          <span className="text-sm text-moss">{t('managerTeam.profile.viewDetail')}</span>
        </button>) : <p className="py-8 text-sm text-secondary">{t('managerTeam.profile.noneShared')}</p>}
      </div>}
  </div>
}

function ManagerSkillDetail({ member, skill, onRateSkill, onLoadSkillAssessments, onLoadSkillDetail, onSetTarget }) {
  const { t } = useLanguage()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [revision, setRevision] = useState(0)
  const [ratingOpen, setRatingOpen] = useState(false)
  const [targetOpen, setTargetOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [savedRating, setSavedRating] = useState(null)
  const loadHistory = useCallback(() => onLoadSkillAssessments?.(member.id, skill.id), [onLoadSkillAssessments, member.id, skill.id])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    Promise.resolve().then(() => onLoadSkillDetail?.(member.id, skill.id))
      .then((data) => { if (active) setDetail(data ?? { targets: [], assessments: [] }) })
      .catch((err) => { if (active) setError(err.message || t('managerTeam.profile.loadError')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [member.id, skill.id, onLoadSkillDetail, revision, t])
  const target = detail?.targets?.[0]
  return <section aria-label={t('managerTeam.profile.detailLabel', { skill: skill.name })} className="space-y-6">
    <h3 className="font-display text-2xl text-ink">{skill.name}</h3>
    {loading ? <p role="status" className="text-sm text-secondary">{t('managerTeam.profile.loadingDetail')}</p> : error ? <div>
      <MutationFeedback status="error" message={error} /><button className={actionClass} onClick={() => setRevision((n) => n + 1)}>{t('managerTeam.profile.retry')}</button>
    </div> : <>
      <div className="grid gap-6 sm:grid-cols-2 border-y border-hairline py-6">
        <div className="flex gap-4 items-center"><GrowthRing level={detail?.level ?? skill.level} size={80} targetLevel={target?.target_level} />
          <div><h4 className="font-medium text-ink">{t('managerTeam.profile.canDo')}</h4><p className="text-secondary">{LEVEL_LABELS[detail?.level ?? skill.level] ?? t('managerTeam.profile.notSelfAssessed')}</p>
            <p className="text-xs text-secondary">{t('managerTeam.profile.selfAssessment')}</p></div></div>
        <div className="flex items-center gap-4"><KnowledgeLevelBar level={detail?.knowledge_level} size={64} />
          <div><h4 className="font-medium text-ink">{t('managerTeam.profile.understands')}</h4><p className="text-sm text-secondary">{KNOWLEDGE_LEVEL_LABELS[detail?.knowledge_level] ?? t('managerTeam.profile.notYetAssessed')}</p></div></div>
      </div>
      <section className="space-y-2"><h4 className="font-display text-lg text-ink">{t('managerTeam.profile.yourAssessment')}</h4>
        <p className="text-sm text-secondary">{t('managerTeam.profile.practicalRating', { level: LEVEL_LABELS[savedRating ?? skill.managerRating?.level] ?? t('managerTeam.profile.notRated') })}</p>
        {onRateSkill && <button className={actionClass} onClick={() => setRatingOpen(true)}>{t('managerTeam.profile.rateSkill')}</button>}
      </section>
      <section className="space-y-3"><h4 className="font-display text-lg text-ink">{t('managerTeam.profile.target')}</h4>
        {target ? <div className="text-sm text-secondary"><p className="font-medium text-ink">{t('managerTeam.profile.targetBy', { level: LEVEL_LABELS[target.target_level], date: formatAbsoluteDate(target.target_date) })}</p>
          {target.set_by_manager && <p>{t('managerTeam.profile.setByManager')}</p>}{target.comments && <p className="mt-1 whitespace-pre-wrap">{target.comments}</p>}</div>
          : <p className="text-sm text-secondary">{t('managerTeam.profile.noTarget')}</p>}
        {onSetTarget && !targetOpen && <button className={actionClass} onClick={() => setTargetOpen(true)}>{target ? t('managerTeam.profile.setNewTarget') : t('managerTeam.profile.setTarget')}</button>}
        {targetOpen && <TargetForm current={target} onCancel={() => setTargetOpen(false)} onSave={async (payload) => {
          const saved = await onSetTarget(member.id, skill.id, payload)
          setDetail((previous) => ({ ...previous, targets: [saved, ...(previous.targets ?? [])] }))
          setTargetOpen(false)
          setNotice(t('managerTeam.profile.targetSaved'))
        }} />}
      </section>
      <p role="status" className="text-sm text-moss">{notice}</p>
      <section className="space-y-3"><h4 className="font-display text-lg text-ink">{t('managerTeam.profile.historyHeading')}</h4>
        {detail?.assessments?.length ? detail.assessments.map((entry) => <div key={entry.id} className="border-b border-hairline pb-3 text-sm">
          <p className="text-ink">{LEVEL_LABELS[entry.level] ?? t('managerTeam.profile.notAssessed')} · {formatAbsoluteDate(entry.assessed_at)}</p>
          {entry.comments && <p className="text-secondary whitespace-pre-wrap">{entry.comments}</p>}
        </div>) : <p className="text-sm text-secondary">{t('managerTeam.profile.noHistory')}</p>}
      </section>
    </>}
    {ratingOpen && <RateSkillDialog member={member} skill={skill} onClose={() => setRatingOpen(false)} onLoadHistory={loadHistory}
      onRate={async (payload) => { await onRateSkill(member.id, skill.id, payload); setSavedRating(payload.level); setNotice(t('managerTeam.profile.ratingSaved')); }} />}
  </section>
}

function TargetForm({ current, onSave, onCancel }) {
  const { t } = useLanguage()
  const [level, setLevel] = useState(current?.target_level ?? 3)
  const [date, setDate] = useState('')
  const [comments, setComments] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  return <form className="max-w-lg space-y-3" onSubmit={async (event) => {
    event.preventDefault(); setSaving(true); setError(null)
    try { await onSave({ level, date, comments: comments.trim() }) }
    catch (err) { setError(err.message || t('managerTeam.profile.targetForm.saveError')); setSaving(false) }
  }}>
    <fieldset disabled={saving} className="space-y-3">
      <legend className="text-sm text-secondary mb-3">{t('managerTeam.profile.targetForm.legend')}</legend>
      <label className="block text-sm text-ink">{t('managerTeam.profile.targetForm.targetLevel')}<select value={level} onChange={(e) => setLevel(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-hairline bg-card p-2">
        {LEVELS.map((value) => <option value={value} key={value}>{LEVEL_LABELS[value]}</option>)}
      </select></label>
      <label className="block text-sm text-ink">{t('managerTeam.profile.targetForm.achieveBy')}<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 block w-full rounded-md border border-hairline bg-card p-2" /></label>
      <label className="block text-sm text-ink">{t('managerTeam.profile.targetForm.comments')}<textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} className="mt-1 block w-full rounded-md border border-hairline bg-card p-2" /></label>
      <MutationFeedback status="error" message={error} />
      <div className="flex gap-2"><button type="submit" className="rounded-md bg-moss text-paper px-4 py-2 text-sm disabled:opacity-60">{saving ? t('managerTeam.profile.targetForm.saving') : t('managerTeam.profile.targetForm.save')}</button>
        <button type="button" className={actionClass} onClick={onCancel}>{t('managerTeam.profile.targetForm.cancel')}</button></div>
    </fieldset>
  </form>
}
