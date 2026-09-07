export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'
import { aggregateExerciseRows, type ExerciseMonthlyRow } from '@/lib/exerciseAggregation'

type OperatorAccount = {
  id: string
  role: string
  school_id: string | null
  is_active: boolean
}

type AuthResult =
  | { account: OperatorAccount }
  | { error: string; status: 400 | 401 | 403 | 404 | 500 }

type StudentRow = {
  id: string
  student_no: number
  name: string
}

async function getOperatorFromRequest(request: NextRequest): Promise<AuthResult> {
  const accessToken = request.cookies.get('op-access-token')?.value
  if (!accessToken) {
    return { error: '인증 토큰이 없습니다.', status: 401 as const }
  }

  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) {
    return { error: '서버 설정 오류 (JWT_SECRET 누락)', status: 500 as const }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = jwt.verify(accessToken, jwtSecret) as any
    const { data: account, error } = await supabaseAdmin
      .from('operator_accounts')
      .select('id, role, school_id, is_active')
      .eq('id', decoded.sub)
      .maybeSingle<OperatorAccount>()

    if (error || !account) {
      return { error: '사용자를 찾을 수 없습니다.', status: 404 as const }
    }

    if (!account.is_active) {
      return { error: '비활성화된 계정입니다.', status: 403 as const }
    }

    // 관리자 acting 허용
    if (account.role === 'admin') {
      const actingSchoolId = request.cookies.get('acting_school_id')?.value || null
      if (!actingSchoolId) return { error: '관리자 acting 컨텍스트가 설정되지 않았습니다.', status: 403 as const }
      return { account: { ...account, school_id: actingSchoolId } }
    }

    if (account.role === 'school') {
      if (!account.school_id) return { error: '학교 정보가 누락되었습니다.', status: 400 as const }
      return { account }
    }

    return { error: '권한이 없습니다.', status: 403 as const }
  } catch {
    return { error: '유효하지 않은 세션입니다.', status: 401 as const }
  }
}

export async function GET(request: NextRequest) {
  const auth = await getOperatorFromRequest(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const schoolId = auth.account.school_id as string
  const { searchParams } = new URL(request.url)
  const gradeParam = searchParams.get('grade')
  const classNoParam = searchParams.get('class_no')
  const yearParam = searchParams.get('year')
  const categoryTypeParam = searchParams.get('category_type')

  if (!gradeParam || !classNoParam || !yearParam) {
    return NextResponse.json({ error: 'grade, class_no, year 쿼리 파라미터가 필요합니다.' }, { status: 400 })
  }

  const grade = Number(gradeParam)
  const class_no = Number(classNoParam)
  const year = Number(yearParam)
  let category_type: number | 'all' = 1
  if (categoryTypeParam === 'all') {
    category_type = 'all'
  } else if (categoryTypeParam != null) {
    const n = Number(categoryTypeParam)
    if (Number.isFinite(n)) {
      category_type = n as 1 | 2 | 3 | 4
    }
  }

  if (!Number.isFinite(grade) || !Number.isFinite(class_no) || !Number.isFinite(year)) {
    return NextResponse.json({ error: 'grade, class_no, year는 숫자여야 합니다.' }, { status: 400 })
  }

  const { data: students, error: studentsError } = await supabaseAdmin
    .from('students')
    .select('id, student_no, name')
    .eq('school_id', schoolId)
    .eq('year', year) // 기준 학년도 학생만 조회
    .eq('grade', grade)
    .eq('class_no', class_no)
    .order('student_no', { ascending: true })
    .returns<StudentRow[]>()

  if (studentsError) {
    return NextResponse.json({ error: studentsError.message }, { status: 500 })
  }

  const studentIds = (students ?? []).map((s) => s.id)
  if (studentIds.length === 0) {
    return NextResponse.json({ rows: [] })
  }

  // 학년도 조회 조건: 당해 3~12월 OR 익년 1~2월
  const baseQuery = supabaseAdmin
    .from('exercise_records')
    .select('student_id, exercise_type, year, month, avg_duration_seconds, avg_accuracy, avg_bpm, avg_max_bpm, avg_calories, record_count')
    .in('student_id', studentIds)
    .or(`and(year.eq.${year},month.gte.3),and(year.eq.${year + 1},month.lte.2)`)

  const typeMap: Record<1 | 2 | 3 | 4, 'strength' | 'endurance' | 'flexibility'> = {
    1: 'strength',
    2: 'endurance',
    3: 'flexibility',
    4: 'strength', // 미사용 보호
  }

  const query = category_type === 'all'
    ? baseQuery.in('exercise_type', ['strength', 'endurance', 'flexibility'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : Number.isFinite(category_type as any)
      ? baseQuery.eq('exercise_type', typeMap[category_type as 1 | 2 | 3 | 4])
      : baseQuery

  let records: ExerciseMonthlyRow[] = []
  {
    const { data: recs, error: recordsError } = await query.returns<ExerciseMonthlyRow[]>()
    if (recordsError) {
      return NextResponse.json({ error: recordsError.message }, { status: 500 })
    }
    records = recs ?? []
  }

  const rows = aggregateExerciseRows(students ?? [], records)
  return NextResponse.json({ rows })
}


