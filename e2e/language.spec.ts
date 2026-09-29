import { test, expect } from '@playwright/test'

// Non-English dictionaries load on demand; the page should wait for the
// chosen one rather than render in English first and then swap.
test('a saved language preference renders on first load without an English flash', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('learnscope-language', 'es'))
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible()
  await expect(page.getByText('Log in to your growth log.')).toHaveCount(0)
})
