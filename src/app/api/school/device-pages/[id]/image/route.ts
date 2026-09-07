export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { supabaseAdmin } from '@/lib/supabase'

const BUCKET = 'device-assets'
const THUMB_SUFFIX = '.thumb.webp'
const THUMB_MAX = 256
const THUMB_QUALITY = 70

function requireServiceRoleForMutation() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return {
      ok: false as const,
      error: '서버 설정 오류 (SUPABASE_SERVICE_ROLE_KEY 누락). Storage 업로드/삭제를 수행할 수 없습니다.',
      status: 500 as const,
    }
  }
  return { ok: true as const }
}

function sanitizeFilename(name: string) {
  const raw = String(name || '').trim()
  const norm = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  const lastDot = norm.lastIndexOf('.')
  const baseRaw = lastDot > 0 ? norm.slice(0, lastDot) : norm
  const extRaw = lastDot > 0 ? norm.slice(lastDot + 1) : ''

  const base = baseRaw
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\.]+|[_\.]+$/g, '')

  const ext = extRaw
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 10)

  const safeBase = base || 'image'
  const withExt = ext ? `${safeBase}.${ext}` : safeBase
  return withExt.slice(0, 120)
}

async function makeThumbnailWebp(bytes: Buffer) {
  return sharp(bytes)
    .rotate()
    .resize(THUMB_MAX, THUMB_MAX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer()
}

async function ensureBucketExists() {
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets()
    const exists = (buckets || []).some((b) => b.name === BUCKET)
    if (!exists) {
      await supabaseAdmin.storage.createBucket(BUCKET, { public: false })
    }
  } catch {
    // ignore
  }
}

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
      name,
      sort_order,
      school_device_id,
      image_name,
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

async function removeStoredPair(paths: { original?: string | null; thumb?: string | null }) {
  const original = paths.original || null
  const thumb = paths.thumb || null
  const toRemove = [original, thumb].filter(Boolean) as string[]
  if (toRemove.length === 0) return
  await supabaseAdmin.storage.from(BUCKET).remove(toRemove)
}

// POST: 이미지 페이지(=school_device_pages.kind=images) 이미지 업로드/변경 (1장 유지)
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getOperatorWithSchool(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const guard = requireServiceRoleForMutation()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const schoolId = auth.schoolId as string
  const { id: pageId } = await ctx.params

  const resolved = await resolvePageWithSchool(pageId, schoolId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = resolved.row as any
  if (String(row.kind) !== 'images') return NextResponse.json({ error: '이미지 페이지가 아닙니다.' }, { status: 400 })

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Content-Type: multipart/form-data 필요' }, { status: 415 })
  }

  const form = await request.formData()
  const file = form.get('file') as File | null
  if (!file || !(file instanceof File)) return NextResponse.json({ error: 'file 필수' }, { status: 400 })
  if (file.type && !String(file.type).startsWith('image/')) return NextResponse.json({ error: '이미지 파일만 가능합니다.' }, { status: 400 })

  await ensureBucketExists()

  // 기존 이미지 제거
  try {
    await removeStoredPair({ original: row.image_original_path, thumb: row.image_thumb_path })
  } catch {
    // ignore: 없던 파일 등
  }

  const authKey = String(row.school_device?.auth_key || '')
  if (!authKey) return NextResponse.json({ error: '디바이스 인증키가 없습니다.' }, { status: 400 })

  const prefix = `devices/${authKey}/pages/${pageId}`
  const safeName = sanitizeFilename(file.name || 'image')
  const key = `${prefix}/${randomUUID()}-${safeName}`
  const bytes = Buffer.from(await file.arrayBuffer())
  const thumbKey = `${key}${THUMB_SUFFIX}`
  const thumbBytes = await makeThumbnailWebp(bytes)

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(key, bytes, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return NextResponse.json({ error: `업로드 실패: ${upErr.message}` }, { status: 500 })

  const { error: thumbErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(thumbKey, thumbBytes, { contentType: 'image/webp', upsert: false })
  if (thumbErr) {
    try {
      await supabaseAdmin.storage.from(BUCKET).remove([key])
    } catch { }
    return NextResponse.json({ error: `썸네일 생성/업로드 실패: ${thumbErr.message}` }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error: dbErr } = await (supabaseAdmin as any)
    .from('school_device_pages')
    .update({ image_name: safeName, image_original_path: key, image_thumb_path: thumbKey })
    .eq('id', pageId)
    .select('id, kind, name, image_name, image_original_path, image_thumb_path, updated_at')
    .single()

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  // signed url (24h)
  const [{ data: fullSigned }, { data: thumbSigned }] = await Promise.all([
    supabaseAdmin.storage.from(BUCKET).createSignedUrl(key, 60 * 60 * 24),
    supabaseAdmin.storage.from(BUCKET).createSignedUrl(thumbKey, 60 * 60 * 24),
  ])

  return NextResponse.json(
    {
      item: {
        ...updated,
        image_full_url: fullSigned?.signedUrl || null,
        image_thumb_url: thumbSigned?.signedUrl || fullSigned?.signedUrl || null,
      },
    },
    { status: 200 },
  )
}

// DELETE: 이미지 페이지 이미지 제거(파일 삭제 + 컬럼 null)
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getOperatorWithSchool(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const guard = requireServiceRoleForMutation()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const schoolId = auth.schoolId as string
  const { id: pageId } = await ctx.params

  const resolved = await resolvePageWithSchool(pageId, schoolId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = resolved.row as any
  if (String(row.kind) !== 'images') return NextResponse.json({ error: '이미지 페이지가 아닙니다.' }, { status: 400 })

  await ensureBucketExists()

  try {
    await removeStoredPair({ original: row.image_original_path, thumb: row.image_thumb_path })
  } catch { }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbErr } = await (supabaseAdmin as any)
    .from('school_device_pages')
    .update({ image_name: null, image_original_path: null, image_thumb_path: null })
    .eq('id', pageId)

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 200 })
}



