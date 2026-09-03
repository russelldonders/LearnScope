import AppHeader from '../components/AppHeader'
import ExperienceSection from '../components/ExperienceSection'
import LearnerRoleAlignmentContainer from './roles/LearnerRoleAlignmentContainer'

export default function Experience() {
  return (
    <div className="min-h-screen bg-paper">
      <div className="print:hidden">
        <AppHeader />
      </div>
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8 space-y-16">
        <ExperienceSection />
        <LearnerRoleAlignmentContainer />
      </main>
    </div>
  )
}
