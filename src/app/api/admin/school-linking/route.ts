export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/apiAuth'

// GET: 학교의 연동 가능 디바이스 및 기존 연동 그룹 조회
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const schoolId = req.nextUrl.searchParams.get('school_id')
  if (!schoolId) return NextResponse.json({ error: 'school_id는 필수입니다.' }, { status: 400 })

  // 1. 해당 학교의 school_contents 조회
  const { data: scRaw, error: scErr } = await (supabaseAdmin as any)
    .from('school_contents')
    .select('id, content_id, content:content_id(name, color_hex)')
    .eq('school_id', schoolId)

  if (scErr) return NextResponse.json({ error: scErr.message }, { status: 500 })
  const schoolContents = (scRaw ?? []) as any[]
  const scIds = schoolContents.map((sc: any) => sc.id)

  if (scIds.length === 0) {
    return NextResponse.json({ linkable_devices: [], groups: [] }, { status: 200 })
  }

  // 2. 해당 school_contents에 속한 school_devices 중 linkable=true인 디바이스만 조회
  const { data: sdRaw, error: sdErr } = await (supabaseAdmin as any)
    .from('school_devices')
    .select(`
      id,
      device_id,
      auth_key,
      school_content_id,
      link_group_id,
      is_primary,
      memo,
      device:device_id(device_name, linkable)
    `)
    .in('school_content_id', scIds)

  if (sdErr) return NextResponse.json({ error: sdErr.message }, { status: 500 })
  const schoolDevices = (sdRaw ?? []) as any[]

  // linkable=true인 디바이스만 필터
  const linkableDevices = schoolDevices.filter((sd: any) => sd.device?.linkable === true)

  // 컨텐츠 정보 매핑
  const scMap = new Map<string, any>()
  schoolContents.forEach((sc: any) => scMap.set(sc.id, sc))

  const linkableItems = linkableDevices.map((sd: any) => {
    const sc = scMap.get(sd.school_content_id)
    return {
      id: sd.id,
      device_id: sd.device_id,
      device_name: sd.device?.device_name || '-',
      auth_key: sd.auth_key,
      school_content_id: sd.school_content_id,
      content_name: sc?.content?.name || '-',
      content_color_hex: sc?.content?.color_hex || null,
      link_group_id: sd.link_group_id,
      is_primary: sd.is_primary,
      memo: sd.memo ?? '',
    }
  })

  // 3. 기존 연동 그룹 조합
  const groupMap = new Map<string, any[]>()
  linkableItems.forEach((item: any) => {
    if (item.link_group_id) {
      const arr = groupMap.get(item.link_group_id) || []
      arr.push(item)
      groupMap.set(item.link_group_id, arr)
    }
  })

  const groups = Array.from(groupMap.entries()).map(([groupId, members]) => ({
    group_id: groupId,
    primary: members.find((m: any) => m.is_primary) || null,
    secondaries: members.filter((m: any) => !m.is_primary),
  }))

  // 연동되지 않은 디바이스만 별도 제공
  const unlinkedDevices = linkableItems.filter((item: any) => !item.link_group_id)

  return NextResponse.json({ linkable_devices: unlinkedDevices, groups }, { status: 200 })
}

// POST: 연동 그룹 생성
export async function POST(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json()
  const { primary_device_id, secondary_device_ids } = body as {
    primary_device_id: string
    secondary_device_ids: string[]
  }

  if (!primary_device_id) {
    return NextResponse.json({ error: '주 디바이스를 선택해주세요.' }, { status: 400 })
  }
  if (!secondary_device_ids || secondary_device_ids.length === 0) {
    return NextResponse.json({ error: '부 디바이스를 1개 이상 선택해주세요.' }, { status: 400 })
  }

  // 새 그룹 ID 생성
  const { data: uuidData } = await supabaseAdmin.rpc('gen_random_uuid' as any)
  const groupId = uuidData || crypto.randomUUID()

  // 주 디바이스 업데이트
  const { error: primaryErr } = await (supabaseAdmin as any)
    .from('school_devices')
    .update({ link_group_id: groupId, is_primary: true })
    .eq('id', primary_device_id)

  if (primaryErr) return NextResponse.json({ error: '주 디바이스 설정 실패: ' + primaryErr.message }, { status: 500 })

  // 부 디바이스들 업데이트
  const { error: secErr } = await (supabaseAdmin as any)
    .from('school_devices')
    .update({ link_group_id: groupId, is_primary: false })
    .in('id', secondary_device_ids)

  if (secErr) return NextResponse.json({ error: '부 디바이스 설정 실패: ' + secErr.message }, { status: 500 })

  return NextResponse.json({ success: true, group_id: groupId }, { status: 201 })
}

// DELETE: 연동 그룹 삭제
export async function DELETE(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const groupId = req.nextUrl.searchParams.get('group_id')
  if (!groupId) return NextResponse.json({ error: 'group_id는 필수입니다.' }, { status: 400 })

  // 해당 그룹의 모든 디바이스 연동 해제
  const { error } = await (supabaseAdmin as any)
    .from('school_devices')
    .update({ link_group_id: null, is_primary: false })
    .eq('link_group_id', groupId)

  if (error) return NextResponse.json({ error: '연동 해제 실패: ' + error.message }, { status: 500 })

  return NextResponse.json({ success: true }, { status: 200 })
}
