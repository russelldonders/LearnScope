import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ltiRequest } from '../lib/lti/session'
import SkillDetail from './SkillDetail'
import { useLanguage } from '../context/LanguageContext'

const button = 'rounded-md bg-moss text-paper px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50'
export default function LtiSession() {
  const { user, loading, needsName, needsOnboarding } = useAuth()
  const { t } = useLanguage()
  // Read through a ref so act stays stable -- a new t (language switch) must
  // not re-run the session request the effect below makes.
  const tRef=useRef(t)
  tRef.current=t
  const requestVersion=useRef(0)
  const [view,setView]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false)
  const act = useCallback(async (action,values) => {
    const version=++requestVersion.current
    setBusy(true);setError('')
    try {
      const result=await ltiRequest(action,values)
      if(version!==requestVersion.current) return
      if(result.disconnected){sessionStorage.removeItem('lti-session');setView(null);setError(tRef.current('lti.disconnected'));return}
      if(result.jwt){
        const form=document.createElement('form');form.method='POST';form.action=result.returnUrl
        const field=document.createElement('input');field.type='hidden';field.name='JWT';field.value=result.jwt;form.append(field);document.body.append(form);form.submit();return
      }
      setView(result)
    }catch(err){if(version===requestVersion.current){if(action==='session')setView(null);setError(err.message)}}finally{if(version===requestVersion.current)setBusy(false)}
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bumping the request counter on cleanup is intended
  useEffect(()=>{setView(null);if(!loading) act('session');return()=>{requestVersion.current++}},[loading,user?.id,act])
  return <div className="min-h-screen bg-paper text-ink">
    <header className="border-b border-hairline px-4 py-4 flex justify-between gap-4"><Link to="/dashboard" target="_blank" rel="noopener noreferrer" className="font-medium text-moss">LearnScope</Link><a href="/lti/session" target="_blank" rel="opener" className="text-sm underline">{t('lti.openInNewWindow')}</a></header>
    <section aria-label={t('lti.sectionLabel')} className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!view && !error && <p role="status">{t('lti.opening')}</p>}
      {view?.type==='picker' && <><h1 className="font-serif text-3xl">{t('lti.chooseSkill')}</h1><p className="text-secondary">{t('lti.chooseSkillDescription')}</p>{!view.objects.length && <p>{t('lti.noObjects')}</p>}<ul className="divide-y divide-hairline">{view.objects.map(o=><li key={o.id} className="py-4 flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-medium">{o.title}</h2><p className="text-sm text-secondary">{o.description}</p>{o.grade_passback && <p className="text-sm text-secondary">{t('lti.gradePassback')}</p>}</div><button disabled={busy} className={button} onClick={()=>act('select',{objectId:o.id})}>{t('lti.selectObject',{title:o.title})}</button></li>)}</ul></>}
      {view?.type==='learner' && <><h1 className="font-serif text-3xl">{view.title}</h1>{view.context && <p className="text-sm text-secondary">{view.context}</p>}
        {view.loginRequired ? <><p>{t('lti.signInPrompt')}</p><Link to="/login" target="_blank" rel="noopener noreferrer" className="text-moss underline">{t('lti.signInLink')}</Link><button disabled={busy} className={button} onClick={()=>act('session')}>{t('lti.signedInButton')}</button></> : view.linkRequired ? <><p>{t('lti.linkPrompt',{lms:view.lms,email:user?.email})}</p><button className={button} disabled={busy} onClick={()=>act('link',{confirm:true})}>{t('lti.connectButton')}</button></> : <>
          {(needsName || needsOnboarding) && <p><Link to={needsName?'/profile':'/onboarding'} target="_blank" className="text-moss underline">{t('lti.completeSetupLink')}</Link>{t('lti.completeSetupSuffix')}</p>}
          {!view.skillId && <><p>{view.description || t('lti.addSkillDefault')}</p><button className={button} disabled={busy} onClick={()=>act('add')}>{t('lti.addSkillButton')}</button></>}
          {view.targetLevel && <p className="text-sm text-secondary">{t('lti.targetLevel',{level:view.targetLevel})}</p>}
          {view.canGrade ? <div className="border border-hairline rounded-lg p-4 space-y-3"><label className="flex items-start gap-3"><input type="checkbox" checked={view.consent} disabled={busy} onChange={event=>act('consent',{consent:event.target.checked})}/><span>{t('lti.shareConsentLabel')}<span className="block text-sm text-secondary">{t('lti.shareConsentDetail')}</span></span></label>{view.consent && <><p role="status" className="text-sm">{t('lti.gradeDelivery',{status:view.grade?.status || t('lti.gradeStatusPending')})}{view.grade?.error ? ` — ${view.grade.error}`:''}</p><button className={button} disabled={busy} onClick={()=>act('sync')}>{t('lti.sendButton')}</button></>}</div> : <p className="text-sm text-secondary">{t('lti.gradeUnavailable')}</p>}
          <button disabled={busy} className="text-sm underline text-secondary" onClick={()=>act('disconnect')}>{t('lti.disconnectButton')}</button>
        </>}
      </>}
    </section>
    {view?.skillId && user && !needsName && !needsOnboarding && <SkillDetail key={view.skillId} skillId={view.skillId} embedded />}
  </div>
}
