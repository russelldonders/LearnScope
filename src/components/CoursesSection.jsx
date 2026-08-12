import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { listLibrarySkills } from '../lib/skillLibrary'
import CourseCard from './CourseCard'
import CourseModal from './CourseModal'

export default function CoursesSection() {
  const { user } = useAuth()
  const [courses, setCourses] = useState([])
  const [skills, setSkills] = useState([])
  const [librarySkills, setLibrarySkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modalCourse, setModalCourse] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    loadCourses()
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

  async function loadPickerData() {
    const [{ data: skillsData }, libraryData] = await Promise.all([
      supabase.from('skills').select('id, name').eq('user_id', user.id).order('name'),
      listLibrarySkills(),
    ])
    setSkills(skillsData ?? [])
    setLibrarySkills(libraryData)
  }

  function openAddModal() {
    setModalCourse(null)
    setModalOpen(true)
  }

  function openEditModal(course) {
    setModalCourse(course)
    loadPickerData()
    setModalOpen(true)
  }

  async function handleSave(values) {
    if (values.id) {
      const { error } = await supabase
        .from('courses')
        .update({
          name: values.name,
          provider: values.provider,
          completed_date: values.completed_date,
          duration: values.duration,
          course_type: values.course_type,
          notes: values.notes,
        })
        .eq('id', values.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('courses').insert({
        name: values.name,
        provider: values.provider,
        completed_date: values.completed_date,
        duration: values.duration,
        course_type: values.course_type,
        notes: values.notes,
        user_id: user.id,
      })
      if (error) throw error
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
          librarySkills={librarySkills}
          onRefreshPickerData={loadPickerData}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModalOpen(false)}
        />
      )}
    </section>
  )
}
