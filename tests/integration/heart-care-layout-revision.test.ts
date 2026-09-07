import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { chartGeometry, chartY } from '../../src/lib/heart-rate/chart'

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
const css = source('src/components/heart-rate/heart-care.module.css')
const rule = (name: string) => css.match(new RegExp(`\\.${name} \\{([^}]+)\\}`))?.[1] ?? ''

describe('September 7 Heart Care layout contract', () => {
  it('lets the desktop chart absorb remaining height without an automatic footer margin', () => {
    expect(rule('waveform')).toContain('flex: 1; min-height: 0')
    expect(rule('detailChart')).toContain('min-height: 0; flex: 1')
    expect(rule('detailChart')).not.toMatch(/height: auto|aspect-ratio/)
    expect(rule('focusMetrics')).not.toContain('margin-top: auto')
    expect(rule('focusMetrics')).toContain('flex-shrink: 0')
  })

  it('uses the handoff desktop viewBox and keeps the mobile and tile geometry', () => {
    const chart = source('src/components/heart-rate/HeartRateChart.tsx')
    expect(chart).toContain("'0 0 1300 558'")
    expect(chart).toContain("'0 0 480 380'")
    expect(chart).toContain("'0 0 264 64'")
    expect(chart).toContain('const height = detail ? compact ? 320 : 500 : 64')
    expect(chart).toContain('y={height + 24}')
    expect(chart).toContain('`≥${bounds[index - 1]}`')
    expect(chart).not.toContain('bounds[3]')
    expect(css).toContain('.detailChart { flex: 1 0 250px; }')
  })

  it('scales marks and axes together without changing the source BPM or gaps', () => {
    const points = [60, 130, 200].map((bpm, sec) => ({ sec, bpm, min: bpm, max: bpm }))
    const before = structuredClone(points)
    const compact = chartGeometry(points, 1200, 320, 0, 2)
    const expanded = chartGeometry(points, 1200, 500, 0, 2)
    expect(points).toEqual(before)
    expect(chartY(60, 500)).toBe(500)
    expect(chartY(130, 500)).toBe(250)
    expect(chartY(200, 500)).toBe(0)
    expect(expanded.segments[0].map(point => point.x)).toEqual(compact.segments[0].map(point => point.x))
    expect(expanded.segments[0].map(point => point.y)).toEqual(compact.segments[0].map(point => point.y * 500 / 320))
  })

  it('renames only display labels and retains the legacy assignment alias', () => {
    expect(source('src/components/heart-rate/HeartRateMonthlyView.tsx')).toContain('title="Heart Care"')
    const menu = source('src/app/school/assigned-menu.ts')
    expect(menu).toContain("label: href === '/school/heart-rate' ? 'Heart Care' : label")
    expect(menu).toContain("name.includes('심박기록관리')")
  })
})
