import { test } from './browser'
import { measureReplay } from './performance'

const minutes = Number(process.env.CHART_SOAK_MINUTES ?? 0)

test('opt-in WALL-CLOCK soak at 1x with 30 actual charts', async ({ page }, testInfo) => {
  test.skip(!minutes, 'Disabled by default. Set CHART_SOAK_MINUTES=60 explicitly for a full hour.')
  test.skip(testInfo.project.name !== 'chrome-1920', 'Soak runs once at FHD; use smoke/replay for both viewport sizes.')
  test.setTimeout(minutes * 60_000 + 45_000)
  await measureReplay(page, testInfo, minutes * 60, 1)
})
