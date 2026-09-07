import { describe, expect, it } from 'vitest'

import {
  academicMonthToCalendarYear,
  bmiBucketFromLabel,
  calculateEfficiencyScore,
  compareRankRows,
  gradeRankScore,
  totalPapsGradeFromScore,
} from './analytics'

describe('analytics utilities', () => {
  it('maps academic months to calendar years', () => {
    expect(academicMonthToCalendarYear(2026, 3)).toBe(2026)
    expect(academicMonthToCalendarYear(2026, 12)).toBe(2026)
    expect(academicMonthToCalendarYear(2026, 1)).toBe(2027)
    expect(academicMonthToCalendarYear(2026, 2)).toBe(2027)
  })

  it('calculates exercise efficiency from minutes and accuracy', () => {
    expect(calculateEfficiencyScore(300, 95)).toBe(285)
    expect(calculateEfficiencyScore(500, 50)).toBe(250)
    expect(calculateEfficiencyScore(null, 95)).toBeNull()
    expect(calculateEfficiencyScore(120, null)).toBeNull()
  })

  it('maps PAPS grades to ranking scores', () => {
    expect(gradeRankScore(1)).toBe(5)
    expect(gradeRankScore(2)).toBe(4)
    expect(gradeRankScore(3)).toBe(3)
    expect(gradeRankScore(4)).toBe(2)
    expect(gradeRankScore(5)).toBe(1)
    expect(gradeRankScore(null)).toBeNull()
  })

  it('keeps existing PAPS total-grade thresholds', () => {
    expect(totalPapsGradeFromScore(null)).toBeNull()
    expect(totalPapsGradeFromScore(19)).toBe(5)
    expect(totalPapsGradeFromScore(20)).toBe(4)
    expect(totalPapsGradeFromScore(39)).toBe(4)
    expect(totalPapsGradeFromScore(40)).toBe(3)
    expect(totalPapsGradeFromScore(60)).toBe(2)
    expect(totalPapsGradeFromScore(80)).toBe(1)
  })

  it('sorts ranking rows by score, tie score, then student number', () => {
    const rows = [
      { score: 20, tieScore: 3, studentNo: 4 },
      { score: 20, tieScore: 5, studentNo: 8 },
      { score: 30, tieScore: 1, studentNo: 2 },
      { score: 20, tieScore: 5, studentNo: 1 },
    ]

    expect([...rows].sort(compareRankRows)).toEqual([
      { score: 30, tieScore: 1, studentNo: 2 },
      { score: 20, tieScore: 5, studentNo: 1 },
      { score: 20, tieScore: 5, studentNo: 8 },
      { score: 20, tieScore: 3, studentNo: 4 },
    ])
  })

  it('normalizes BMI labels into dashboard buckets', () => {
    expect(bmiBucketFromLabel('normal')).toBe('normal')
    expect(bmiBucketFromLabel('thin')).toBe('normal')
    expect(bmiBucketFromLabel('overweight')).toBe('overweight')
    expect(bmiBucketFromLabel('mild_obesity')).toBe('mild_obesity')
    expect(bmiBucketFromLabel('obesity')).toBe('obesity')
  })
})
