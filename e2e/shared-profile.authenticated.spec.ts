import { expect, test, type Page } from '@playwright/test';

// Runs as the seeded Staging learner. Share links can be revoked but not
// deleted, so each run leaves one revoked link labelled with an E2E prefix
// and a run id in the learner's link history.
const label = `E2E share ${Date.now()}`;

function shareLinkRow(page: Page) {
  return page.getByRole('listitem').filter({ hasText: label });
}

test.afterEach(async ({ page }) => {
  // Revoke the link if the test stopped before doing so itself.
  await page.goto('/profile/privacy');
  await expect(page.getByRole('heading', { name: 'Share via link' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const revoke = shareLinkRow(page).getByRole('button', { name: 'Revoke' });
  if ((await revoke.count()) > 0) {
    await revoke.click();
    await expect(shareLinkRow(page)).toContainText('Revoked');
  }
});

test('a link sharing only experience hides skills and stops working once revoked', async ({ page, browser }) => {
  await page.goto('/profile/privacy');
  await page.getByRole('checkbox', { name: 'Experience', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Skills', exact: true })).not.toBeChecked();
  await page.getByLabel('Label (optional)').fill(label);
  await page.getByRole('button', { name: 'Create link' }).click();

  const url = await page.getByRole('textbox', { name: 'Share this link:' }).inputValue();
  expect(url).toMatch(/\/shared\/[^/]+$/);

  // Open it as a visitor with no LearnScope session.
  const visitorContext = await browser.newContext();
  try {
    const visitor = await visitorContext.newPage();
    await visitor.goto(url);
    await expect(visitor.getByRole('heading', { name: 'Experience', level: 2 })).toBeVisible();
    await expect(visitor.getByRole('heading', { name: 'Skills', level: 2 })).toHaveCount(0);

    await shareLinkRow(page).getByRole('button', { name: 'Revoke' }).click();
    await expect(shareLinkRow(page)).toContainText('Revoked');

    await visitor.reload();
    await expect(visitor.getByText('This link is invalid or has expired.')).toBeVisible();
    await expect(visitor.getByRole('heading', { name: 'Experience', level: 2 })).toHaveCount(0);
  } finally {
    await visitorContext.close();
  }
});
