import AppHeader from '../components/AppHeader'
import ExperienceSection from '../components/ExperienceSection'
import CoursesSection from '../components/CoursesSection'

export default function Experience() {
  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-16">
        <ExperienceSection />
        <CoursesSection />
      </main>
    </div>
  )
}
