import { expect, test } from '@playwright/test'
import { brandedLearnerSections, expectBrandedLearnerSurface } from './helpers/branding'

const organisationSlug = process.env.E2E_BRANDED_ORG_SLUG || 'leeds-united'

for (const section of brandedLearnerSections) {
  test(`${section.label} applies the organisation palette with readable text @branding`, async ({ page }) => {
    const params = new URLSearchParams({ org: organisationSlug })
    if (section.id !== 'home') params.set('section', section.id)

    await page.goto(`/organisation/learning?${params.toString()}`)

    await expect(page).toHaveURL(/\/organisation\/learning\?/)
    await expect(page.getByRole('navigation', { name: /learning/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectBrandedLearnerSurface(page)
  })
}
