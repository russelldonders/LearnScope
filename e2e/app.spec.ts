import { test, expect } from '@playwright/test';

test('loads the app and shows the landing page', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();

  await expect(page).toHaveTitle('Home | LearnScope');
  await expect(page.getByRole('heading', { name: /track the skills you're growing/i })).toBeVisible();
});

test('login form exposes accessible field names', async ({ page }) => {
  await page.goto('/login');

  await expect(page).toHaveTitle('Log in | LearnScope');
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});
