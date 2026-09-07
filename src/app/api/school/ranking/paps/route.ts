export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import {
  academicMonthIndex,
  academicMonthToCalendarYear,
  academicYearMonthFilter,
  compareRankRows,
  gradeRankScore,
  type Gender,
  type GradeRefRow,
  type PapsItemKey,
  type PapsRecordValues,
  scorePapsRecord,
} from '@/lib/analytics'
import { getSchoolContext } from '@/lib/schoolApiAuth'
import { supabaseAdmin } from '@/lib/supabase'

type PapsCategory = 'total' | 'muscular' | 'speed' | 'flexibility' | 'cardio' | 'growth'

type StudentRow = {
  id: string
  grade: number
  class_no: number
  student_no: number
  name: string
  gender: Gender | null
}

type PapsRecordRow = PapsRecordValues & {
  student_id: string
  year: number
  month: number
}

type PapsRankingItem = {
  rank: number
  student_id: string
  name: string
  grade: number
  class_no: number
  student_no: number
  score: number
  total_grade: number | null
  grades: {
    muscular: number | null
    speed: number | null
    flexibility: number | null
    cardio: number | null
  }
  growth_delta: number | null
  previous_total_grade: number | null
  detail: Record<string, unknown>
}

function intParam(params: URLSearchParams, key: string) {
  const raw = params.get(key)
  if (raw == null || raw === '' || raw === 'all' || raw === 'null') return null
  const value = Number(raw)
  return Number.isInteger(value) ? value : NaN
}

function parseCategory(raw: string | null): PapsCategory | null {
  if (!raw) return 'total'
  if (raw === 'total' || raw === 'muscular' || raw === 'speed' || raw === 'flexibility' || raw === 'cardio' || raw === 'growth') {
    return raw
  }
  return null
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

export async function GET(request: NextRequest) {
  const auth = await getSchoolContext(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const year = intParam(searchParams, 'year')
  const month = intParam(searchParams, 'month')
  const grade = intParam(searchParams, 'grade')
  const classNo = intParam(searchParams, 'class_no') ?? intParam(searchParams, 'class')
  const category = parseCategory(searchParams.get('category'))

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return NextResponse.json({ error: 'year and month are required integer parameters.' }, { status: 400 })
  }
  const targetYear = year as number
  const targetMonth = month as number

  if (targetMonth < 1 || targetMonth > 12) return NextResponse.json({ error: 'month must be between 1 and 12.' }, { status: 400 })
  if (Number.isNaN(grade) || Number.isNaN(classNo)) return NextResponse.json({ error: 'grade and class_no must be integers.' }, { status: 400 })
  if (!category) return NextResponse.json({ error: 'Invalid category.' }, { status: 400 })

  let studentsQuery = supabaseAdmin
    .from('students')
    .select('id, grade, class_no, student_no, name, gender')
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: gradeRefsRaw, error: refsError } = await (supabaseAdmin as any)
    .from('paps_grade_reference')
    .select('id, exercise_id, school_id, grade, sex, grade5, grade4, grade3, grade2, grade1')

  if (refsError) return NextResponse.json({ error: refsError.message }, { status: 500 })
  const gradeRefs = (gradeRefsRaw ?? []) as GradeRefRow[]

  const studentIds = studentRows.map((student) => student.id)
  const calendarYear = academicMonthToCalendarYear(targetYear, targetMonth)

  // paps_records exists at runtime but is absent from generated database.types.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: currentRecordsRaw, error: currentError } = await ((supabaseAdmin as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('paps_records') as any)
    .select('student_id, year, month, muscular_endurance, power_1, power_2, flexibility_1, flexibility_2, cardio_1min, cardio_2min, cardio_3min, bmi')
    .in('student_id', studentIds)
    .eq('year', calendarYear)
    .eq('month', targetMonth)

  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 })
  const currentRecords = (currentRecordsRaw ?? []) as PapsRecordRow[]

  let academicRecords: PapsRecordRow[] = []
  if (category === 'growth') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await ((supabaseAdmin as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('paps_records') as any)
      .select('student_id, year, month, muscular_endurance, power_1, power_2, flexibility_1, flexibility_2, cardio_1min, cardio_2min, cardio_3min, bmi')
      .in('student_id', studentIds)
      .or(academicYearMonthFilter(targetYear))

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    academicRecords = (data ?? []) as PapsRecordRow[]
  }

  const currentByStudent = new Map(currentRecords.map((record: PapsRecordRow) => [record.student_id, record]))
  const academicByStudent = new Map<string, PapsRecordRow[]>()
  for (const record of academicRecords) {
    const arr = academicByStudent.get(record.student_id) ?? []
    arr.push(record)
    academicByStudent.set(record.student_id, arr)
  }

  const categoryToItemKey: Record<Exclude<PapsCategory, 'total' | 'growth'>, PapsItemKey> = {
    muscular: 'muscular',
    speed: 'speed',
    flexibility: 'flexibility',
    cardio: 'cardio',
  }
  const selectedIndex = academicMonthIndex(targetMonth)

  const items = studentRows.flatMap((student) => {
    const current = currentByStudent.get(student.id)
    if (!current) return []

    const summary = scorePapsRecord(valuesFromRecord(current), gradeRefs, auth.schoolType, student.grade, student.gender)
    let score: number | null = null
    let tieScore: number | null = null
    let growthDelta: number | null = null
    let previousTotalGrade: number | null = null

    if (category === 'total') {
      score = gradeRankScore(summary.totalGrade)
    } else if (category === 'growth') {
      const previous = (academicByStudent.get(student.id) ?? [])
        .filter((record) => academicMonthIndex(record.month) < selectedIndex)
        .sort((a, b) => academicMonthIndex(b.month) - academicMonthIndex(a.month))[0]

      if (!previous) return []
      const previousSummary = scorePapsRecord(valuesFromRecord(previous), gradeRefs, auth.schoolType, student.grade, student.gender)
      const currentScore = gradeRankScore(summary.totalGrade)
      const previousScore = gradeRankScore(previousSummary.totalGrade)
      if (currentScore == null || previousScore == null) return []
      growthDelta = currentScore - previousScore
      previousTotalGrade = previousSummary.totalGrade
      score = growthDelta
      tieScore = currentScore
    } else {
      score = gradeRankScore(summary.items[categoryToItemKey[category]].grade)
    }

    if (score == null) return []

    return [{
      rank: 0,
      student_id: student.id,
      name: student.name,
      grade: student.grade,
      class_no: student.class_no,
      student_no: student.student_no,
      score,
      total_grade: summary.totalGrade,
      grades: {
        muscular: summary.items.muscular.grade,
        speed: summary.items.speed.grade,
        flexibility: summary.items.flexibility.grade,
        cardio: summary.items.cardio.grade,
      },
      growth_delta: growthDelta,
      previous_total_grade: previousTotalGrade,
      detail: {
        category,
        totalScore: summary.totalScore,
        items: summary.items,
      },
      tieScore,
      studentNo: student.student_no,
    }]
  }).sort(compareRankRows)

  const ranked = items.map((item, index) => ({ ...item, rank: index + 1, tieScore: undefined, studentNo: undefined } satisfies PapsRankingItem & { tieScore?: undefined; studentNo?: undefined }))
  return NextResponse.json({ top3: ranked.slice(0, 3), items: ranked })
}
