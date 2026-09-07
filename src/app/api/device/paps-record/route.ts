export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/** 디바이스에서 PAPS 월별 행의 일부 항목만 갱신할 때 사용하는 타입 */
const RECORD_TYPES = [
  'muscular_endurance', // 근지구력
  'power', // 순발력 (power_1, power_2)
  'flexibility', // 유연성 (flexibility_1, flexibility_2)
  'cardio', // 심폐지구력 (cardio_1min, cardio_2min, cardio_3min)
  'bmi', // 체질량지수
] as const

type RecordType = (typeof RECORD_TYPES)[number]

function isRecordType(v: unknown): v is RecordType {
  return typeof v === 'string' && (RECORD_TYPES as readonly string[]).includes(v)
}

type Body = {
  recognition_key: string
  /** 측정일 기준 달력 연도 (ingest API의 year와 동일: 1·2월이면 학생 학년도는 year-1) */
  year: number
  month: number
  grade: number
  class_no: number
  student_no: number
  /** 갱신할 PAPS 항목 구분 */
  record_type: RecordType
  muscular_endurance?: number | null
  power_1?: number | null
  power_2?: number | null
  flexibility_1?: number | null
  flexibility_2?: number | null
  cardio_1min?: number | null
  cardio_2min?: number | null
  cardio_3min?: number | null
  bmi?: number | null
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function validatePayloadForType(
  recordType: RecordType,
  body: Body
): { ok: true } | { ok: false; message: string } {
  switch (recordType) {
    case 'muscular_endurance': {
      if (num(body.muscular_endurance) == null) {
        return { ok: false, message: 'record_type이 muscular_endurance일 때 muscular_endurance 값이 필요합니다.' }
      }
      return { ok: true }
    }
    case 'power': {
      if (num(body.power_1) == null && num(body.power_2) == null) {
        return { ok: false, message: 'record_type이 power일 때 power_1 또는 power_2 중 하나 이상 필요합니다.' }
      }
      return { ok: true }
    }
    case 'flexibility': {
      if (num(body.flexibility_1) == null && num(body.flexibility_2) == null) {
        return { ok: false, message: 'record_type이 flexibility일 때 flexibility_1 또는 flexibility_2 중 하나 이상 필요합니다.' }
      }
      return { ok: true }
    }
    case 'cardio': {
      if (
        num(body.cardio_1min) == null &&
        num(body.cardio_2min) == null &&
        num(body.cardio_3min) == null
      ) {
        return { ok: false, message: 'record_type이 cardio일 때 cardio_1min, cardio_2min, cardio_3min 중 하나 이상 필요합니다.' }
      }
      return { ok: true }
    }
    case 'bmi': {
      if (num(body.bmi) == null) {
        return { ok: false, message: 'record_type이 bmi일 때 bmi 값이 필요합니다.' }
      }
      return { ok: true }
    }
    default: {
      const _exhaustive: never = recordType
      return { ok: false, message: `알 수 없는 record_type: ${_exhaustive}` }
    }
  }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ error: 'Content-Type: application/json 필요' }, { status: 415 })
  }

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: '잘못된 JSON 본문' }, { status: 400 })
  }

  if (!body.recognition_key || body.recognition_key === '') {
    return NextResponse.json({ error: 'recognition_key가 필요합니다.' }, { status: 400 })
  }

  if (!isRecordType(body.record_type)) {
    return NextResponse.json(
      {
        error: `record_type은 다음 중 하나여야 합니다: ${RECORD_TYPES.join(', ')}`,
      },
      { status: 400 }
    )
  }

  const recordType = body.record_type

  const calendarYear = num(body.year)
  const month = num(body.month)
  const grade = num(body.grade)
  const class_no = num(body.class_no)
  const student_no = num(body.student_no)

  if (calendarYear == null || !Number.isInteger(calendarYear)) {
    return NextResponse.json({ error: 'year는 정수여야 합니다.' }, { status: 400 })
  }
  if (month == null || month < 1 || month > 12 || !Number.isInteger(month)) {
    return NextResponse.json({ error: 'month는 1~12 정수여야 합니다.' }, { status: 400 })
  }
  if (grade == null || class_no == null || student_no == null) {
    return NextResponse.json({ error: 'grade, class_no, student_no가 필요합니다.' }, { status: 400 })
  }

  const payloadCheck = validatePayloadForType(recordType, body)
  if (!payloadCheck.ok) {
    return NextResponse.json({ error: payloadCheck.message }, { status: 400 })
  }

  // RPC 함수로 학생 생성 + paps_records upsert 를 단일 호출로 처리
  // SECURITY DEFINER 로 RLS 를 우회하며, ingest 의 RPC 패턴과 동일
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin as any).rpc('upsert_paps_record', {
    p_recognition_key: String(body.recognition_key),
    p_year: calendarYear,
    p_month: month,
    p_grade: grade,
    p_class_no: class_no,
    p_student_no: student_no,
    p_record_type: recordType,
    p_muscular_endurance: num(body.muscular_endurance),
    p_power_1: num(body.power_1),
    p_power_2: num(body.power_2),
    p_flexibility_1: num(body.flexibility_1),
    p_flexibility_2: num(body.flexibility_2),
    p_cardio_1min: num(body.cardio_1min),
    p_cardio_2min: num(body.cardio_2min),
    p_cardio_3min: num(body.cardio_3min),
    p_bmi: num(body.bmi),
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // RPC 는 jsonb 를 반환: { ok: true/false, error?: string, student_id?: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = data as any
  if (result && result.ok === false) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true, record_type: recordType })
}
