export type Gender = 'M' | 'F'

export type GradeRefRow = {
  id?: number
  exercise_id: number
  school_id: number
  grade: number
  sex: number
  grade5: number[]
  grade4: number[]
  grade3: number[]
  grade2: number[]
  grade1: number[]
}

export type PapsRecordValues = {
  muscular_endurance: number | null
  power_1: number | null
  power_2: number | null
  flexibility_1: number | null
  flexibility_2: number | null
  cardio_1min: number | null
  cardio_2min: number | null
  cardio_3min: number | null
  bmi: number | null
}

export type PapsItemKey = 'muscular' | 'speed' | 'flexibility' | 'cardio' | 'bmi'

export type PapsItemScore = {
  key: PapsItemKey
  label: string
  grade: number | null
  score: number | null
  rawValue: number | null
  bmiLabel?: BmiLabel
}

export type PapsScoreSummary = {
  items: Record<PapsItemKey, PapsItemScore>
  totalScore: number | null
  totalGrade: number | null
}

export type BmiLabel = 'normal' | 'thin' | 'overweight' | 'mild_obesity' | 'obesity'
export type BmiBucket = 'normal' | 'overweight' | 'mild_obesity' | 'obesity'

export type RankComparable = {
  score: number | null
  tieScore?: number | null
  studentNo?: number | null
  name?: string | null
}

export function academicMonthToCalendarYear(academicYear: number, month: number) {
  return month === 1 || month === 2 ? academicYear + 1 : academicYear
}

export function academicYearMonthFilter(academicYear: number) {
  return `and(year.eq.${academicYear},month.gte.3),and(year.eq.${academicYear + 1},month.lte.2)`
}

export function academicMonthIndex(month: number) {
  return month === 1 || month === 2 ? month + 11 : month - 1
}

export function calculateEfficiencyScore(minutes: number | null | undefined, accuracy: number | null | undefined) {
  if (typeof minutes !== 'number' || typeof accuracy !== 'number') return null
  if (!Number.isFinite(minutes) || !Number.isFinite(accuracy)) return null
  return Math.round((minutes * (accuracy / 100)) * 10) / 10
}

export function gradeRankScore(grade: number | null | undefined) {
  if (grade == null) return null
  if (grade < 1 || grade > 5) return null
  return 6 - grade
}

export function totalPapsGradeFromScore(totalScore: number | null | undefined) {
  if (totalScore == null) return null
  if (totalScore < 20) return 5
  if (totalScore < 40) return 4
  if (totalScore < 60) return 3
  if (totalScore < 80) return 2
  return 1
}

export function compareRankRows(a: RankComparable, b: RankComparable) {
  const scoreA = a.score ?? Number.NEGATIVE_INFINITY
  const scoreB = b.score ?? Number.NEGATIVE_INFINITY
  if (scoreA !== scoreB) return scoreB - scoreA

  const tieA = a.tieScore ?? Number.NEGATIVE_INFINITY
  const tieB = b.tieScore ?? Number.NEGATIVE_INFINITY
  if (tieA !== tieB) return tieB - tieA

  const noA = a.studentNo ?? Number.POSITIVE_INFINITY
  const noB = b.studentNo ?? Number.POSITIVE_INFINITY
  if (noA !== noB) return noA - noB

  return String(a.name ?? '').localeCompare(String(b.name ?? ''))
}

export function calcGradeAndScore(value: number, ref: GradeRefRow): { gradeNo: number; score: number } | null {
  const levels = [
    { arr: ref.grade1, gradeNo: 1, baseScore: 16 },
    { arr: ref.grade2, gradeNo: 2, baseScore: 12 },
    { arr: ref.grade3, gradeNo: 3, baseScore: 8 },
    { arr: ref.grade4, gradeNo: 4, baseScore: 4 },
    { arr: ref.grade5, gradeNo: 5, baseScore: 0 },
  ]

  if (value > ref.grade1[3]) return { gradeNo: 1, score: 20 }

  for (const level of levels) {
    if (value >= level.arr[0]) {
      let pos = 0
      for (let i = 3; i >= 0; i--) {
        if (value >= level.arr[i]) {
          pos = i
          break
        }
      }
      return { gradeNo: level.gradeNo, score: level.baseScore + pos }
    }
  }

  return { gradeNo: 5, score: 0 }
}

const BMI_SCORE_MAP = [13, 14, 15, 16, 17, 18, 19, 20, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]

export function getBmiResult(initialScore: number): { gradeNo: number; score: number; label: BmiLabel } {
  const score = BMI_SCORE_MAP[Math.min(19, Math.max(0, Math.floor(initialScore)))] ?? 1

  if (score <= 4) return { gradeNo: 5, score, label: 'obesity' }
  if (score <= 8) return { gradeNo: 4, score, label: 'mild_obesity' }
  if (score <= 12) return { gradeNo: 3, score, label: 'overweight' }
  if (score <= 16) return { gradeNo: 2, score, label: 'thin' }
  return { gradeNo: 1, score, label: 'normal' }
}

export function bmiBucketFromLabel(label: BmiLabel): BmiBucket {
  if (label === 'normal' || label === 'thin') return 'normal'
  return label
}

export function bestOfTwo(a: number | null | undefined, b: number | null | undefined) {
  if (a == null && b == null) return null
  if (a == null) return b ?? null
  if (b == null) return a
  return Math.max(a, b)
}

export function getCardioPEI(
  row: Pick<PapsRecordValues, 'cardio_1min' | 'cardio_2min' | 'cardio_3min'>,
  schoolType: number,
  gender: Gender | null
) {
  const duration = 180
  const c1 = row.cardio_1min
  const c2 = row.cardio_2min
  const c3 = row.cardio_3min

  if (schoolType === 3 && gender === 'M') {
    if (c1 === null || c1 === 0) return null
    const pei = (duration * 100) / (5.5 * Number(c1) / 2) + (0.22 * (300 - duration))
    return Math.round(pei * 10) / 10
  }

  if (c1 === null || c2 === null || c3 === null) return null
  const pulseTotal = Number(c1) + Number(c2) + Number(c3)
  if (pulseTotal === 0) return null
  return Math.round(((duration / pulseTotal) * 100) * 10) / 10
}

export function findGradeRef(
  refs: GradeRefRow[],
  exerciseId: number,
  schoolType: number,
  studentGrade: number,
  gender: Gender | null
) {
  const sexCode = gender === 'F' ? 2 : 1

  if (exerciseId === 4) {
    return refs.find((r) => r.exercise_id === 4) ?? null
  }

  return refs.find((r) =>
    r.exercise_id === exerciseId &&
    r.school_id === schoolType &&
    r.grade === studentGrade &&
    r.sex === sexCode
  ) ?? refs.find((r) =>
    r.exercise_id === exerciseId &&
    r.school_id === schoolType &&
    r.grade === 0 &&
    r.sex === sexCode
  ) ?? refs.find((r) =>
    r.exercise_id === exerciseId &&
    r.school_id === 0 &&
    r.sex === 0
  ) ?? null
}

export function scorePapsRecord(
  record: PapsRecordValues,
  refs: GradeRefRow[],
  schoolType: number,
  studentGrade: number,
  gender: Gender | null
): PapsScoreSummary {
  const definitions: Array<{
    key: PapsItemKey
    label: string
    exerciseId: number
    getValue: () => number | null
  }> = [
    { key: 'muscular', label: 'muscular_endurance', exerciseId: 1, getValue: () => record.muscular_endurance },
    { key: 'speed', label: 'speed', exerciseId: 2, getValue: () => bestOfTwo(record.power_1, record.power_2) },
    { key: 'flexibility', label: 'flexibility', exerciseId: 3, getValue: () => bestOfTwo(record.flexibility_1, record.flexibility_2) },
    { key: 'cardio', label: 'cardio', exerciseId: 4, getValue: () => getCardioPEI(record, schoolType, gender) },
    { key: 'bmi', label: 'bmi', exerciseId: 5, getValue: () => record.bmi },
  ]

  const entries = definitions.map((definition) => {
    const rawValue = definition.getValue()
    const ref = findGradeRef(refs, definition.exerciseId, schoolType, studentGrade, gender)
    if (rawValue == null || !ref) {
      return [definition.key, {
        key: definition.key,
        label: definition.label,
        grade: null,
        score: null,
        rawValue,
      }] as const
    }

    const result = calcGradeAndScore(Number(rawValue), ref)
    if (!result) {
      return [definition.key, {
        key: definition.key,
        label: definition.label,
        grade: null,
        score: null,
        rawValue,
      }] as const
    }

    if (definition.exerciseId === 5) {
      const bmi = getBmiResult(result.score)
      return [definition.key, {
        key: definition.key,
        label: definition.label,
        grade: bmi.gradeNo,
        score: bmi.score,
        rawValue,
        bmiLabel: bmi.label,
      }] as const
    }

    return [definition.key, {
      key: definition.key,
      label: definition.label,
      grade: result.gradeNo,
      score: result.score,
      rawValue,
    }] as const
  })

  const items = Object.fromEntries(entries) as Record<PapsItemKey, PapsItemScore>
  const scores = Object.values(items).map((item) => item.score).filter((score): score is number => score != null)
  const totalScore = scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0)

  return {
    items,
    totalScore,
    totalGrade: totalPapsGradeFromScore(totalScore),
  }
}
