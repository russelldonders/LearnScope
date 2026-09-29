import { useLanguage } from '../context/LanguageContext'

// Shown while a page's chunk downloads -- same look as ProtectedRoute's own
// auth-check state, so the two never flash different placeholders in turn.
export default function RouteLoading() {
  const { t } = useLanguage()
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper text-secondary">
      {t('common.loading')}
    </div>
  )
}
