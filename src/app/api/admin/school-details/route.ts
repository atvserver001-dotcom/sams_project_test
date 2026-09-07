export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/apiAuth'

// GET: 학교 세부정보 목록 (페이징)
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const search = req.nextUrl.searchParams
  const page = Math.max(1, Number(search.get('page') || '1'))
  const pageSize = Math.max(1, Number(search.get('pageSize') || '10'))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  // 1) 기본 학교 목록 페이징 조회 (schools)
  const { data: schools, error: schoolsErr, count } = await supabaseAdmin
    .from('schools')
    .select('id, group_no, name', { count: 'exact' })
    .order('created_at', { ascending: true })
    .range(from, to)

  if (schoolsErr) return NextResponse.json({ error: schoolsErr.message }, { status: 500 })

  const schoolIds = (schools ?? []).map((s) => s.id as string)

  // 2) 교사 계정 수 집계
  const teacherCountBySchoolId = new Map<string, number>()
  if (schoolIds.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: accounts, error: accErr } = await (supabaseAdmin.from('operator_accounts') as any)
      .select('school_id, role')
      .in('school_id', schoolIds)
      .eq('role', 'school')

    if (!accErr) {
      for (const r of (accounts ?? []) as Array<{ school_id: string | null }>) {
        if (r.school_id) {
          teacherCountBySchoolId.set(r.school_id, (teacherCountBySchoolId.get(r.school_id) || 0) + 1)
        }
      }
    }
  }

  // 3) 제품 구성(디바이스) 수 집계: school_contents -> school_devices
  const deviceCountBySchoolId = new Map<string, number>()
  if (schoolIds.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: schoolContents, error: scErr } = await (supabaseAdmin.from('school_contents') as any)
      .select('id, school_id')
      .in('school_id', schoolIds)

    const schoolContentsArr = (schoolContents ?? []) as Array<{ id: string; school_id: string }>

    if (!scErr && schoolContentsArr.length > 0) {
      const scIds = schoolContentsArr.map((sc) => sc.id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: devices, error: devErr } = await (supabaseAdmin.from('school_devices') as any)
        .select('school_content_id')
        .in('school_content_id', scIds)

      if (!devErr) {
        const devicesArr = (devices ?? []) as Array<{ school_content_id: string }>
        // school_content_id -> school_id 매핑 필요
        const scToSchool = new Map<string, string>()
        schoolContentsArr.forEach((sc) => scToSchool.set(sc.id, sc.school_id))

        for (const d of devicesArr) {
          const sid = scToSchool.get(d.school_content_id)
          if (sid) {
            deviceCountBySchoolId.set(sid, (deviceCountBySchoolId.get(sid) || 0) + 1)
          }
        }
      }
    }
  }

  const items = (schools ?? []).map((s: { name: string; group_no: string; id: string }, idx: number) => ({
    index: from + idx + 1,
    name: s.name as string,
    group_no: s.group_no as string,
    teacher_accounts: teacherCountBySchoolId.get(s.id) || 0,
    device_count: deviceCountBySchoolId.get(s.id) || 0,
  }))

  return NextResponse.json({ items, total: count ?? 0, page, pageSize }, { status: 200 })
}
