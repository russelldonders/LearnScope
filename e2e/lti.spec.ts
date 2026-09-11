import { test, expect } from '@playwright/test'

test('LTI picker stays usable on desktop and mobile', async ({ page }) => {
  await page.route('**/api/lti/session',route=>route.fulfill({json:{type:'picker',objects:[{id:'sql',title:'SQL',description:'Develop your practical SQL proficiency.',grade_passback:true}]}}))
  await page.goto('/lti/session')
  await expect(page.getByRole('heading',{name:'Choose a skill'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Select SQL'})).toBeVisible()
  await page.screenshot({path:'test-results/lti-picker-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await expect(page.getByRole('button',{name:'Select SQL'})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy()
  await page.screenshot({path:'test-results/lti-picker-mobile.png',fullPage:true})
})
test('an expired launch shows a relaunch message without a private skill',async({page})=>{
  await page.route('**/api/lti/session',route=>route.fulfill({status:400,json:{error:'Launch expired. Return to your LMS.'}}))
  await page.goto('/lti/session')
  await expect(page.getByRole('alert')).toContainText('Launch expired')
  await expect(page.getByRole('button',{name:'Add to my skills'})).toHaveCount(0)
})
test('a learner must sign in before linking an LMS identity',async({page})=>{
  await page.route('**/api/lti/session',route=>route.fulfill({json:{type:'learner',title:'SQL',loginRequired:true}}))
  await page.goto('/lti/session')
  await expect(page.getByRole('link',{name:'Sign in or create an account'})).toHaveAttribute('href','/login')
  await expect(page.getByRole('checkbox')).toHaveCount(0)
})
