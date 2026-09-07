export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import {
  HEART_RATE_MAX_BPM,
  HEART_RATE_MAX_STORED_RECORD_COUNT,
  HEART_RATE_MIN_BPM,
  ValidatedHeartRateResult,
  validateHeartRateRecordRequest,
} from '@/lib/heartRateRecordValidation'
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

type HeartRateMonthlyRow = {
  student_id: string
  year: number
  month: number
  avg_bpm: number | null
  max_bpm: number | null
  min_bpm: number | null
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

type HeartRateRow = {
  student_id: string
  student_no: number
  name: string
  avg_bpm: (number | null)[]
  max_bpm: (number | null)[]
  min_bpm: (number | null)[]
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

  // 학년도 조회 조건: 당해 3~12월 OR 익년 1~2월
  const { data: records, error: recordsError } = await supabaseAdmin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('heart_rate_records' as any)
    .select('student_id, year, month, avg_bpm, max_bpm, min_bpm, record_count')
    .in('student_id', studentIds)
    .or(`and(year.eq.${year},month.gte.3),and(year.eq.${year + 1},month.lte.2)`)
    .returns<HeartRateMonthlyRow[]>()

  if (recordsError) {
    return NextResponse.json({ error: recordsError.message }, { status: 500 })
  }

  const studentIdToRow: Record<string, HeartRateRow> = {}
  for (const s of students ?? []) {
    studentIdToRow[s.id] = {
      student_id: s.id,
      student_no: s.student_no,
      name: s.name,
      avg_bpm: Array.from({ length: 12 }, () => null),
      max_bpm: Array.from({ length: 12 }, () => null),
      min_bpm: Array.from({ length: 12 }, () => null),
    }
  }

  for (const r of records ?? []) {
    const row = studentIdToRow[r.student_id]
    if (!row) continue
    const idx = Math.max(0, Math.min(11, (r.month ?? 1) - 1))

    row.avg_bpm[idx] = typeof r.avg_bpm === 'number' ? r.avg_bpm : null
    row.max_bpm[idx] = typeof r.max_bpm === 'number' ? r.max_bpm : null
    row.min_bpm[idx] = typeof r.min_bpm === 'number' ? r.min_bpm : null
  }

  const rows: HeartRateRow[] = Object.values(studentIdToRow).sort((a, b) => (a.student_no ?? 0) - (b.student_no ?? 0))
  return NextResponse.json({ rows })
}

export async function POST(request: NextRequest) {
  const auth = await getOperatorFromRequest(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '요청 본문이 올바른 JSON이 아닙니다.' }, { status: 400 })
    }

    const validation = validateHeartRateRecordRequest(body)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { results, grade, class_no, year } = validation.value
    const schoolId = auth.account.school_id as string
    const studentIds = results.map((result) => result.student_id)

    // 요청의 모든 학생이 로그인 학교와 측정 시작 시점의 학급에 실제로 속하는지 확인한다.
    // 일부만 일치해도 저장하지 않는다.
    const { data: enrolledStudents, error: enrolledStudentsError } = await supabaseAdmin
      .from('students')
      .select('id, student_no')
      .eq('school_id', schoolId)
      .eq('year', year)
      .eq('grade', grade)
      .eq('class_no', class_no)
      .in('id', studentIds)
      .returns<Array<Pick<StudentRow, 'id' | 'student_no'>>>()

    if (enrolledStudentsError) {
      console.error('심박수 저장 대상 학생 검증 오류:', enrolledStudentsError)
      return NextResponse.json({ error: '저장 대상 학생을 확인하지 못했습니다.' }, { status: 500 })
    }

    const enrolledById = new Map((enrolledStudents ?? []).map((student) => [student.id, student.student_no]))
    const hasInvalidMembership = results.some((result) => (
      enrolledById.get(result.student_id) !== result.student_no
    ))
    if (hasInvalidMembership || enrolledById.size !== results.length) {
      return NextResponse.json({ error: '선택한 학교·학년도·학년·반에 속하지 않는 학생이 포함되어 있습니다.' }, { status: 400 })
    }

    // 기존 월 기록을 가져와 서버에서만 누적값을 계산한다.
    const { data: existingRecords, error: fetchError } = await supabaseAdmin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('heart_rate_records' as any)
      .select('student_id, year, month, avg_bpm, max_bpm, min_bpm, record_count')
      .in('student_id', studentIds)
      .returns<HeartRateMonthlyRow[]>()

    if (fetchError) {
      console.error('기존 심박수 조회 오류:', fetchError)
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    const existingMap = new Map<string, HeartRateMonthlyRow>()
    existingRecords?.forEach(r => {
      const key = `${r.student_id}-${r.year}-${r.month}`
      existingMap.set(key, r)
    })

    const isStoredBpm = (value: number | null): value is number => (
      typeof value === 'number'
      && Number.isFinite(value)
      && value >= HEART_RATE_MIN_BPM
      && value <= HEART_RATE_MAX_BPM
    )
    type HeartRateUpsertRow = Omit<ValidatedHeartRateResult, 'student_no' | 'record_count'> & {
      record_count: number
      updated_at: string
    }
    const upsertData: HeartRateUpsertRow[] = []

    for (const result of results) {
      const r = result
      const key = `${r.student_id}-${r.year}-${r.month}`
      const old = existingMap.get(key)
      const updatedAt = new Date().toISOString()

      if (old) {
        const oldAverageBpm = old.avg_bpm
        const oldMaximumBpm = old.max_bpm
        const oldMinimumBpm = old.min_bpm
        if (
          !Number.isInteger(old.record_count)
          || old.record_count < 1
          || old.record_count >= HEART_RATE_MAX_STORED_RECORD_COUNT
          || !isStoredBpm(oldAverageBpm)
          || !isStoredBpm(oldMaximumBpm)
          || !isStoredBpm(oldMinimumBpm)
          || oldMinimumBpm > oldAverageBpm
          || oldAverageBpm > oldMaximumBpm
        ) {
          console.error('기존 심박수 월 기록의 값 범위가 올바르지 않습니다.', { key })
          return NextResponse.json({ error: '기존 심박수 기록을 안전하게 병합할 수 없습니다.' }, { status: 500 })
        }

        const totalCount = old.record_count + 1
        upsertData.push({
          student_id: r.student_id,
          year: r.year,
          month: r.month,
          avg_bpm: Math.round(((oldAverageBpm * old.record_count + r.avg_bpm) / totalCount) * 10) / 10,
          max_bpm: Math.max(oldMaximumBpm, r.max_bpm),
          min_bpm: Math.min(oldMinimumBpm, r.min_bpm),
          record_count: totalCount,
          updated_at: updatedAt,
        })
      } else {
        upsertData.push({
          student_id: r.student_id,
          year: r.year,
          month: r.month,
          avg_bpm: r.avg_bpm,
          max_bpm: r.max_bpm,
          min_bpm: r.min_bpm,
          record_count: r.record_count,
          updated_at: updatedAt,
        })
      }
    }

    const { error } = await supabaseAdmin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('heart_rate_records' as any)
      .upsert(upsertData, {
        onConflict: 'student_id,year,month'
      })

    if (error) {
      console.error('심박수 저장 오류:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, count: upsertData.length })
  } catch (err: unknown) {
    const e = err as Error
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
