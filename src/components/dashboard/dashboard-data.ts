import { MONTH_ORDER, hasRecord, mean, monthLabel, readSchoolApi } from '../exercises/exercise-data'
import type { DashboardData, DashboardClass, DashboardLicense } from '@/lib/schoolDashboard'
export type { DashboardData, DashboardClass, DashboardLicense } from '@/lib/schoolDashboard'

export async function loadDashboard(year: number, signal: AbortSignal): Promise<DashboardData> {
  return readSchoolApi<DashboardData>(`/api/school/dashboard/overview?year=${year}`, signal)
}

export function licenseStatus(license: DashboardLicense, now = new Date()) {
  if (!license.unlimited && license.end && new Date(`${license.end}T23:59:59`) < now) return '기간만료'
  if (license.start && new Date(`${license.start}T00:00:00`) > now) return '사용 예정'
  return '사용중'
}

export function classSummary(item: DashboardClass, year: number) {
  const active = item.rows.filter(row => hasRecord(row)).length
  const latestMonth = [...MONTH_ORDER].reverse().find(index => item.rows.some(row => hasRecord(row, index)))
  return {
    label: `${item.grade}학년 ${item.classNo}반`, students: item.students.length, active,
    participation: item.students.length ? active / item.students.length * 100 : null,
    minutes: mean(item.rows.flatMap(row => row.minutes)),
    accuracy: mean(item.rows.flatMap(row => row.accuracy ?? [])),
    bpm: mean(item.rows.flatMap(row => row.avg_bpm)),
    latest: latestMonth === undefined ? null : monthLabel(year, latestMonth),
  }
}
