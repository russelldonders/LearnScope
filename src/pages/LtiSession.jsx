import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ltiRequest } from '../lib/lti/session'
import SkillDetail from './SkillDetail'

const button = 'rounded-md bg-moss text-paper px-4 py-2 text-sm hover:opacity-90 disabled:opacity-50'
export default function LtiSession() {
  const { user, loading, needsName, needsOnboarding } = useAuth()
  const requestVersion=useRef(0)
  const [view,setView]=useState(null), [error,setError]=useState(''), [busy,setBusy]=useState(false)
  const act = useCallback(async (action,values) => {
    const version=++requestVersion.current
    setBusy(true);setError('')
    try {
      const result=await ltiRequest(action,values)
      if(version!==requestVersion.current) return
      if(result.disconnected){sessionStorage.removeItem('lti-session');setView(null);setError('Account disconnected. Return to your LMS to launch again.');return}
      if(result.jwt){
        const form=document.createElement('form');form.method='POST';form.action=result.returnUrl
        const field=document.createElement('input');field.type='hidden';field.name='JWT';field.value=result.jwt;form.append(field);document.body.append(form);form.submit();return
      }
      setView(result)
    }catch(err){if(version===requestVersion.current){if(action==='session')setView(null);setError(err.message)}}finally{if(version===requestVersion.current)setBusy(false)}
  }, [])
  useEffect(()=>{setView(null);if(!loading) act('session');return()=>{requestVersion.current++}},[loading,user?.id,act])
  return <div className="min-h-screen bg-paper text-ink">
    <header className="border-b border-hairline px-4 py-4 flex justify-between gap-4"><Link to="/dashboard" target="_blank" rel="noopener noreferrer" className="font-medium text-moss">LearnScope</Link><a href="/lti/session" target="_blank" rel="opener" className="text-sm underline">Open in a new window</a></header>
    <section aria-label="LMS connection" className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!view && !error && <p role="status">Opening your LMS activity…</p>}
      {view?.type==='picker' && <><h1 className="font-serif text-3xl">Choose a skill</h1><p className="text-secondary">Add a skill development page to this LMS activity.</p>{!view.objects.length && <p>No skill objects are available for this connection.</p>}<ul className="divide-y divide-hairline">{view.objects.map(o=><li key={o.id} className="py-4 flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-medium">{o.title}</h2><p className="text-sm text-secondary">{o.description}</p>{o.grade_passback && <p className="text-sm text-secondary">Proficiency grade: 1–5, with learner consent</p>}</div><button disabled={busy} className={button} onClick={()=>act('select',{objectId:o.id})}>Select {o.title}</button></li>)}</ul></>}
      {view?.type==='learner' && <><h1 className="font-serif text-3xl">{view.title}</h1>{view.context && <p className="text-sm text-secondary">{view.context}</p>}
        {view.loginRequired ? <><p>Sign in to your LearnScope account, then return here to connect this LMS activity.</p><Link to="/login" target="_blank" rel="noopener noreferrer" className="text-moss underline">Sign in or create an account</Link><button disabled={busy} className={button} onClick={()=>act('session')}>I’ve signed in</button></> : view.linkRequired ? <><p>Connect your {view.lms} identity to the LearnScope account signed in as {user?.email}. This connects your identity; sharing proficiency is a separate choice.</p><button className={button} disabled={busy} onClick={()=>act('link',{confirm:true})}>Connect my account</button></> : <>
          {(needsName || needsOnboarding) && <p><Link to={needsName?'/profile':'/onboarding'} target="_blank" className="text-moss underline">Complete your LearnScope setup</Link>, then return to this activity.</p>}
          {!view.skillId && <><p>{view.description || 'Add this skill to start recording your development.'}</p><button className={button} disabled={busy} onClick={()=>act('add')}>Add to my skills</button></>}
          {view.targetLevel && <p className="text-sm text-secondary">Activity target: proficiency level {view.targetLevel} of 5.</p>}
          {view.canGrade ? <div className="border border-hairline rounded-lg p-4 space-y-3"><label className="flex items-start gap-3"><input type="checkbox" checked={view.consent} disabled={busy} onChange={event=>act('consent',{consent:event.target.checked})}/><span>Share my current proficiency for this skill with this LMS activity.<span className="block text-sm text-secondary">Only the 1–5 level is sent. It may be self-assessed; this does not certify proficiency. Future changes are shared until you turn this off.</span></span></label>{view.consent && <><p role="status" className="text-sm">Grade delivery: {view.grade?.status || 'pending'}{view.grade?.error ? ` — ${view.grade.error}`:''}</p><button className={button} disabled={busy} onClick={()=>act('sync')}>Send current proficiency</button></>}</div> : <p className="text-sm text-secondary">Grade sharing is unavailable for this launch. The LMS must provide a gradebook item and score permission.</p>}
          <button disabled={busy} className="text-sm underline text-secondary" onClick={()=>act('disconnect')}>Disconnect this LMS account and stop sharing</button>
        </>}
      </>}
    </section>
    {view?.skillId && user && !needsName && !needsOnboarding && <SkillDetail key={view.skillId} skillId={view.skillId} embedded />}
  </div>
}
