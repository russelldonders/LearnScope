import CourseThumbnail from './CourseThumbnail'

export default function CourseCard({ course, onEdit }) {
  return (
    <button
      onClick={() => onEdit(course)}
      className="text-left bg-card border border-hairline rounded-lg overflow-hidden hover:border-moss transition-colors w-full"
    >
      <CourseThumbnail name={course.name} provider={course.provider} className="h-24 w-full" />
      <div className="p-4">
        <h3 className="font-display text-lg text-ink">{course.name}</h3>
        {course.provider && <p className="text-sm text-secondary mt-0.5">{course.provider}</p>}
        {course.notes && <p className="text-sm text-secondary mt-1 line-clamp-2">{course.notes}</p>}
        {course.completed_date && (
          <p className="font-mono text-xs text-secondary mt-2">
            Completed {new Date(course.completed_date).toLocaleDateString()}
          </p>
        )}
      </div>
    </button>
  )
}
