export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import sharp from 'sharp'

const BUCKET = 'device-assets'
const THUMB_SUFFIX = '.thumb.webp'
const THUMB_MAX = 256
const THUMB_QUALITY = 70
const EMPTY_FOLDER_PLACEHOLDER = '.emptyFolderPlaceholder'

function requireServiceRoleForMutation() {
  // storage upload/remove 는 service role 이 안전(그리고 보통 필수)합니다.
  // 현재 lib/supabase.ts 는 service role 미설정 시 anon 키로 fallback 하므로,
  // “겉으로는 성공처럼 보이지만 실제로는 삭제가 안 되는” 환경 차이를 막기 위해 명시적으로 가드합니다.
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
  // Supabase Storage key에 안전한 파일명으로 정규화(한글/공백 등 제거)
  // - 영문/숫자/._- 만 허용
  // - 공백은 '_'로 치환
  // - 확장자 보존(가능한 경우)
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
  // 회전 정보(EXIF) 반영 + 썸네일(저용량 webp) 생성
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
    // ignore: local/remote 환경 차이로 실패할 수 있음. 이후 upload 시 에러로 표면화.
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

// GET: 특정 school_device의 이미지 목록(+ signed url)
export async function GET(request: NextRequest) {
  const auth = await getOperatorWithSchool(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const schoolId = auth.schoolId as string
  const schoolDeviceId = request.nextUrl.searchParams.get('school_device_id') || ''
  if (!schoolDeviceId) return NextResponse.json({ error: 'school_device_id 필수' }, { status: 400 })

  const resolved = await resolveAuthKeyForSchoolDevice(schoolDeviceId, schoolId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  await ensureBucketExists()

  const prefix = `devices/${resolved.authKey}`
  const { data: files, error: listErr } = await supabaseAdmin.storage.from(BUCKET).list(prefix, {
    limit: 100,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  })

  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })

  const rows = (files || [])
    .filter((f) => !!f.name)
    // 폴더 유지용 더미 파일/숨김파일은 UI에 노출하지 않음
    .filter((f) => {
      const n = String(f.name || '')
      if (!n) return false
      if (n === EMPTY_FOLDER_PLACEHOLDER) return false
      if (n.startsWith('.')) return false
      return true
    })
    .map((f) => ({
      name: f.name,
      path: `${prefix}/${f.name}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      id: (f as any).id ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updated_at: (f as any).updated_at ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      created_at: (f as any).created_at ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      last_accessed_at: (f as any).last_accessed_at ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: (f as any).metadata ?? null,
    }))

  // 원본/썸네일 페어링: 원본=path, 썸네일=path + THUMB_SUFFIX
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byBase = new Map<string, { original?: any; thumb?: any }>()
  for (const r of rows) {
    if (r.path.endsWith(THUMB_SUFFIX)) {
      const base = r.path.slice(0, -THUMB_SUFFIX.length)
      const cur = byBase.get(base) || {}
      cur.thumb = r
      byBase.set(base, cur)
    } else {
      const base = r.path
      const cur = byBase.get(base) || {}
      cur.original = r
      byBase.set(base, cur)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = []
  for (const [basePath, pair] of byBase.entries()) {
    const originalPath = pair.original?.path || basePath
    const thumbPath = pair.thumb?.path || `${basePath}${THUMB_SUFFIX}`

    // signed url (24h)
    const [{ data: fullSigned }, { data: thumbSigned }] = await Promise.all([
      supabaseAdmin.storage.from(BUCKET).createSignedUrl(originalPath, 60 * 60 * 24),
      supabaseAdmin.storage.from(BUCKET).createSignedUrl(thumbPath, 60 * 60 * 24),
    ])

    const name = (pair.original?.name || pair.thumb?.name || '').replace(THUMB_SUFFIX, '')
    items.push({
      name,
      original_path: originalPath,
      thumb_path: thumbPath,
      full_url: fullSigned?.signedUrl || null,
      thumb_url: thumbSigned?.signedUrl || (fullSigned?.signedUrl || null),
      created_at: pair.original?.created_at ?? pair.thumb?.created_at ?? null,
      updated_at: pair.original?.updated_at ?? pair.thumb?.updated_at ?? null,
      metadata: pair.original?.metadata ?? pair.thumb?.metadata ?? null,
    })
  }

  // 최신순으로 보고 싶으면(만든 순 기준): created_at desc. 여기서는 name asc에 가깝게 유지.
  items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))

  return NextResponse.json({ items }, { status: 200 })
}

// POST: 업로드 (multipart/form-data) - fields: school_device_id, files[]
export async function POST(request: NextRequest) {
  const auth = await getOperatorWithSchool(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const guard = requireServiceRoleForMutation()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const schoolId = auth.schoolId as string
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Content-Type: multipart/form-data 필요' }, { status: 415 })
  }

  const form = await request.formData()
  const schoolDeviceId = String(form.get('school_device_id') || '')
  if (!schoolDeviceId) return NextResponse.json({ error: 'school_device_id 필수' }, { status: 400 })

  const resolved = await resolveAuthKeyForSchoolDevice(schoolDeviceId, schoolId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const files = form.getAll('files') as File[]
  if (!files || files.length === 0) return NextResponse.json({ error: '업로드할 파일이 없습니다.' }, { status: 400 })

  await ensureBucketExists()

  const prefix = `devices/${resolved.authKey}`

  const uploaded: Array<{ name: string; original_path: string; thumb_path: string }> = []
  for (const f of files) {
    if (!(f instanceof File)) continue
    if (f.type && !String(f.type).startsWith('image/')) continue
    const safeName = sanitizeFilename(f.name || 'image')
    const key = `${prefix}/${randomUUID()}-${safeName}`
    const bytes = Buffer.from(await f.arrayBuffer())
    const thumbKey = `${key}${THUMB_SUFFIX}`
    const thumbBytes = await makeThumbnailWebp(bytes)

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(key, bytes, { contentType: f.type || 'application/octet-stream', upsert: false })
    if (upErr) {
      return NextResponse.json({ error: `업로드 실패: ${upErr.message}` }, { status: 500 })
    }

    const { error: thumbErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(thumbKey, thumbBytes, { contentType: 'image/webp', upsert: false })
    if (thumbErr) {
      // 썸네일 실패 시 원본도 롤백(일관성 유지)
      try {
        await supabaseAdmin.storage.from(BUCKET).remove([key])
      } catch { }
      return NextResponse.json({ error: `썸네일 생성/업로드 실패: ${thumbErr.message}` }, { status: 500 })
    }

    uploaded.push({ name: safeName, original_path: key, thumb_path: thumbKey })
  }

  return NextResponse.json({ uploaded }, { status: 201 })
}

// DELETE: 특정 파일(원본) 삭제 시 썸네일까지 같이 삭제
export async function DELETE(request: NextRequest) {
  const auth = await getOperatorWithSchool(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const guard = requireServiceRoleForMutation()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const schoolId = auth.schoolId as string
  const schoolDeviceId = request.nextUrl.searchParams.get('school_device_id') || ''
  const path = request.nextUrl.searchParams.get('path') || ''
  const originalPathParam = request.nextUrl.searchParams.get('original_path') || ''
  if (!schoolDeviceId) return NextResponse.json({ error: 'school_device_id 필수' }, { status: 400 })
  if (!path && !originalPathParam) return NextResponse.json({ error: 'path 또는 original_path 필수' }, { status: 400 })

  const resolved = await resolveAuthKeyForSchoolDevice(schoolDeviceId, schoolId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const expectedPrefix = `devices/${resolved.authKey}/`
  const anyPath = originalPathParam || path
  if (!anyPath.startsWith(expectedPrefix)) return NextResponse.json({ error: '잘못된 path 입니다.' }, { status: 400 })

  await ensureBucketExists()

  let originalPath = anyPath
  if (originalPath.endsWith(THUMB_SUFFIX)) {
    originalPath = originalPath.slice(0, -THUMB_SUFFIX.length)
  }
  const thumbPath = `${originalPath}${THUMB_SUFFIX}`

  // 둘 다 prefix 아래인지 검증
  if (!originalPath.startsWith(expectedPrefix) || !thumbPath.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: '잘못된 path 입니다.' }, { status: 400 })
  }

  // 원본/썸네일을 한 번에 지우면, 썸네일이 없는 파일(예: placeholder)에서 실패할 수 있어 분리 삭제합니다.
  const { error: delOrigErr } = await supabaseAdmin.storage.from(BUCKET).remove([originalPath])
  if (delOrigErr) return NextResponse.json({ error: delOrigErr.message }, { status: 500 })

  const { error: delThumbErr } = await supabaseAdmin.storage.from(BUCKET).remove([thumbPath])
  if (delThumbErr) {
    // 썸네일이 원래 없던 케이스는 무시 (원본 삭제가 핵심)
    const msg = String(delThumbErr.message || '')
    if (!/not\s*found|does\s*not\s*exist|404/i.test(msg)) {
      return NextResponse.json({ error: delThumbErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true }, { status: 200 })
}


