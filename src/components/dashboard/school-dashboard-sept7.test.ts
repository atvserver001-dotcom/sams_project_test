import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import { Children, isValidElement, useEffect, useState, type ChangeEvent, type ReactElement, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import * as icons from 'lucide-react'
import { Bar, BarChart, ResponsiveContainer } from 'recharts'
import * as recharts from 'recharts'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as dashboardData from './dashboard-data'
import { loadDashboard, type DashboardData } from './dashboard-data'
import * as exerciseData from '../exercises/exercise-data'
import { academicYear, MONTH_ORDER, SERIES } from '../exercises/exercise-data'
import { cn } from '@/lib/utils'

// Inspect React elements and callbacks without a DOM; browser layout QC is separate.
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: vi.fn(),
  useEffect: vi.fn(),
  useMemo: (factory: () => unknown) => factory(),
}))

vi.mock('./dashboard-data', async importOriginal => ({
  ...await importOriginal<typeof import('./dashboard-data')>(),
  loadDashboard: vi.fn(),
}))

type Element = ReactElement<Record<string, unknown>>
const require = createRequire(import.meta.url)
let SchoolDashboard: typeof import('./school-dashboard').default
let MonthlyExerciseChart: typeof import('../exercises/exercise-charts').MonthlyExerciseChart

// Match the existing exercise-data tests: transpile locally, keeping Next's JSX-preserve config unchanged.
function loadComponent<T>(path: string, imports: Record<string, unknown>): T {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  runInNewContext(code, { exports, require: (id: string) => id in imports ? imports[id] : require(id), Date, AbortController })
  return exports as T
}

function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap(child => isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as ReactNode), ...elements(child.props.actions as ReactNode)]
    : [])
}

function find(node: ReactNode, predicate: (element: Element) => boolean): Element {
  const match = elements(node).find(predicate)
  expect(match).toBeDefined()
  return match!
}

const row: DashboardData['classes'][number]['rows'][number] = {
  student_id: 'student-1', student_no: 1, name: 'Test student',
  minutes: Array(12).fill(6), avg_bpm: Array(12).fill(100), max_bpm: Array(12).fill(140),
  minutes_c1: Array(12).fill(1), minutes_c2: Array(12).fill(2), minutes_c3: Array(12).fill(3),
  accuracy: Array(12).fill(90), calories: Array(12).fill(24),
}
const data: DashboardData = {
  school: { id: 'school-1', name: 'Test school', school_type: 2 },
  classes: [{ grade: 1, classNo: 1, students: [{ id: 'student-1', name: row.name, student_no: 1, grade: 1, class_no: 1 }], rows: [row] }],
  licenses: [],
}

function dashboard(year = academicYear(), loaded = true) {
  const setYear = vi.fn()
  const setResult = vi.fn()
  const setExportError = vi.fn()
  vi.mocked(useState)
    .mockReturnValueOnce([year, setYear])
    .mockReturnValueOnce(['', vi.fn()])
    .mockReturnValueOnce([0, vi.fn()])
    .mockReturnValueOnce([loaded ? { key: `${year}-0`, data } : null, setResult])
    .mockReturnValueOnce([false, vi.fn()])
    .mockReturnValueOnce([null, setExportError])
  return { tree: SchoolDashboard(), setYear, setResult, setExportError }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 7, 12))
  vi.mocked(useState).mockReset()
  vi.mocked(useEffect).mockReset()
  vi.mocked(loadDashboard).mockReset().mockResolvedValue(data)
  const charts = loadComponent<typeof import('../exercises/exercise-charts')>('../exercises/exercise-charts.tsx', {
    recharts, './exercise-data': exerciseData,
  })
  MonthlyExerciseChart = charts.MonthlyExerciseChart
  SchoolDashboard = loadComponent<typeof import('./school-dashboard')>('./school-dashboard.tsx', {
    react: React, 'lucide-react': icons, 'next/link': { default: 'a' },
    '@/components/console/page-header': { PageHeader: 'PageHeader' },
    '@/components/ui/badge': { Badge: 'Badge' },
    '@/components/ui/button': { Button: 'Button' },
    '@/components/ui/input': { Input: 'Input' },
    '@/components/ui/table': { TableBody: 'tbody', TableCell: 'td', TableHead: 'th', TableHeader: 'thead', TableRow: 'tr' },
    '@/lib/utils': { cn },
    '@/components/exercises/exercise-charts': charts,
    '@/components/exercises/exercise-controls': { ExerciseEmpty: 'ExerciseEmpty', ExerciseError: 'ExerciseError', ExerciseLoading: 'ExerciseLoading' },
    '@/components/exercises/exercise-data': exerciseData,
    './dashboard-data': dashboardData,
  }).default
})

afterEach(() => {
  vi.useRealTimers()
})

describe('September 7 dashboard academic-year select', () => {
  it.each([
    [new Date(2026, 8, 7), [2026, 2025, 2024]],
    [new Date(2027, 0, 1), [2026, 2025, 2024]],
    [new Date(2027, 1, 28), [2026, 2025, 2024]],
    [new Date(2027, 2, 1), [2027, 2026, 2025]],
  ])('offers the current academic year and previous two at %s', (date, years) => {
    vi.setSystemTime(date)
    const { tree } = dashboard()
    const select = find(tree, element => element.type === 'select')
    const options = elements(select.props.children as ReactNode).filter(element => element.type === 'option')
    expect(select.props.value).toBe(years[0])
    expect(options.map(option => option.props.value)).toEqual(years)
    expect(options.map(option => Children.toArray(option.props.children as ReactNode).join(''))).toEqual(years.map(year => `${year} 학년도`))
    expect(elements(tree).filter(element => element.props.role === 'radiogroup')).toHaveLength(0)
  })

  it('retains the requested native control dimensions and decorative Lucide arrow while loading', () => {
    const { tree } = dashboard(2026, false)
    const select = find(tree, element => element.type === 'select')
    expect(select.props['aria-label']).toBe('대시보드 학년도')
    expect(String(select.props.className).split(' ')).toEqual(expect.arrayContaining([
      'h-9', 'w-[132px]', 'appearance-none', 'border', 'border-[#201e1d]/40', 'bg-[#f3f2f2]',
      'pl-3', 'pr-[34px]', 'text-[13px]', 'font-semibold',
    ]))
    const arrow = find(tree, element => element.type === ChevronDown)
    expect(arrow.props['aria-hidden']).toBe(true)
    expect(String(arrow.props.className).split(' ')).toEqual(expect.arrayContaining([
      'pointer-events-none', 'absolute', 'right-[11px]', 'h-[15px]', 'w-[15px]', 'opacity-55',
    ]))
  })

  it('changes the numeric year and clears the export error', () => {
    const { tree, setYear, setExportError } = dashboard()
    const select = find(tree, element => element.type === 'select')
    const onChange = select.props.onChange as (event: ChangeEvent<HTMLSelectElement>) => void
    onChange({ target: { value: '2024' } } as ChangeEvent<HTMLSelectElement>)
    expect(setYear).toHaveBeenCalledWith(2024)
    expect(setExportError).toHaveBeenCalledWith(null)
  })

  it('uses the existing loader and cancellation path for the newly selectable oldest year', async () => {
    const { tree, setResult } = dashboard(2024)
    expect(find(tree, element => element.type === MonthlyExerciseChart).props.year).toBe(2024)
    expect(find(tree, element => element.props.title === '2024 학년도 요약')).toBeDefined()
    expect(find(tree, element => element.props.href === '/school/exercises?year=2024')).toBeDefined()
    const cleanup = vi.mocked(useEffect).mock.calls[0][0]()
    expect(loadDashboard).toHaveBeenCalledWith(2024, expect.any(AbortSignal))
    await Promise.resolve()
    expect(setResult).toHaveBeenCalledWith({ key: '2024-0', data })
    if (typeof cleanup === 'function') cleanup()
    expect(vi.mocked(loadDashboard).mock.calls[0][1].aborted).toBe(true)
  })
})

describe('September 7 dashboard chart sizing', () => {
  it('stretches the two columns and leaves the chart out of intrinsic row sizing', () => {
    const { tree } = dashboard()
    const monthly = find(tree, element => element.props['aria-labelledby'] === 'dashboard-monthly-title')
    const devices = find(tree, element => element.props['aria-labelledby'] === 'dashboard-device-title')
    const grid = find(tree, element => {
      const labels = Children.toArray(element.props.children as ReactNode)
        .filter(isValidElement<Record<string, unknown>>).map(child => child.props['aria-labelledby'])
      return labels.includes('dashboard-monthly-title') && labels.includes('dashboard-device-title')
    })
    expect(String(grid.props.className).split(' ')).toContain('items-stretch')
    expect(String(grid.props.className)).not.toContain('items-start')
    expect(String(monthly.props.className).split(' ')).toEqual(expect.arrayContaining(['flex', 'flex-col']))
    const area = find(monthly, element => String(element.props.className).includes('min-h-[215px]'))
    expect(String(area.props.className).split(' ')).toEqual(expect.arrayContaining(['relative', 'flex-1']))
    const fill = find(area, element => element.props.className === 'absolute inset-0')
    const chart = find(fill, element => element.type === MonthlyExerciseChart)
    expect(chart.props).toMatchObject({ height: '100%', dashboard: true, year: 2026, metric: 'minutes', rows: [row] })
    expect(String(devices.props.className)).toContain('min-h-[392px]')
    expect(find(devices, element => element.type === 'ul').props.className).toContain('max-h-[300px]')
  })

  it('keeps the populated chart in Recharts at full available height with finite initial dimensions', () => {
    const chart = MonthlyExerciseChart({ rows: [row], year: 2026, metric: 'minutes', height: '100%', dashboard: true })
    expect(chart.props.style).toEqual({ height: '100%' })
    const container = find(chart, element => element.type === ResponsiveContainer)
    expect(container.props).toMatchObject({ width: '100%', height: '100%', minWidth: 0, initialDimension: { width: 1, height: 215 } })
    const bars = find(container, element => element.type === BarChart)
    expect((bars.props.data as { index: number }[]).map(month => month.index)).toEqual([...MONTH_ORDER])
    expect(elements(bars).filter(element => element.type === Bar).map(bar => [bar.props.dataKey, bar.props.fill, bar.props.stackId]))
      .toEqual(SERIES.map(series => [series.key, series.color, 'minutes']))
  })

  it('fills the same area when there are no received records', () => {
    const chart = MonthlyExerciseChart({ rows: [], year: 2026, metric: 'minutes', height: '100%', dashboard: true })
    expect(chart.props.style).toEqual({ height: '100%' })
    const empty = find(chart.props.children, element => String(element.props.className).split(' ').includes('h-full'))
    expect(Children.toArray(empty.props.children as ReactNode).join('')).toBe('수신된 운동시간 기록이 없습니다.')
    expect(elements(chart).filter(element => element.type === ResponsiveContainer)).toHaveLength(0)
  })

  it.each([undefined, 220, 190])('preserves fixed sizing for existing callers with height %s', height => {
    const chart = MonthlyExerciseChart({ rows: [row], year: 2026, metric: 'bpm', height })
    expect(chart.props.style).toEqual({ height: height ?? 220 })
    expect(find(chart, element => element.type === ResponsiveContainer).props).toMatchObject({
      height: height ?? 220, initialDimension: { width: 1, height: height ?? 220 },
    })
  })
})
