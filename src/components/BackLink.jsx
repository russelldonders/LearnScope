import { Link, useNavigate } from 'react-router-dom'
import { useLanguage } from '../context/LanguageContext'

// Whether the page before this one was also in LearnScope. The router
// numbers this tab's entries (history.state.idx), so 0 means the learner
// arrived here first -- a bookmark or a link from elsewhere -- and going back
// would leave the app.
function cameFromInApp() {
  return typeof window !== 'undefined' && Number(window.history.state?.idx) > 0
}

// The back link at the top of a page, leading to where the learner came
// from:
//   - the page that opened this one, when it said so (to + label);
//   - otherwise the previous page in the app, whatever it was;
//   - otherwise the page's usual parent (fallbackTo + fallbackLabel).
export default function BackLink({ to = null, label = null, state = undefined, fallbackTo, fallbackLabel, className }) {
  const navigate = useNavigate()
  const { t } = useLanguage()
  if (to) {
    return <Link to={to} state={state} className={className}>{label}</Link>
  }
  if (cameFromInApp()) {
    return (
      <button type="button" onClick={() => navigate(-1)} className={className}>
        {t('common.goBack')}
      </button>
    )
  }
  return <Link to={fallbackTo} state={state} className={className}>{fallbackLabel}</Link>
}
