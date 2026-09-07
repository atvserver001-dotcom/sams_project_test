import { test } from './browser'
import { measureReplay } from './performance'

test('one-minute WALL-CLOCK smoke at 1x with 30 actual charts', async ({ page }, testInfo) => {
  test.setTimeout(100_000)
  await measureReplay(page, testInfo, 60, 1)
})
