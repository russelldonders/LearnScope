import { expect, test } from '@playwright/test';

const authenticatedRoutes = [
  { path: '/dashboard', name: 'dashboard' },
  { path: '/activity', name: 'activity' },
  { path: '/skills', name: 'skills' },
  { path: '/experience', name: 'experience' },
  { path: '/profile', name: 'profile' },
  { path: '/profile/privacy', name: 'privacy settings' },
  { path: '/connections', name: 'connections' },
  { path: '/learning', name: 'learning' },
  { path: '/training', name: 'training catalogue' },
  { path: '/plans', name: 'development plans' },
  { path: '/actions', name: 'actions' },
];

for (const route of authenticatedRoutes) {
  test(`seeded learner can open the ${route.name}`, async ({ page }) => {
    await page.goto(route.path);

    await expect(page).toHaveURL(new RegExp(`${route.path}(?:\\?|$)`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toHaveCount(0);
  });
}
