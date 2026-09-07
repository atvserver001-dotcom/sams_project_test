import { test, expect, openLab, openLive, readyChart, SCENARIOS, selectStudent } from './browser'
import { assertFiniteGeometry, assertLabelGeometry } from './geometry'

// Pixel comparison uses software raster only; replay/soak keep their GPU path.
test.use({ launchOptions: { args: [
  '--disable-lcd-text', '--font-render-hinting=none', '--force-color-profile=srgb', '--disable-gpu',
] } })

for (const scenario of SCENARIOS) {
  test(`monthly ${scenario} chart-region candidate`, async ({ page }) => {
    await openLab(page, scenario)
    await expect(page.getByTestId('monthly-data')).toBeVisible()
    for (const id of ['monthly-bars', 'monthly-lines']) {
      const region = page.getByTestId(id)
      await readyChart(region)
      await assertFiniteGeometry(region)
      await assertLabelGeometry(region)
      await page.mouse.move(0, 0)
      await expect(region).toHaveScreenshot(`${scenario}-${id}.png`)
    }
  })

  test(`live ${scenario} detail candidate`, async ({ page }) => {
    await openLab(page, scenario)
    const grid = await openLive(page)
    await assertFiniteGeometry(grid)
    if (scenario === 'normal' || scenario === 'missing') {
      await page.mouse.move(0, 0)
      await expect(grid).toHaveScreenshot(`${scenario}-live-grid.png`)
    }
    const detail = await selectStudent(page, 1)
    await assertFiniteGeometry(detail)
    await assertLabelGeometry(detail)
    await page.mouse.move(0, 0)
    await expect(detail).toHaveScreenshot(`${scenario}-live-detail.png`)
  })
}
