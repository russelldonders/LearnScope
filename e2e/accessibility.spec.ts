import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const publicPages = ['/', '/login', '/signup', '/forgot-password']

for (const path of publicPages) {
  test(`${path} has no automatically detectable accessibility violations`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('main, form').first()).toBeVisible()

    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
}
