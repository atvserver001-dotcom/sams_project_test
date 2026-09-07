export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'
import type { Database } from '@/types/database.types'

async function getOperatorFromRequest(request: NextRequest) {
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
      .single<Database['public']['Tables']['operator_accounts']['Row']>()

    if (error || !account) {
      return { error: '사용자를 찾을 수 없습니다.', status: 404 as const }
    }

    if (!account.is_active) {
      return { error: '비활성화된 계정입니다.', status: 403 as const }
    }

    // 관리자 acting 허용
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((account as any).role === 'admin') {
      const actingSchoolId = request.cookies.get('acting_school_id')?.value || null
      if (!actingSchoolId) return { error: '관리자 acting 컨텍스트가 설정되지 않았습니다.', status: 403 as const }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { account: { ...account, school_id: actingSchoolId } as any }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((account as any).role === 'school') {
      if (!account.school_id) return { error: '학교 정보가 누락되었습니다.', status: 400 as const }
      return { account }
    }

    return { error: '권한이 없습니다.', status: 403 as const }
  } catch {
    return { error: '유효하지 않은 세션입니다.', status: 401 as const }
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getOperatorFromRequest(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const schoolId = auth.account.school_id as string
  const { id } = await params

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: '유효하지 않은 JSON 본문' }, { status: 400 })
  }

  const updatePayload = body as Database['public']['Tables']['students']['Update']

  // 학교 범위 보호: school_id 강제
  const { data, error } = await (supabaseAdmin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('students') as any)
    .update({
      ...updatePayload,
      school_id: schoolId,
      updated_at: new Date().toISOString(),
    } as Database['public']['Tables']['students']['Update'])
    .eq('id', id)
    .eq('school_id', schoolId)
    .select('*')
    .single()

  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message = (error as any)?.message || ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (error as any)?.code || ''
    if (code === '23505' || message.includes('duplicate key value violates unique constraint')) {
      return NextResponse.json({ error: '해당 번호에 존재하는 학생데이터가 있습니다.' }, { status: 409 })
    }
    return NextResponse.json({ error: message || '요청 처리 중 오류가 발생했습니다.' }, { status: 400 })
  }

  return NextResponse.json({ student: data })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getOperatorFromRequest(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const schoolId = auth.account.school_id as string
  const { id } = await params

  // 먼저 의존 테이블(exercise_records)에서 해당 학생 데이터 삭제
  const { error: exrecError } = await supabaseAdmin
    .from('exercise_records')
    .delete()
    .eq('student_id', id)

  if (exrecError) {
    return NextResponse.json({ error: exrecError.message }, { status: 400 })
  }

  // 종속 데이터 삭제 후 학생 삭제 시도
  const { error } = await supabaseAdmin
    .from('students')
    .delete()
    .eq('id', id)
    .eq('school_id', schoolId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}


