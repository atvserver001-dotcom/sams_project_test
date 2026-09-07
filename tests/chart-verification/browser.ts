import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { usePinnedFonts } from './fonts'

export const FIXED_TIME = '2026-09-05T03:00:00.000Z'
export const SCENARIOS = ['normal', 'missing', 'zero', 'spike', 'flat', 'range', 'disconnect'] as const
export type Scenario = typeof SCENARIOS[number]
export const CHART_SVG = 'svg.recharts-surface, svg[data-chart]'

export const test = base.extend<{ browserEvidence: void }>({
  browserEvidence: [async ({ page, browser, launchOptions }, use, testInfo) => {
    const errors: string[] = []
    const rasterArgs = launchOptions.args ?? []
    page.on('pageerror', error => errors.push(error.message))
    page.on('crash', () => errors.push('Browser page crashed'))
    await usePinnedFonts(page)
    // Date is deterministic; rAF, performance.now and timers remain real for soak evidence.
    await page.clock.setFixedTime(new Date(FIXED_TIME))
    await use()
    if (!page.isClosed() && await page.getByTestId('chart-lab').count()) {
      await testInfo.attach('chart-environment', {
        contentType: 'application/json',
        body: JSON.stringify({
          browserVersion: browser.version(), fixedTime: FIXED_TIME, rasterArgs,
          ignoredDefaultArgs: launchOptions.ignoreDefaultArgs ?? [],
          legacyScreenshotRequested: Boolean(process.env.PLAYWRIGHT_LEGACY_SCREENSHOT),
          rasterArgsSource: 'Resolved Playwright launchOptions fixture, including file-scoped overrides',
          viewport: page.viewportSize(),
          ...(await page.evaluate(() => ({
            devicePixelRatio, userAgent: navigator.userAgent,
            fonts: Array.from(document.fonts).map(font => ({ family: font.family, weight: font.weight, status: font.status })),
            fontFamily: getComputedStyle(document.body).fontFamily,
          }))),
        }),
      })
    }
    expect(errors, 'Uncaught chart-lab browser errors').toEqual([])
  }, { auto: true }],
})
export { expect }

export async function openLab(page: Page, scenario: Scenario = 'normal') {
  await page.goto('/')
  const root = page.getByTestId('chart-lab')
  await expect(root).toBeVisible()
  await expect(root).toHaveAttribute('data-ready', 'true')
  await expect(page.getByRole('tab', { name: '월별 집계', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByLabel('검증 데이터', { exact: true }).selectOption(scenario)
  await expect(root).toHaveAttribute('data-scenario', scenario)
  await expect(root).toHaveAttribute('data-running', 'false')
  await page.evaluate(async () => {
    for (const weight of [400, 500, 600, 700, 800]) await document.fonts.load(`${weight} 14px Pretendard`, '월별 검증 0123456789')
    await document.fonts.ready
  })
  expect(await page.evaluate(() => Array.from(document.fonts).some(font => font.family.replaceAll('"', '').replaceAll("'", '') === 'Pretendard' && font.status === 'loaded')), 'Pinned Pretendard must be loaded; fallback-only baselines are forbidden').toBe(true)
  expect(await page.evaluate(() => Array.from(document.fonts).filter(font => font.status === 'error').map(font => font.family)), 'Fonts must load before chart comparison').toEqual([])
  return root
}

export async function readyChart(region: Locator, svgCount = 1) {
  await expect(region).toBeVisible()
  await expect(region.locator(CHART_SVG)).toHaveCount(svgCount)
  await expect.poll(() => region.locator(CHART_SVG).evaluateAll(svgs => svgs.every(svg => {
    const box = svg.getBoundingClientRect()
    return box.width > 20 && box.height > 20 && !!svg.querySelector('path, polyline, rect')
  })), { message: 'Responsive SVGs must have real dimensions and geometry' }).toBe(true)
  // Two consecutive animation frames let ResizeObserver and SVG layout settle.
  await region.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

export async function openLive(page: Page) {
  await page.getByRole('tab', { name: '실시간 파형', exact: true }).click()
  const grid = page.getByTestId('live-grid')
  await expect(grid.locator('button[data-student-no]')).toHaveCount(30)
  await readyChart(grid, 30)
  return grid
}

export async function selectStudent(page: Page, no: number) {
  await page.getByTestId('live-grid').locator(`button[data-student-no="${no}"]`).click()
  const detail = page.getByTestId('live-detail')
  await detail.scrollIntoViewIfNeeded()
  await readyChart(detail)
  await expect(detail.locator('svg[data-chart="focus"]')).toHaveAttribute('aria-label', new RegExp(`^${no}번 `))
  return detail
}

export async function lastSec(page: Page) {
  const value = await page.getByTestId('chart-lab').getAttribute('data-last-sec')
  expect(value).toMatch(/^-?\d+$/)
  return Number(value)
}

export async function tableRows(table: Locator) {
  return table.locator('tbody tr').evaluateAll(rows => rows.map(row => Array.from(row.querySelectorAll('th,td')).map(cell => cell.textContent?.trim() ?? '')))
}
