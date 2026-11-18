import { expect, test } from '@playwright/test'

const BRAND = {
  text: '#080e22',
  background: '#f5ec00',
  primary: '#213a8f',
  contrast: '#ffffff',
}

for (const path of ['/login', '/signup']) {
  test(`${path} keeps organisation colours when the viewer uses dark mode`, async ({ page }) => {
    await page.goto(path)

    const scope = page.locator('.org-brand-scope')
    await expect(scope).toBeVisible()
    await scope.evaluate((element, brand) => {
      document.documentElement.classList.add('dark')
      const htmlElement = element as HTMLElement
      htmlElement.style.setProperty('--org-text', brand.text)
      htmlElement.style.setProperty('--org-background', brand.background)
      htmlElement.style.setProperty('--org-primary', brand.primary)
      htmlElement.style.setProperty('--org-primary-contrast', brand.contrast)
    }, BRAND)

    const heading = scope.locator('.text-ink').first()
    const supportingText = scope.locator('.text-secondary').first()
    const card = scope.locator(':scope > div').first()
    const action = scope.getByRole('button', { name: /log in|sign up/i }).last()

    await expect(heading).toHaveCSS('color', 'rgb(8, 14, 34)')
    await expect(supportingText).toHaveCSS('color', 'rgb(8, 14, 34)')
    await expect(card).toHaveCSS('background-color', 'rgb(245, 236, 0)')
    await expect(action).toHaveCSS('color', 'rgb(255, 255, 255)')
  })
}
