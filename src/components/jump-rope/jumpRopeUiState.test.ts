import { describe, expect, it } from 'vitest'

import {
  getJumpRopeSlotLifecycleLabel,
  isJumpRopeConnectionActionBusy,
  isJumpRopeConnectionContextLocked,
  isJumpRopeMeasurementConfigLocked,
  shouldApplyJumpRopeMeasurementCompletion,
  shouldClearJumpRopeMeasurementUi,
} from './jumpRopeUiState'

describe('jump-rope UI state policy', () => {
  it('keeps the cohort and mode locked while the gateway reconnects', () => {
    expect(isJumpRopeConnectionContextLocked('reconnecting', true)).toBe(true)
    expect(isJumpRopeMeasurementConfigLocked('reconnecting', true)).toBe(true)
    expect(isJumpRopeConnectionActionBusy('reconnecting')).toBe(false)
    expect(shouldClearJumpRopeMeasurementUi('reconnecting', true)).toBe(true)
    expect(getJumpRopeSlotLifecycleLabel('reconnecting')).toBe('JR203 재연결 중')
  })

  it('unlocks only measurement settings in connected idle', () => {
    expect(isJumpRopeConnectionContextLocked('connected', true)).toBe(true)
    expect(isJumpRopeMeasurementConfigLocked('connected', true)).toBe(false)
    expect(getJumpRopeSlotLifecycleLabel('connected')).toBe('시작 신호 대기')
    expect(isJumpRopeMeasurementConfigLocked('error', true)).toBe(true)
    expect(isJumpRopeConnectionActionBusy('running')).toBe(true)
    expect(isJumpRopeConnectionActionBusy('starting')).toBe(true)
    expect(isJumpRopeConnectionActionBusy('finishing')).toBe(true)
    expect(isJumpRopeConnectionActionBusy('disconnecting')).toBe(true)
    expect(shouldClearJumpRopeMeasurementUi('connected', true)).toBe(false)
    expect(shouldClearJumpRopeMeasurementUi('error', true)).toBe(false)
    expect(shouldClearJumpRopeMeasurementUi('error', false)).toBe(true)
    expect(shouldApplyJumpRopeMeasurementCompletion(3, 3)).toBe(true)
    expect(shouldApplyJumpRopeMeasurementCompletion(2, 3)).toBe(false)
  })
})
