import { calculateEfficiencyScore, compareRankRows } from './analytics'

export type HealthCareExerciseType = 'endurance' | 'flexibility' | 'strength'
export type HealthCareExerciseCategory = 'all' | 'strength' | 'cardio' | 'flexibility'
export type HealthCareRankingMetric = 'efficiency' | 'calorie'

export type HealthCareStudentRow = {
  id: string
  grade: number
  class_no: number
  student_no: number
  name: string
}

export type HealthCareExerciseRecordRow = {
  student_id: string
  exercise_type: HealthCareExerciseType
  avg_duration_seconds: number | null
  avg_accuracy: number | null
  avg_calories: number | null
  record_count: number | null
}

export type HealthCareRankingOptions = {
  category: HealthCareExerciseCategory
  metric: HealthCareRankingMetric
}

export type HealthCareRankingItem = {
  rank: number
  student_id: string
  name: string
  grade: number
  class_no: number
  student_no: number
  score: number
  minutes: number
  accuracy: number | null
  calories: number
  record_count: number
  detail: {
    category: HealthCareExerciseCategory
    metric: HealthCareRankingMetric
  }
}

export const HEALTH_CARE_EXERCISE_TYPES_BY_CATEGORY: Record<HealthCareExerciseCategory, HealthCareExerciseType[]> = {
  all: ['strength', 'endurance', 'flexibility'],
  strength: ['strength'],
  cardio: ['endurance'],
  flexibility: ['flexibility'],
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

export function parseHealthCareCategory(raw: string | null | undefined): HealthCareExerciseCategory | null {
  if (!raw) return 'all'
  if (raw === 'all' || raw === 'strength' || raw === 'cardio' || raw === 'flexibility') return raw
  return null
}

export function parseHealthCareMetric(raw: string | null | undefined): HealthCareRankingMetric | null {
  if (!raw) return 'efficiency'
  if (raw === 'efficiency' || raw === 'calorie') return raw
  return null
}

export function resolveHealthCareRankingOptions(
  categoryRaw: string | null | undefined,
  metricRaw: string | null | undefined,
): HealthCareRankingOptions | null {
  const isLegacyCalorieCategory = categoryRaw === 'calorie'
  const category = isLegacyCalorieCategory ? 'all' : parseHealthCareCategory(categoryRaw)
  const metric = isLegacyCalorieCategory ? 'calorie' : parseHealthCareMetric(metricRaw)

  if (!category || !metric) return null
  return { category, metric }
}

export function buildHealthCareExerciseRanking(
  students: HealthCareStudentRow[],
  records: HealthCareExerciseRecordRow[],
  options: HealthCareRankingOptions,
): HealthCareRankingItem[] {
  const allowedTypes = new Set(HEALTH_CARE_EXERCISE_TYPES_BY_CATEGORY[options.category])
  const buckets = new Map<string, {
    minutes: number
    accuracyWeighted: number
    accuracyCount: number
    calories: number
    recordCount: number
  }>()

  for (const record of records) {
    if (!allowedTypes.has(record.exercise_type)) continue

    const count = Number(record.record_count ?? 0)
    if (count <= 0) continue

    const bucket = buckets.get(record.student_id) ?? {
      minutes: 0,
      accuracyWeighted: 0,
      accuracyCount: 0,
      calories: 0,
      recordCount: 0,
    }

    if (typeof record.avg_duration_seconds === 'number') {
      bucket.minutes += (record.avg_duration_seconds * count) / 60
    }
    if (typeof record.avg_accuracy === 'number') {
      bucket.accuracyWeighted += record.avg_accuracy * count
      bucket.accuracyCount += count
    }
    if (typeof record.avg_calories === 'number') {
      bucket.calories += record.avg_calories * count
    }
    bucket.recordCount += count
    buckets.set(record.student_id, bucket)
  }

  const items = students.flatMap((student) => {
    const bucket = buckets.get(student.id)
    if (!bucket) return []

    const accuracy = bucket.accuracyCount > 0 ? round1(bucket.accuracyWeighted / bucket.accuracyCount) : null
    const score = options.metric === 'calorie'
      ? round1(bucket.calories)
      : calculateEfficiencyScore(bucket.minutes, accuracy)

    if (score == null) return []

    return [{
      rank: 0,
      student_id: student.id,
      name: student.name,
      grade: student.grade,
      class_no: student.class_no,
      student_no: student.student_no,
      score,
      minutes: round1(bucket.minutes),
      accuracy,
      calories: round1(bucket.calories),
      record_count: bucket.recordCount,
      detail: {
        category: options.category,
        metric: options.metric,
      },
    }]
  })

  return items
    .sort((a, b) => compareRankRows(
      { score: a.score, studentNo: a.student_no, name: a.name },
      { score: b.score, studentNo: b.student_no, name: b.name },
    ))
    .map((item, index) => ({ ...item, rank: index + 1 }))
}
