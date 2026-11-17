import { supabase } from './supabaseClient'

function fileNameFromDisposition(value) {
  const encoded = value?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) return decodeURIComponent(encoded)
  return value?.match(/filename="([^"]+)"/i)?.[1] ?? 'learnscope-course-SCORM-1.2.zip'
}

export async function downloadCourseScormPackage(courseId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in again before exporting this course.')

  const response = await fetch('/api/admin/actions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action: 'exportCourseScorm', courseId }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || 'The SCORM package could not be created.')
  }

  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = fileNameFromDisposition(response.headers.get('content-disposition'))
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
