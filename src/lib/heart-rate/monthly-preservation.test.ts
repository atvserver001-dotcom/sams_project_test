import { expect, it } from 'vitest'
import { monthlySummary, monthlyZoneOf, type HeartRateRow } from './monthly'

it('preserves stored zero separately from missing while excluding it from physiological evaluation', () => {
  const row: HeartRateRow = { student_id: 's1', student_no: 1, name: '테스트', avg_bpm: [0, null, 100], min_bpm: [0, null, 80], max_bpm: [0, null, 120] }
  const before = structuredClone(row)
  expect(monthlyZoneOf(0, 7)).toBeNull()
  expect(monthlyZoneOf(240, 7)).toBeNull()
  expect(monthlySummary([row], new Map([[1, 7]]))).toMatchObject({ average: 100, maximum: 120, recorded: 1 })
  expect(row).toEqual(before)
})

it('counts a stored zero record without turning it into a valid average or erasing it', () => {
  const row: HeartRateRow = { student_id: 's1', student_no: 1, name: '테스트', avg_bpm: [0], min_bpm: [0], max_bpm: [0] }
  expect(monthlySummary([row], new Map([[1, 7]]))).toMatchObject({ average: null, maximum: null, ratio: null, recorded: 1 })
  expect(row.avg_bpm[0]).toBe(0)
})
