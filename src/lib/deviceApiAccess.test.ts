import { describe, expect, it } from 'vitest'

import { isDeviceApiEnabled } from './deviceApiAccess'

describe('isDeviceApiEnabled', () => {
  it('disables the device API for an explicit false value', () => {
    expect(isDeviceApiEnabled('false')).toBe(false)
    expect(isDeviceApiEnabled(' FALSE ')).toBe(false)
  })

  it('keeps the device API enabled for true values', () => {
    expect(isDeviceApiEnabled('true')).toBe(true)
    expect(isDeviceApiEnabled(' TRUE ')).toBe(true)
  })

  it('preserves existing behavior when the value is unset or blank', () => {
    expect(isDeviceApiEnabled(undefined)).toBe(true)
    expect(isDeviceApiEnabled('   ')).toBe(true)
  })
})
