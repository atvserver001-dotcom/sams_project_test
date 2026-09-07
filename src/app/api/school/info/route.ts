export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
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
    const { data: account, error } = await (supabaseAdmin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('operator_accounts') as any)
      .select('id, role, school_id, is_active')
      .eq('id', decoded.sub)
      .maybeSingle()

    if (error || !account) {
      return { error: '사용자를 찾을 수 없습니다.', status: 404 as const }
    }

    if (!account.is_active) {
      return { error: '비활성화된 계정입니다.', status: 403 as const }
    }

    // 관리자 acting 허용: acting_school_id 쿠키가 있으면 해당 학교로 컨텍스트 전환
    if (account.role === 'admin') {
      const actingSchoolId = request.cookies.get('acting_school_id')?.value || null
      if (!actingSchoolId) {
        return { error: '관리자 acting 컨텍스트가 설정되지 않았습니다.', status: 403 as const }
      }
      return { account: { ...account, school_id: actingSchoolId } }
    }

    // 일반 학교 계정
    if (account.role === 'school') {
      if (!account.school_id) {
        return { error: '학교 정보가 누락되었습니다.', status: 400 as const }
      }
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
  const { data, error } = await supabaseAdmin
    .from('schools')
    .select('id, name, group_no, school_type, recognition_key')
    .eq('id', schoolId)
    .maybeSingle<Pick<import('@/types/database.types').Database['public']['Tables']['schools']['Row'], 'id' | 'name' | 'group_no' | 'school_type' | 'recognition_key'>>()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || '학교 정보를 찾을 수 없습니다.' }, { status: 404 })
  }

  return NextResponse.json({
    school: {
      id: data.id,
      name: data.name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      group_no: (data as any).group_no,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      school_type: (data as any).school_type,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition_key: (data as any).recognition_key,
    },
  })
}


