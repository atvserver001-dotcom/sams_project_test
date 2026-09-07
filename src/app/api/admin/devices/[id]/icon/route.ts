export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/apiAuth'

const BUCKET = 'device-icons'

function sanitizeFilename(name: string) {
  return name
    .replace(/[\\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
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

// POST: 디바이스 아이콘 업로드 (multipart/form-data: file)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Content-Type: multipart/form-data 필요' }, { status: 415 })
  }

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file 필수' }, { status: 400 })
  }
  if (!file.type?.startsWith('image/')) {
    return NextResponse.json({ error: '이미지 파일만 업로드할 수 있습니다.' }, { status: 400 })
  }

  // 기존 icon_path 조회
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: exErr } = await (supabaseAdmin as any)
    .from('devices')
    .select('id, icon_path')
    .eq('id', id)
    .maybeSingle()

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: '디바이스를 찾을 수 없습니다.' }, { status: 404 })

  await ensureBucketExists()

  const safeName = sanitizeFilename(file.name || 'icon')
  const objectPath = `devices/${id}/${randomUUID()}-${safeName}`
  const bytes = await file.arrayBuffer()
  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(objectPath, Buffer.from(bytes), { contentType: file.type || 'application/octet-stream', upsert: true })

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // DB 업데이트
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error: updErr } = await (supabaseAdmin as any)
    .from('devices')
    .update({ icon_path: objectPath })
    .eq('id', id)
    .select('id, icon_path')
    .single()

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // 기존 아이콘 제거(최신 업로드가 성공한 뒤 cleanup)
  const oldPath = existing.icon_path as string | null
  if (oldPath && oldPath !== objectPath) {
    try {
      await supabaseAdmin.storage.from(BUCKET).remove([oldPath])
    } catch {
      // ignore
    }
  }

  const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(objectPath, 60 * 60 * 24)
  return NextResponse.json(
    { icon_path: updated.icon_path ?? null, icon_url: signed?.signedUrl || null },
    { status: 200 },
  )
}


