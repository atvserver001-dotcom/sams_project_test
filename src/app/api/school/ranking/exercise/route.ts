export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import { academicMonthToCalendarYear } from '@/lib/analytics'
import {
  HEALTH_CARE_EXERCISE_TYPES_BY_CATEGORY,
  buildHealthCareExerciseRanking,
  resolveHealthCareRankingOptions,
  type HealthCareExerciseRecordRow,
  type HealthCareStudentRow,
} from '@/lib/healthCareExercise'
import { getSchoolContext } from '@/lib/schoolApiAuth'
import { supabaseAdmin } from '@/lib/supabase'

type StudentRow = HealthCareStudentRow
type ExerciseRecordRow = HealthCareExerciseRecordRow

function intParam(params: URLSearchParams, key: string) {
  const raw = params.get(key)
  if (raw == null || raw === '' || raw === 'all' || raw === 'null') return null
  const value = Number(raw)
  return Number.isInteger(value) ? value : NaN
}

export async function GET(request: NextRequest) {
  const auth = await getSchoolContext(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const year = intParam(searchParams, 'year')
  const month = intParam(searchParams, 'month')
  const grade = intParam(searchParams, 'grade')
  const classNo = intParam(searchParams, 'class_no') ?? intParam(searchParams, 'class')
  const rankingOptions = resolveHealthCareRankingOptions(searchParams.get('category'), searchParams.get('metric'))

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return NextResponse.json({ error: 'year and month are required integer parameters.' }, { status: 400 })
  }
  const targetYear = year as number
  const targetMonth = month as number

  if (targetMonth < 1 || targetMonth > 12) return NextResponse.json({ error: 'month must be between 1 and 12.' }, { status: 400 })
  if (Number.isNaN(grade) || Number.isNaN(classNo)) return NextResponse.json({ error: 'grade and class_no must be integers.' }, { status: 400 })
  if (!rankingOptions) return NextResponse.json({ error: 'Invalid category or metric.' }, { status: 400 })

  let studentsQuery = supabaseAdmin
    .from('students')
    .select('id, grade, class_no, student_no, name')
    .eq('school_id', auth.schoolId)
    .eq('year', targetYear)
    .order('grade', { ascending: true })
    .order('class_no', { ascending: true })
    .order('student_no', { ascending: true })

  if (grade != null) studentsQuery = studentsQuery.eq('grade', grade)
  if (classNo != null) studentsQuery = studentsQuery.eq('class_no', classNo)

  const { data: students, error: studentsError } = await studentsQuery.returns<StudentRow[]>()
  if (studentsError) return NextResponse.json({ error: studentsError.message }, { status: 500 })

  const studentRows = students ?? []
  if (studentRows.length === 0) return NextResponse.json({ top3: [], items: [] })

  const studentIds = studentRows.map((student) => student.id)
  const calendarYear = academicMonthToCalendarYear(targetYear, targetMonth)
  const selectedTypes = HEALTH_CARE_EXERCISE_TYPES_BY_CATEGORY[rankingOptions.category]
  const { data: records, error: recordsError } = await supabaseAdmin
    .from('exercise_records')
    .select('student_id, exercise_type, avg_duration_seconds, avg_accuracy, avg_calories, record_count')
    .in('student_id', studentIds)
    .in('exercise_type', selectedTypes)
    .eq('year', calendarYear)
    .eq('month', targetMonth)
    .returns<ExerciseRecordRow[]>()
  if (recordsError) return NextResponse.json({ error: recordsError.message }, { status: 500 })

  const ranked = buildHealthCareExerciseRanking(studentRows, records ?? [], rankingOptions)
  return NextResponse.json({ top3: ranked.slice(0, 3), items: ranked })
}
