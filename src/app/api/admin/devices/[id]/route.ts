export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/apiAuth'
import type { TableRow, TableUpdate } from '@/types/supabaseHelpers'

const ICON_BUCKET = 'device-icons'

// PUT: 디바이스 이름 수정
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json()
  const { device_name, linkable } = body as { device_name?: string; linkable?: boolean }
  const updatePayload: TableUpdate<'devices'> = {}
  if (device_name !== undefined) {
    if (!device_name.trim()) return NextResponse.json({ error: 'device_name은 비울 수 없습니다.' }, { status: 400 })
    updatePayload.device_name = device_name.trim()
  }
  if (linkable !== undefined) {
    updatePayload.linkable = !!linkable
  }

  const { data, error } = await supabaseAdmin
    .from('devices')
    .update(updatePayload)
    .eq('id', id)
    .select('id, device_name, sort_order, icon_path, linkable')
    .single()
    .returns<TableRow<'devices'>>()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const icon_path = data?.icon_path ?? null
  const signed = icon_path
    ? (await supabaseAdmin.storage.from(ICON_BUCKET).createSignedUrl(String(icon_path), 60 * 60 * 24)).data
    : null
  return NextResponse.json({ item: { ...data, icon_url: signed?.signedUrl || null } }, { status: 200 })
}

// DELETE: 디바이스 삭제
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  // 주의: device_management FK 제약 조건으로 인해 참조 중인 경우 삭제 실패 가능
  const { error } = await supabaseAdmin
    .from('devices')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true }, { status: 200 })
}


