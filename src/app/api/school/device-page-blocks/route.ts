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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: account, error } = await (supabaseAdmin.from('operator_accounts') as any)
      .select('id, role, school_id, is_active')
      .eq('id', decoded.sub)
      .maybeSingle()

    if (error || !account) return { error: '사용자를 찾을 수 없습니다.', status: 404 as const }
    if (!account.is_active) return { error: '비활성화된 계정입니다.', status: 403 as const }

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

async function resolvePageWithSchool(pageId: string, schoolId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any)
    .from('school_device_pages')
    .select(
      `
      id,
      kind,
      school_device_id,
      school_device:school_device_id(
        school_content:school_content_id(
          school_id
        )
      )
    `,
    )
    .eq('id', pageId)
    .maybeSingle()

  if (error || !data) return { ok: false as const, error: '페이지를 찾을 수 없습니다.', status: 404 as const }
  if (data.school_device?.school_content?.school_id !== schoolId)
    return { ok: false as const, error: '권한이 없습니다.', status: 403 as const }

  return { ok: true as const, row: data }
}

// POST: 블록 생성 (페이지당 최대 4개)
export async function POST(request: NextRequest) {
  const auth = await getOperatorWithSchool(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const schoolId = auth.schoolId as string
  const body = await request.json().catch(() => ({}))
  const pageId = String(body.page_id || '')
  const type = String(body.type || '')
  if (!pageId) return NextResponse.json({ error: 'page_id 필수' }, { status: 400 })
  if (!['text', 'image'].includes(type)) return NextResponse.json({ error: 'type은 text/image' }, { status: 400 })

  const resolved = await resolvePageWithSchool(pageId, schoolId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (String((resolved.row as any).kind) !== 'custom')
    return NextResponse.json({ error: '커스텀 페이지에서만 블록을 생성할 수 있습니다.' }, { status: 400 })

  // 페이지당 최대 4개 제한
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: eErr } = await (supabaseAdmin as any)
    .from('school_device_page_blocks')
    .select('id, sort_order')
    .eq('page_id', pageId)
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cur = (existing || []) as any[]
  if (cur.length >= 4) return NextResponse.json({ error: '최대 수량(4개)에 도달했습니다.' }, { status: 400 })

  const maxSort = cur.reduce((m, r) => Math.max(m, Number(r.sort_order || 0)), 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error: insErr } = await (supabaseAdmin as any)
    .from('school_device_page_blocks')
    .insert({
      page_id: pageId,
      type,
      subtitle: String(body.subtitle || ''),
      body: String(body.body || ''),
      sort_order: maxSort + 1,
    })
    .select('id, page_id, type, subtitle, body, sort_order, image_name, image_original_path, image_thumb_path, created_at, updated_at')
    .single()

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  return NextResponse.json({ item: inserted }, { status: 201 })
}



