import { describe, expect, it } from 'vitest'

import {
  JUMP_ROPE_GATEWAY_PRODUCT,
  JUMP_ROPE_MODE_OPTIONS,
  JUMP_ROPE_NDJSON_MAX_LINE_LENGTH,
  JUMP_ROPE_PROFILE,
  JumpRopeGatewayMessage,
  JumpRopeNdjsonMessageDecoder,
  formatJumpRopeDuration,
  getJumpRopeCardRule,
  getJumpRopeModePresentation,
  getJumpRopeRule,
  isExpectedJumpRopeAck,
  isExpectedJumpRopeGatewayIdentity,
  isJumpRopeEventForRun,
  isJumpRopeUint32After,
  jumpRopeModeSetFields,
  normalizeJumpRopeTarget,
  parseJumpRopeAckUptime,
  parseJumpRopeDeviceReady,
  parseJumpRopeDeviceState,
  parseJumpRopeSnapshot,
} from './jumpRopeSerial'

const readyCaps = (): JumpRopeGatewayMessage => ({
  v: 1,
  kind: 'caps',
  product: JUMP_ROPE_GATEWAY_PRODUCT,
  protocol: 1,
  state: 'ready',
  baud: 115200,
  rx_line_max: 767,
  lease_min_ms: 1000,
  lease_default_ms: 5000,
  lease_max_ms: 30000,
  gateway_id: 'gateway-1',
  boot_id: 'boot-1',
  max_active_devices: 1,
  capabilities: [
    'chileaf_jr203_gatt_v1',
    'jump_rope_count',
    'mode_control',
    'run_gate',
    'heartbeat_lease',
    'fresh_event_sequence',
  ],
})

const snapshot = (): JumpRopeGatewayMessage => ({
  v: 1,
  kind: 'jump_rope_snapshot',
  boot_id: 'boot-1',
  run_id: 'run-1',
  generation: 2,
  seq: 7,
  observed_ms: 1_234,
  fresh: true,
  slot: 1,
  count: 42,
  mode: 1,
  count_up_minute: 0,
  count_up_second: 15,
  count_down_minute: 0,
  count_down_second: 45,
  battery_percent: 88,
  rssi_dbm: -54,
})

describe('jump-rope gateway protocol', () => {
  it('accepts only the promoted JR203 gateway identity and complete capabilities', () => {
    expect(isExpectedJumpRopeGatewayIdentity(readyCaps())).toBe(true)
    expect(isExpectedJumpRopeGatewayIdentity({ ...readyCaps(), product: 'ATV_CL830_WEB_SERIAL_GATEWAY' })).toBe(false)
    expect(isExpectedJumpRopeGatewayIdentity({ ...readyCaps(), state: 'stopping' })).toBe(true)
    expect(isExpectedJumpRopeGatewayIdentity({
      ...readyCaps(),
      capabilities: (readyCaps().capabilities as string[]).filter((item) => item !== 'jump_rope_count'),
    })).toBe(false)
    expect(isExpectedJumpRopeGatewayIdentity({ ...readyCaps(), max_active_devices: 2 })).toBe(false)
  })

  it('validates a pinned device_ready identity', () => {
    const event = parseJumpRopeDeviceReady({
      v: 1,
      kind: 'device_ready',
      boot_id: 'boot-1',
      run_id: 'run-1',
      generation: 1,
      slot: 1,
      profile_handle: 'jump-rope-slot-01',
      address: 'ec:67:0e:8b:da:97',
      address_type: 0,
      name: 'JR260-0923081',
      identity_verified: true,
    })
    expect(event?.address_type).toBe(0)
    expect(parseJumpRopeDeviceReady({ ...event, address_type: 4 } as JumpRopeGatewayMessage)).toBeNull()
    expect(parseJumpRopeDeviceReady({ ...event, profile_handle: 'other-profile' } as JumpRopeGatewayMessage)).toBeNull()
  })

  it('accepts only reconnect-relevant device_state envelopes for the JR203 profile', () => {
    const deviceState: JumpRopeGatewayMessage = {
      v: 1,
      kind: 'device_state',
      boot_id: 'boot-1',
      run_id: 'run-1',
      generation: 2,
      slot: 1,
      profile_handle: 'jump-rope-slot-01',
      state: 'disconnected',
    }
    expect(parseJumpRopeDeviceState(deviceState)?.state).toBe('disconnected')
    expect(parseJumpRopeDeviceState({ ...deviceState, state: 'connecting' })?.state).toBe('connecting')
    expect(parseJumpRopeDeviceState({ ...deviceState, state: 'link_established' })).toBeNull()
    expect(parseJumpRopeDeviceState({ ...deviceState, profile_handle: 'other-profile' })).toBeNull()
  })

  it('binds ACKs to the expected boot, run, and generation', () => {
    const ack: JumpRopeGatewayMessage = {
      v: 1,
      kind: 'ack',
      command: 'run_stop',
      boot_id: 'boot-1',
      run_id: 'run-1',
      generation: 2,
    }
    const expected = { bootId: 'boot-1', runId: 'run-1', generation: 2 }

    expect(isExpectedJumpRopeAck(ack, 'run_stop', expected)).toBe(true)
    expect(isExpectedJumpRopeAck({ ...ack, run_id: 'run-other' }, 'run_stop', expected)).toBe(false)
    expect(isExpectedJumpRopeAck({ ...ack, generation: 3 }, 'run_stop', expected)).toBe(false)
  })

  it.each([
    ['slot', 0],
    ['slot', 31],
    ['count', -1],
    ['mode', 4],
    ['count_up_second', 60],
    ['count_down_second', 60],
    ['battery_percent', 101],
    ['rssi_dbm', 1],
    ['seq', 0],
    ['observed_ms', -1],
    ['observed_ms', 0x1_0000_0000],
  ])('rejects an invalid %s snapshot field', (field, value) => {
    expect(parseJumpRopeSnapshot({ ...snapshot(), [field]: value })).toBeNull()
  })

  it('accepts nullable battery and RSSI values', () => {
    expect(parseJumpRopeSnapshot({
      ...snapshot(),
      battery_percent: null,
      rssi_dbm: null,
    })).not.toBeNull()
  })

  it('rejects stale, duplicated, and cross-run sequence events', () => {
    const event = parseJumpRopeSnapshot(snapshot())!
    const run = { bootId: 'boot-1', runId: 'run-1', generation: 2, lastSequence: 6 }
    expect(isJumpRopeEventForRun(event, run)).toBe(true)
    expect(isJumpRopeEventForRun(event, { ...run, lastSequence: 7 })).toBe(false)
    expect(isJumpRopeEventForRun(event, { ...run, runId: 'run-other' })).toBe(false)
    expect(isJumpRopeEventForRun(event, { ...run, generation: 3 })).toBe(false)
  })

  it('validates ACK uptime and compares uint32 timestamps across millis wrap', () => {
    const ack = { v: 1, kind: 'ack', uptime_ms: 0xFFFF_FFF0 }
    expect(parseJumpRopeAckUptime(ack)).toBe(0xFFFF_FFF0)
    expect(parseJumpRopeAckUptime({ ...ack, uptime_ms: -1 })).toBeNull()
    expect(parseJumpRopeAckUptime({ ...ack, uptime_ms: 0x1_0000_0000 })).toBeNull()

    expect(isJumpRopeUint32After(100, 100)).toBe(false)
    expect(isJumpRopeUint32After(101, 100)).toBe(true)
    expect(isJumpRopeUint32After(99, 100)).toBe(false)
    expect(isJumpRopeUint32After(0x10, 0xFFFF_FFF0)).toBe(true)
    expect(isJumpRopeUint32After(0xFFFF_FF00, 0x10)).toBe(false)
  })
})

describe('jump-rope NDJSON decoder', () => {
  it('decodes split and consecutive lines', () => {
    const decoder = new JumpRopeNdjsonMessageDecoder()
    expect(decoder.push('{"v":1,"kind":"caps"')).toEqual([])
    expect(decoder.push('}\n{"v":1,"kind":"status"}\n')).toEqual([
      { v: 1, kind: 'caps' },
      { v: 1, kind: 'status' },
    ])
  })

  it('drops malformed and oversized lines without damaging the next line', () => {
    const decoder = new JumpRopeNdjsonMessageDecoder()
    const oversized = 'x'.repeat(JUMP_ROPE_NDJSON_MAX_LINE_LENGTH + 1)
    expect(decoder.push(`${oversized}\nnot-json\n{"v":1,"kind":"caps"}\n`)).toEqual([
      { v: 1, kind: 'caps' },
    ])
  })
})

describe('jump-rope mode helpers', () => {
  it('keeps the four SDK modes and the fixed JR203 profile', () => {
    expect(JUMP_ROPE_MODE_OPTIONS.map((option) => option.value)).toEqual([0, 1, 2, 3])
    expect(JUMP_ROPE_PROFILE).toMatchObject({
      slot: 1,
      handle: 'jump-rope-slot-01',
      driver: 'chileaf_jr203_gatt_v1',
      wireDialect: 'JR203_WX_1_1_2',
      writeMode: 'without_response',
    })
  })

  it('serializes mode_set fields exactly as the firmware codec expects', () => {
    expect(jumpRopeModeSetFields(0, 999)).toEqual({ mode: 0, target: 0, minutes: 0, seconds: 0 })
    expect(jumpRopeModeSetFields(1, 120)).toEqual({ mode: 1, target: 120, minutes: 0, seconds: 0 })
    expect(jumpRopeModeSetFields(2, 125)).toEqual({ mode: 2, target: 0, minutes: 2, seconds: 0 })
  })

  it('normalizes targets and formats rules for display', () => {
    expect(normalizeJumpRopeTarget(0, 100)).toBe(0)
    expect(normalizeJumpRopeTarget(1, -1)).toBe(1)
    expect(normalizeJumpRopeTarget(1, 99999)).toBe(1000)
    expect(normalizeJumpRopeTarget(2, 91)).toBe(120)
    expect(normalizeJumpRopeTarget(2, 99999)).toBe(3600)
    expect(normalizeJumpRopeTarget(3, 99999)).toBe(60)
    expect(formatJumpRopeDuration(125)).toBe('02:05')
    expect(getJumpRopeRule(1, 120)).toBe('목표 120회')
    expect(getJumpRopeRule(2, 125)).toBe('02:00 측정')
  })

  it('distinguishes requested, sensor-confirmed, and mismatched modes', () => {
    expect(getJumpRopeModePresentation(2)).toEqual({
      state: 'pending',
      label: '타임어택 요청',
      warning: null,
    })
    expect(getJumpRopeModePresentation(2, 2)).toEqual({
      state: 'confirmed',
      label: '타임어택 · 센서 확인',
      warning: null,
    })
    expect(getJumpRopeModePresentation(2, 1)).toEqual({
      state: 'mismatch',
      label: '센서 목표 횟수 · 요청 타임어택',
      warning: '센서 모드 불일치',
    })

    const sensorRule = {
      mode: 2 as const,
      count: 40,
      count_up_minute: 0,
      count_up_second: 40,
      count_down_minute: 1,
      count_down_second: 20,
    }
    expect(getJumpRopeCardRule(2, 120, sensorRule)).toBe('남은 시간 01:20')
    expect(getJumpRopeCardRule(1, 100, sensorRule)).toBeNull()
  })
})
