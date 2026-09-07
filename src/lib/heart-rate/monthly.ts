import { HEART_RATE_SESSION_MIN_BPM, HEART_RATE_SESSION_MAX_BPM } from '../heartRateSession'
import { zoneOf } from './zones'

export const isEvaluableHeartRate = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value >= HEART_RATE_SESSION_MIN_BPM && value <= HEART_RATE_SESSION_MAX_BPM
export const monthlyZoneOf = (value: number, age: number) => isEvaluableHeartRate(value) ? zoneOf(value, age) : null

export type HeartRateRow = { student_id: string; student_no: number; name: string; avg_bpm: (number | null)[]; max_bpm: (number | null)[]; min_bpm: (number | null)[] }
export function monthlySummary(rows: HeartRateRow[], ages: Map<number, number>) {
  let sum = 0, count = 0, targetCount = 0, recorded = 0
  let maximum: number | null = null
  let maximumAge = 13
  for (const row of rows) {
    const age = ages.get(row.student_no) ?? 13
    const values = row.avg_bpm.filter(isEvaluableHeartRate)
    if (row.avg_bpm.some(value => value !== null && Number.isFinite(value))) recorded++
    for (const value of values) { sum += value; count++; if (zoneOf(value, age).key !== 'low') targetCount++ }
    for (const value of row.max_bpm) if (isEvaluableHeartRate(value) && (maximum === null || value > maximum)) { maximum = value; maximumAge = age }
  }
  return { average: count ? Math.round(sum / count) : null, maximum, maximumAge, ratio: count ? Math.round(targetCount / count * 100) : null, recorded }
}
