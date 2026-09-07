export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'

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

type PapsMonthRow = {
  student_id: string
  year: number
  month: number
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

type PapsRow = {
  student_id: string
  student_no: number
  name: string
  muscular_endurance: (number | null)[]
  power_1: (number | null)[]
  power_2: (number | null)[]
  flexibility_1: (number | null)[]
  flexibility_2: (number | null)[]
  cardio_1min: (number | null)[]
  cardio_2min: (number | null)[]
  cardio_3min: (number | null)[]
  bmi: (number | null)[]
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

  if (!gradeParam || !classNoParam || !yearParam) {
    return NextResponse.json({ error: 'grade, class_no, year 쿼리 파라미터가 필요합니다.' }, { status: 400 })
  }

  const grade = Number(gradeParam)
  const class_no = Number(classNoParam)
  const year = Number(yearParam)

  if (!Number.isFinite(grade) || !Number.isFinite(class_no) || !Number.isFinite(year)) {
    return NextResponse.json({ error: 'grade, class_no, year는 숫자여야 합니다.' }, { status: 400 })
  }

  const { data: students, error: studentsError } = await supabaseAdmin
    .from('students')
    .select('id, student_no, name')
    .eq('school_id', schoolId)
    .eq('year', year)
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

  // 학년도 조회: 당해 3~12월 OR 익년 1~2월 (exercises/heart-rate와 동일)
  const { data: records, error: recordsError } = await supabaseAdmin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('paps_records' as any)
    .select('student_id, year, month, muscular_endurance, power_1, power_2, flexibility_1, flexibility_2, cardio_1min, cardio_2min, cardio_3min, bmi')
    .in('student_id', studentIds)
    .or(`and(year.eq.${year},month.gte.3),and(year.eq.${year + 1},month.lte.2)`)
    .order('month', { ascending: true })
    .returns<PapsMonthRow[]>()

  if (recordsError) {
    return NextResponse.json({ error: recordsError.message }, { status: 500 })
  }

  const studentIdToRow: Record<string, PapsRow> = {}
  for (const s of students ?? []) {
    studentIdToRow[s.id] = {
      student_id: s.id,
      student_no: s.student_no,
      name: s.name,
      muscular_endurance: Array.from({ length: 12 }, () => null),
      power_1: Array.from({ length: 12 }, () => null),
      power_2: Array.from({ length: 12 }, () => null),
      flexibility_1: Array.from({ length: 12 }, () => null),
      flexibility_2: Array.from({ length: 12 }, () => null),
      cardio_1min: Array.from({ length: 12 }, () => null),
      cardio_2min: Array.from({ length: 12 }, () => null),
      cardio_3min: Array.from({ length: 12 }, () => null),
      bmi: Array.from({ length: 12 }, () => null),
    }
  }

  for (const r of records ?? []) {
    const row = studentIdToRow[r.student_id]
    if (!row) continue
    const idx = Math.max(0, Math.min(11, (r.month ?? 1) - 1))

    row.muscular_endurance[idx] = typeof r.muscular_endurance === 'number' ? r.muscular_endurance : null
    row.power_1[idx] = typeof r.power_1 === 'number' ? r.power_1 : null
    row.power_2[idx] = typeof r.power_2 === 'number' ? r.power_2 : null
    row.flexibility_1[idx] = typeof r.flexibility_1 === 'number' ? r.flexibility_1 : null
    row.flexibility_2[idx] = typeof r.flexibility_2 === 'number' ? r.flexibility_2 : null
    row.cardio_1min[idx] = typeof r.cardio_1min === 'number' ? r.cardio_1min : null
    row.cardio_2min[idx] = typeof r.cardio_2min === 'number' ? r.cardio_2min : null
    row.cardio_3min[idx] = typeof r.cardio_3min === 'number' ? r.cardio_3min : null
    row.bmi[idx] = typeof r.bmi === 'number' ? r.bmi : null
  }

  const rows: PapsRow[] = Object.values(studentIdToRow).sort((a, b) => (a.student_no ?? 0) - (b.student_no ?? 0))
  return NextResponse.json({ rows })
}
