import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import LegacyRedirect from './LegacyRedirect'

afterEach(cleanup)

function Where() {
  const location = useLocation()
  return <p>{`${location.pathname}${location.search}${location.hash}`}</p>
}

it('redirects to the new path, keeping params, query and hash', () => {
  render(
    <MemoryRouter initialEntries={['/admin/catalogue/course-1/edit?tab=content#skills']}>
      <Routes>
        <Route path="/admin/catalogue/:courseId/edit" element={<LegacyRedirect to={({ courseId }) => `/admin/courses/${courseId}/edit`} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
  expect(screen.getByText('/admin/courses/course-1/edit?tab=content#skills')).toBeInTheDocument()
})
