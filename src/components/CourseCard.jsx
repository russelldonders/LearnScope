export default function CourseCard({ course, onEdit }) {
  return (
    <button
      onClick={() => onEdit(course)}
      className="text-left bg-card border border-hairline rounded-lg p-4 hover:border-moss transition-colors w-full"
    >
      <h3 className="font-display text-lg text-ink">{course.name}</h3>
      {course.provider && <p className="text-sm text-secondary mt-0.5">{course.provider}</p>}
      {course.notes && <p className="text-sm text-secondary mt-1 line-clamp-2">{course.notes}</p>}
      {course.completed_date && (
        <p className="font-mono text-xs text-secondary mt-2">
          Completed {new Date(course.completed_date).toLocaleDateString()}
        </p>
      )}
    </button>
  )
}
