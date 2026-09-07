export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { TableInsert, TableUpdate } from '@/types/supabaseHelpers'
import { requireAdmin } from '@/lib/apiAuth'

type ContentDetailRow = {
  id: string
  name: string | null
  description: string | null
  color_hex: string | null
  content_devices: { device_id: string; device?: { device_name: string | null } | null }[] | null
}

// GET: 컨텐츠 상세
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('contents')
    .select(`
      id,
      name,
      description,
      color_hex,
      content_devices(
        device_id,
        device:device_id(device_name)
      )
    `)
    .eq('id', id)
    .single()
    .returns<ContentDetailRow>()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const row = data

  const item = {
    ...row,
    devices: (row.content_devices || []).map((cd) => ({
      id: cd.device_id,
      name: cd.device?.device_name,
    })),
  }

  return NextResponse.json({ item }, { status: 200 })
}

// PUT: 컨텐츠 수정
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json()
  const { name, description, device_ids, color_hex } = body as {
    name?: string
    description?: string
    device_ids?: string[]
    color_hex?: string
  }

  // 1. 기본 정보 수정
  if (name !== undefined || description !== undefined || color_hex !== undefined) {
    const updateData: TableUpdate<'contents'> = {}
    if (name !== undefined) updateData.name = name.trim()
    if (description !== undefined) updateData.description = description
    if (color_hex !== undefined) updateData.color_hex = color_hex

    const { error: updError } = await supabaseAdmin.from('contents').update(updateData).eq('id', id)
    if (updError) return NextResponse.json({ error: updError.message }, { status: 500 })
  }

  // 2. 디바이스 관계 수정 (전체 삭제 후 재삽입)
  if (device_ids) {
    const { error: delError } = await supabaseAdmin.from('content_devices').delete().eq('content_id', id)
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })

    if (device_ids.length > 0) {
      const relations: TableInsert<'content_devices'>[] = device_ids.map((devId) => ({ content_id: id, device_id: devId }))
      const { error: insError } = await supabaseAdmin.from('content_devices').insert(relations)
      if (insError) return NextResponse.json({ error: insError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true }, { status: 200 })
}

// DELETE: 컨텐츠 삭제
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const { error } = await supabaseAdmin.from('contents').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true }, { status: 200 })
}
