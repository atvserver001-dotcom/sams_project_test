export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

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

  // 키 이름 유연 처리
  const recognition_key =
    body?.recognition_key ??
    body?.recognitionKey ??
    body?.RecognitionKey

  if (!recognition_key) {
    return NextResponse.json({ error: 'recognition_key 필수' }, { status: 400 })
  }

  const { data: school, error } = await supabaseAdmin
    .from('schools')
    .select('id, name, school_type')
    .eq('recognition_key', String(recognition_key))
    .maybeSingle<{ id: string; name: string; school_type: number }>()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!school) {
    return NextResponse.json({ error: '학교를 찾을 수 없습니다.' }, { status: 404 })
  }

  return NextResponse.json({
    school_id: school.id,
    school_name: school.name,
    school_type: school.school_type ?? null,
  })
}


