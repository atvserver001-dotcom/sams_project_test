export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { Database } from '@/types/database.types'
import { requireAdmin } from '@/lib/apiAuth'

// PUT: 수정
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json()
  const { username, password, role, school_id, is_active } = body as Partial<Database['public']['Tables']['operator_accounts']['Update']>

  const updatePayload: Database['public']['Tables']['operator_accounts']['Update'] = {}
  if (username !== undefined) updatePayload.username = username
  if (password !== undefined) updatePayload.password = password
  if (role !== undefined) updatePayload.role = role
  if (school_id !== undefined) updatePayload.school_id = school_id
  if (is_active !== undefined) updatePayload.is_active = is_active

  const { data, error } = await (supabaseAdmin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('operator_accounts') as any)
    .update(updatePayload as Database['public']['Tables']['operator_accounts']['Update'])
    .eq('id', id)
    .select('id, username, password, role, school_id, is_active')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ item: data }, { status: 200 })
}

// DELETE: 삭제
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const { error } = await supabaseAdmin
    .from('operator_accounts')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true }, { status: 200 })
}


