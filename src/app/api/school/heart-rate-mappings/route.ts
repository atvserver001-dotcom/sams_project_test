export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { validateHeartRateMappingSnapshot } from '@/lib/heartRateMapping'
import { supabaseAdmin } from '@/lib/supabase'

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
      .single()

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

// GET: 심박계 ID 매핑 조회
export async function GET(request: NextRequest) {
  const auth = await getOperatorFromRequest(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const schoolId = auth.account.school_id as string

  try {
    // 심박계 매핑 데이터 조회
    const { data: mappings, error: mappingsError } = await supabaseAdmin
      .from('school_heart_rate_mappings')
      .select('student_no, device_id')
      .eq('school_id', schoolId)
      .neq('device_id', '')
      .order('student_no', { ascending: true })

    if (mappingsError) {
      console.error('Error fetching heart rate mappings:', mappingsError)
      return NextResponse.json({ error: '매핑 데이터 조회 실패' }, { status: 500 })
    }

    return NextResponse.json({ mappings: mappings || [] })
  } catch (error) {
    console.error('Unexpected error in GET /api/school/heart-rate-mappings:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}

// POST: 심박계 ID 매핑 저장
export async function POST(request: NextRequest) {
  const auth = await getOperatorFromRequest(request)
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const schoolId = auth.account.school_id as string

  try {
    // 요청 본문 파싱
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: '요청 본문이 올바른 JSON이 아닙니다.' }, { status: 400 })
    }

    const mappings = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).mappings
      : undefined
    const validation = validateHeartRateMappingSnapshot(mappings)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // 1~30 전체 슬롯을 한 SQL 문으로 갱신한다. 빈 문자열은 미배정 슬롯을 뜻한다.
    // delete-then-insert를 사용하지 않아 요청 실패 시 기존 배정표가 사라지지 않는다.
    const upsertData = validation.mappings
      .slice()
      .sort((left, right) => left.student_no - right.student_no)
      .map((mapping) => ({
        school_id: schoolId,
        student_no: mapping.student_no,
        device_id: mapping.device_id,
      }))

    const { error: upsertError } = await supabaseAdmin
      .from('school_heart_rate_mappings')
      .upsert(upsertData, { onConflict: 'school_id,student_no' })

    if (upsertError) {
      console.error('Error saving heart rate mappings:', upsertError)
      return NextResponse.json({ error: '매핑 데이터 저장 실패' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error in POST /api/school/heart-rate-mappings:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
