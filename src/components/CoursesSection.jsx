import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import CourseCard from './CourseCard'
import CourseModal from './CourseModal'

export default function CoursesSection() {
  const { user } = useAuth()
  const [courses, setCourses] = useState([])
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalCourse, setModalCourse] = useState(null)
  const [modalLinkedAssessment, setModalLinkedAssessment] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    loadCourses()
    loadSkills()
  }, [])

  async function loadCourses() {
    setLoading(true)
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .order('completed_date', { ascending: false, nullsFirst: false })
    if (error) {
      setError(error.message)
    } else {
      setCourses(data)
    }
    setLoading(false)
  }

  async function loadSkills() {
    const { data } = await supabase
      .from('skills')
      .select('id, name, category')
      .eq('user_id', user.id)
      .order('name')
    setSkills(data ?? [])
  }

  async function refreshSkillLevel(skillId) {
    if (!skillId) return
    const { data } = await supabase
      .from('skill_assessments')
      .select('level')
      .eq('skill_id', skillId)
      .order('assessed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    await supabase
      .from('skills')
      .update({ level: data?.level ?? null })
      .eq('id', skillId)
  }

  function openAddModal() {
    setModalCourse(null)
    setModalLinkedAssessment(null)
    setModalOpen(true)
    loadSkills()
  }

  async function openEditModal(course) {
    setModalCourse(course)
    loadSkills()
    const { data } = await supabase
      .from('skill_assessments')
      .select('id, skill_id, level, skills(name, category)')
      .eq('course_id', course.id)
      .order('assessed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setModalLinkedAssessment(data ?? null)
    setModalOpen(true)
  }

  async function handleSave(values) {
    const { skillId, level, linkedAssessmentId, previousSkillId, ...courseValues } = values
    let courseId = values.id

    if (values.id) {
      const { error } = await supabase
        .from('courses')
        .update({
          name: courseValues.name,
          provider: courseValues.provider,
          completed_date: courseValues.completed_date,
          notes: courseValues.notes,
        })
        .eq('id', values.id)
      if (error) throw error
    } else {
      const { data, error } = await supabase
        .from('courses')
        .insert({
          name: courseValues.name,
          provider: courseValues.provider,
          completed_date: courseValues.completed_date,
          notes: courseValues.notes,
          user_id: user.id,
        })
        .select()
        .single()
      if (error) throw error
      courseId = data.id
    }

    if (linkedAssessmentId) {
      if (!skillId || !level) {
        const { error } = await supabase.from('skill_assessments').delete().eq('id', linkedAssessmentId)
        if (error) throw error
        await refreshSkillLevel(previousSkillId)
      } else if (skillId === previousSkillId) {
        const { error } = await supabase
          .from('skill_assessments')
          .update({ level, assessed_at: courseValues.completed_date || undefined })
          .eq('id', linkedAssessmentId)
        if (error) throw error
        await refreshSkillLevel(skillId)
      } else {
        const { error: deleteError } = await supabase
          .from('skill_assessments')
          .delete()
          .eq('id', linkedAssessmentId)
        if (deleteError) throw deleteError
        await refreshSkillLevel(previousSkillId)
        const { error: insertError } = await supabase.from('skill_assessments').insert({
          skill_id: skillId,
          user_id: user.id,
          level,
          source: 'course',
          course_id: courseId,
          assessed_at: courseValues.completed_date || new Date().toISOString(),
        })
        if (insertError) throw insertError
        await refreshSkillLevel(skillId)
      }
    } else if (skillId && level) {
      const { error } = await supabase.from('skill_assessments').insert({
        skill_id: skillId,
        user_id: user.id,
        level,
        source: 'course',
        course_id: courseId,
        assessed_at: courseValues.completed_date || new Date().toISOString(),
      })
      if (error) throw error
      await refreshSkillLevel(skillId)
    }

    setModalOpen(false)
    await loadCourses()
  }

  async function handleDelete(id) {
    const { error } = await supabase.from('courses').delete().eq('id', id)
    if (error) throw error
    setModalOpen(false)
    await loadCourses()
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-display text-xl text-ink">Training &amp; courses</h2>
        <button
          onClick={openAddModal}
          className="rounded-md bg-moss text-paper py-2 px-4 font-medium hover:opacity-90"
        >
          + Add course
        </button>
      </div>

      {loading && <p className="text-secondary">Loading…</p>}
      {error && <p className="text-red-700 text-sm">{error}</p>}

      {!loading && courses.length === 0 && (
        <div className="text-center py-16 border border-dashed border-hairline rounded-lg">
          <p className="text-secondary">No courses logged yet. Add your first one.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {courses.map((course) => (
          <CourseCard key={course.id} course={course} onEdit={openEditModal} />
        ))}
      </div>

      {modalOpen && (
        <CourseModal
          course={modalCourse}
          skills={skills}
          linkedAssessment={modalLinkedAssessment}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModalOpen(false)}
        />
      )}
    </section>
  )
}
