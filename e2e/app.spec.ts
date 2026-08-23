import { test, expect } from '@playwright/test';

test('loads the app and shows the landing page', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name: /track the skills you're growing/i })).toBeVisible();
});
