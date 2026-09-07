import { readFile } from 'node:fs/promises'
import { type Page } from '@playwright/test'
import { test, expect, openLab, openLive, readyChart, selectStudent } from './browser'

type Point = { sec: number; bpm: number | null; min: number | null; max: number | null }
type Monthly = { index: number; calendarMonth: string } & Record<string, number | string | null>
type Exported = {
  kind: string; scenario: string; year: number
  rows: Record<string, (number | null)[]>[]; monthly: Monthly[]
  students: { no: number; window: Point[]; aggregate: { n: number; sum: number; min: number | null; max: number | null } }[]
  lastSec: number; sessionId: string
  results: { student_no: number; record_count: number; avg_bpm: number }[]
}

async function downloadData(page: Page): Promise<Exported> {
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '검증 데이터 다운로드', exact: true }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toMatch(/^atvcms-chart-.*\.json$/)
  const file = await download.path()
  expect(file).toBeTruthy()
  return JSON.parse(await readFile(file!, 'utf8'))
}

const display = (value: number | null) => value === null ? '\u2014' : value.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const runs = (values: (number | null)[]) => values.reduce<number>((count, value, index) => count + Number(value !== null && (index === 0 || values[index - 1] === null)), 0)

for (const scenario of ['normal', 'missing', 'zero'] as const) {
  test(`monthly ${scenario}: visible cells, independent aggregation, paths and tooltip agree`, async ({ page }) => {
    await openLab(page, scenario)
    const data = await downloadData(page)
    expect(data.kind).toBe('synthetic-chart-verification')
    expect(data.year).toBe(2025)
    expect(data.scenario).toBe(scenario)
    expect(data.monthly.map(month => month.index)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1])
    for (const month of data.monthly) {
      for (const field of ['minutes_c1', 'minutes_c2', 'minutes_c3', 'minutes', 'avg_bpm', 'max_bpm']) {
        const input = data.rows.map(row => row[field]?.[month.index]).filter((value): value is number => typeof value === 'number')
        const expected = !input.length ? null : field === 'max_bpm' ? Math.max(...input) : input.reduce((sum, value) => sum + value, 0) / (field === 'avg_bpm' ? input.length : 1)
        if (expected === null) expect(month[field]).toBeNull()
        else expect(month[field]).toBeCloseTo(expected, 8)
        await expect(page.getByTestId('monthly-data').locator(`tr[data-month="${month.index + 1}"] [data-field="${field}"]`)).toHaveText(display(expected))
      }
    }
    const maxValues = data.monthly.map(month => month.max_bpm as number | null)
    if (scenario === 'missing') {
      expect(maxValues.filter(value => value === null).length).toBeGreaterThan(0)
      expect(runs(maxValues), 'Fixture must exercise an internal missing interval').toBeGreaterThan(1)
    }
    if (scenario === 'zero') expect(data.monthly.some(month => month.minutes === 0)).toBe(true)
    const line = page.getByTestId('monthly-lines')
    await readyChart(line)
    for (const [index, field] of ['max_bpm', 'avg_bpm'].entries()) {
      const path = line.locator('.recharts-line-curve').nth(index)
      await expect(path).toHaveAttribute('d', /M/)
      expect(((await path.getAttribute('d')) ?? '').match(/M/g)?.length ?? 0, `${field}: nulls must break the real line, zeros must not`).toBe(runs(data.monthly.map(month => month[field] as number | null)))
    }
    const target = data.monthly.findIndex((month, index) => index > 0 && index < 11 && month.max_bpm !== null && (scenario !== 'zero' || month.max_bpm === 0))
    expect(target, 'Fixture needs a measured tooltip target').toBeGreaterThanOrEqual(0)
    const tick = line.locator('svg text.recharts-cartesian-axis-tick-value[orientation="bottom"]').nth(target)
    const tickBox = await tick.boundingBox()
    expect(tickBox!.width).toBeGreaterThan(0)
    expect(tickBox!.height).toBeGreaterThan(0)
    const svgBox = await line.locator('svg.recharts-surface').boundingBox()
    await page.mouse.move(tickBox!.x + tickBox!.width / 2, svgBox!.y + svgBox!.height / 2)
    const tooltip = line.locator('.recharts-tooltip-wrapper')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(data.monthly[target].calendarMonth)
    for (const field of ['max_bpm', 'avg_bpm']) {
      await expect(tooltip).toContainText(`${display(data.monthly[target][field] as number | null)} bpm`)
    }
  })
}

for (const scenario of ['missing', 'zero', 'disconnect', 'spike', 'flat', 'range'] as const) {
  test(`live ${scenario}: raw export, visible derived values and actual SVG remain truthful`, async ({ page }) => {
    await openLab(page, scenario)
    await openLive(page)
    const detail = await selectStudent(page, 1)
    const data = await downloadData(page)
    const student = data.students.find(student => student.no === 1)!
    const raw = student.window
    expect(raw).toHaveLength(120)
    const svg = detail.locator('svg[data-chart="focus"]')
    const signal = svg.locator('g[clip-path$="-plot)"] > path, g[clip-path$="-plot)"] > polyline')
    await expect(signal).toHaveCount(1)
    const segments = (await signal.getAttribute('points')) !== null ? 1 : ((await signal.getAttribute('d')) ?? '').match(/M/g)?.length ?? 0
    expect(segments).toBe(runs(raw.map(point => point.bpm)))
    if (scenario === 'missing' || scenario === 'zero' || scenario === 'disconnect') {
      expect(raw.some(point => point.bpm === null)).toBe(true)
      expect(raw.some(point => point.bpm !== null)).toBe(scenario !== 'zero')
      await expect(svg.locator('[data-signal-gap]').first()).toBeVisible()
      if (scenario === 'zero') expect(raw.some(point => point.bpm === 0), 'Sensor zero means no contact, never measured zero bpm').toBe(false)
    }
    for (const [extreme, field] of [['max', 'max'], ['min', 'min']] as const) {
      const points = raw.filter(point => point[field] !== null)
      if (!points.length) {
        await expect(svg.locator(`[data-extreme="${extreme}"]`)).toHaveCount(0)
        continue
      }
      const value = extreme === 'max' ? Math.max(...points.map(point => point[field]!)) : Math.min(...points.map(point => point[field]!))
      await expect(svg.locator(`[data-extreme="${extreme}"] text`)).toContainText(String(value))
    }
    await detail.locator('summary').click()
    const table = page.getByTestId('live-data')
    await expect(table).toBeVisible()
    await expect(table.getByRole('columnheader', { name: '원시 수신 (bpm)', exact: true })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: '5초 이동평균 (bpm)', exact: true })).toBeVisible()
    const buffer: number[] = []
    const smoothed = raw.map(point => {
      if (point.bpm === null) { buffer.length = 0; return null }
      buffer.push(point.bpm)
      if (buffer.length > 5) buffer.shift()
      return buffer.reduce((sum, value) => sum + value, 0) / buffer.length
    })
    for (const [offset, point] of raw.slice(-30).entries()) {
      const cells = table.locator('tbody tr').nth(offset).locator('th, td')
      await expect(cells).toHaveText([String(point.sec), display(point.bpm), display(smoothed[raw.length - 30 + offset]), display(point.min), display(point.max)])
    }
  })
}
