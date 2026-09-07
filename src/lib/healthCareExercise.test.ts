import { describe, expect, it } from 'vitest'

import {
  buildHealthCareExerciseRanking,
  resolveHealthCareRankingOptions,
  type HealthCareExerciseRecordRow,
  type HealthCareStudentRow,
} from './healthCareExercise'

const students: HealthCareStudentRow[] = [
  { id: 'a', grade: 1, class_no: 1, student_no: 3, name: 'A' },
  { id: 'b', grade: 1, class_no: 1, student_no: 1, name: 'B' },
  { id: 'c', grade: 1, class_no: 1, student_no: 2, name: 'C' },
]

describe('Health Care exercise ranking', () => {
  it('aggregates minutes, weighted accuracy, and calories like Health Care records', () => {
    const records: HealthCareExerciseRecordRow[] = [
      { student_id: 'a', exercise_type: 'strength', avg_duration_seconds: 60, avg_accuracy: 50, avg_calories: 10, record_count: 2 },
      { student_id: 'a', exercise_type: 'endurance', avg_duration_seconds: 120, avg_accuracy: 100, avg_calories: 50, record_count: 1 },
      { student_id: 'b', exercise_type: 'strength', avg_duration_seconds: 180, avg_accuracy: 50, avg_calories: 20, record_count: 1 },
    ]

    const ranked = buildHealthCareExerciseRanking(students, records, { category: 'all', metric: 'efficiency' })
    const rowA = ranked.find((row) => row.student_id === 'a')

    expect(rowA).toMatchObject({
      minutes: 4,
      accuracy: 66.7,
      calories: 70,
      score: 2.7,
      record_count: 3,
    })
  })

  it('honors Health Care category filters before calculating calorie rankings', () => {
    const records: HealthCareExerciseRecordRow[] = [
      { student_id: 'a', exercise_type: 'strength', avg_duration_seconds: 60, avg_accuracy: 50, avg_calories: 10, record_count: 2 },
      { student_id: 'a', exercise_type: 'endurance', avg_duration_seconds: 120, avg_accuracy: 100, avg_calories: 50, record_count: 1 },
      { student_id: 'b', exercise_type: 'strength', avg_duration_seconds: 180, avg_accuracy: 50, avg_calories: 40, record_count: 1 },
    ]

    const ranked = buildHealthCareExerciseRanking(students, records, { category: 'strength', metric: 'calorie' })

    expect(ranked.map((row) => [row.student_id, row.score])).toEqual([
      ['b', 40],
      ['a', 20],
    ])
  })

  it('keeps legacy category=calorie requests pointed at all Health Care calories', () => {
    expect(resolveHealthCareRankingOptions('calorie', null)).toEqual({
      category: 'all',
      metric: 'calorie',
    })
  })

  it('breaks ranking ties by student number', () => {
    const records: HealthCareExerciseRecordRow[] = [
      { student_id: 'a', exercise_type: 'strength', avg_duration_seconds: 60, avg_accuracy: 100, avg_calories: 10, record_count: 1 },
      { student_id: 'b', exercise_type: 'strength', avg_duration_seconds: 60, avg_accuracy: 100, avg_calories: 10, record_count: 1 },
    ]

    const ranked = buildHealthCareExerciseRanking(students, records, { category: 'all', metric: 'efficiency' })

    expect(ranked.map((row) => row.student_id)).toEqual(['b', 'a'])
  })
})
