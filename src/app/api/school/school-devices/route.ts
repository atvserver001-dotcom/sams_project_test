export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'

const ICON_BUCKET = 'device-icons'

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

  // 1) 학교에 할당된 school_contents 조회
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: schoolContents, error: scErr } = await (supabaseAdmin as any)
    .from('school_contents')
    .select('id')
    .eq('school_id', schoolId)

  if (scErr) return NextResponse.json({ error: scErr.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scIds = ((schoolContents ?? []) as any[]).map((x) => x.id).filter(Boolean)
  if (scIds.length === 0) {
    return NextResponse.json({ items: [] }, { status: 200 })
  }

  // 2) school_devices(인증키) 조회 + 디바이스명/컨텐츠명 조인
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any)
    .from('school_devices')
    .select(
      `
      id,
      device_id,
      auth_key,
      memo,
      status,
      created_at,
      link_group_id,
      is_primary,
      device:device_id(device_name, icon_path),
      school_content:school_content_id(
        content:content_id(name, color_hex)
      )
    `,
    )
    .in('school_content_id', scIds)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = await Promise.all(((data ?? []) as any[]).map(async (row) => {
    const icon_path = row.device?.icon_path ?? null
    const { data: signed } = icon_path
      ? await supabaseAdmin.storage.from(ICON_BUCKET).createSignedUrl(String(icon_path), 60 * 60 * 24)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : { data: null as any }
    return {
      id: row.id as string,
      device_id: row.device_id as string,
      device_name: row.device?.device_name || '-',
      device_icon_url: signed?.signedUrl || null,
      auth_key: row.auth_key as string,
      memo: row.memo ?? '',
      status: row.status ?? null,
      created_at: row.created_at ?? null,
      content_name: row.school_content?.content?.name || null,
      content_color_hex: row.school_content?.content?.color_hex || null,
      link_group_id: row.link_group_id || null,
      is_primary: !!row.is_primary,
    }
  }))

  return NextResponse.json({ items }, { status: 200 })
}


