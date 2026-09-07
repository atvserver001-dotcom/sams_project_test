export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import type { TableInsert, TableRow } from '@/types/supabaseHelpers'
import { requireAdmin } from '@/lib/apiAuth'

function generateAuthKey() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from(randomBytes(12)).map(b => alphabet[b % alphabet.length]).join('')
}

// GET: 학교 목록 조회
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // 1. 학교 기본 정보 조회
  const { data: schoolsRaw, error: schoolErr } = await supabaseAdmin
    .from('schools')
    .select('id, group_no, name, school_type, recognition_key, created_at')
    .order('created_at', { ascending: true })
    .returns<TableRow<'schools'>[]>()

  if (schoolErr) return NextResponse.json({ error: schoolErr.message }, { status: 500 })

  const schools = schoolsRaw ?? []
  const schoolIds = schools.map((s) => s.id)

  // 2. 각 학교별 할당된 컨텐츠 및 디바이스 집계
  type SchoolContentWithRelations = TableRow<'school_contents'> & {
    content: { name: string | null; color_hex: string | null } | null
    school_devices: Array<
      TableRow<'school_devices'> & {
        device: { device_name: string | null; linkable?: boolean } | null
      }
    > | null
  }

  const { data: schoolContentsRaw, error: scErr } = await supabaseAdmin
    .from('school_contents')
    .select(`
      id,
      school_id,
      content_id,
      start_date,
      end_date,
      is_unlimited,
      content:content_id(name, color_hex),
      school_devices(
        id,
        device_id,
        created_at,
        auth_key,
        memo,
        link_group_id,
        is_primary,
        device:device_id(device_name, linkable)
      )
    `)
    .in('school_id', schoolIds)
    .returns<SchoolContentWithRelations[]>()

  if (scErr) return NextResponse.json({ error: scErr.message }, { status: 500 })
  const schoolContents = schoolContentsRaw ?? []

  const items = schools.map((school) => {
    const contents = schoolContents
      .filter((sc) => sc.school_id === school.id)
      .map((sc) => ({
        id: sc.id,
        content_id: sc.content_id,
        name: sc.content?.name || '-',
        color_hex: sc.content?.color_hex || null,
        start_date: sc.start_date ?? null,
        end_date: sc.end_date ?? null,
        is_unlimited: !!sc.is_unlimited,
        period: sc.is_unlimited ? '제한없음' : `${sc.start_date || ''} ~ ${sc.end_date || ''}`,
        devices: (sc.school_devices || []).map((sd) => ({
          id: sd.id,
          device_id: sd.device_id,
          device_name: sd.device?.device_name || '-',
          auth_key: sd.auth_key,
          created_at: sd.created_at,
          memo: sd.memo ?? '',
          linkable: sd.device?.linkable ?? false,
          link_group_id: sd.link_group_id || null, // link_group_id 추가
        }))
      }))

    // 연동 가능 디바이스가 속한 컨텐츠의 종류가 2가지 이상일 때만 true
    const linkableContentIds = contents
      .filter(c => c.devices.some(d => d.linkable))
      .map(c => c.content_id)

    const uniqueLinkableContentCount = new Set(linkableContentIds).size
    const has_linkable = uniqueLinkableContentCount >= 2

    return {
      ...school,
      contents,
      has_linkable,
    }
  })

  return NextResponse.json({ items, total: schools.length }, { status: 200 })
}

// POST: 학교 생성
export async function POST(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await req.json()
  const { group_no, name, school_type, content_assignments } = body as {
    group_no: string;
    name: string;
    school_type: number;
    content_assignments?: Array<{
      content_id: string;
      start_date?: string | null;
      end_date?: string | null;
      is_unlimited: boolean;
      device_quantities: Array<{ device_id: string; quantity: number }>;
    }>
  }

  if (!group_no || !name) {
    return NextResponse.json({ error: 'group_no, name는 필수입니다.' }, { status: 400 })
  }

  const st = Number(school_type)
  if (st !== 1 && st !== 2 && st !== 3) {
    return NextResponse.json({ error: 'school_type은 1|2|3 이어야 합니다.' }, { status: 400 })
  }

  // 중복 체크
  const { data: dup } = await supabaseAdmin.from('schools').select('id').eq('group_no', group_no).maybeSingle()
  if (dup) return NextResponse.json({ error: '이미 존재하는 그룹번호입니다.' }, { status: 409 })

  // 인식키 생성
  const recognition_key = Array.from(randomBytes(5)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()

  // 1. 학교 생성
  const schoolPayload: TableInsert<'schools'> = {
    group_no,
    name,
    school_type: st,
    recognition_key,
  }

  const { data: schoolData, error: schoolErr } = await supabaseAdmin
    .from('schools')
    .insert(schoolPayload)
    .select()
    .single()

  if (schoolErr) return NextResponse.json({ error: schoolErr.message }, { status: 500 })
  const school = schoolData as TableRow<'schools'>

  // 2. 컨텐츠 및 디바이스 할당
  if (content_assignments && content_assignments.length > 0) {
    for (const assignment of content_assignments) {
      // 2.1. school_contents 삽입
      const scPayload: TableInsert<'school_contents'> = {
        school_id: school.id,
        content_id: assignment.content_id,
        start_date: assignment.is_unlimited ? null : (assignment.start_date || null),
        end_date: assignment.is_unlimited ? null : (assignment.end_date || null),
        is_unlimited: assignment.is_unlimited
      }

      const { data: scData, error: scErr } = await supabaseAdmin
        .from('school_contents')
        .insert(scPayload)
        .select()
        .single()

      if (scErr) {
        return NextResponse.json({ error: '컨텐츠 할당 중 오류: ' + scErr.message }, { status: 500 })
      }
      const sc = scData as TableRow<'school_contents'>

      // 2.2. school_devices 삽입 (수량만큼 인증키 생성)
      const deviceRows: TableInsert<'school_devices'>[] = []
      if (assignment.device_quantities && Array.isArray(assignment.device_quantities)) {
        for (const dq of assignment.device_quantities) {
          const qty = Number(dq.quantity)
          for (let i = 0; i < qty; i++) {
            deviceRows.push({
              school_content_id: sc.id,
              device_id: dq.device_id,
              auth_key: generateAuthKey(),
            })
          }
        }
      }

      if (deviceRows.length > 0) {
        const { error: devErr } = await supabaseAdmin.from('school_devices').insert(deviceRows)
        if (devErr) {
          return NextResponse.json({ error: '디바이스 할당 중 오류: ' + devErr.message }, { status: 500 })
        }
      }
    }
  }

  return NextResponse.json({ success: true, item: school }, { status: 201 })
}
