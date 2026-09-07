import { test, expect, lastSec, openLab, openLive, selectStudent } from './browser'

test('all 30 production tiles select the matching detail without replacing the session', async ({ page }) => {
  const root = await openLab(page)
  const grid = await openLive(page)
  const sessionId = await root.getAttribute('data-session-id')
  expect(sessionId).toBeTruthy()
  const second = await lastSec(page)
  expect(await grid.locator('button[data-student-no]').evaluateAll(buttons => buttons.map(button => Number(button.getAttribute('data-student-no'))))).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
  await expect(grid.locator('svg[data-chart="tile"]')).toHaveCount(30)
  for (let no = 1; no <= 30; no++) {
    await selectStudent(page, no)
    await expect(root).toHaveAttribute('data-session-id', sessionId!)
    await expect(root).toHaveAttribute('data-last-sec', String(second))
    await expect(grid.locator('button[data-student-no]')).toHaveCount(30)
  }
})

test('public step, pause, reset and tab controls preserve the replay contract', async ({ page }) => {
  const root = await openLab(page)
  await openLive(page)
  await selectStudent(page, 1)
  const sessionId = await root.getAttribute('data-session-id')
  const second = await lastSec(page)
  await page.getByRole('button', { name: '1초 진행', exact: true }).click()
  await expect(root).toHaveAttribute('data-last-sec', String(second + 1))
  await expect(root).toHaveAttribute('data-running', 'false')
  await expect(root).toHaveAttribute('data-session-id', sessionId!)
  await page.getByRole('tab', { name: '월별 집계', exact: true }).click()
  await openLive(page)
  await expect(root).toHaveAttribute('data-last-sec', String(second + 1))
  await expect(root).toHaveAttribute('data-session-id', sessionId!)
  await page.getByRole('button', { name: '처음으로', exact: true }).click()
  await expect(root).toHaveAttribute('data-running', 'false')
  expect(await lastSec(page)).toBeLessThanOrEqual(second)
  for (const speed of ['1', '10', '60']) {
    await page.getByLabel('재생 속도', { exact: true }).selectOption(speed)
    await expect(page.getByLabel('재생 속도', { exact: true })).toHaveValue(speed)
  }
})

test('60-minute data load is explicitly a paused preload, not a real-time soak', async ({ page }) => {
  const root = await openLab(page)
  await openLive(page)
  const load = page.getByRole('button', { name: '60분 데이터 불러오기', exact: true })
  await expect(load).toBeVisible()
  await load.click()
  await expect.poll(() => lastSec(page)).toBeGreaterThanOrEqual(3599)
  await expect(root).toHaveAttribute('data-running', 'false')
  await selectStudent(page, 30)
  const loaded = await lastSec(page)
  await page.getByRole('button', { name: '1초 진행', exact: true }).click()
  await expect(root).toHaveAttribute('data-last-sec', String(loaded + 1))
})
