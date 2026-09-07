import { test } from './browser'
import { measureReplay } from './performance'

test('60x logical 60-minute replay is NOT a 60-minute wall-clock soak', async ({ page }, testInfo) => {
  test.setTimeout(105_000)
  await measureReplay(page, testInfo, 62, 60)
})
