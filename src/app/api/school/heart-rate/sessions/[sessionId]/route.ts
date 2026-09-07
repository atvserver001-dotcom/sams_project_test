export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'

import {
  isHeartRateSessionId,
  validateHeartRateSessionAction,
} from '@/lib/heartRateSession'
import { getSchoolContext } from '@/lib/schoolApiAuth'
import { supabaseAdmin } from '@/lib/supabase'

type RouteContext = { params: Promise<{ sessionId: string }> }
type RpcError = { message: string }
type RpcClient = {
  rpc(name: string, arguments_: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>
}

const sessionRpc = supabaseAdmin as unknown as RpcClient

function rpcErrorResponse(error: RpcError) {
  const message = error.message || 'heart_rate_session_error'
  if (message.includes('not_found')) return NextResponse.json({ error: '측정 세션을 찾을 수 없습니다.' }, { status: 404 })
  if (message.includes('forbidden')) return NextResponse.json({ error: '측정 세션 권한이 없습니다.' }, { status: 403 })
  if (message.includes('has_no_results')) {
    return NextResponse.json({ error: '저장할 수 있는 유효한 심박 측정값이 없습니다.' }, { status: 409 })
  }
  if (message.includes('invalid') || message.includes('field_missing') || message.includes('regressed')) {
    return NextResponse.json({ error: '측정 데이터 형식 또는 범위가 올바르지 않습니다.' }, { status: 400 })
  }
  if (
    message.includes('conflict')
    || message.includes('not_recording')
    || message.includes('not_stable')
    || message.includes('already_complete')
    || message.includes('must_be_stopped')
    || message.includes('delete_denied')
  ) {
    return NextResponse.json({ error: '현재 측정 세션 상태에서는 요청을 적용할 수 없습니다.' }, { status: 409 })
  }

  console.error('심박 측정 세션 RPC 오류:', error)
  return NextResponse.json({ error: '측정 세션 요청을 처리하지 못했습니다.' }, { status: 500 })
}

async function authenticatedSessionId(request: NextRequest, context: RouteContext) {
  const auth = await getSchoolContext(request)
  if ('error' in auth) return { response: NextResponse.json({ error: auth.error }, { status: auth.status }) }

  const { sessionId } = await context.params
  if (!isHeartRateSessionId(sessionId)) {
    return { response: NextResponse.json({ error: '측정 세션 식별자가 올바르지 않습니다.' }, { status: 400 }) }
  }
  return { auth, sessionId }
}

/** 현재 세션·참여자·분 단위 데이터·확정 결과를 다시 불러온다. */
export async function GET(request: NextRequest, context: RouteContext) {
  const contextResult = await authenticatedSessionId(request, context)
  if ('response' in contextResult) return contextResult.response

  const { data, error } = await sessionRpc.rpc('get_heart_rate_session', {
    p_school_id: contextResult.auth.schoolId,
    p_session_id: contextResult.sessionId,
  })

  if (error) return rpcErrorResponse(error)
  return NextResponse.json(data)
}

/**
 * PATCH actions:
 * - stabilize: { action, gateway_run_id, run_started_at } (ACK 직후의 ISO 시각)
 * - checkpoint: { action, points[], transport_quality } (최대 60개, 절대 누적값)
 * - stop: { action, points[], transport_quality }
 *   정상 클라이언트는 미반영 point를 checkpoint로 먼저 나눠 저장한 뒤 빈 배열로 중지한다.
 *   points 최대 3,600개는 이전 클라이언트나 복구 경로의 전체 snapshot 호환 한도다.
 * - finalize: { action } (수업 결과 확정과 기존 월 집계를 한 트랜잭션에서 투영)
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const contextResult = await authenticatedSessionId(request, context)
  if ('response' in contextResult) return contextResult.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '요청 본문이 올바른 JSON이 아닙니다.' }, { status: 400 })
  }

  const validation = validateHeartRateSessionAction(body)
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 })

  const commonArguments = {
    p_school_id: contextResult.auth.schoolId,
    p_session_id: contextResult.sessionId,
  }

  let rpcName: string
  let rpcArguments: Record<string, unknown> = commonArguments
  switch (validation.value.action) {
    case 'stabilize':
      rpcName = 'mark_heart_rate_session_stable'
      rpcArguments = {
        ...commonArguments,
        p_gateway_run_id: validation.value.gateway_run_id,
        p_run_started_at: validation.value.run_started_at,
      }
      break
    case 'checkpoint':
      rpcName = 'checkpoint_heart_rate_session'
      rpcArguments = {
        ...commonArguments,
        p_points: validation.value.points,
        p_transport_quality: validation.value.transport_quality,
      }
      break
    case 'stop':
      rpcName = 'stop_heart_rate_session'
      rpcArguments = {
        ...commonArguments,
        p_points: validation.value.points,
        p_transport_quality: validation.value.transport_quality,
      }
      break
    case 'finalize':
      rpcName = 'finalize_heart_rate_session'
      break
  }

  const { data, error } = await sessionRpc.rpc(rpcName, rpcArguments)
  if (error) return rpcErrorResponse(error)
  return NextResponse.json(data)
}

/** 명시적으로 저장하지 않음을 선택한 미확정 세션만 정확히 삭제한다. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const contextResult = await authenticatedSessionId(request, context)
  if ('response' in contextResult) return contextResult.response

  const { data, error } = await sessionRpc.rpc('discard_heart_rate_session', {
    p_school_id: contextResult.auth.schoolId,
    p_session_id: contextResult.sessionId,
  })

  if (error) return rpcErrorResponse(error)
  return NextResponse.json(data)
}
