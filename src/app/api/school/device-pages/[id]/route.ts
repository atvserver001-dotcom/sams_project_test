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

async function resolvePageWithSchool(pageId: string, schoolId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any)
    .from('school_device_pages')
    .select(
      `
      id,
      kind,
      name,
      sort_order,
      school_device_id,
      image_original_path,
      image_thumb_path,
      school_device:school_device_id(
        id,
        auth_key,
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

// PATCH: 페이지 이름/정렬 변경
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getOperatorWithSchool(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const schoolId = auth.schoolId as string
  const { id: pageId } = await ctx.params

  const resolved = await resolvePageWithSchool(pageId, schoolId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const body = await request.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: any = {}
  if (body.name != null) patch.name = String(body.name || '')
  if (body.sort_order != null) patch.sort_order = Number(body.sort_order || 0)

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '변경할 필드가 없습니다.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any)
    .from('school_device_pages')
    .update(patch)
    .eq('id', pageId)
    .select('id, school_device_id, kind, name, sort_order, image_name, image_original_path, image_thumb_path, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ item: data }, { status: 200 })
}

// DELETE: 페이지 삭제 + (이미지 페이지면) 이미지 파일 제거 + 이미지 페이지 이름 재정렬
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getOperatorWithSchool(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const schoolId = auth.schoolId as string
  const { id: pageId } = await ctx.params

  const resolved = await resolvePageWithSchool(pageId, schoolId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schoolDeviceId = String((resolved.row as any).school_device_id)

  // 페이지 삭제(블록은 FK cascade)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: delErr } = await (supabaseAdmin as any).from('school_device_pages').delete().eq('id', pageId)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  // 이미지 페이지 이름 재정렬: 1-이미지, 2-이미지...
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: remaining, error: listErr } = await (supabaseAdmin as any)
    .from('school_device_pages')
    .select('id, kind, name, sort_order')
    .eq('school_device_id', schoolDeviceId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const images = (remaining || []).filter((p: any) => String(p.kind) === 'images')
  for (let i = 0; i < images.length; i++) {
    const desired = `${i + 1}-이미지`
    if (String(images[i].name) === desired) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any).from('school_device_pages').update({ name: desired }).eq('id', images[i].id)
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}


