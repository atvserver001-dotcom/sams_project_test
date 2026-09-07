export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'

async function getOperatorWithSchool(request: NextRequest) {
  const accessToken = request.cookies.get('op-access-token')?.value
  if (!accessToken) return { error: '인증 토큰이 없습니다.', status: 401 as const }

  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret) return { error: '서버 설정 오류 (JWT_SECRET 누락)', status: 500 as const }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = jwt.verify(accessToken, jwtSecret) as any
    const { data: account, error } = await (supabaseAdmin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('operator_accounts') as any)
      .select('id, role, school_id, is_active')
      .eq('id', decoded.sub)
      .maybeSingle()

    if (error || !account) return { error: '사용자를 찾을 수 없습니다.', status: 404 as const }
    if (!account.is_active) return { error: '비활성화된 계정입니다.', status: 403 as const }

    // 관리자 acting 지원
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((account as any).role === 'admin') {
      const actingSchoolId = request.cookies.get('acting_school_id')?.value || null
      if (!actingSchoolId) return { error: '관리자 acting 컨텍스트가 설정되지 않았습니다.', status: 403 as const }
      return { schoolId: actingSchoolId as string }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((account as any).role === 'school') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(account as any).school_id) return { error: '학교 정보가 누락되었습니다.', status: 400 as const }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { schoolId: (account as any).school_id as string }
    }
    return { error: '권한이 없습니다.', status: 403 as const }
  } catch {
    return { error: '유효하지 않은 세션입니다.', status: 401 as const }
  }
}

export async function GET(request: NextRequest) {
  const auth = await getOperatorWithSchool(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const schoolId = auth.schoolId as string

  const { data: mgmt, error: mgmtErr } = await (supabaseAdmin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('device_management') as any)
    .select('device_id, start_date, end_date, limited_period, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: true })

  if (mgmtErr) return NextResponse.json({ error: mgmtErr.message }, { status: 500 })

  const mgmtRows = (mgmt ?? []) as Array<{ device_id: string; start_date: string | null; end_date: string | null; limited_period: boolean }>
  const deviceIds = Array.from(new Set(mgmtRows.map((m) => m.device_id).filter(Boolean)))

  const idToDevice = new Map<string, { device_name: string }>()
  if (deviceIds.length) {
    const { data: deviceRows, error: devErr } = await supabaseAdmin
      .from('devices')
      .select('id, device_name')
      .in('id', deviceIds)
    if (devErr) return NextResponse.json({ error: devErr.message }, { status: 500 })
    for (const r of (deviceRows ?? []) as Array<{ id: string; device_name: string }>) {
      idToDevice.set(r.id, { device_name: r.device_name })
    }
  }

  const items = mgmtRows
    .map((m) => {
      const meta = idToDevice.get(m.device_id)
      return {
        device_id: m.device_id,
        device_name: meta?.device_name || '-',
        start_date: m.start_date,
        end_date: m.end_date,
        limited_period: !!m.limited_period,
      }
    })

  return NextResponse.json({ items }, { status: 200 })
}


