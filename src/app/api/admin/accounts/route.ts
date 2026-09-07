export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { Database } from '@/types/database.types'
import { requireAdmin } from '@/lib/apiAuth'

// GET: 목록 조회
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const search = req.nextUrl.searchParams
  const page = Math.max(1, Number(search.get('page') || '1'))
  const pageSize = Math.max(1, Number(search.get('pageSize') || '10'))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabaseAdmin
    .from('operator_accounts')
    .select('id, username, password, role, school_id, is_active', { count: 'exact' })
    .order('created_at', { ascending: true })
    .range(from, to)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ items: data, total: count ?? 0, page, pageSize }, { status: 200 })
}

// POST: 생성
export async function POST(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json()
  const { username, password, role, school_id, is_active } = body as Partial<Database['public']['Tables']['operator_accounts']['Insert']>

  if (!username || !password || !role) {
    return NextResponse.json({ error: 'username, password, role은 필수입니다.' }, { status: 400 })
  }

  const { data, error } = await (supabaseAdmin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('operator_accounts') as any)
    .insert({ username, password, role, school_id: school_id ?? null, is_active: is_active ?? true } as Database['public']['Tables']['operator_accounts']['Insert'])
    .select('id, username, password, role, school_id, is_active')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ item: data }, { status: 201 })
}


