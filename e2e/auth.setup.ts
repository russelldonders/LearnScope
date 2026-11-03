import { expect, test as setup } from '@playwright/test';

const authFile = 'playwright/.auth/learner.json';

setup('authenticate the seeded learner', async ({ page }) => {
  const email = process.env.E2E_LEARNER_EMAIL;
  const password = process.env.E2E_LEARNER_PASSWORD;

  if (!email || !password) {
    throw new Error('E2E_LEARNER_EMAIL and E2E_LEARNER_PASSWORD are required for authenticated tests.');
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
