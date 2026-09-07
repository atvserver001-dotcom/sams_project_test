import { readFile } from 'node:fs/promises'
import type { Locator, Page } from '@playwright/test'
import type { Aggregate, Sample } from '../../src/lib/heart-rate/session'
import { test, expect, FIXED_TIME, lastSec, openLab, openLive, selectStudent, type Scenario } from './browser'
import { assertFiniteGeometry } from './geometry'

type Evidence = {
  scenario: Scenario
  sessionId: string
  lastSec: number
  students: { no: number; aggregate: Pick<Aggregate, 'n' | 'sum' | 'min' | 'max'>; window: Sample[] }[]
}

async function downloadEvidence(page: Page): Promise<Evidence> {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '검증 데이터 다운로드', exact: true }).click()
  const download = await pending
  const file = await download.path()
  expect(file).toBeTruthy()
  return JSON.parse(await readFile(file!, 'utf8'))
}

const timeLabels = (svg: Locator) => svg.locator('text').filter({ hasText: /^(?:현재|[−-].*(?:분|초))$/ })

function expectUniformSession(data: Evidence, scenario: 'flat' | 'zero', seconds: number) {
  expect(data.scenario).toBe(scenario)
  expect(data.lastSec).toBe(seconds - 1)
  expect(data.students.map(student => student.no)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
  const bpm = scenario === 'flat' ? 130 : null
  for (const student of data.students) {
    expect(student.aggregate.n).toBe(scenario === 'flat' ? seconds : 0)
    expect(student.aggregate.sum).toBe(scenario === 'flat' ? seconds * 130 : 0)
    expect(student.aggregate.min).toBe(bpm)
    expect(student.aggregate.max).toBe(bpm)
    expect(student.window).toEqual(Array.from({ length: seconds }, (_, sec) => ({ sec, bpm, min: bpm, max: bpm })))
  }
}

async function openClockedLive(page: Page) {
  // Virtual clock checks are edge tests, not wall-clock replay/soak evidence.
  // Let existing font/layout helpers settle before pausing rAF and timers.
  await page.clock.install({ time: new Date(FIXED_TIME) })
  const root = await openLab(page, 'flat')
  await openLive(page)
  await selectStudent(page, 1)
  await page.clock.pauseAt(new Date(Date.parse(FIXED_TIME) + 3_600_000))
  return root
}

test('reset renders one sample with only the current-time label and no fictional history', async ({ page }) => {
  const root = await openLab(page, 'flat')
  await openLive(page)
  const detail = await selectStudent(page, 1)
  await page.getByRole('button', { name: '처음으로', exact: true }).click()
  await expect(root).toHaveAttribute('data-last-sec', '0')
  await expect(root).toHaveAttribute('data-running', 'false')
  const svg = detail.locator('svg[data-chart="focus"]')
  await expect(timeLabels(svg)).toHaveText(['현재'])
  await expect(svg.locator('text').filter({ hasText: /^[−-]/ })).toHaveCount(0)
  expectUniformSession(await downloadEvidence(page), 'flat', 1)
})

test('120 samples render five unique short-time labels including ninety seconds', async ({ page }) => {
  const root = await openLab(page)
  await openLive(page)
  const detail = await selectStudent(page, 1)
  await expect(root).toHaveAttribute('data-last-sec', '119')
  const labels = timeLabels(detail.locator('svg[data-chart="focus"]'))
  await expect(labels).toHaveText(['−2분', '−1분 30초', '−1분', '−30초', '현재'])
  expect(new Set(await labels.allTextContents()).size).toBe(5)
  const data = await downloadEvidence(page)
  expect(data.students[0].window).toHaveLength(120)
  expect(data.students[0].window[0].sec).toBe(0)
  expect(data.students[0].window[119].sec).toBe(119)
})

for (const { scenario, low, high } of [
  { scenario: 'spike', low: 45, high: 220 },
  { scenario: 'range', low: 30, high: 240 },
] as const) {
  test(`${scenario}: production SVGs show real out-of-range triangles and unclipped raw extrema`, async ({ page }) => {
    await openLab(page, scenario)
    const grid = await openLive(page)
    const detail = await selectStudent(page, 1)
    const focus = detail.locator('svg[data-chart="focus"]')
    const tile = grid.locator('button[data-student-no="1"] svg[data-chart="tile"]')
    const data = await downloadEvidence(page)
    const raw = data.students.find(student => student.no === 1)!.window
    expect(raw.map(point => point.bpm)).toEqual(expect.arrayContaining([45, 220]))
    expect(Math.min(...raw.map(point => point.bpm!))).toBe(low)
    expect(Math.max(...raw.map(point => point.bpm!))).toBe(high)

    for (const chart of [tile, focus]) {
      await expect(chart.locator('[data-out-of-range]')).toHaveCount(2)
      for (const [direction, bpm] of [['below', low], ['above', high]] as const) {
        const marker = chart.locator(`[data-out-of-range="${direction}"]`)
        await expect(marker.locator('title')).toContainText(`${bpm} bpm`)
        const triangle = marker.locator('path')
        await expect(triangle).toHaveCount(1)
        await expect(triangle).toBeVisible()
        const path = await triangle.getAttribute('d')
        expect(path).toMatch(/^M.*[Zz]$/)
        expect(path!.match(/[Ll]/g)).toHaveLength(2)
        const shape = await triangle.evaluate(element => {
          const path = element as SVGPathElement
          const bounds = path.getBBox()
          return { width: bounds.width, height: bounds.height, length: path.getTotalLength(), fill: getComputedStyle(path).fill }
        })
        expect(shape.width).toBeGreaterThan(0)
        expect(shape.height).toBeGreaterThan(0)
        expect(shape.length).toBeGreaterThan(0)
        expect(shape.fill).not.toBe('none')
      }
    }
    await expect(focus.locator('[data-extreme="min"] text')).toHaveText(new RegExp(`^↓ 최저 ${low} · \\d{2}:\\d{2}$`))
    await expect(focus.locator('[data-extreme="max"] text')).toHaveText(new RegExp(`^↑ 최고 ${high} · \\d{2}:\\d{2}$`))
    await assertFiniteGeometry(detail)
  })
}

test('running reset and scenario switches leave all 30 new sessions free of old-scenario samples', async ({ page }) => {
  const root = await openClockedLive(page)
  const flatId = await root.getAttribute('data-session-id')
  await page.getByLabel('재생 속도', { exact: true }).selectOption('60')
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(root).toHaveAttribute('data-running', 'true')
  await page.clock.runFor(400)
  expect(await lastSec(page)).toBeGreaterThan(119)
  await page.getByRole('button', { name: '처음으로', exact: true }).click()
  await expect(root).toHaveAttribute('data-running', 'false')
  await page.clock.runFor(1000)
  await expect(root).toHaveAttribute('data-last-sec', '0')
  await expect(root).toHaveAttribute('data-session-id', flatId!)
  expectUniformSession(await downloadEvidence(page), 'flat', 1)

  for (const scenario of ['zero', 'flat'] as const) {
    await page.getByRole('button', { name: '재생', exact: true }).click()
    await expect(root).toHaveAttribute('data-running', 'true')
    await page.clock.runFor(400)
    await page.getByLabel('검증 데이터', { exact: true }).selectOption(scenario)
    await expect(root).toHaveAttribute('data-scenario', scenario)
    await expect(root).toHaveAttribute('data-running', 'false')
    await page.clock.runFor(1000)
    await expect(root).toHaveAttribute('data-last-sec', '119')
    const data = await downloadEvidence(page)
    expectUniformSession(data, scenario, 120)
    if (scenario === 'flat') expect(data.sessionId).toBe(flatId)
    else expect(data.sessionId).not.toBe(flatId)
    await expect(page.getByTestId('live-detail').locator('svg[data-chart="focus"]')).toHaveAttribute('aria-label', /^1번 /)
  }
})

test('pause and speed changes retain fractional replay time without wall-clock timing assertions', async ({ page }) => {
  const root = await openClockedLive(page)
  const sessionId = await root.getAttribute('data-session-id')
  await page.getByRole('button', { name: '처음으로', exact: true }).click()
  await page.getByLabel('재생 속도', { exact: true }).selectOption('1')
  await expect(root).toHaveAttribute('data-last-sec', '0')

  // Two subsecond runs must add up across a pause; paused time must add nothing.
  for (const expectedSecond of [0, 1]) {
    await page.getByRole('button', { name: '재생', exact: true }).click()
    await expect(root).toHaveAttribute('data-running', 'true')
    await page.clock.runFor(600)
    await page.getByRole('button', { name: '일시정지', exact: true }).click()
    await expect(root).toHaveAttribute('data-running', 'false')
    await expect(root).toHaveAttribute('data-last-sec', String(expectedSecond))
    await page.clock.runFor(2000)
    await expect(root).toHaveAttribute('data-last-sec', String(expectedSecond))
  }

  // 1.2 retained seconds + 0.3 at 1x + 0.06 at 10x = 2.1 seconds.
  // The 60 ms segment is shorter than a paint interval, exercising cleanup flush.
  await page.getByRole('button', { name: '재생', exact: true }).click()
  await expect(root).toHaveAttribute('data-running', 'true')
  await page.clock.runFor(300)
  await page.getByLabel('재생 속도', { exact: true }).selectOption('10')
  await expect(root).toHaveAttribute('data-running', 'true')
  await page.clock.runFor(60)
  await page.getByRole('button', { name: '일시정지', exact: true }).click()
  await expect(root).toHaveAttribute('data-running', 'false')
  await expect(root).toHaveAttribute('data-last-sec', '2')
  await page.clock.runFor(2000)
  await expect(root).toHaveAttribute('data-last-sec', '2')
  await expect(root).toHaveAttribute('data-session-id', sessionId!)
  expectUniformSession(await downloadEvidence(page), 'flat', 3)
})
