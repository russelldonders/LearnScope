import AppHeader from '../components/AppHeader'
import ExperienceSection from '../components/ExperienceSection'

// Role profile assignments (pending and accepted) are integrated directly
// into ExperienceSection's own timeline now -- a pending one as a grayed
// suggestion card at the top, an accepted one as a normal timeline entry
// with a badge -- rather than a separate section below it.
export default function Experience() {
  return (
    <div className="min-h-screen bg-paper">
      <div className="print:hidden">
        <AppHeader />
      </div>
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        <ExperienceSection />
      </main>
    </div>
  )
}
