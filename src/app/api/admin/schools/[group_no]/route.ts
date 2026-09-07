export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/apiAuth'

function generateAuthKey() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from(randomBytes(12)).map((b) => alphabet[b % alphabet.length]).join('')
}

// GET: 학교 상세 (컨텐츠/디바이스/인증키 포함)
export async function GET(req: NextRequest, { params }: { params: Promise<{ group_no: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_no: groupNo } = await params
  const { data: school, error: findErr } = await (supabaseAdmin as any)
    .from('schools')
    .select('id, group_no, name, school_type, recognition_key')
    .eq('group_no', groupNo)
    .single()
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })

  const schoolId = (school as any)?.id as string
  const { data: schoolContentsRaw, error: scErr } = await (supabaseAdmin as any)
    .from('school_contents')
    .select(`
      id,
      content_id,
      start_date,
      end_date,
      is_unlimited,
      content:content_id(name, color_hex),
      school_devices(
        id,
        device_id,
        auth_key,
        created_at,
        memo,
        device:device_id(device_name)
      )
    `)
    .eq('school_id', schoolId)

  if (scErr) return NextResponse.json({ error: scErr.message }, { status: 500 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schoolContents = (schoolContentsRaw ?? []) as any[]

  const contents = (schoolContents || []).map((sc: any) => ({
    id: sc.id,
    content_id: sc.content_id,
    name: sc.content?.name || '-',
    color_hex: sc.content?.color_hex || null,
    start_date: sc.start_date,
    end_date: sc.end_date,
    is_unlimited: !!sc.is_unlimited,
    devices: (sc.school_devices || []).map((sd: any) => ({
      id: sd.id,
      device_id: sd.device_id,
      device_name: sd.device?.device_name || '-',
      auth_key: sd.auth_key,
      created_at: sd.created_at,
      memo: sd.memo ?? '',
    })),
  }))

  return NextResponse.json(
    {
      ...(school as any),
      contents,
    },
    { status: 200 },
  )
}

// PUT: 수정 (컨텐츠 기반 재할당 포함)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ group_no: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_no: groupNo } = await params
  const body = await req.json()
  const { group_no: newGroupNo, name, school_type, content_assignments } = body as {
    group_no?: string
    name?: string
    school_type?: number
    content_assignments?: Array<{
      content_id: string
      start_date?: string | null
      end_date?: string | null
      is_unlimited: boolean
      remove_school_device_ids?: string[]
      device_quantities: Array<{ device_id: string; quantity: number }>
    }>
  }

  const { data: school, error: findErr } = await (supabaseAdmin as any)
    .from('schools')
    .select('id')
    .eq('group_no', groupNo)
    .single()
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })

  const schoolId = (school as any)?.id as string

  // 1) 학교 기본정보 업데이트
  const updatePayload: any = {}
  if (newGroupNo !== undefined) {
    if (!/^\d{4}$/.test(newGroupNo)) {
      return NextResponse.json({ error: '그룹번호는 4자리 숫자여야 합니다.' }, { status: 400 })
    }
    updatePayload.group_no = newGroupNo
  }
  if (name !== undefined) updatePayload.name = name
  if (school_type !== undefined) updatePayload.school_type = school_type

  const { error: updErr } = await ((supabaseAdmin as any).from('schools') as any).update(updatePayload).eq('id', schoolId)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // 2) 컨텐츠 재할당 (인증키는 유지: 필요한 만큼만 추가/삭제)
  if (content_assignments) {
    const desiredContentIds = content_assignments.map((a) => a.content_id)

    // 2.0 기존 school_contents 조회
    const { data: existingContentsRaw, error: exErr } = await (supabaseAdmin as any)
      .from('school_contents')
      .select('id, content_id')
      .eq('school_id', schoolId)
    if (exErr) return NextResponse.json({ error: '기존 컨텐츠 조회 실패: ' + exErr.message }, { status: 500 })

    const existingContents = (existingContentsRaw ?? []) as any[]
    const existingByContentId = new Map<string, string>()
    for (const row of existingContents) existingByContentId.set(row.content_id, row.id)

    // 2.0-a) 선택 해제된 컨텐츠 제거 (하위 school_devices는 FK cascade)
    const toDelete = existingContents.filter((x) => !desiredContentIds.includes(x.content_id))
    if (toDelete.length > 0) {
      const ids = toDelete.map((x) => x.id)
      const { error: delErr } = await ((supabaseAdmin as any).from('school_contents') as any).delete().in('id', ids)
      if (delErr) return NextResponse.json({ error: '기존 컨텐츠 삭제 실패: ' + delErr.message }, { status: 500 })
    }

    // 2.1) 선택된 컨텐츠별로 upsert + 디바이스 수량 조정(인증키 유지)
    for (const assignment of content_assignments) {
      const contentId = assignment.content_id
      let schoolContentId = existingByContentId.get(contentId)

      if (schoolContentId) {
        // 기간만 업데이트
        const { error: updScErr } = await ((supabaseAdmin as any).from('school_contents') as any)
          .update({
            start_date: assignment.is_unlimited ? null : assignment.start_date ?? null,
            end_date: assignment.is_unlimited ? null : assignment.end_date ?? null,
            is_unlimited: !!assignment.is_unlimited,
          })
          .eq('id', schoolContentId)
        if (updScErr) return NextResponse.json({ error: '컨텐츠 기간 저장 실패: ' + updScErr.message }, { status: 500 })
      } else {
        const { data: scData, error: scErr } = await ((supabaseAdmin as any).from('school_contents') as any)
          .insert({
            school_id: schoolId,
            content_id: contentId,
            start_date: assignment.is_unlimited ? null : assignment.start_date ?? null,
            end_date: assignment.is_unlimited ? null : assignment.end_date ?? null,
            is_unlimited: !!assignment.is_unlimited,
          })
          .select('id')
          .single()
        if (scErr) return NextResponse.json({ error: '컨텐츠 저장 실패: ' + scErr.message }, { status: 500 })
        schoolContentId = (scData as any)?.id as string | undefined
        if (!schoolContentId) return NextResponse.json({ error: '컨텐츠 저장 실패: school_content_id를 가져오지 못했습니다.' }, { status: 500 })
        existingByContentId.set(contentId, schoolContentId)
      }

      // 2.1-0) 개별 삭제 요청이 있으면 먼저 삭제 (특정 인스턴스 제거 지원)
      const removeIds = Array.from(new Set((assignment.remove_school_device_ids || []).filter(Boolean)))
      if (removeIds.length > 0) {
        // delete()에 복수 필터를 체인했을 때 환경에 따라 누락되는 케이스가 있어,
        // 먼저 현재 school_content_id에 속한 id만 선별한 뒤 id 기준으로 삭제한다.
        const { data: deletableRaw, error: qErr } = await ((supabaseAdmin as any).from('school_devices') as any)
          .select('id')
          .eq('school_content_id', schoolContentId)
          .in('id', removeIds)
        if (qErr) return NextResponse.json({ error: '디바이스 개별 삭제 대상 조회 실패: ' + qErr.message }, { status: 500 })

        const deletableIds = ((deletableRaw ?? []) as any[]).map((r) => r.id).filter(Boolean)
        if (deletableIds.length > 0) {
          const { error: delSpecificErr } = await ((supabaseAdmin as any).from('school_devices') as any).delete().in('id', deletableIds)
          if (delSpecificErr) {
            return NextResponse.json({ error: '디바이스 개별 삭제 실패: ' + delSpecificErr.message }, { status: 500 })
          }
        }
      }

      // 현재 컨텐츠에 붙은 기기 조회
      const { data: existingDevicesRaw, error: exDevErr } = await (supabaseAdmin as any)
        .from('school_devices')
        .select('id, device_id, auth_key, created_at')
        .eq('school_content_id', schoolContentId)
        .order('created_at', { ascending: true })
      if (exDevErr) return NextResponse.json({ error: '기존 디바이스 조회 실패: ' + exDevErr.message }, { status: 500 })

      const existingDevices = (existingDevicesRaw ?? []) as any[]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byDeviceId = new Map<string, any[]>()
      for (const d of existingDevices) {
        const arr = byDeviceId.get(d.device_id) || []
        arr.push(d)
        byDeviceId.set(d.device_id, arr)
      }

      const desiredDeviceIds = (assignment.device_quantities || []).map((dq) => dq.device_id)
      // 2.1-a) 이번 요청에서 빠진 디바이스는 0개로 간주 → 전부 삭제
      for (const [deviceId, rows] of byDeviceId.entries()) {
        if (!desiredDeviceIds.includes(deviceId)) {
          const ids = rows.map((r) => r.id)
          if (ids.length) {
            const { error: delDevErr } = await ((supabaseAdmin as any).from('school_devices') as any).delete().in('id', ids)
            if (delDevErr) return NextResponse.json({ error: '디바이스 삭제 실패: ' + delDevErr.message }, { status: 500 })
          }
        }
      }

      // 2.1-b) 수량 맞추기: 부족하면 추가, 많으면 초과분만 삭제 (남는 것은 인증키 유지)
      for (const dq of assignment.device_quantities || []) {
        const deviceId = dq.device_id
        const desiredQty = Math.max(0, Number(dq.quantity) || 0)
        const rows = byDeviceId.get(deviceId) || []
        const currentQty = rows.length

        if (currentQty < desiredQty) {
          const add = desiredQty - currentQty
          const deviceRows = Array.from({ length: add }).map(() => ({
            school_content_id: schoolContentId,
            device_id: deviceId,
            auth_key: generateAuthKey(),
          }))
          const { error: insErr } = await (supabaseAdmin as any).from('school_devices').insert(deviceRows)
          if (insErr) return NextResponse.json({ error: '디바이스 추가 실패: ' + insErr.message }, { status: 500 })
        } else if (currentQty > desiredQty) {
          // 뒤에서부터 삭제(가장 최근 생성된 것부터 제거) → 앞에 남는 인증키는 유지
          const toRemove = rows.slice(desiredQty) // created_at asc 기준이므로 뒤쪽이 초과분
          const ids = toRemove.map((r) => r.id)
          if (ids.length) {
            const { error: delDevErr } = await ((supabaseAdmin as any).from('school_devices') as any).delete().in('id', ids)
            if (delDevErr) return NextResponse.json({ error: '디바이스 수량 감소 실패: ' + delDevErr.message }, { status: 500 })
          }
        }
      }
    }
  }

  return NextResponse.json({ success: true }, { status: 200 })
}

// DELETE: 삭제
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ group_no: string }> }) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { group_no: groupNo } = await params
  const { error } = await ((supabaseAdmin as any).from('schools') as any).delete().eq('group_no', groupNo)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true }, { status: 200 })
}


