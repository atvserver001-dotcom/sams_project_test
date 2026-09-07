import { describe, expect, it } from 'vitest'

import {
  deriveGradeProxyAge,
  deriveHeartRateZone,
  derivePredictedMaxBpm,
  serializeHeartRateTransportQuality,
  serializeHeartRateMinutePoint,
  validateHeartRateSessionAction,
  validateStartHeartRateSessionRequest,
} from './heartRateSession'

const participantId = '123e4567-e89b-12d3-a456-426614174000'
const transportQuality = () => ({
  received_event_count: 5,
  sequence_gap_count: 1,
  rejected_sequence_count: 0,
  last_event_at: '2026-08-20T07:00:05.123Z',
})

const point = () => ({
  participant_id: participantId,
  minute_index: 1,
  revision: 1,
  duration_ms: 12_000,
  bpm_sum: 500,
  sample_count: 5,
  min_bpm: 90,
  max_bpm: 110,
  is_partial: true,
  rssi_sample_count: 5,
  average_rssi_dbm: -60,
  min_rssi_dbm: -65,
  max_rssi_dbm: -55,
  battery_percent: 72,
})

describe('school grade proxy age policy', () => {
  it.each([
    [1, 1, 7],
    [1, 6, 12],
    [2, 1, 13],
    [2, 3, 15],
    [3, 1, 16],
    [3, 3, 18],
  ] as const)('derives school type %i grade %i as age %i', (schoolType, grade, expectedAge) => {
    expect(deriveGradeProxyAge(schoolType, grade)).toBe(expectedAge)
  })

  it('rejects a grade that does not exist for the school type', () => {
    expect(() => deriveGradeProxyAge(2, 4)).toThrow(RangeError)
    expect(() => deriveGradeProxyAge(3, 6)).toThrow(RangeError)
  })

  it('calculates the versioned predicted maximum and four relative zones', () => {
    const predictedMaximum = derivePredictedMaxBpm(7)
    expect(predictedMaximum).toBe(203.1)
    expect(deriveHeartRateZone(100, predictedMaximum)).toBe('low')
    expect(deriveHeartRateZone(130, predictedMaximum)).toBe('moderate')
    expect(deriveHeartRateZone(170, predictedMaximum)).toBe('high')
    expect(deriveHeartRateZone(200, predictedMaximum)).toBe('near_max')
  })

  it('serializes the hook transport snapshot without assigning gaps to a student', () => {
    expect(serializeHeartRateTransportQuality({
      receivedEventCount: 5,
      sequenceGapCount: 2,
      rejectedSequenceCount: 1,
      lastEventAt: Date.parse('2026-08-20T07:00:05.123Z'),
    })).toEqual({
      received_event_count: 5,
      sequence_gap_count: 2,
      rejected_sequence_count: 1,
      last_event_at: '2026-08-20T07:00:05.123Z',
    })
  })

  it('serializes a collector minute point using only its session participant identity', () => {
    expect(serializeHeartRateMinutePoint(participantId, {
      minuteIndex: 1,
      revision: 3,
      bucketStartedAt: 5_000,
      bucketEndedAt: 17_000,
      bpmSum: 500,
      sampleCount: 5,
      minBpm: 90,
      maxBpm: 110,
      isPartial: true,
      quality: {
        rssiSampleCount: 5,
        averageRssiDbm: -60,
        minRssiDbm: -65,
        maxRssiDbm: -55,
        batteryPercent: 72,
      },
    })).toEqual({
      ...point(),
      revision: 3,
    })
  })

  it('serializes a completed minute as exactly 60000ms', () => {
    expect(serializeHeartRateMinutePoint(participantId, {
      minuteIndex: 1,
      revision: 4,
      bucketStartedAt: 5_000,
      bucketEndedAt: 65_000,
      bpmSum: 500,
      sampleCount: 5,
      minBpm: 90,
      maxBpm: 110,
      isPartial: false,
      quality: {
        rssiSampleCount: 0,
        averageRssiDbm: null,
        minRssiDbm: null,
        maxRssiDbm: null,
        batteryPercent: null,
      },
    }).duration_ms).toBe(60_000)
  })

  it('does not fabricate a positive duration from an invalid browser bucket window', () => {
    expect(() => serializeHeartRateMinutePoint(participantId, {
      minuteIndex: 1,
      revision: 4,
      bucketStartedAt: 17_000,
      bucketEndedAt: 5_000,
      bpmSum: 500,
      sampleCount: 5,
      minBpm: 90,
      maxBpm: 110,
      isPartial: true,
      quality: {
        rssiSampleCount: 0,
        averageRssiDbm: null,
        minRssiDbm: null,
        maxRssiDbm: null,
        batteryPercent: null,
      },
    })).toThrow(/실제 측정 시간/)
  })
})

describe('heart-rate session request validation', () => {
  it('accepts start identity and class fields while stripping untrusted age fields', () => {
    expect(validateStartHeartRateSessionRequest({
      client_request_id: '123e4567-e89b-12d3-a456-426614174001',
      academic_year: 2026,
      grade: 1,
      class_no: 1,
      age_years: 99,
      school_type: 3,
    })).toEqual({
      ok: true,
      value: {
        client_request_id: '123e4567-e89b-12d3-a456-426614174001',
        academic_year: 2026,
        grade: 1,
        class_no: 1,
      },
    })
  })

  it('validates stabilize and requires a gateway run identifier', () => {
    expect(validateHeartRateSessionAction({
      action: 'stabilize',
      gateway_run_id: 'run_m4kr2_1',
      run_started_at: '2026-08-20T07:00:00.123Z',
    })).toEqual({
      ok: true,
      value: {
        action: 'stabilize',
        gateway_run_id: 'run_m4kr2_1',
        run_started_at: '2026-08-20T07:00:00.123Z',
      },
    })
    expect(validateHeartRateSessionAction({ action: 'stabilize' })).toMatchObject({ ok: false })
    expect(validateHeartRateSessionAction({
      action: 'stabilize',
      gateway_run_id: 'run_m4kr2_1',
      run_started_at: 'not-a-date',
    })).toMatchObject({ ok: false })
  })

  it('normalizes an absolute checkpoint snapshot', () => {
    expect(validateHeartRateSessionAction({
      action: 'checkpoint',
      points: [point()],
      transport_quality: transportQuality(),
    })).toEqual({
      ok: true,
      value: { action: 'checkpoint', points: [point()], transport_quality: transportQuality() },
    })
  })

  it.each([
    ['zero-duration partial minute', { ...point(), duration_ms: 0 }],
    ['overlong partial minute', { ...point(), duration_ms: 60_001 }],
    ['short completed minute', { ...point(), duration_ms: 59_999, is_partial: false }],
  ])('rejects %s', (_name, invalidPoint) => {
    expect(validateHeartRateSessionAction({
      action: 'checkpoint',
      points: [invalidPoint],
      transport_quality: transportQuality(),
    })).toMatchObject({ ok: false })
  })

  it('accepts partial-minute durations from 1ms through 60000ms', () => {
    for (const durationMs of [1, 12_000, 60_000]) {
      expect(validateHeartRateSessionAction({
        action: 'checkpoint',
        points: [{ ...point(), duration_ms: durationMs }],
        transport_quality: transportQuality(),
      })).toMatchObject({ ok: true })
    }
  })

  it('accepts an empty stop snapshot for a session with no stabilized sensor', () => {
    const emptyTransportQuality = {
      received_event_count: 0,
      sequence_gap_count: 0,
      rejected_sequence_count: 0,
      last_event_at: null,
    }
    expect(validateHeartRateSessionAction({
      action: 'stop',
      points: [],
      transport_quality: emptyTransportQuality,
    })).toEqual({
      ok: true,
      value: { action: 'stop', points: [], transport_quality: emptyTransportQuality },
    })
  })

  it('keeps regular checkpoints small while allowing the full stop snapshot', () => {
    const points = Array.from({ length: 61 }, (_, index) => ({
      ...point(),
      minute_index: index + 1,
    }))
    expect(validateHeartRateSessionAction({
      action: 'checkpoint',
      points,
      transport_quality: transportQuality(),
    })).toMatchObject({ ok: false })
    expect(validateHeartRateSessionAction({
      action: 'stop',
      points,
      transport_quality: transportQuality(),
    })).toMatchObject({ ok: true })
  })

  it.each([
    ['student identity instead of participant identity', () => ({ ...point(), participant_id: undefined, student_id: participantId })],
    ['out-of-range BPM', () => ({ ...point(), max_bpm: 221 })],
    ['inconsistent sum', () => ({ ...point(), bpm_sum: 800 })],
    ['missing RSSI average', () => ({ ...point(), average_rssi_dbm: null, rssi_sample_count: 5 })],
    ['invalid battery', () => ({ ...point(), battery_percent: 101 })],
  ])('rejects %s', (_name, makePoint) => {
    expect(validateHeartRateSessionAction({
      action: 'checkpoint',
      points: [makePoint()],
      transport_quality: transportQuality(),
    })).toMatchObject({ ok: false })
  })

  it('rejects duplicate participant/minute entries in a batch', () => {
    expect(validateHeartRateSessionAction({
      action: 'checkpoint',
      points: [point(), point()],
      transport_quality: transportQuality(),
    })).toMatchObject({ ok: false })
  })

  it('rejects inconsistent session-level transport quality', () => {
    expect(validateHeartRateSessionAction({
      action: 'checkpoint',
      points: [point()],
      transport_quality: { ...transportQuality(), received_event_count: 0 },
    })).toMatchObject({ ok: false })
  })
})
