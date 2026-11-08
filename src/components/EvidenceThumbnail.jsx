import { useEffect, useRef, useState } from 'react'
import { getEvidenceSignedUrl } from '../lib/skillEvidence'
import { useLanguage } from '../context/LanguageContext'

// A photo attached as evidence, shown small. Files live in a private bucket,
// so the short-lived link is only fetched once the thumbnail scrolls into
// view; tapping opens the full image. Falls back to the plain attachment
// label if the link can't be made.
export default function EvidenceThumbnail({ path, index }) {
  const { t } = useLanguage()
  const ref = useRef(null)
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const label = t('modals.evidenceAttachmentLink.attachmentLabel', { number: index + 1 })

  useEffect(() => {
    let active = true
    const load = () => {
      getEvidenceSignedUrl(path)
        .then((signed) => { if (active) setUrl(signed) })
        .catch(() => { if (active) setFailed(true) })
    }
    if (typeof IntersectionObserver === 'undefined' || !ref.current) {
      load()
      return () => { active = false }
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect()
        load()
      }
    }, { rootMargin: '200px' })
    observer.observe(ref.current)
    return () => {
      active = false
      observer.disconnect()
    }
  }, [path])

  return (
    <button
      ref={ref}
      type="button"
      disabled={!url}
      onClick={() => url && window.open(url, '_blank', 'noopener')}
      aria-label={label}
      className="w-16 h-16 rounded-md overflow-hidden border border-hairline/70 bg-paper flex items-center justify-center text-[11px] text-secondary hover:border-moss focus:outline-none focus-visible:ring-2 focus-visible:ring-moss"
    >
      {url && !failed ? (
        <img src={url} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span className="px-1 text-center">{failed ? label : t('common.loading')}</span>
      )}
    </button>
  )
}
