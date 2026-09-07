export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const BUCKET = 'device-assets'
const THUMB_SUFFIX = '.thumb.webp'

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

// POST: 디바이스(다른 PC)에서 auth_key로 이미지 목록/다운로드 URL 조회
// body: { auth_key: string } (또는 authKey)
// 옵션(증분 동기화):
// - known_items: Array<{ path: string; updated_at?: string | null }>
//   => 서버는 현재 목록과 비교해서 to_download / to_delete를 계산해줌
export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type: application/json 필요' }, { status: 415 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '잘못된 JSON 본문' }, { status: 400 })
  }

  const auth_key = body?.auth_key ?? body?.authKey ?? body?.AuthKey
  if (!auth_key) return NextResponse.json({ error: 'auth_key 필수' }, { status: 400 })

  const known_items = Array.isArray(body?.known_items) ? body.known_items : null

  // auth_key 유효성 확인(존재하는 디바이스인지)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: deviceRow, error: devErr } = await (supabaseAdmin as any)
    .from('school_devices')
    .select('id')
    .eq('auth_key', String(auth_key))
    .maybeSingle()

  if (devErr) return NextResponse.json({ error: devErr.message }, { status: 500 })
  if (!deviceRow) return NextResponse.json({ error: '유효하지 않은 auth_key 입니다.' }, { status: 404 })

  await ensureBucketExists()

  const prefix = `devices/${String(auth_key)}`
  const { data: files, error: listErr } = await supabaseAdmin.storage.from(BUCKET).list(prefix, {
    limit: 100,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })

  const rows = (files || [])
    .filter((f) => !!f.name)
    .filter((f) => !String(f.name).endsWith(THUMB_SUFFIX))
    .map((f) => ({
      name: f.name,
      path: `${prefix}/${f.name}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updated_at: (f as any).updated_at ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      created_at: (f as any).created_at ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: (f as any).metadata ?? null,
    }))

  // 현재 스냅샷(전체)
  const currentPaths = new Set(rows.map((r) => r.path))

  // known map (path -> updated_at)
  const knownUpdatedAt = new Map<string, string>()
  const knownPaths = new Set<string>()
  if (known_items) {
    for (const it of known_items) {
      const p = typeof it?.path === 'string' ? it.path : ''
      if (!p) continue
      knownPaths.add(p)
      const u = typeof it?.updated_at === 'string' ? it.updated_at : ''
      if (u) knownUpdatedAt.set(p, u)
    }
  }

  // 디바이스가 이미 가진 것 중 서버에 없는 것 => 삭제해야 함
  const to_delete: string[] = []
  if (known_items) {
    for (const p of knownPaths) {
      if (!currentPaths.has(p)) to_delete.push(p)
    }
  }

  // 디바이스가 없거나(updated_at 다름) => 다운로드해야 함
  const candidates = known_items
    ? rows.filter((r) => {
      if (!knownPaths.has(r.path)) return true
      const knownU = knownUpdatedAt.get(r.path) || ''
      const curU = String(r.updated_at || '')
      return knownU !== curU
    })
    : rows

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const to_download: any[] = []
  for (const r of candidates) {
    const { data: signed, error: signErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(r.path, 60 * 60 * 24)
    if (signErr) continue
    to_download.push({
      ...r,
      url: signed?.signedUrl || null,
      filename: String(r.name || ''),
    })
  }

  // 호환을 위해 items도 유지(처음 호출 시 전체 목록)
  const items = !known_items ? to_download : undefined

  return NextResponse.json(
    {
      ...(items ? { items } : {}),
      to_download,
      to_delete,
      generated_at: new Date().toISOString(),
    },
    { status: 200 },
  )
}


