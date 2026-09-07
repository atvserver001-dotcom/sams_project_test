import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const store = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, reads: [] as Array<{ table: string; rows: number }>, cap: 97 }))
vi.mock('jsonwebtoken', () => ({ default: { verify: (token: string) => { if (token === 'invalid') throw new Error('invalid'); return { sub: token } } } }))
vi.mock('@/lib/supabase', () => {
  class Query {
    filters: Array<(row: Row) => boolean> = []
    sorts: string[] = []
    fromRow = 0
    toRow = Infinity
    counted = false
    one = false
    signal?: AbortSignal
    constructor(public table: string) {}
    select(_fields: string, options?: { count?: string }) { this.counted = options?.count === 'exact'; return this }
    eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
    gte(key: string, value: number) { this.filters.push(row => Number(row[key]) >= value); return this }
    lte(key: string, value: number) { this.filters.push(row => Number(row[key]) <= value); return this }
    in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this }
    or(value: string) {
      const year = Number(/year\.eq\.(\d+)/.exec(value)?.[1])
      this.filters.push(row => (row.year === year && Number(row.month) >= 3) || (row.year === year + 1 && Number(row.month) <= 2))
      return this
    }
    order(key: string) { this.sorts.push(key); return this }
    range(from: number, to: number) { this.fromRow = from; this.toRow = to; return this }
    abortSignal(signal: AbortSignal) { this.signal = signal; return this }
    returns() { return this }
    maybeSingle() { this.one = true; return this }
    single() { this.one = true; return this }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => {
        this.signal?.throwIfAborted()
        const rows = (store.tables[this.table] ?? []).filter(row => this.filters.every(filter => filter(row)))
          .sort((a, b) => { for (const key of this.sorts) { const result = String(a[key]).localeCompare(String(b[key])); if (result) return result } return 0 })
        const data = rows.slice(this.fromRow, Math.min(this.toRow + 1, this.fromRow + store.cap))
        store.reads.push({ table: this.table, rows: data.length })
        return { data: this.one ? data[0] ?? null : data, count: this.counted ? rows.length : null, error: null }
      }).then(resolve, reject)
    }
  }
  return { supabaseAdmin: { from: (table: string) => new Query(table) } }
})

import { GET } from '../../src/app/api/school/dashboard/overview/route'
import { aggregateExerciseRows, type ExerciseMonthlyRow } from '../../src/lib/exerciseAggregation'

const request = (token = 'teacher-a', acting = '', extra = '') => new NextRequest(`http://localhost/api/school/dashboard/overview?year=2026${extra}`, {
  headers: { cookie: `${token ? `op-access-token=${token};` : ''}${acting ? `acting_school_id=${acting};` : ''}` },
})

beforeEach(() => {
  process.env.JWT_SECRET = 'synthetic-only'
  store.reads.length = 0
  store.cap = 97
  store.tables = {
    operator_accounts: [
      { id: 'teacher-a', role: 'school', school_id: 'a', is_active: true },
      { id: 'teacher-b', role: 'school', school_id: 'b', is_active: true },
      { id: 'admin', role: 'admin', school_id: null, is_active: true },
      { id: 'inactive', role: 'school', school_id: 'a', is_active: false },
    ],
    schools: [{ id: 'a', name: '합성 A', school_type: 1 }, { id: 'b', name: '합성 B', school_type: 2 }],
    students: [
      { id: 'student-a', school_id: 'a', year: 2026, grade: 1, class_no: 1, student_no: 1, name: '학생 A' },
      { id: 'student-b', school_id: 'b', year: 2026, grade: 1, class_no: 1, student_no: 1, name: '학생 B' },
    ],
    exercise_records: [
      { id: 'record-a', student_id: 'student-a', exercise_type: 'strength', year: 2026, month: 3, avg_duration_seconds: 60, avg_accuracy: 0, avg_bpm: 0, avg_max_bpm: 0, avg_calories: 0, record_count: 2 },
      { id: 'record-b', student_id: 'student-b', exercise_type: 'strength', year: 2026, month: 3, avg_duration_seconds: 900, avg_accuracy: 99, avg_bpm: 199, avg_max_bpm: 200, avg_calories: 99, record_count: 3 },
    ],
    school_contents: [{ id: 'content-a', school_id: 'a', content: null, start_date: null, end_date: null, is_unlimited: null, created_at: '2026-01-01' }],
    device_management: [{ id: 'assignment-a', school_id: 'a', device_id: null, start_date: null, end_date: null, limited_period: null, created_at: '2026-01-01' }],
    devices: [],
  }
})

describe('GET dashboard overview with actual school authorization', () => {
  it('denies absent/invalid/inactive accounts and admins without an acting school before school data reads', async () => {
    for (const [token, status] of [['', 401], ['invalid', 401], ['inactive', 403], ['admin', 403]] as const) {
      store.reads.length = 0
      expect((await GET(request(token))).status).toBe(status)
      expect(store.reads.every(read => read.table === 'operator_accounts')).toBe(true)
    }
  })
  it('keeps teacher and acting-school scopes isolated, including null device and license fields', async () => {
    const response = await GET(request('teacher-a', 'b', '&school_id=b'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const data = await response.json()
    expect(data.school.id).toBe('a')
    expect(data.classes[0].rows[0].avg_bpm[2]).toBe(0)
    expect(data.classes.flatMap((cohort: { students: Array<{ id: string }> }) => cohort.students.map(student => student.id))).toEqual(['student-a'])
    expect(data.licenses).toEqual([
      { key: 'content-content-a', name: '-', kind: '콘텐츠', start: null, end: null, unlimited: false },
      { key: 'device-null-0', name: '-', kind: '디바이스', start: null, end: null, unlimited: true },
    ])
    const acting = await (await GET(request('admin', 'b'))).json()
    expect(acting.school.id).toBe('b')
    expect(acting.classes[0].rows[0].student_id).toBe('student-b')
    expect(acting.licenses).toEqual([])
  })
  it('reads all 1005 students and multiple record pages, retaining academic boundaries and class aggregation', async () => {
    const roster = Array.from({ length: 1005 }, (_, index) => ({ id: `large-${String(index).padStart(5, '0')}`, school_id: 'a', year: 2026, grade: index % 6 + 1, class_no: Math.floor(index / 6) % 10 + 1, student_no: Math.floor(index / 60) + 1, name: `합성 ${index}` }))
    store.tables.students.push(...roster,
      { ...roster[0], id: 'out-year', year: 2025 }, { ...roster[0], id: 'out-grade', grade: 7 }, { ...roster[0], id: 'out-class', class_no: 11 })
    const records = roster.flatMap((student, index) => [
      { ...store.tables.exercise_records[0], id: `one-${student.id}`, student_id: student.id, avg_bpm: index % 2 ? 0 : 90 },
      { ...store.tables.exercise_records[0], id: `two-${student.id}`, student_id: student.id, year: 2027, month: 2 },
      { ...store.tables.exercise_records[0], id: `excluded-${student.id}`, student_id: student.id, year: 2026, month: 1, avg_duration_seconds: 99999 },
    ])
    store.tables.exercise_records.push(...records)
    const response = await GET(request())
    expect(response.status).toBe(200)
    const data = await response.json()
    const allStudents = data.classes.flatMap((cohort: { students: unknown[] }) => cohort.students)
    expect(allStudents).toHaveLength(1006)
    expect(data.classes).toHaveLength(60)
    expect(store.reads.filter(read => read.table === 'operator_accounts')).toHaveLength(1)
    expect(store.reads.filter(read => read.table === 'students').length).toBeGreaterThan(10)
    for (const cohort of data.classes) {
      expect(cohort.rows).toEqual(aggregateExerciseRows(cohort.students, store.tables.exercise_records.filter(record => record.year === 2026 && Number(record.month) >= 3 || record.year === 2027 && Number(record.month) <= 2) as unknown as ExerciseMonthlyRow[]))
    }
  })
  it('uses no class or exercise scans for an empty school and rejects malformed academic years', async () => {
    store.tables.students = []
    expect((await (await GET(request())).json()).classes).toEqual([])
    expect(store.reads.filter(read => read.table === 'exercise_records')).toHaveLength(0)
    expect((await GET(new NextRequest('http://localhost/api/school/dashboard/overview?year=no', { headers: { cookie: 'op-access-token=teacher-a' } }))).status).toBe(400)
  })
})
