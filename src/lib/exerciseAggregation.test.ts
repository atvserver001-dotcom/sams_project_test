import { describe, expect, it } from 'vitest'
import { aggregateExerciseRows, type ExerciseMonthlyRow } from './exerciseAggregation'
import { buildDashboardClasses } from './schoolDashboard'

const record = (patch: Partial<ExerciseMonthlyRow> = {}): ExerciseMonthlyRow => ({
  student_id: 'a', exercise_type: 'strength', year: 2026, month: 3,
  avg_duration_seconds: 60, avg_accuracy: 80, avg_bpm: 100, avg_max_bpm: 130,
  avg_calories: 5, record_count: 2, ...patch,
})
const students = [{ id: 'a', student_no: 4, name: '합성 A' }, { id: 'b', student_no: 1, name: '합성 B' }]

describe('exercise aggregation retained semantics', () => {
  it('keeps weighted student-month averages, category minutes, totals and maximums', () => {
    const [empty, measured] = aggregateExerciseRows(students, [record(), record({ exercise_type: 'endurance', record_count: 1, avg_duration_seconds: 120, avg_accuracy: 20, avg_bpm: 160, avg_max_bpm: 140, avg_calories: 8 })])
    expect(empty.student_id).toBe('b')
    expect(empty.minutes).toEqual(Array(12).fill(null))
    expect(measured.minutes[2]).toBe(4)
    expect(measured.minutes_c1[2]).toBe(2)
    expect(measured.minutes_c2[2]).toBe(2)
    expect(measured.minutes_c3[2]).toBeNull()
    expect(measured.avg_bpm[2]).toBe(120)
    expect(measured.accuracy[2]).toBe(60)
    expect(measured.max_bpm[2]).toBe(140)
    expect(measured.calories[2]).toBe(18)
  })
  it('preserves measured zero, null, count-zero and calendar January/February cells', () => {
    const rows = aggregateExerciseRows(students, [
      record({ year: 2027, month: 1, avg_duration_seconds: 0, avg_accuracy: 0, avg_bpm: 0, avg_max_bpm: 0, avg_calories: 0 }),
      record({ year: 2027, month: 2, record_count: 0, avg_duration_seconds: null, avg_accuracy: null, avg_bpm: null, avg_max_bpm: 12 }),
      record({ student_id: 'other-school', avg_bpm: 200 }),
    ])
    const measured = rows[1]
    for (const field of ['minutes', 'accuracy', 'avg_bpm', 'max_bpm', 'calories'] as const) expect(measured[field][0]).toBe(0)
    expect(measured.avg_bpm[1]).toBeNull()
    expect(measured.minutes[1]).toBeNull()
    expect(measured.max_bpm[1]).toBe(12)
    expect(measured.avg_bpm[2]).toBeNull()
  })
  it('produces the same class rows as separate per-class aggregation', () => {
    const roster = [
      { ...students[0], grade: 2, class_no: 3 },
      { ...students[1], grade: 1, class_no: 1 },
      { id: 'c', student_no: 2, name: '합성 C', grade: 1, class_no: 1 },
    ]
    const records = [record(), record({ student_id: 'b', avg_bpm: 0 }), record({ student_id: 'c', record_count: 3 })]
    const result = buildDashboardClasses(roster, records)
    expect(result.map(c => [c.grade, c.classNo])).toEqual([[1, 1], [2, 3]])
    for (const cohort of result) expect(cohort.rows).toEqual(aggregateExerciseRows(cohort.students, records))
  })
})
