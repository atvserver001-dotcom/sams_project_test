export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getSchoolContext } from '@/lib/schoolApiAuth'
import { readAllRows } from '@/lib/readAllRows'
import { buildDashboardClasses, type DashboardData, type DashboardStudent } from '@/lib/schoolDashboard'
import type { ExerciseMonthlyRow } from '@/lib/exerciseAggregation'

type ContentRow = {
  id: string
  start_date: string | null
  end_date: string | null
  is_unlimited: boolean | null
  content: { name: string } | null
}
type DeviceAssignment = {
  id: string
  device_id: string | null
  start_date: string | null
  end_date: string | null
  limited_period: boolean
}

export async function GET(request: NextRequest) {
  const auth = await getSchoolContext(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const yearParam = request.nextUrl.searchParams.get('year')
  const year = Number(yearParam)
  if (!yearParam || !Number.isInteger(year) || year < 1900 || year > 9998) {
    return NextResponse.json({ error: '올바른 학년도가 필요합니다.' }, { status: 400 })
  }

  const signal = request.signal
  const schoolId = auth.schoolId
  try {
    const [schoolResult, students, contents, assignments] = await Promise.all([
      supabaseAdmin.from('schools').select('id, name, school_type').eq('id', schoolId).abortSignal(signal).single(),
      readAllRows<DashboardStudent>((from, to, includeCount) => supabaseAdmin
        .from('students').select('id, grade, class_no, student_no, name', includeCount ? { count: 'exact' } : {})
        .eq('school_id', schoolId).eq('year', year)
        .gte('grade', 1).lte('grade', auth.schoolType === 1 ? 6 : 3)
        .gte('class_no', 1).lte('class_no', 10)
        .order('id').range(from, to).abortSignal(signal).returns<DashboardStudent[]>(), signal),
      readAllRows<ContentRow>((from, to, includeCount) => supabaseAdmin
        .from('school_contents').select('id, start_date, end_date, is_unlimited, content:content_id(name)', includeCount ? { count: 'exact' } : {})
        .eq('school_id', schoolId).order('created_at').order('id').range(from, to).abortSignal(signal).returns<ContentRow[]>(), signal),
      readAllRows<DeviceAssignment>((from, to, includeCount) => supabaseAdmin
        .from('device_management').select('id, device_id, start_date, end_date, limited_period', includeCount ? { count: 'exact' } : {})
        .eq('school_id', schoolId).order('created_at').order('id').range(from, to).abortSignal(signal).returns<DeviceAssignment[]>(), signal),
    ])
    if (schoolResult.error || !schoolResult.data) throw new Error(schoolResult.error?.message || '학교 정보를 찾지 못했습니다.')

    const studentChunks: string[][] = []
    for (let i = 0; i < students.length; i += 100) studentChunks.push(students.slice(i, i + 100).map(student => student.id))
    const recordChunks: ExerciseMonthlyRow[][] = Array.from({ length: studentChunks.length })
    let cursor = 0
    async function readRecords() {
      while (cursor < studentChunks.length) {
        const index = cursor++
        recordChunks[index] = await readAllRows<ExerciseMonthlyRow>((from, to, includeCount) => supabaseAdmin
          .from('exercise_records')
          .select('student_id, exercise_type, year, month, avg_duration_seconds, avg_accuracy, avg_bpm, avg_max_bpm, avg_calories, record_count', includeCount ? { count: 'exact' } : {})
          .in('student_id', studentChunks[index])
          .in('exercise_type', ['strength', 'endurance', 'flexibility'])
          .or(`and(year.eq.${year},month.gte.3),and(year.eq.${year + 1},month.lte.2)`)
          .order('id').range(from, to).abortSignal(signal).returns<ExerciseMonthlyRow[]>(), signal)
      }
    }
    const deviceIds = [...new Set(assignments.map(item => item.device_id).filter((id): id is string => Boolean(id)))]
    const [devices] = await Promise.all([
      deviceIds.length ? readAllRows<{ id: string; device_name: string }>((from, to, includeCount) => supabaseAdmin
        .from('devices').select('id, device_name', includeCount ? { count: 'exact' } : {})
        .in('id', deviceIds).order('id').range(from, to).abortSignal(signal).returns<Array<{ id: string; device_name: string }>>(), signal) : [],
      Promise.all(Array.from({ length: Math.min(4, studentChunks.length) }, readRecords)),
    ])
    const deviceNames = new Map(devices.map(device => [device.id, device.device_name]))
    const result: DashboardData = {
      school: schoolResult.data as DashboardData['school'],
      classes: buildDashboardClasses(students, recordChunks.flat()),
      licenses: [
        ...contents.map(item => ({ key: `content-${item.id}`, name: item.content?.name || '-', kind: '콘텐츠' as const, start: item.start_date, end: item.end_date, unlimited: !!item.is_unlimited })),
        ...assignments.map((item, index) => ({ key: `device-${item.device_id}-${index}`, name: (item.device_id && deviceNames.get(item.device_id)) || '-', kind: '디바이스' as const, start: item.start_date, end: item.end_date, unlimited: !item.limited_period })),
      ],
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (signal.aborted) return new NextResponse(null, { status: 499 })
    return NextResponse.json({ error: error instanceof Error ? error.message : '대시보드 조회 실패' }, { status: 500 })
  }
}
