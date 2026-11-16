import { expect, test, type Page } from '@playwright/test';

// Runs as the seeded Staging learner, whose own history must stay untouched:
// the record created here carries an E2E prefix plus a run id and is deleted
// again afterwards. It is a past job on purpose -- adding a current one would
// prompt to end the learner's existing current role.
const title = `E2E backdated role ${Date.now()}`;

function experienceCard(page: Page) {
  return page.getByRole('button', { name: new RegExp(title) });
}

async function deleteTestExperienceIfPresent(page: Page) {
  await page.goto('/experience');
  await expect(page.getByRole('heading', { name: 'Experience timeline', level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  if ((await experienceCard(page).count()) === 0) return;

  await experienceCard(page).click();
  await page.getByRole('button', { name: 'Experience settings' }).click();
  await page.getByRole('button', { name: 'Delete experience' }).click();
  await page.getByRole('dialog', { name: 'Confirm action' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/experience(?:\?|$)/);
}

test.afterEach(async ({ page }) => {
  await deleteTestExperienceIfPresent(page);
});

test('a backdated job keeps its real dates and cannot end before it starts', async ({ page }) => {
  await page.goto('/experience');
  await page.getByRole('button', { name: '+ Add Experience' }).click();
  await page.getByRole('button', { name: 'Job', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Add job' });
  await dialog.getByLabel('Role title').fill(title);
  await dialog.getByLabel('Company').fill('E2E Test Co');
  await dialog.getByLabel('Start date').fill('2015-06-01');
  const endDate = dialog.getByLabel('End date');
  await endDate.fill('2015-01-31');
  await dialog.getByRole('button', { name: 'Save' }).click();

  // Reversed dates are refused: the dialog stays open and nothing is saved.
  await expect(dialog).toBeVisible();
  expect(await endDate.evaluate((el: HTMLInputElement) => el.validity.rangeUnderflow)).toBe(true);

  await endDate.fill('2016-03-31');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // The timeline shows when the job actually happened, not when it was entered.
  const card = experienceCard(page);
  await expect(card).toContainText('Jun 2015');
  await expect(card).toContainText('Mar 2016');

  await card.click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(page.getByText(/ends .* before it starts/)).toHaveCount(0);
});
