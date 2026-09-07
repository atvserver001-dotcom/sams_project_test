export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { supabaseAdmin } from '@/lib/supabase'

const BUCKET = 'device-assets'

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

async function resolveAuthKeyForSchoolDevice(schoolDeviceId: string, schoolId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any)
    .from('school_devices')
    .select(
      `
      id,
      auth_key,
      school_content:school_content_id(
        school_id
      )
    `,
    )
    .eq('id', schoolDeviceId)
    .maybeSingle()

  if (error || !data) return { ok: false as const, error: '디바이스를 찾을 수 없습니다.', status: 404 as const }
  if (data.school_content?.school_id !== schoolId) return { ok: false as const, error: '권한이 없습니다.', status: 403 as const }
  if (!data.auth_key) return { ok: false as const, error: '디바이스 인증키가 없습니다.', status: 400 as const }

  return { ok: true as const, authKey: String(data.auth_key) }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePages(pages: any[]) {
  return (pages || []).map((p) => ({
    id: String(p.id),
    school_device_id: String(p.school_device_id),
    kind: String(p.kind) as 'custom' | 'images',
    name: String(p.name || ''),
    sort_order: Number(p.sort_order || 0),
    image_name: p.image_name ?? null,
    image_original_path: p.image_original_path ?? null,
    image_thumb_path: p.image_thumb_path ?? null,
    created_at: p.created_at ?? null,
    updated_at: p.updated_at ?? null,
  }))
}

// GET: 특정 school_device의 페이지/블록 목록
export async function GET(request: NextRequest) {
  const auth = await getOperatorWithSchool(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const schoolId = auth.schoolId as string
  const schoolDeviceId = request.nextUrl.searchParams.get('school_device_id') || ''
  if (!schoolDeviceId) return NextResponse.json({ error: 'school_device_id 필수' }, { status: 400 })

  const resolved = await resolveAuthKeyForSchoolDevice(schoolDeviceId, schoolId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pagesRaw, error: pErr } = await (supabaseAdmin as any)
    .from('school_device_pages')
    .select('id, school_device_id, kind, name, sort_order, image_name, image_original_path, image_thumb_path, created_at, updated_at')
    .eq('school_device_id', schoolDeviceId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

  const pages = normalizePages(pagesRaw || [])
  const pageIds = pages.map((p) => p.id)

  const { data: blocksRaw, error: bErr } = pageIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (supabaseAdmin as any)
      .from('school_device_page_blocks')
      .select('id, page_id, type, subtitle, body, sort_order, image_name, image_original_path, image_thumb_path, created_at, updated_at')
      .in('page_id', pageIds)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : { data: [], error: null as any }

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks = (blocksRaw || []).map((b: any) => ({
    id: String(b.id),
    page_id: String(b.page_id),
    type: String(b.type) as 'text' | 'image',
    subtitle: b.subtitle ?? '',
    body: b.body ?? '',
    sort_order: Number(b.sort_order || 0),
    image_name: b.image_name ?? null,
    image_original_path: b.image_original_path ?? null,
    image_thumb_path: b.image_thumb_path ?? null,
    created_at: b.created_at ?? null,
    updated_at: b.updated_at ?? null,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocksByPageId: Record<string, any[]> = {}
  for (const b of blocks) {
    blocksByPageId[b.page_id] = blocksByPageId[b.page_id] || []
    blocksByPageId[b.page_id].push(b)
  }

  // Storage signed URL (24h) - image pages / image blocks (있을 때만)
  const sign = async (path: string | null) => {
    if (!path) return null
    const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24)
    return data?.signedUrl || null
  }

  const items = await Promise.all(
    pages.map(async (p) => {
      const pageFull = await sign(p.image_original_path ?? null)
      const pageThumb = await sign(p.image_thumb_path ?? null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bs = (blocksByPageId[p.id] || []) as any[]
      const blocksWithUrls = await Promise.all(
        bs.map(async (b) => {
          const full = await sign(b.image_original_path ?? null)
          const thumb = await sign(b.image_thumb_path ?? null)
          return { ...b, image_full_url: full, image_thumb_url: thumb || full }
        }),
      )
      return { ...p, image_full_url: pageFull, image_thumb_url: pageThumb || pageFull, blocks: blocksWithUrls }
    }),
  )

  return NextResponse.json({ items }, { status: 200 })
}

// POST: 페이지 생성
export async function POST(request: NextRequest) {
  const auth = await getOperatorWithSchool(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const schoolId = auth.schoolId as string
  const body = await request.json().catch(() => ({}))
  const schoolDeviceId = String(body.school_device_id || '')
  const kind = String(body.kind || '')
  if (!schoolDeviceId) return NextResponse.json({ error: 'school_device_id 필수' }, { status: 400 })
  if (!['custom', 'images'].includes(kind)) return NextResponse.json({ error: 'kind는 custom/images' }, { status: 400 })

  const resolved = await resolveAuthKeyForSchoolDevice(schoolDeviceId, schoolId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  // 최대 8페이지 제한
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: eErr } = await (supabaseAdmin as any)
    .from('school_device_pages')
    .select('id, kind, sort_order')
    .eq('school_device_id', schoolDeviceId)

  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cur = (existing || []) as any[]
  if (cur.length >= 8) return NextResponse.json({ error: '페이지 최대 수량(8페이지)에 도달했습니다.' }, { status: 400 })

  const maxSort = cur.reduce((m, r) => Math.max(m, Number(r.sort_order || 0)), 0)
  const customCount = cur.filter((p) => String(p.kind) === 'custom').length
  const imageCount = cur.filter((p) => String(p.kind) === 'images').length
  const name = kind === 'images' ? `${imageCount + 1}-이미지` : `${customCount + 1}-페이지`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error: insErr } = await (supabaseAdmin as any)
    .from('school_device_pages')
    .insert({
      school_device_id: schoolDeviceId,
      kind,
      name,
      sort_order: maxSort + 1,
    })
    .select('id, school_device_id, kind, name, sort_order, image_name, image_original_path, image_thumb_path, created_at, updated_at')
    .single()

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({ item: normalizePages([inserted])[0] }, { status: 201 })
}


