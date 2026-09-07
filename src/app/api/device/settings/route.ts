export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const BUCKET = 'device-assets'

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

async function sign(path: string | null) {
  if (!path) return null
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24)
  if (error) return null
  return data?.signedUrl || null
}

// POST: 디바이스(유니티 등)에서 auth_key로 설정(페이지/블록/이미지)을 조회
// body: { auth_key: string } (또는 authKey)
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

  // auth_key 유효성/상태 확인
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: deviceRow, error: devErr } = await (supabaseAdmin as any)
    .from('school_devices')
    .select('id, status')
    .eq('auth_key', String(auth_key))
    .maybeSingle()

  if (devErr) return NextResponse.json({ error: devErr.message }, { status: 500 })
  if (!deviceRow) return NextResponse.json({ error: '유효하지 않은 auth_key 입니다.' }, { status: 404 })
  if (deviceRow.status && String(deviceRow.status) !== 'active') {
    return NextResponse.json({ error: '비활성화된 디바이스입니다.' }, { status: 403 })
  }

  await ensureBucketExists()

  const schoolDeviceId = String(deviceRow.id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pagesRaw, error: pErr } = await (supabaseAdmin as any)
    .from('school_device_pages')
    .select('id, school_device_id, kind, name, sort_order, image_name, image_original_path, image_thumb_path, created_at, updated_at')
    .eq('school_device_id', schoolDeviceId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pages = (pagesRaw || []).map((p: any) => ({
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageIds = pages.map((p: any) => p.id)
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

  const items = await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pages.map(async (p: any) => {
      const page_full_url = await sign(p.image_original_path)
      const page_thumb_url = (await sign(p.image_thumb_path)) || page_full_url
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pageBlocks = (blocksByPageId[p.id] || []) as any[]
      const blocksWithUrls = await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pageBlocks.map(async (b: any) => {
          const full = await sign(b.image_original_path)
          const thumb = (await sign(b.image_thumb_path)) || full
          return { ...b, image_full_url: full, image_thumb_url: thumb }
        }),
      )
      return {
        ...p,
        image_full_url: page_full_url,
        image_thumb_url: page_thumb_url,
        blocks: blocksWithUrls,
      }
    }),
  )

  return NextResponse.json(
    {
      school_device_id: schoolDeviceId,
      auth_key: String(auth_key),
      pages: items,
      generated_at: new Date().toISOString(),
    },
    { status: 200 },
  )
}

