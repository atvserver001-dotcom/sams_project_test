export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/apiAuth'
import type { TableRow, TableUpdate } from '@/types/supabaseHelpers'

// PATCH: school_devices 메모 수정
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const memo = typeof body.memo === 'string' ? body.memo : ''

  const updatePayload: TableUpdate<'school_devices'> = { memo }

  const { data, error } = await supabaseAdmin
    .from('school_devices')
    .update(updatePayload)
    .eq('id', id)
    .select('id, memo')
    .single()
    .returns<Pick<TableRow<'school_devices'>, 'id' | 'memo'>>()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data }, { status: 200 })
}



