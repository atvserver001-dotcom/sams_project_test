import { describe, expect, it } from 'vitest'

import {
  validateHeartRateMappingSnapshot,
  validateHeartRateMappings,
} from './heartRateMapping'

const fullSnapshot = () => Array.from({ length: 30 }, (_, index) => ({
  student_no: index + 1,
  device_id: index === 0 ? '0123456' : '',
}))

describe('validateHeartRateMappings', () => {
  it('accepts empty IDs and preserves a seven-digit ID with a leading zero', () => {
    const result = validateHeartRateMappings([
      { student_no: 1, device_id: '0123456' },
      { student_no: 2, device_id: '' },
    ])

    expect(result).toEqual({
      ok: true,
      mappings: [
        { student_no: 1, device_id: '0123456' },
        { student_no: 2, device_id: '' },
      ],
    })
  })

  it.each([
    { name: 'an object instead of an array', value: { student_no: 1, device_id: '0123456' } },
    { name: 'a non-object item', value: [null] },
    { name: 'a string student number', value: [{ student_no: '1', device_id: '0123456' }] },
    { name: 'a student number below the range', value: [{ student_no: 0, device_id: '0123456' }] },
    { name: 'a student number above the range', value: [{ student_no: 31, device_id: '0123456' }] },
    { name: 'a fractional student number', value: [{ student_no: 1.5, device_id: '0123456' }] },
    { name: 'a numeric device ID', value: [{ student_no: 1, device_id: 1234567 }] },
    { name: 'a six-digit device ID', value: [{ student_no: 1, device_id: '123456' }] },
    { name: 'a ten-digit legacy device ID', value: [{ student_no: 1, device_id: '1234567890' }] },
    { name: 'a device ID containing whitespace', value: [{ student_no: 1, device_id: ' 1234567' }] },
    { name: 'a device ID containing a letter', value: [{ student_no: 1, device_id: '123456a' }] },
  ])('rejects $name', ({ value }) => {
    expect(validateHeartRateMappings(value).ok).toBe(false)
  })

  it('rejects duplicate student numbers', () => {
    expect(validateHeartRateMappings([
      { student_no: 1, device_id: '0123456' },
      { student_no: 1, device_id: '1234567' },
    ])).toMatchObject({ ok: false })
  })

  it('rejects duplicate non-empty device IDs but allows repeated empty IDs', () => {
    expect(validateHeartRateMappings([
      { student_no: 1, device_id: '0123456' },
      { student_no: 2, device_id: '0123456' },
    ])).toMatchObject({ ok: false })

    expect(validateHeartRateMappings([
      { student_no: 1, device_id: '' },
      { student_no: 2, device_id: '' },
    ])).toMatchObject({ ok: true })
  })

  it('requires every slot from 1 through 30 for a destructive settings snapshot', () => {
    expect(validateHeartRateMappingSnapshot(fullSnapshot())).toMatchObject({ ok: true })
    expect(validateHeartRateMappingSnapshot(fullSnapshot().slice(0, 29))).toMatchObject({ ok: false })
    expect(validateHeartRateMappingSnapshot([])).toMatchObject({ ok: false })
  })
})
