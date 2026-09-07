export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import {
  deriveGradeProxyAge,
  isSchoolType,
  validateStartHeartRateSessionRequest,
} from '@/lib/heartRateSession'
import { getSchoolContext } from '@/lib/schoolApiAuth'
import { supabaseAdmin } from '@/lib/supabase'

type RpcError = { message: string }
type RpcClient = {
  rpc(name: string, arguments_: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>
}

const sessionRpc = supabaseAdmin as unknown as RpcClient

function rpcErrorResponse(error: RpcError) {
  const message = error.message || 'heart_rate_session_error'
  if (message.includes('forbidden')) return NextResponse.json({ error: '측정 세션 권한이 없습니다.' }, { status: 403 })
  if (message.includes('not_found')) return NextResponse.json({ error: '선택한 학급의 학생을 찾지 못했습니다.' }, { status: 404 })
  if (message.includes('invalid')) return NextResponse.json({ error: '학교·학년·반 정보가 올바르지 않습니다.' }, { status: 400 })
  if (message.includes('conflict')) return NextResponse.json({ error: '같은 요청 식별자가 다른 측정에 이미 사용되었습니다.' }, { status: 409 })

  console.error('심박 측정 세션 시작 RPC 오류:', error)
  return NextResponse.json({ error: '측정 세션을 시작하지 못했습니다.' }, { status: 500 })
}

/**
 * POST /api/school/heart-rate/sessions
 * body: { client_request_id, academic_year, grade, class_no }
 * 나이·학교 유형·학생 명단은 클라이언트 값을 받지 않고 인증된 학교와 DB에서 스냅샷한다.
 */
export async function POST(request: NextRequest) {
  const auth = await getSchoolContext(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '요청 본문이 올바른 JSON이 아닙니다.' }, { status: 400 })
  }

  const validation = validateStartHeartRateSessionRequest(body)
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })
  if (!isSchoolType(auth.schoolType)) {
    return NextResponse.json({ error: '학교 유형 설정이 올바르지 않습니다.' }, { status: 500 })
  }

  try {
    // API에서도 학교 유형별 학년을 즉시 검증하되, 실제 나이 스냅샷은 RPC가 학교 DB를 다시 읽어 계산한다.
    deriveGradeProxyAge(auth.schoolType, validation.value.grade)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '학년 정보가 올바르지 않습니다.' }, { status: 400 })
  }

  const { data, error } = await sessionRpc.rpc('start_heart_rate_session', {
    p_school_id: auth.schoolId,
    p_operator_account_id: auth.account.id,
    p_client_request_id: validation.value.client_request_id,
    p_academic_year: validation.value.academic_year,
    p_grade: validation.value.grade,
    p_class_no: validation.value.class_no,
  })

  if (error) return rpcErrorResponse(error)
  if (!data || typeof data !== 'object') {
    console.error('심박 측정 세션 시작 RPC가 올바른 응답을 반환하지 않았습니다.', data)
    return NextResponse.json({ error: '측정 세션 정보를 확인하지 못했습니다.' }, { status: 500 })
  }

  return NextResponse.json(data)
}
