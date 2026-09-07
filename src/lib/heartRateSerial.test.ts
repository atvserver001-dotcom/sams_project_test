import { describe, expect, it } from 'vitest'

import {
  GatewayHeartRateEvent,
  HEART_RATE_NDJSON_MAX_LINE_LENGTH,
  NdjsonMessageDecoder,
  addHeartRateSample,
  averageHeartRate,
  currentHeartRateForSignal,
  findMappedStudentNumber,
  getHeartRateSignalState,
  isExpectedGatewayStatus,
  isExpectedGatewayCaps,
  isGatewayReadyCaps,
  isExpectedRunStartAck,
  isHeartRateEventForRun,
  parseGatewayMessage,
  parseHeartRateEvent,
} from './heartRateSerial'
import { isCanonicalHeartRateDeviceId } from './heartRateMapping'

const event: GatewayHeartRateEvent = {
  v: 1,
  kind: 'heart_rate',
  boot_id: 'boot-1',
  run_id: 'run-1',
  source_key: 'cl830:000b738e',
  aliases: {
    be_decimal: '750478',
    be_decimal_min7: '0750478',
    le_decimal: '2389904128',
  },
  bpm: 92,
  battery_percent: 81,
  seq: 1,
  fresh: true,
}

describe('heart-rate Web Serial protocol', () => {
  it('decodes NDJSON split across serial chunks', () => {
    const decoder = new NdjsonMessageDecoder()
    expect(decoder.push('{"v":1,"kind":"ca')).toEqual([])
    expect(decoder.push('ps","request_id":"req_1"}\n')).toEqual([
      { v: 1, kind: 'caps', request_id: 'req_1' },
    ])
  })

  it('drops an oversized line and recovers at the next newline', () => {
    const decoder = new NdjsonMessageDecoder()
    expect(decoder.push('x'.repeat(HEART_RATE_NDJSON_MAX_LINE_LENGTH + 1))).toEqual([])
    expect(decoder.push('\n{"v":1,"kind":"status"}\n')).toEqual([
      { v: 1, kind: 'status' },
    ])
  })

  it('validates the canonical source key and seven-digit alias', () => {
    expect(parseHeartRateEvent(event)).toEqual(event)
    expect(parseHeartRateEvent({ ...event, source_key: 'CL830:000B738E' })).toBeNull()
    expect(parseHeartRateEvent({
      ...event,
      aliases: { ...event.aliases, be_decimal_min7: '2389900032' },
    })).toBeNull()
    expect(parseHeartRateEvent({
      ...event,
      aliases: { ...event.aliases, le_decimal: '2389900032' },
    })).toBeNull()
    expect(parseGatewayMessage({ v: '1', kind: 'status' })).toBeNull()
  })

  it('matches only the exact seven-digit big-endian alias', () => {
    expect(findMappedStudentNumber(event, [
      { student_no: 1, device_id: '0750478' },
    ])).toBe(1)
    expect(findMappedStudentNumber(event, [
      { student_no: 1, device_id: '750478' },
      { student_no: 2, device_id: '2389904128' },
      { student_no: 3, device_id: 'cl830:000b738e' },
    ])).toBeNull()
    expect(findMappedStudentNumber(event, [
      { student_no: 1, device_id: '0750478' },
      { student_no: 2, device_id: '0750478' },
    ])).toBeNull()
  })

  it('preserves leading zeroes in canonical device IDs', () => {
    expect(isCanonicalHeartRateDeviceId('0750478')).toBe(true)
    expect(isCanonicalHeartRateDeviceId('750478')).toBe(false)
    expect(isCanonicalHeartRateDeviceId('2389904128')).toBe(false)
  })

  it('rejects events from another boot, run, or non-increasing sequence', () => {
    expect(isHeartRateEventForRun(event, { bootId: 'boot-1', runId: 'run-1', lastSequence: 0 })).toBe(true)
    expect(isHeartRateEventForRun(event, { bootId: 'other', runId: 'run-1', lastSequence: 0 })).toBe(false)
    expect(isHeartRateEventForRun(event, { bootId: 'boot-1', runId: 'other', lastSequence: 0 })).toBe(false)
    expect(isHeartRateEventForRun(event, { bootId: 'boot-1', runId: 'run-1', lastSequence: 1 })).toBe(false)
    expect(isHeartRateEventForRun(
      { ...event, generation: 7 },
      { bootId: 'boot-1', runId: 'run-1', lastSequence: 0, generation: 7 },
    )).toBe(true)
    expect(isHeartRateEventForRun(
      { ...event, generation: 6 },
      { bootId: 'boot-1', runId: 'run-1', lastSequence: 0, generation: 7 },
    )).toBe(false)
  })

  it('retains the wire protocol range so quality gating remains a collector concern', () => {
    expect(parseHeartRateEvent({ ...event, bpm: 1 })).not.toBeNull()
    expect(parseHeartRateEvent({ ...event, bpm: 255 })).not.toBeNull()
    expect(parseHeartRateEvent({ ...event, bpm: 0 })).toBeNull()
    expect(parseHeartRateEvent({ ...event, bpm: 256 })).toBeNull()
  })

  it('accepts only the expected gateway capabilities and run-start acknowledgement', () => {
    const caps = {
      v: 1,
      kind: 'caps',
      product: 'ATV_CL830_WEB_SERIAL_GATEWAY',
      protocol: 1,
      state: 'ready',
      baud: 115200,
      rx_line_max: 255,
      lease_min_ms: 1000,
      lease_default_ms: 5000,
      lease_max_ms: 15000,
      gateway_id: 'gateway-1',
      boot_id: 'boot-1',
      capabilities: ['cl830_a1_a2', 'run_gate', 'heartbeat_lease', 'fresh_event_sequence'],
    }
    expect(isExpectedGatewayCaps(caps)).toBe(true)
    expect(isGatewayReadyCaps(caps)).toBe(true)
    expect(isExpectedGatewayCaps({ ...caps, state: 'running' })).toBe(true)
    expect(isGatewayReadyCaps({ ...caps, state: 'running' })).toBe(false)
    expect(isExpectedGatewayCaps({ ...caps, protocol: 2 })).toBe(false)
    expect(isExpectedGatewayCaps({ ...caps, capabilities: ['run_gate'] })).toBe(false)

    const ack = {
      v: 1,
      kind: 'ack',
      command: 'run_start',
      boot_id: 'boot-1',
      run_id: 'run-1',
      state: 'running',
      generation: 1,
      lease_remaining_ms: 4999,
    }
    expect(isExpectedRunStartAck(ack, { bootId: 'boot-1', runId: 'run-1' })).toBe(true)
    expect(isExpectedRunStartAck({ ...ack, boot_id: 'other' }, { bootId: 'boot-1', runId: 'run-1' })).toBe(false)
    expect(isExpectedRunStartAck({ ...ack, lease_remaining_ms: 0 }, { bootId: 'boot-1', runId: 'run-1' })).toBe(false)

    expect(isExpectedGatewayStatus({
      v: 1,
      kind: 'status',
      boot_id: 'boot-1',
      state: 'running',
      run_id: 'old-run',
      generation: 2,
      lease_remaining_ms: 2500,
    }, { bootId: 'boot-1' })).toBe(true)
    expect(isExpectedGatewayStatus({
      v: 1,
      kind: 'status',
      boot_id: 'boot-1',
      state: 'ready',
      generation: 2,
      lease_remaining_ms: 0,
    }, { bootId: 'boot-1' })).toBe(true)
  })

  it('aggregates samples and applies fresh, stale, and offline thresholds', () => {
    const first = addHeartRateSample(undefined, event, 1_000)
    const second = addHeartRateSample(first, { ...event, bpm: 108, seq: 2, battery_percent: null }, 2_000)

    expect(second).toMatchObject({
      currentBpm: 108,
      maxBpm: 108,
      minBpm: 92,
      totalBpm: 200,
      sampleCount: 2,
      batteryPercent: null,
    })
    expect(averageHeartRate(second)).toBe(100)
    expect(getHeartRateSignalState(second, 4_000)).toBe('fresh')
    expect(getHeartRateSignalState(second, 4_001)).toBe('stale')
    expect(getHeartRateSignalState(second, 7_000)).toBe('stale')
    expect(getHeartRateSignalState(second, 7_001)).toBe('offline')
    expect(currentHeartRateForSignal(second, 'fresh')).toBe(108)
    expect(currentHeartRateForSignal(second, 'stale')).toBeNull()
    expect(currentHeartRateForSignal(second, 'offline')).toBeNull()
  })
})
