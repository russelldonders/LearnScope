import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function ImpersonationBanner() {
  const { impersonation, endImpersonation } = useAuth()
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!impersonation) return undefined
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [impersonation])

  useEffect(() => {
    if (!impersonation) return undefined
    const remaining = new Date(impersonation.expiresAt).getTime() - Date.now()
    if (remaining <= 0) {
      endImpersonation()
      return undefined
    }
    const timeout = window.setTimeout(endImpersonation, remaining)
    return () => window.clearTimeout(timeout)
  }, [impersonation, endImpersonation])

  useEffect(() => {
    if (!impersonation) return undefined
    const handlePageHide = () => endImpersonation({ closeWindow: false })
    window.addEventListener('pagehide', handlePageHide)
    return () => window.removeEventListener('pagehide', handlePageHide)
  }, [impersonation, endImpersonation])

  if (!impersonation) return null

  const seconds = Math.max(0, Math.ceil((new Date(impersonation.expiresAt).getTime() - Date.now()) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainder = String(seconds % 60).padStart(2, '0')

  return (
    <div role="status" className="border-b border-gold bg-[color-mix(in_srgb,var(--color-gold)_16%,var(--color-card))] text-ink">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
        <p>
          <strong>Read-only user preview:</strong>{' '}
          {impersonation.targetName || impersonation.targetEmail} · closes in {minutes}:{remainder}
        </p>
        <button
          type="button"
          onClick={endImpersonation}
          className="rounded-md border border-hairline bg-card px-3 py-1.5 text-xs font-medium text-ink hover:bg-paper"
        >
          End preview
        </button>
      </div>
    </div>
  )
}
