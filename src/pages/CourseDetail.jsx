import { useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'

// /courses/:id has no page of its own any more -- every viewer, regardless
// of role, goes straight to the actual learning content. Kept as a route
// (rather than removed outright) purely so old links/bookmarks still land
// somewhere useful instead of 404ing; every in-app link now points at
// /courses/:id/learn directly. Carries location.state's backTo/backLabel
// forward so a course reached from a skill/experience page still "back"s
// to the right place.
export default function CourseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    navigate(`/courses/${id}/learn`, { replace: true, state: location.state })
  }, [id])

  return <div className="min-h-screen bg-paper" />
}
