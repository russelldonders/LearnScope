import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

export const brandedLearnerSections = [
  { id: 'home', label: 'Home' },
  { id: 'learning', label: 'My learning' },
  { id: 'catalogue', label: 'Catalogue' },
  { id: 'role', label: 'Role & skills' },
] as const

type BrandPalette = {
  text: string
  background: string
  primary: string
  hover: string
  primaryContrast: string
  textRgb: string
  backgroundRgb: string
}

async function readBrandPalette(page: Page): Promise<BrandPalette> {
  const scope = page.locator('.org-brand-scope')
  await expect(scope).toBeVisible()

  const read = () => scope.evaluate((element) => {
    const styles = getComputedStyle(element)
    const read = (name: string) => styles.getPropertyValue(name).trim()
    const toRgb = (color: string) => {
      const probe = document.createElement('span')
      probe.style.color = color
      document.body.append(probe)
      const rgb = getComputedStyle(probe).color
      probe.remove()
      return rgb
    }

    const text = read('--org-text')
    const background = read('--org-background')

    return {
      text,
      background,
      primary: read('--org-primary'),
      hover: read('--org-hover'),
      primaryContrast: read('--org-primary-contrast'),
      textRgb: toRgb(text),
      backgroundRgb: toRgb(background),
    }
  })

  await expect.poll(read, {
    message: 'wait for the organisation palette to finish loading',
  }).toMatchObject({
    text: expect.stringMatching(/^#/),
    background: expect.stringMatching(/^#/),
    primary: expect.stringMatching(/^#/),
    hover: expect.stringMatching(/^#/),
    primaryContrast: expect.stringMatching(/^#/),
  })

  return read()
}

export async function expectBrandedLearnerSurface(page: Page) {
  const scope = page.locator('.org-brand-scope')
  const palette = await readBrandPalette(page)

  await expect(scope).toHaveCSS('color', palette.textRgb)
  await expect(scope).toHaveCSS('background-color', palette.backgroundRgb)

  const readTokenMismatches = () => scope.locator('.text-ink, .text-secondary, .text-moss').evaluateAll(
    (elements, expectedText) => elements
      .filter((element) => {
        const styles = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return styles.display !== 'none'
          && styles.visibility !== 'hidden'
          && Number(styles.opacity) > 0
          && rect.width > 0
          && rect.height > 0
      })
      .filter((element) => getComputedStyle(element).color !== expectedText)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: element.getAttribute('class') || '',
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        actual: getComputedStyle(element).color,
        expected: expectedText,
      })),
    palette.textRgb,
  )

  await expect.poll(readTokenMismatches, {
    message: 'visible shared content-text utilities must use the organisation Text colour',
  }).toEqual([])

  const contrast = await new AxeBuilder({ page })
    .include('.org-brand-scope')
    .withRules(['color-contrast'])
    .analyze()

  expect(
    contrast.violations,
    'all visible text in the branded learner shell must meet WCAG AA colour contrast',
  ).toEqual([])
}
