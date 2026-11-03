import { useEffect, useState } from 'react'
import { ltiRequest } from '../../lib/lti/session'
import { useLanguage } from '../../context/LanguageContext'
export default function LtiAccounts() {
  const { t } = useLanguage()
  const [accounts,setAccounts]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(null)
  useEffect(()=>{let live=true;ltiRequest('accounts').then(result=>{if(live)setAccounts(result.accounts)}).catch(err=>{if(live)setError(err.message)});return()=>{live=false}},[])
  async function disconnect(id){setBusy(id);setError('');try{await ltiRequest('disconnect-account',{id});setAccounts(rows=>rows.filter(row=>row.id!==id))}catch(err){setError(err.message)}finally{setBusy(null)}}
  return <section aria-labelledby="lti-accounts-title" className="border border-hairline rounded-lg p-5 my-6"><h2 id="lti-accounts-title" className="font-display text-xl mb-2">{t('connectedAccounts.ltiAccounts.heading')}</h2><p className="text-sm text-secondary mb-4">{t('connectedAccounts.ltiAccounts.description')}</p>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{accounts===null&&!error?<p role="status">{t('connectedAccounts.ltiAccounts.loading')}</p>:accounts?.length?<ul className="divide-y divide-hairline">{accounts.map(row=><li key={row.id} className="flex items-center justify-between flex-wrap gap-3 py-3"><span>{row.name}</span><button disabled={busy!==null} className="rounded-md border border-hairline px-3 py-2 text-sm hover:bg-paper disabled:opacity-50" onClick={()=>disconnect(row.id)}>{busy===row.id?t('connectedAccounts.ltiAccounts.disconnectingButton'):t('connectedAccounts.ltiAccounts.disconnectButton')}</button></li>)}</ul>:accounts&&<p className="text-sm text-secondary">{t('connectedAccounts.ltiAccounts.emptyState')}</p>}</section>
}
