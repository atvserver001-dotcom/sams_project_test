export type MonthlyValues = (number | null)[]
export type CategoryFilter = 'all' | 1 | 2 | 3 | 4
export type ExerciseMetric = 'minutes' | 'bpm' | 'accuracy' | 'calories'
export type ExerciseField = 'minutes' | 'avg_bpm' | 'max_bpm' | 'accuracy' | 'calories'

export interface ExerciseRow {
  student_id: string
  student_no: number
  name: string
  minutes: MonthlyValues
  avg_bpm: MonthlyValues
  max_bpm: MonthlyValues
  accuracy?: MonthlyValues
  calories?: MonthlyValues
  minutes_c1?: MonthlyValues
  minutes_c2?: MonthlyValues
  minutes_c3?: MonthlyValues
}

export interface ExerciseStudent {
  id: string
  grade: number
  class_no: number
  student_no: number
  name: string
}

export interface ExerciseSchool {
  id: string
  name: string
  school_type: 1 | 2 | 3
}

export const MONTH_ORDER = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1] as const
export const CATEGORIES = [
  { value: 'all', label: '전체', title: '전체 운동' },
  { value: '1', label: '근력', title: '근력·근지구력운동' },
  { value: '2', label: '지구력', title: '심폐지구력운동' },
  { value: '3', label: '유연성', title: '유연성운동' },
  { value: '4', label: '분류 4', title: '분류 4 · 기존 API 분류 유지' },
] as const
export const SERIES = [
  { key: 'minutes_c1', label: '근력', color: '#ec3013' },
  { key: 'minutes_c2', label: '지구력', color: '#444141' },
  { key: 'minutes_c3', label: '유연성', color: '#bab6b6' },
] as const
export const METRICS: Record<ExerciseMetric, { label: string; unit: string; fields: ExerciseField[] }> = {
  minutes: { label: '운동시간', unit: '분', fields: ['minutes'] },
  bpm: { label: '심박', unit: 'bpm', fields: ['avg_bpm', 'max_bpm'] },
  accuracy: { label: '정확도', unit: '%', fields: ['accuracy'] },
  calories: { label: '칼로리', unit: 'kcal', fields: ['calories'] },
}
export const FIELD_LABELS: Record<ExerciseField, string> = {
  minutes: '운동시간 (분)', avg_bpm: '평균 심박 (bpm)', max_bpm: '최대 심박 (bpm)',
  accuracy: '정확도 (%)', calories: '칼로리 (kcal)',
}
export const ALL_FIELDS: ExerciseField[] = ['minutes', 'accuracy', 'avg_bpm', 'max_bpm', 'calories']

export function academicYear(date = new Date()) {
  return date.getFullYear() - (date.getMonth() < 2 ? 1 : 0)
}

export function monthLabel(year: number, index: number) {
  return `${index < 2 ? year + 1 : year}.${String(index + 1).padStart(2, '0')}`
}

export function numeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function sum(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter(numeric)
  return present.length ? present.reduce((total, value) => total + value, 0) : null
}

export function mean(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter(numeric)
  return present.length ? present.reduce((total, value) => total + value, 0) / present.length : null
}

export function maximum(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter(numeric)
  return present.length ? Math.max(...present) : null
}

export function formatValue(value: number | null | undefined, digits = 1) {
  return numeric(value) ? value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—'
}

export function hasRecord(row: ExerciseRow, month?: number) {
  return ALL_FIELDS.some(field => month === undefined ? row[field]?.some(numeric) : numeric(row[field]?.[month]))
}

export function summarizeField(row: ExerciseRow, field: ExerciseField) {
  const values = row[field] ?? []
  return field === 'max_bpm' ? maximum(values) : field === 'minutes' || field === 'calories' ? sum(values) : mean(values)
}

// The endpoint has already weighted each student-month. Cross-month/class means
// are unweighted means of those returned cells; raw sample counts are not exposed.
export function monthlySummary(rows: ExerciseRow[], year: number, now = new Date()) {
  return MONTH_ORDER.map(index => ({
    month: `${index + 1}월`, index, calendarMonth: monthLabel(year, index),
    future: new Date(index < 2 ? year + 1 : year, index, 1) > now,
    minutes: sum(rows.map(row => row.minutes[index])),
    minutes_c1: sum(rows.map(row => row.minutes_c1?.[index])),
    minutes_c2: sum(rows.map(row => row.minutes_c2?.[index])),
    minutes_c3: sum(rows.map(row => row.minutes_c3?.[index])),
    avg_bpm: mean(rows.map(row => row.avg_bpm[index])),
    max_bpm: maximum(rows.map(row => row.max_bpm[index])),
    accuracy: mean(rows.map(row => row.accuracy?.[index])),
    calories: sum(rows.map(row => row.calories?.[index])),
  }))
}

export function joinStudents(students: ExerciseStudent[], rows: ExerciseRow[]): ExerciseRow[] {
  const byId = new Map(rows.map(row => [row.student_id, row]))
  return students.map(student => byId.get(student.id) ?? {
    student_id: student.id, student_no: student.student_no, name: student.name,
    minutes: Array(12).fill(null), avg_bpm: Array(12).fill(null), max_bpm: Array(12).fill(null),
  }).sort((a, b) => a.student_no - b.student_no)
}

export function exerciseExportRows(rows: ExerciseRow[]) {
  return rows.flatMap(row => ALL_FIELDS.map(field => [
    row.student_no, row.name, FIELD_LABELS[field],
    ...MONTH_ORDER.map(index => row[field]?.[index] ?? null),
    summarizeField(row, field),
  ]))
}

export async function readSchoolApi<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || `조회에 실패했습니다. (${response.status})`)
  }
  return response.json() as Promise<T>
}
