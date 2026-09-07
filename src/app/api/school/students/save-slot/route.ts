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

function finiteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export async function POST(request: NextRequest) {
  const auth = await getOperatorFromRequest(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: '유효하지 않은 JSON 본문입니다.' }, { status: 400 })
  }

  const year = finiteNumber(body.year)
  const grade = finiteNumber(body.grade)
  const classNo = finiteNumber(body.class_no)
  const studentNo = finiteNumber(body.student_no)
  const sourceStudentNo = body.source_student_no == null ? null : finiteNumber(body.source_student_no)
  const studentId = typeof body.id === 'string' && body.id.trim() !== '' ? body.id : null
  const name = typeof body.name === 'string' ? body.name.trim() : ''

  if (!year || !grade || !classNo || !studentNo || !name) {
    return NextResponse.json({ error: 'year, grade, class_no, student_no, name은 필수입니다.' }, { status: 400 })
  }

  if (studentNo < 1 || studentNo > 30) {
    return NextResponse.json({ error: '번호는 1~30 사이여야 합니다.' }, { status: 400 })
  }

  if (sourceStudentNo != null && (sourceStudentNo < 1 || sourceStudentNo > 30)) {
    return NextResponse.json({ error: '원래 번호는 1~30 사이여야 합니다.' }, { status: 400 })
  }

  const height = body.height_cm == null || body.height_cm === '' ? null : finiteNumber(body.height_cm)
  const weight = body.weight_kg == null || body.weight_kg === '' ? null : finiteNumber(body.weight_kg)

  if (body.height_cm != null && body.height_cm !== '' && height == null) {
    return NextResponse.json({ error: '키는 숫자여야 합니다.' }, { status: 400 })
  }

  if (body.weight_kg != null && body.weight_kg !== '' && weight == null) {
    return NextResponse.json({ error: '몸무게는 숫자여야 합니다.' }, { status: 400 })
  }

  const { data, error } = await (supabaseAdmin as any).rpc('save_student_slot', {
    p_school_id: auth.account.school_id,
    p_student_id: studentId,
    p_source_student_no: sourceStudentNo,
    p_year: year,
    p_grade: grade,
    p_class_no: classNo,
    p_student_no: studentNo,
    p_name: name,
    p_gender: body.gender || null,
    p_birth_date: body.birth_date || null,
    p_email: body.email || null,
    p_height_cm: height,
    p_weight_kg: weight,
    p_notes: body.notes || null,
  })

  if (error) {
    const message = String(error.message || '')
    if (message.includes('no temporary student number available')) {
      return NextResponse.json({ error: '번호 이동을 위한 임시 번호가 없습니다.' }, { status: 409 })
    }
    if (message.includes('source student number already exists')) {
      return NextResponse.json({ error: '원래 번호에 이미 학생데이터가 있어 번호를 이동할 수 없습니다.' }, { status: 409 })
    }
    if (message.includes('duplicate key value violates unique constraint')) {
      return NextResponse.json({ error: '해당 번호에 존재하는 학생데이터가 있습니다.' }, { status: 409 })
    }
    return NextResponse.json({ error: message || '저장 중 오류가 발생했습니다.' }, { status: 400 })
  }

  return NextResponse.json({ student: data })
}
