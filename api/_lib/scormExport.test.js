import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildScormCoursePackage } from './scormExport.js'

describe('buildScormCoursePackage', () => {
  it('creates a thin SCORM 1.2 package that launches the hosted course', async () => {
    const result = await buildScormCoursePackage(
      { id: '11111111-2222-3333-4444-555555555555', name: 'Safety & Handling' },
      'https://learn.example/app/ignored'
    )
    const zip = await JSZip.loadAsync(result.buffer)
    const manifest = await zip.file('imsmanifest.xml').async('string')
    const launch = await zip.file('index.html').async('string')

    expect(Object.keys(zip.files).sort()).toEqual(['imsmanifest.xml', 'index.html'])
    expect(result.fileName).toBe('Safety-Handling-SCORM-1.2.zip')
    expect(manifest).toContain('<schemaversion>1.2</schemaversion>')
    expect(manifest).toContain('adlcp:scormtype="sco"')
    expect(manifest).toContain('<title>Safety &amp; Handling</title>')
    expect(launch).toContain('https://learn.example/scorm/launch/11111111-2222-3333-4444-555555555555')
    expect(launch).toContain("cmi.core.lesson_status")
    expect(launch).toContain("cmi.core.score.raw")
    expect(launch).toContain("cmi.suspend_data")
    expect(launch).toContain("learnscope.scorm.progress")
    expect(launch).not.toContain('course-content/')
  })

  it('escapes course text in both XML and HTML', async () => {
    const { buffer } = await buildScormCoursePackage(
      { id: '11111111-2222-3333-4444-555555555555', name: '<script>alert("x")</script>' },
      'https://learn.example'
    )
    const zip = await JSZip.loadAsync(buffer)
    const manifest = await zip.file('imsmanifest.xml').async('string')
    const launch = await zip.file('index.html').async('string')

    expect(manifest).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(launch).not.toContain('<title><script>')
  })
})
