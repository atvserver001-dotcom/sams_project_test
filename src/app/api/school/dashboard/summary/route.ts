export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import {
  academicMonthIndex,
  academicMonthToCalendarYear,
  academicYearMonthFilter,
  bmiBucketFromLabel,
  calculateEfficiencyScore,
  scorePapsRecord,
  type Gender,
  type GradeRefRow,
  type PapsRecordValues,
} from '@/lib/analytics'
import { getSchoolContext } from '@/lib/schoolApiAuth'
import { supabaseAdmin } from '@/lib/supabase'

type StudentRow = {
  id: string
  grade: number
  class_no: number
  student_no: number
  name: string
  gender: Gender | null
}

type ExerciseRecordRow = {
  student_id: string
  exercise_type: 'endurance' | 'flexibility' | 'strength'
  year: number
  month: number
  avg_duration_seconds: number | null
  avg_accuracy: number | null
  record_count: number | null
}

type PapsRecordRow = PapsRecordValues & {
  student_id: string
  year: number
  month: number
}

type ExerciseBucket = {
  minutes: number
  accuracyWeighted: number
  accuracyCount: number
  recordCount: number
}

function intParam(params: URLSearchParams, key: string) {
  const raw = params.get(key)
  if (raw == null || raw === '' || raw === 'all' || raw === 'null') return null
  const value = Number(raw)
  return Number.isInteger(value) ? value : NaN
}

function round1(value: number) {
  return Math.round(value * 10) / 10
}

function valuesFromRecord(record: PapsRecordRow): PapsRecordValues {
  return {
    muscular_endurance: record.muscular_endurance,
    power_1: record.power_1,
    power_2: record.power_2,
    flexibility_1: record.flexibility_1,
    flexibility_2: record.flexibility_2,
    cardio_1min: record.cardio_1min,
    cardio_2min: record.cardio_2min,
    cardio_3min: record.cardio_3min,
    bmi: record.bmi,
  }
}

function addExerciseRecord(bucket: ExerciseBucket, record: ExerciseRecordRow) {
  const count = Number(record.record_count || 0)
  if (count <= 0) return
  if (typeof record.avg_duration_seconds === 'number') {
    bucket.minutes += (record.avg_duration_seconds * count) / 60
  }
  if (typeof record.avg_accuracy === 'number') {
    bucket.accuracyWeighted += record.avg_accuracy * count
    bucket.accuracyCount += count
  }
  bucket.recordCount += count
}

function emptyExerciseBucket(): ExerciseBucket {
  return { minutes: 0, accuracyWeighted: 0, accuracyCount: 0, recordCount: 0 }
}

export async function GET(request: NextRequest) {
  const auth = await getSchoolContext(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const year = intParam(searchParams, 'year')
  const month = intParam(searchParams, 'month')

  if (!Number.isInteger(year)) return NextResponse.json({ error: 'year is required.' }, { status: 400 })
  if (Number.isNaN(month)) return NextResponse.json({ error: 'month must be an integer.' }, { status: 400 })
  if (month != null && (month < 1 || month > 12)) return NextResponse.json({ error: 'month must be between 1 and 12.' }, { status: 400 })

  const targetYear = year as number
  const targetMonth = month as number | null

  const { data: students, error: studentsError } = await supabaseAdmin
    .from('students')
    .select('id, grade, class_no, student_no, name, gender')
    .eq('school_id', auth.schoolId)
    .eq('year', targetYear)
    .order('grade', { ascending: true })
    .order('class_no', { ascending: true })
    .order('student_no', { ascending: true })
    .returns<StudentRow[]>()

  if (studentsError) return NextResponse.json({ error: studentsError.message }, { status: 500 })

  const studentRows = students ?? []
  if (studentRows.length === 0) {
    return NextResponse.json({
      exercise_count: 0,
      paps_count: 0,
      avg_paps_grade: null,
      avg_paps_grade_delta: null,
      avg_efficiency_score: null,
      grade_avg_paps: [],
      exercise_type_ratio: { strength: 0, cardio: 0, flexibility: 0 },
      grade_distribution: [],
      bmi_distribution: [],
      grade_efficiency: [],
    })
  }

  const studentIds = studentRows.map((student) => student.id)
  const studentById = new Map(studentRows.map((student) => [student.id, student]))
  const exerciseQuery = supabaseAdmin
    .from('exercise_records')
    .select('student_id, exercise_type, year, month, avg_duration_seconds, avg_accuracy, record_count')
    .in('student_id', studentIds)

  // paps_records exists at runtime but is absent from generated database.types.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const papsQuery = ((supabaseAdmin as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('paps_records') as any)
    .select('student_id, year, month, muscular_endurance, power_1, power_2, flexibility_1, flexibility_2, cardio_1min, cardio_2min, cardio_3min, bmi')
    .in('student_id', studentIds)

  if (targetMonth != null) {
    const calendarYear = academicMonthToCalendarYear(targetYear, targetMonth)
    exerciseQuery.eq('year', calendarYear).eq('month', targetMonth)
    papsQuery.eq('year', calendarYear).eq('month', targetMonth)
  } else {
    exerciseQuery.or(academicYearMonthFilter(targetYear))
    papsQuery.or(academicYearMonthFilter(targetYear))
  }

  const [{ data: exerciseRecords, error: exerciseError }, { data: papsRecordsRaw, error: papsError }, { data: gradeRefsRaw, error: refsError }] = await Promise.all([
    exerciseQuery.returns<ExerciseRecordRow[]>(),
    papsQuery,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabaseAdmin as any)
      .from('paps_grade_reference')
      .select('id, exercise_id, school_id, grade, sex, grade5, grade4, grade3, grade2, grade1'),
  ])

  if (exerciseError) return NextResponse.json({ error: exerciseError.message }, { status: 500 })
  if (papsError) return NextResponse.json({ error: papsError.message }, { status: 500 })
  if (refsError) return NextResponse.json({ error: refsError.message }, { status: 500 })
  const papsRecords = (papsRecordsRaw ?? []) as PapsRecordRow[]
  const gradeRefs = (gradeRefsRaw ?? []) as GradeRefRow[]

  const exerciseStudentIds = new Set<string>()
  const exerciseByStudent = new Map<string, ExerciseBucket>()
  const minutesByType = { strength: 0, cardio: 0, flexibility: 0 }

  for (const record of exerciseRecords ?? []) {
    exerciseStudentIds.add(record.student_id)
    const bucket = exerciseByStudent.get(record.student_id) ?? emptyExerciseBucket()
    addExerciseRecord(bucket, record)
    exerciseByStudent.set(record.student_id, bucket)

    const count = Number(record.record_count || 0)
    const minutes = typeof record.avg_duration_seconds === 'number' && count > 0
      ? (record.avg_duration_seconds * count) / 60
      : 0
    if (record.exercise_type === 'strength') minutesByType.strength += minutes
    if (record.exercise_type === 'endurance') minutesByType.cardio += minutes
    if (record.exercise_type === 'flexibility') minutesByType.flexibility += minutes
  }

  const latestPapsByStudent = new Map<string, PapsRecordRow>()
  for (const record of papsRecords) {
    const current = latestPapsByStudent.get(record.student_id)
    if (!current || academicMonthIndex(record.month) > academicMonthIndex(current.month)) {
      latestPapsByStudent.set(record.student_id, record)
    }
  }

  const totalTypeMinutes = minutesByType.strength + minutesByType.cardio + minutesByType.flexibility
  const typePercent = (value: number) => totalTypeMinutes > 0 ? round1((value / totalTypeMinutes) * 100) : 0

  const papsGrades: Array<{ student: StudentRow; grade: number; bmiBucket: string | null }> = []
  for (const [studentId, record] of latestPapsByStudent) {
    const student = studentById.get(studentId)
    if (!student) continue
    const summary = scorePapsRecord(valuesFromRecord(record), gradeRefs, auth.schoolType, student.grade, student.gender)
    if (summary.totalGrade == null) continue
    papsGrades.push({
      student,
      grade: summary.totalGrade,
      bmiBucket: summary.items.bmi.bmiLabel ? bmiBucketFromLabel(summary.items.bmi.bmiLabel) : null,
    })
  }

  const efficiencyRows = Array.from(exerciseByStudent.entries()).flatMap(([studentId, bucket]) => {
    const student = studentById.get(studentId)
    if (!student) return []
    const accuracy = bucket.accuracyCount > 0 ? bucket.accuracyWeighted / bucket.accuracyCount : null
    const score = calculateEfficiencyScore(bucket.minutes, accuracy)
    if (score == null) return []
    return [{ student, score }]
  })

  const avg = (values: number[]) => values.length > 0 ? round1(values.reduce((sum, value) => sum + value, 0) / values.length) : null
  const grades = Array.from(new Set(studentRows.map((student) => student.grade))).sort((a, b) => a - b)

  const gradeAvgPaps = grades.flatMap((gradeNo) => {
    const values = papsGrades.filter((row) => row.student.grade === gradeNo).map((row) => row.grade)
    const value = avg(values)
    return value == null ? [] : [{ grade: gradeNo, avg: value }]
  })

  const gradeDistribution = grades.flatMap((gradeNo) => {
    const rows = papsGrades.filter((row) => row.student.grade === gradeNo)
    if (rows.length === 0) return []
    return [{
      grade: gradeNo,
      measured: rows.length,
      g1: rows.filter((row) => row.grade === 1).length,
      g2: rows.filter((row) => row.grade === 2).length,
      g3: rows.filter((row) => row.grade === 3).length,
      g4: rows.filter((row) => row.grade === 4).length,
      g5: rows.filter((row) => row.grade === 5).length,
    }]
  })

  const bmiDistribution = grades.flatMap((gradeNo) => {
    const rows = papsGrades.filter((row) => row.student.grade === gradeNo && row.bmiBucket)
    if (rows.length === 0) return []
    return [{
      grade: gradeNo,
      normal: rows.filter((row) => row.bmiBucket === 'normal').length,
      overweight: rows.filter((row) => row.bmiBucket === 'overweight').length,
      mild_obesity: rows.filter((row) => row.bmiBucket === 'mild_obesity').length,
      obesity: rows.filter((row) => row.bmiBucket === 'obesity').length,
    }]
  })

  const gradeEfficiency = grades.flatMap((gradeNo) => {
    const values = efficiencyRows.filter((row) => row.student.grade === gradeNo).map((row) => row.score)
    const value = avg(values)
    return value == null ? [] : [{ grade: gradeNo, avg: value }]
  })

  return NextResponse.json({
    exercise_count: exerciseStudentIds.size,
    paps_count: latestPapsByStudent.size,
    avg_paps_grade: avg(papsGrades.map((row) => row.grade)),
    avg_paps_grade_delta: null,
    avg_efficiency_score: avg(efficiencyRows.map((row) => row.score)),
    grade_avg_paps: gradeAvgPaps,
    exercise_type_ratio: {
      strength: typePercent(minutesByType.strength),
      cardio: typePercent(minutesByType.cardio),
      flexibility: typePercent(minutesByType.flexibility),
    },
    grade_distribution: gradeDistribution,
    bmi_distribution: bmiDistribution,
    grade_efficiency: gradeEfficiency,
  })
}
