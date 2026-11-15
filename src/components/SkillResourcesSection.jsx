import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '../context/LanguageContext'
import { formatFullDate } from '../lib/dates'
import { listConnections } from '../lib/connections'
import { KNOWLEDGE_LEVEL_LABELS, LEVEL_LABELS } from '../lib/levels'
import {
  MAX_RESOURCE_FILE_BYTES,
  RESOURCE_FILE_ACCEPT,
  addResource,
  audiencesFor,
  deleteResource,
  getResourceFileUrl,
  isHttpUrl,
  listMyResources,
  listSharedResources,
  updateResource,
} from '../lib/skillResources'

// Documents, videos and links the learner keeps for learning a skill, each
// shared as they choose, and below them what others have shared with them for
// the same skill. Nothing here is evidence of ability: a resource is study
// material, so it doesn't change the skill's levels.
export default function SkillResourcesSection({ skill, user }) {
  const { t } = useLanguage()
  const [mine, setMine] = useState([])
  const [shared, setShared] = useState([])
  const [connections, setConnections] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const hasLibrarySkill = Boolean(skill.library_skill_id)

  const load = useCallback(async () => {
    const [own, others] = await Promise.all([
      listMyResources(skill.id),
      hasLibrarySkill ? listSharedResources(skill.id) : Promise.resolve([]),
    ])
    setMine(own)
    setShared(others)
  }, [skill.id, hasLibrarySkill])

  useEffect(() => {
    let active = true
    load()
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [load])

  // Only needed once the learner picks "Selected contacts".
  const ensureConnections = useCallback(() => {
    if (connections !== null) return
    listConnections(user.id)
      .then(setConnections)
      .catch(() => setConnections([]))
  }, [connections, user.id])

  // Names for "Shared with Sam, Alex" on resources shared with chosen people.
  useEffect(() => {
    if (mine.some((resource) => resource.audience === 'selected')) ensureConnections()
  }, [mine, ensureConnections])

  async function run(action) {
    setError(null)
    setBusy(true)
    try {
      await action()
      await load()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function openFile(path) {
    // Opened before the URL arrives, so a popup blocker doesn't stop it.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    try {
      const url = await getResourceFileUrl(path)
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch (err) {
      tab?.close()
      setError(err.message)
    }
  }

  return (
    <section aria-labelledby="skill-resources-heading" className="mt-4 rounded-md border border-hairline bg-paper p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="skill-resources-heading" className="font-display text-xl text-ink">{t('skillDetail.resources.title')}</h2>
          <p className="text-xs text-secondary">{t('skillDetail.resources.description')}</p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => { setAdding(true); setEditingId(null) }}
            className="rounded-md bg-moss text-paper text-xs font-medium px-3 py-1.5 hover:opacity-90"
          >
            {t('skillDetail.resources.add')}
          </button>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-700 mt-3">{error}</p>}

      {adding && (
        <div className="mt-3 rounded-md border border-hairline bg-card p-3">
          <ResourceForm
            hasLibrarySkill={hasLibrarySkill}
            connections={connections}
            onNeedConnections={ensureConnections}
            busy={busy}
            submitLabel={t('skillDetail.resources.save')}
            onCancel={() => setAdding(false)}
            onSubmit={async (values) => {
              const ok = await run(() => addResource({ userId: user.id, skillId: skill.id, ...values }))
              if (ok) setAdding(false)
            }}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-secondary mt-3">{t('skillDetail.resources.loading')}</p>
      ) : (
        <>
          {mine.length === 0 && !adding && <p className="text-sm text-secondary mt-3">{t('skillDetail.resources.nothingYet')}</p>}
          {mine.length > 0 && (
            <ul className="mt-3 space-y-2">
              {mine.map((resource) => (
                <li key={resource.id} className="rounded-md border border-hairline bg-card p-3">
                  {editingId === resource.id ? (
                    <ResourceForm
                      resource={resource}
                      hasLibrarySkill={hasLibrarySkill}
                      connections={connections}
                      onNeedConnections={ensureConnections}
                      busy={busy}
                      submitLabel={t('skillDetail.resources.saveChanges')}
                      onCancel={() => setEditingId(null)}
                      onSubmit={async (values) => {
                        const ok = await run(() => updateResource(resource, values))
                        if (ok) setEditingId(null)
                      }}
                    />
                  ) : (
                    <>
                      <ResourceSummary resource={resource} onOpenFile={openFile} />
                      <p className="mt-1 text-xs text-secondary">
                        <AudienceText resource={resource} connections={connections} />
                      </p>
                      {confirmingId === resource.id ? (
                        <div className="mt-2">
                          <p className="text-sm text-ink">{t('skillDetail.resources.confirmDelete')}</p>
                          <div className="flex gap-3 mt-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                await run(() => deleteResource(resource))
                                setConfirmingId(null)
                              }}
                              className="text-xs text-red-700 font-medium hover:underline disabled:opacity-60"
                            >
                              {t('skillDetail.resources.confirmDeleteYes')}
                            </button>
                            <button type="button" disabled={busy} onClick={() => setConfirmingId(null)} className="text-xs text-secondary hover:text-ink">
                              {t('skillDetail.resources.cancel')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3 mt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setAdding(false)
                              setConfirmingId(null)
                              setEditingId(resource.id)
                              if (resource.audience === 'selected') ensureConnections()
                            }}
                            className="text-xs text-moss font-medium hover:underline"
                          >
                            {t('skillDetail.resources.edit')}
                          </button>
                          <button type="button" onClick={() => setConfirmingId(resource.id)} className="text-xs text-red-700 font-medium hover:underline">
                            {t('skillDetail.resources.delete')}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {shared.length > 0 && (
            <div className="mt-5">
              <h3 className="font-mono text-[10px] uppercase tracking-wide text-secondary">{t('skillDetail.resources.sharedWithYou')}</h3>
              <ul className="mt-2 space-y-2">
                {shared.map((resource) => (
                  <li key={resource.id} className="rounded-md border border-hairline bg-card p-3">
                    <ResourceSummary resource={resource} onOpenFile={openFile} />
                    <p className="mt-1 text-xs text-secondary">
                      {t('skillDetail.resources.sharedBy', { name: resource.sharer_name, date: formatFullDate(resource.created_at) })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ResourceSummary({ resource, onOpenFile }) {
  const { t } = useLanguage()
  const kindLabel = t(`skillDetail.resources.kinds.${resource.kind}`)
  const titleClass = 'text-sm font-medium text-moss hover:underline underline-offset-2 break-words text-left'
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {resource.kind === 'file' ? (
          <button type="button" onClick={() => onOpenFile(resource.file_path)} className={titleClass}>
            {resource.title}
          </button>
        ) : (
          <a href={resource.url} target="_blank" rel="noopener noreferrer" className={titleClass}>
            {resource.title}
          </a>
        )}
        <span className="font-mono text-[10px] uppercase tracking-wide text-secondary">
          {kindLabel}
          {resource.kind === 'file' && resource.file_name ? ` · ${resource.file_name}` : ''}
        </span>
      </div>
      {(resource.knowledge_level || resource.practical_level) && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {resource.knowledge_level && (
            <span data-level="knowledge" className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-secondary">
              {t('skillDetail.resources.knowledgeTag', { level: KNOWLEDGE_LEVEL_LABELS[resource.knowledge_level] })}
            </span>
          )}
          {resource.practical_level && (
            <span data-level="practical" className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-secondary">
              {t('skillDetail.resources.practicalTag', { level: LEVEL_LABELS[resource.practical_level] })}
            </span>
          )}
        </div>
      )}
      {resource.note && <p className="text-sm text-secondary mt-1 whitespace-pre-wrap break-words">{resource.note}</p>}
    </div>
  )
}

function AudienceText({ resource, connections }) {
  const { t } = useLanguage()
  if (resource.audience !== 'selected') return t(`skillDetail.resources.audienceShort.${resource.audience}`)
  const names = connections
    ? resource.recipientIds.map((id) => connections.find((c) => c.id === id)?.name).filter(Boolean)
    : []
  return names.length
    ? t('skillDetail.resources.sharedWithNames', { names: names.join(', ') })
    : t('skillDetail.resources.sharedWithCount', { count: resource.recipientIds.length })
}

function ResourceForm({ resource = null, hasLibrarySkill, connections, onNeedConnections, busy, submitLabel, onCancel, onSubmit }) {
  const { t } = useLanguage()
  const editing = Boolean(resource)
  const [kind, setKind] = useState(resource?.kind ?? 'link')
  const [title, setTitle] = useState(resource?.title ?? '')
  const [url, setUrl] = useState(resource?.url ?? '')
  const [file, setFile] = useState(null)
  const [note, setNote] = useState(resource?.note ?? '')
  const [audience, setAudience] = useState(resource?.audience ?? 'private')
  const [recipientIds, setRecipientIds] = useState(resource?.recipientIds ?? [])
  const [knowledgeLevel, setKnowledgeLevel] = useState(resource?.knowledge_level ?? '')
  const [practicalLevel, setPracticalLevel] = useState(resource?.practical_level ?? '')
  const [formError, setFormError] = useState(null)
  const idPrefix = `skill-resource-${resource?.id ?? 'new'}`
  const audiences = audiencesFor(kind, { hasLibrarySkill })

  useEffect(() => {
    if (audience === 'selected') onNeedConnections()
  }, [audience, onNeedConnections])

  function chooseKind(next) {
    setKind(next)
    // An uploaded file can't stay shared with everyone tracking the skill.
    if (!audiencesFor(next, { hasLibrarySkill }).includes(audience)) setAudience('private')
  }

  function handleSubmit(event) {
    event.preventDefault()
    setFormError(null)
    if (!title.trim()) return setFormError(t('skillDetail.resources.errorTitle'))
    if (!editing && kind !== 'file' && !isHttpUrl(url)) return setFormError(t('skillDetail.resources.errorUrl'))
    if (!editing && kind === 'file') {
      if (!file) return setFormError(t('skillDetail.resources.errorFile'))
      if (file.size > MAX_RESOURCE_FILE_BYTES) return setFormError(t('skillDetail.resources.errorFileSize'))
    }
    if (audience === 'selected' && recipientIds.length === 0) return setFormError(t('skillDetail.resources.errorRecipients'))
    onSubmit({
      kind, title, url, file, note, audience, recipientIds,
      knowledgeLevel: knowledgeLevel ? Number(knowledgeLevel) : null,
      practicalLevel: practicalLevel ? Number(practicalLevel) : null,
    })
  }

  const inputClass = 'mt-1 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink focus:outline-none focus:border-moss'

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      {!editing && (
        <fieldset>
          <legend className="text-xs text-secondary">{t('skillDetail.resources.kindLabel')}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {['link', 'video', 'file'].map((option) => (
              <label
                key={option}
                className={`cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium ${
                  kind === option ? 'border-moss text-moss' : 'border-hairline text-ink'
                }`}
              >
                <input type="radio" name={`${idPrefix}-kind`} value={option} checked={kind === option} onChange={() => chooseKind(option)} className="sr-only" />
                {t(`skillDetail.resources.kinds.${option}`)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div>
        <label htmlFor={`${idPrefix}-title`} className="text-xs text-secondary">{t('skillDetail.resources.titleLabel')}</label>
        <input id={`${idPrefix}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />
      </div>

      {!editing && kind !== 'file' && (
        <div>
          <label htmlFor={`${idPrefix}-url`} className="text-xs text-secondary">
            {kind === 'video' ? t('skillDetail.resources.videoUrlLabel') : t('skillDetail.resources.urlLabel')}
          </label>
          <input id={`${idPrefix}-url`} type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} className={inputClass} />
        </div>
      )}

      {!editing && kind === 'file' && (
        <div>
          <label htmlFor={`${idPrefix}-file`} className="text-xs text-secondary">{t('skillDetail.resources.fileLabel')}</label>
          <input
            id={`${idPrefix}-file`}
            type="file"
            accept={RESOURCE_FILE_ACCEPT}
            onChange={(e) => {
              const chosen = e.target.files?.[0] ?? null
              setFile(chosen)
              if (chosen && !title.trim()) setTitle(chosen.name.replace(/\.[^.]+$/, ''))
            }}
            className="mt-1 block w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-hairline file:bg-paper file:px-3 file:py-1.5 file:text-xs file:text-ink"
          />
          <p className="mt-1 text-xs text-secondary">{t('skillDetail.resources.fileHint')}</p>
        </div>
      )}

      <div>
        <label htmlFor={`${idPrefix}-note`} className="text-xs text-secondary">{t('skillDetail.resources.noteLabel')}</label>
        <textarea id={`${idPrefix}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} className={inputClass} />
      </div>

      {/* Which level it suits, on either axis -- both optional. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${idPrefix}-knowledge-level`} className="text-xs text-secondary">{t('skillDetail.resources.knowledgeLevelLabel')}</label>
          <select id={`${idPrefix}-knowledge-level`} value={knowledgeLevel} onChange={(e) => setKnowledgeLevel(e.target.value)} className={inputClass}>
            <option value="">{t('skillDetail.resources.anyLevel')}</option>
            {Object.entries(KNOWLEDGE_LEVEL_LABELS).map(([level, label]) => (
              <option key={level} value={level}>{level} · {label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idPrefix}-practical-level`} className="text-xs text-secondary">{t('skillDetail.resources.practicalLevelLabel')}</label>
          <select id={`${idPrefix}-practical-level`} value={practicalLevel} onChange={(e) => setPracticalLevel(e.target.value)} className={inputClass}>
            <option value="">{t('skillDetail.resources.anyLevel')}</option>
            {Object.entries(LEVEL_LABELS).map(([level, label]) => (
              <option key={level} value={level}>{level} · {label}</option>
            ))}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="text-xs text-secondary">{t('skillDetail.resources.audienceLabel')}</legend>
        <div className="mt-1 space-y-1.5">
          {audiences.map((option) => (
            <label key={option} className="flex items-start gap-2 text-sm text-ink cursor-pointer">
              <input
                type="radio"
                name={`${idPrefix}-audience`}
                value={option}
                checked={audience === option}
                onChange={() => setAudience(option)}
                className="mt-1 accent-moss"
              />
              <span>
                {t(`skillDetail.resources.audiences.${option}`)}
                <span className="block text-xs text-secondary">{t(`skillDetail.resources.audienceHints.${option}`)}</span>
              </span>
            </label>
          ))}
        </div>
        {kind === 'file' && hasLibrarySkill && (
          <p className="mt-1 text-xs text-secondary">{t('skillDetail.resources.filesNotPublic')}</p>
        )}
      </fieldset>

      {audience === 'selected' && (
        <fieldset>
          <legend className="text-xs text-secondary">{t('skillDetail.resources.chooseContacts')}</legend>
          {connections === null ? (
            <p className="mt-1 text-sm text-secondary">{t('skillDetail.resources.loading')}</p>
          ) : connections.length === 0 ? (
            <p className="mt-1 text-sm text-secondary">{t('skillDetail.resources.noContacts')}</p>
          ) : (
            <div className="mt-1 max-h-48 overflow-y-auto space-y-1">
              {connections.map((connection) => (
                <label key={connection.id} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recipientIds.includes(connection.id)}
                    onChange={(e) =>
                      setRecipientIds((ids) => (e.target.checked ? [...ids, connection.id] : ids.filter((id) => id !== connection.id)))
                    }
                    className="accent-moss"
                  />
                  {connection.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}

      {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}

      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-moss text-paper text-sm font-medium px-4 py-2 hover:opacity-90 disabled:opacity-60">
          {busy ? t('skillDetail.resources.saving') : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-sm text-secondary hover:text-ink">
          {t('skillDetail.resources.cancel')}
        </button>
      </div>
    </form>
  )
}
