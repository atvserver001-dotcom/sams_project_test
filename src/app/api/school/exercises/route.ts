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

type ExerciseMonthlyRow = {
  student_id: string
  exercise_type: 'endurance' | 'flexibility' | 'strength'
  year: number
  month: number
  avg_duration_seconds: number | null
  avg_accuracy: number | null
  avg_bpm: number | null
  avg_max_bpm: number | null
  avg_calories: number | null
  record_count: number
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

type ExerciseRow = {
  student_id: string
  student_no: number
  name: string
  minutes: (number | null)[]
  avg_bpm: (number | null)[]
  max_bpm: (number | null)[]
  accuracy: (number | null)[]
  calories: (number | null)[]
  minutes_c1: (number | null)[]
  minutes_c2: (number | null)[]
  minutes_c3: (number | null)[]
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

  // 칼로리는 쿼리된 category_type 범위 내(record_type=5) 값만 합산하여 사용합니다.

  const studentIdToRow: Record<string, ExerciseRow> = {}
  for (const s of students ?? []) {
    studentIdToRow[s.id] = {
      student_id: s.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      student_no: (s as any).student_no ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      name: (s as any).name ?? '',
      minutes: Array.from({ length: 12 }, () => null),
      avg_bpm: Array.from({ length: 12 }, () => null),
      max_bpm: Array.from({ length: 12 }, () => null),
      accuracy: Array.from({ length: 12 }, () => null),
      calories: Array.from({ length: 12 }, () => null),
      minutes_c1: Array.from({ length: 12 }, () => null),
      minutes_c2: Array.from({ length: 12 }, () => null),
      minutes_c3: Array.from({ length: 12 }, () => null),
    }
  }

  // 평균 계산을 위한 가중 누적 버퍼(record_count 기준)
  const avgSumMap: Record<string, number[]> = {}
  const avgCntMap: Record<string, number[]> = {}
  const ensureAvgBuffers = (studentId: string) => {
    if (!avgSumMap[studentId]) avgSumMap[studentId] = Array.from({ length: 12 }, () => 0)
    if (!avgCntMap[studentId]) avgCntMap[studentId] = Array.from({ length: 12 }, () => 0)
  }

  // 정확도(%) 평균 계산을 위한 가중 누적 버퍼(record_count 기준)
  const accSumMap: Record<string, number[]> = {}
  const accCntMap: Record<string, number[]> = {}
  const ensureAccBuffers = (studentId: string) => {
    if (!accSumMap[studentId]) accSumMap[studentId] = Array.from({ length: 12 }, () => 0)
    if (!accCntMap[studentId]) accCntMap[studentId] = Array.from({ length: 12 }, () => 0)
  }

  for (const r of records ?? []) {
    const row = studentIdToRow[r.student_id]
    if (!row) continue
    const idx = Math.max(0, Math.min(11, (r.month ?? 1) - 1))

    const count = typeof r.record_count === 'number' ? r.record_count : 0
    const durationMinutes = typeof r.avg_duration_seconds === 'number' && count > 0
      ? (r.avg_duration_seconds * count) / 60
      : null
    const caloriesTotal = typeof r.avg_calories === 'number' && count > 0
      ? r.avg_calories * count
      : null

    // 전체 minutes 합산
    if (durationMinutes != null) {
      const cur = row.minutes[idx]
      row.minutes[idx] = cur == null ? durationMinutes : cur + durationMinutes
    }

    // 카테고리별 스택: 1=strength, 2=endurance, 3=flexibility
    const target = r.exercise_type === 'strength' ? row.minutes_c1 : r.exercise_type === 'endurance' ? row.minutes_c2 : row.minutes_c3
    if (durationMinutes != null) {
      const curC = target[idx]
      target[idx] = curC == null ? durationMinutes : curC + durationMinutes
    }

    // 평균 bpm 가중 누적
    if (typeof r.avg_bpm === 'number' && count > 0) {
      ensureAvgBuffers(r.student_id)
      avgSumMap[r.student_id][idx] += r.avg_bpm * count
      avgCntMap[r.student_id][idx] += count
    }

    // 최대 bpm 은 최대값 유지
    if (typeof r.avg_max_bpm === 'number') {
      const curMax = row.max_bpm[idx]
      row.max_bpm[idx] = curMax == null ? r.avg_max_bpm : Math.max(curMax, r.avg_max_bpm)
    }

    // 정확도 평균 가중 누적
    if (typeof r.avg_accuracy === 'number' && count > 0) {
      ensureAccBuffers(r.student_id)
      accSumMap[r.student_id][idx] += r.avg_accuracy * count
      accCntMap[r.student_id][idx] += count
    }

    // 칼로리 합계
    if (caloriesTotal != null) {
      const curCal = row.calories[idx]
      row.calories[idx] = curCal == null ? caloriesTotal : curCal + caloriesTotal
    }
  }

  // 평균 심박 산출 (가중 평균)
  for (const [studentId, row] of Object.entries(studentIdToRow)) {
    const sumArr = avgSumMap[studentId]
    const cntArr = avgCntMap[studentId]
    if (!sumArr || !cntArr) continue
    for (let i = 0; i < 12; i++) {
      const c = cntArr[i]
      row.avg_bpm[i] = c > 0 ? Math.round((sumArr[i] / c) * 10) / 10 : row.avg_bpm[i]
    }
  }

  // 정확도 평균 산출 (% 값으로 가정, 가중 평균)
  for (const [studentId, row] of Object.entries(studentIdToRow)) {
    const sumArr = accSumMap[studentId]
    const cntArr = accCntMap[studentId]
    if (!sumArr || !cntArr) continue
    for (let i = 0; i < 12; i++) {
      const c = cntArr[i]
      row.accuracy[i] = c > 0 ? Math.round((sumArr[i] / c) * 10) / 10 : row.accuracy[i]
    }
  }

  const rows: ExerciseRow[] = Object.values(studentIdToRow).sort((a, b) => (a.student_no ?? 0) - (b.student_no ?? 0))
  return NextResponse.json({ rows })
}


