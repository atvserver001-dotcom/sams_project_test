export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

type ExerciseType = 'endurance' | 'flexibility' | 'strength'

type IngestItem = {
  idempotency_key: string
  recognition_key: string
  year: number
  grade: number
  class_no: number
  student_no: number
  exercise_type: ExerciseType
  month: number
  avg_duration_seconds?: number | null
  avg_accuracy?: number | null
  avg_bpm?: number | null
  avg_max_bpm?: number | null
  avg_calories?: number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isValidExerciseType(v: any): v is ExerciseType {
  return v === 'endurance' || v === 'flexibility' || v === 'strength'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateItem(it: any): { ok: true; item: IngestItem } | { ok: false; message: string } {
  const requiredFields = [
    'idempotency_key',
    'recognition_key',
    'year',
    'grade',
    'class_no',
    'student_no',
    'exercise_type',
    'month',
  ] as const

  for (const f of requiredFields) {
    if (it == null || it[f] == null || it[f] === '') {
      return { ok: false, message: `필수 필드 누락: ${f}` }
    }
  }

  if (!Number.isFinite(Number(it.year))) return { ok: false, message: 'year 숫자여야 합니다.' }
  if (!Number.isFinite(Number(it.grade))) return { ok: false, message: 'grade 숫자여야 합니다.' }
  if (!Number.isFinite(Number(it.class_no))) return { ok: false, message: 'class_no 숫자여야 합니다.' }
  if (!Number.isFinite(Number(it.student_no))) return { ok: false, message: 'student_no 숫자여야 합니다.' }
  if (!Number.isFinite(Number(it.month)) || it.month < 1 || it.month > 12) return { ok: false, message: 'month(1-12) 범위를 벗어났습니다.' }
  if (!isValidExerciseType(it.exercise_type)) return { ok: false, message: 'exercise_type 값이 유효하지 않습니다.' }

  const item: IngestItem = {
    idempotency_key: String(it.idempotency_key),
    recognition_key: String(it.recognition_key),
    year: Number(it.year),
    grade: Number(it.grade),
    class_no: Number(it.class_no),
    student_no: Number(it.student_no),
    exercise_type: it.exercise_type,
    month: Number(it.month),
    avg_duration_seconds: it.avg_duration_seconds == null ? null : Number(it.avg_duration_seconds),
    avg_accuracy: it.avg_accuracy == null ? null : Number(it.avg_accuracy),
    avg_bpm: it.avg_bpm == null ? null : Number(it.avg_bpm),
    avg_max_bpm: it.avg_max_bpm == null ? null : Number(it.avg_max_bpm),
    avg_calories: it.avg_calories == null ? null : Number(it.avg_calories),
  }

  return { ok: true, item }
}

async function ensureStudentExistsForItem(it: IngestItem) {
  // recognition_key 로 학교 조회
  const { data: school, error: schoolError } = await (supabaseAdmin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('schools') as any)
    .select('id')
    .eq('recognition_key', it.recognition_key)
    .maybeSingle()

  if (schoolError || !school) {
    return { ok: false as const, message: '유효하지 않은 recognition_key 입니다.' }
  }

  // 학년도 계산: 1, 2월 데이터는 전년도 학년도 학생에게 귀속됨
  const studentYear = (it.month === 1 || it.month === 2) ? it.year - 1 : it.year

  // 이미 존재하는지 먼저 조회 (year 없는 유니크 제약조건에 맞춰 year 제외)
  const { data: existing, error: selectError } = await (supabaseAdmin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('students') as any)
    .select('id')
    .eq('school_id', school.id)
    .eq('grade', it.grade)
    .eq('class_no', it.class_no)
    .eq('student_no', it.student_no)
    .maybeSingle()

  if (selectError) {
    return { ok: false as const, message: selectError.message || '학생 조회 중 오류가 발생했습니다.' }
  }

  if (existing) {
    // 이미 학생이 있으면 그대로 사용
    return { ok: true as const }
  }

  const payload = {
    school_id: school.id,
    year: studentYear,
    grade: it.grade,
    class_no: it.class_no,
    student_no: it.student_no,
    // 디바이스에서 온 학생 기본 이름: "x번 학생"
    name: `${it.student_no}번 학생`,
  }

  const { error: insertError } = await (supabaseAdmin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('students') as any)
    .insert(payload)

  if (insertError) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (insertError as any).code || ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message = (insertError as any).message || ''
    // 유니크 인덱스가 있는 경우, 동시 요청에서 중복이 나도 OK 로 처리
    if (code === '23505' || message.includes('duplicate key value violates unique constraint')) {
      return { ok: true as const }
    }
    return { ok: false as const, message: message || '학생 정보 저장 중 오류가 발생했습니다.' }
  }

  return { ok: true as const }
}

export async function POST(request: NextRequest) {
  // 디바이스 토큰 검증 제거: 누구나 호출 가능

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

  // 배치: body가 배열이거나 { items: [...] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] | null = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : null
  if (items && items.length > 0) {
    const validated: IngestItem[] = []
    for (const it of items) {
      const v = validateItem(it)
      if (!v.ok) return NextResponse.json({ error: v.message }, { status: 400 })
      validated.push(v.item)
    }

    // 각 레코드에 대해 학생이 없으면 기본값으로 학생을 먼저 업서트
    for (const it of validated) {
      const ensured = await ensureStudentExistsForItem(it)
      if (!ensured.ok) {
        return NextResponse.json({ error: ensured.message }, { status: 400 })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseAdmin as any).rpc('upsert_exercise_records_batch', {
      p_items: validated,
    })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ upserted: data ?? 0 })
  }

  // 단건
  const v = validateItem(body)
  if (!v.ok) return NextResponse.json({ error: v.message }, { status: 400 })
  const it = v.item

  // 단건에서도 학생이 없으면 기본값으로 학생을 먼저 업서트
  const ensured = await ensureStudentExistsForItem(it)
  if (!ensured.ok) {
    return NextResponse.json({ error: ensured.message }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any).rpc('upsert_exercise_record_by_key_idem', {
    p_idempotency_key: it.idempotency_key,
    p_recognition_key: it.recognition_key,
    p_year: it.year,
    p_grade: it.grade,
    p_class_no: it.class_no,
    p_student_no: it.student_no,
    p_exercise_type: it.exercise_type,
    p_month: it.month,
    p_avg_duration_seconds: it.avg_duration_seconds,
    p_avg_accuracy: it.avg_accuracy,
    p_avg_bpm: it.avg_bpm,
    p_avg_max_bpm: it.avg_max_bpm,
    p_avg_calories: it.avg_calories,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ upserted: Boolean(data) })
}


