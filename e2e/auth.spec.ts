import { test, expect } from '@playwright/test';

// Public-route smoke tests, same philosophy as app.spec.ts: no Supabase
// session or seeded data required, so these stay reliable without a real
// backend (see playwright.config.ts's placeholder-credentials comment).

test('signup form exposes accessible field names', async ({ page }) => {
  await page.goto('/signup');

  await expect(page).toHaveTitle('Sign up | LearnScope');
  await expect(page.getByLabel('First name')).toBeVisible();
  await expect(page.getByLabel('Last name')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});

test('forgot password form exposes accessible field names', async ({ page }) => {
  await page.goto('/forgot-password');

  await expect(page).toHaveTitle('Forgot password | LearnScope');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
});

// ProtectedRoute (src/components/ProtectedRoute.jsx) redirects to /login
// whenever there's no signed-in user -- this is the one behavior of these
// pages that's actually reachable without seeded backend data/a real
// session, and it's exactly the guard every one of these routes depends on.
for (const path of ['/dashboard', '/profile', '/connections', '/actions']) {
  test(`${path} redirects an unauthenticated visitor to /login`, async ({ page }) => {
    await page.goto(path);
    await page.waitForURL('**/login');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });
}
