import { expect, test } from '@playwright/test';

const authenticatedRoutes = [
  { path: '/dashboard', name: 'dashboard' },
  { path: '/profile', name: 'profile' },
  { path: '/connections', name: 'connections' },
  { path: '/learning', name: 'learning' },
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
