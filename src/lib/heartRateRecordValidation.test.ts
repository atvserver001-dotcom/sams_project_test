import { describe, expect, it } from 'vitest'

import { validateHeartRateRecordRequest } from './heartRateRecordValidation'

const validRequest = () => ({
  year: 2026,
  grade: 1,
  class_no: 1,
  results: [{
    student_id: '123e4567-e89b-12d3-a456-426614174000',
    student_no: 1,
    year: 2026,
    month: 8,
    avg_bpm: 101.7,
    max_bpm: 117,
    min_bpm: 92,
    record_count: 1,
  }],
})

describe('validateHeartRateRecordRequest', () => {
  it('accepts a bounded measurement snapshot and strips untrusted extra fields', () => {
    const request = validRequest()
    Object.assign(request.results[0], { name: '클라이언트 표시 이름' })

    expect(validateHeartRateRecordRequest(request)).toEqual({
      ok: true,
      value: validRequest(),
    })
  })

  it('accepts January and February only in the calendar year after the academic year', () => {
    const request = validRequest()
    request.results[0].year = 2027
    request.results[0].month = 2

    expect(validateHeartRateRecordRequest(request)).toMatchObject({ ok: true })

    request.results[0].year = 2026
    expect(validateHeartRateRecordRequest(request)).toMatchObject({ ok: false })
  })

  it.each([
    ['an invalid UUID', (request: ReturnType<typeof validRequest>) => { request.results[0].student_id = 'student-1' }],
    ['a student number below the range', (request: ReturnType<typeof validRequest>) => { request.results[0].student_no = 0 }],
    ['a student number above the range', (request: ReturnType<typeof validRequest>) => { request.results[0].student_no = 31 }],
    ['a fractional month', (request: ReturnType<typeof validRequest>) => { request.results[0].month = 8.5 }],
    ['an academic year outside the range', (request: ReturnType<typeof validRequest>) => { request.year = 1999 }],
    ['a grade outside the range', (request: ReturnType<typeof validRequest>) => { request.grade = 7 }],
    ['a class outside the range', (request: ReturnType<typeof validRequest>) => { request.class_no = 11 }],
    ['a BPM below the range', (request: ReturnType<typeof validRequest>) => { request.results[0].min_bpm = 0 }],
    ['a BPM above the range', (request: ReturnType<typeof validRequest>) => { request.results[0].max_bpm = 256 }],
    ['a non-finite BPM', (request: ReturnType<typeof validRequest>) => { request.results[0].avg_bpm = Number.NaN }],
    ['a fractional minimum BPM', (request: ReturnType<typeof validRequest>) => { request.results[0].min_bpm = 92.5 }],
    ['an average BPM with excessive precision', (request: ReturnType<typeof validRequest>) => { request.results[0].avg_bpm = 101.71 }],
    ['an inverted BPM range', (request: ReturnType<typeof validRequest>) => { request.results[0].avg_bpm = 118 }],
    ['an inflated record count', (request: ReturnType<typeof validRequest>) => { request.results[0].record_count = 2 }],
  ])('rejects %s', (_name, mutate) => {
    const request = validRequest()
    mutate(request)
    expect(validateHeartRateRecordRequest(request)).toMatchObject({ ok: false })
  })

  it('rejects duplicate student IDs or student numbers', () => {
    const duplicateId = validRequest()
    duplicateId.results.push({
      ...duplicateId.results[0],
      student_no: 2,
    })
    expect(validateHeartRateRecordRequest(duplicateId)).toMatchObject({ ok: false })

    const duplicateNumber = validRequest()
    duplicateNumber.results.push({
      ...duplicateNumber.results[0],
      student_id: '123e4567-e89b-12d3-a456-426614174001',
    })
    expect(validateHeartRateRecordRequest(duplicateNumber)).toMatchObject({ ok: false })
  })

  it('rejects an empty list and more than 30 results', () => {
    const empty = validRequest()
    empty.results = []
    expect(validateHeartRateRecordRequest(empty)).toMatchObject({ ok: false })

    const oversized = validRequest()
    oversized.results = Array.from({ length: 31 }, (_, index) => ({
      ...oversized.results[0],
      student_id: `123e4567-e89b-12d3-a456-${String(index).padStart(12, '0')}`,
      student_no: index + 1,
    }))
    expect(validateHeartRateRecordRequest(oversized)).toMatchObject({ ok: false })
  })
})
