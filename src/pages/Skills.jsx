import AppHeader from '../components/AppHeader'
import SkillsSection from '../components/SkillsSection'
import SkillsMomentum from '../components/SkillsMomentum'

export default function Skills() {
  return (
    <div className="min-h-screen bg-paper">
      <AppHeader />
      <main id="main-content" tabIndex={-1} className="max-w-4xl mx-auto px-4 py-8">
        <SkillsSection intro={<SkillsMomentum />} />
      </main>
    </div>
  )
}
