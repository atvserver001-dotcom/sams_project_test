import { describe, expect, it } from 'vitest'
import { createHeartRateStatsCollector } from '../heartRateCollector'
import { deriveHeartRateZone, derivePredictedMaxBpm, type HeartRateSessionPayload } from '../heartRateSession'
import type { GatewayHeartRateEvent, HeartRateDeviceMapping } from '../heartRateSerial'
import { appendAcceptedSample, createSerialDisplay, createSerialDisplaySlots, getSerialDisplaySlotState, syncSerialDisplay } from './serial-display'
import { createSession, windowSamples } from './session'
import { zoneOf } from './zones'

const event = (bpm: number, seq: number): GatewayHeartRateEvent => ({
  v: 1, kind: 'heart_rate', boot_id: 'boot', run_id: 'run', source_key: 'sensor',
  aliases: { be_decimal: '750478', be_decimal_min7: '0750478', le_decimal: '2389904128' },
  bpm, battery_percent: 80, seq, fresh: true,
})
const display = () => createSession({ schoolId: 'test', year: 2026, grade: 1, class_no: 1, schoolType: 1,
  students: [{ id: 'student-1', no: 1, name: '테스트 학생', age: 7, estimatedAge: true, device_id: '0750478' }],
}, 1000)

const sparsePayload = (): HeartRateSessionPayload => {
  const studentNumbers = [1, 4, 6, 10, 11]
  return {
    session: {
      id: 'session', client_request_id: 'request', academic_year: 2026, grade: 1, class_no: 1,
      school_type: 1, age_years: 7, age_source: 'school_type_grade_proxy', age_policy_version: 'school_grade_age_v1',
      zone_policy_version: 'aha_youth_relative_v1', quality_policy_version: 'cl830_stable_5s_5samples_v1',
      stabilization_seconds: 5, stabilization_min_samples: 5, stabilization_max_gap_ms: 2000,
      valid_bpm_min: 40, valid_bpm_max: 220, bucket_seconds: 60, status: 'recording',
      started_at: '2026-09-07T00:00:00.000Z', measurement_started_at: null, stable_started_at: null,
      gateway_run_id: null, transport_received_event_count: 0, transport_sequence_gap_count: 0,
      transport_rejected_sequence_count: 0, transport_last_event_at: null, stopped_at: null, finalized_at: null,
    },
    participants: studentNumbers.map((studentNumber) => ({
      participant_id: `participant-${studentNumber}`, student_id: `student-${studentNumber}`,
      student_no: studentNumber, name: `${studentNumber}번 학생`, age_years: 7,
      age_source: 'school_type_grade_proxy', age_policy_version: 'school_grade_age_v1', predicted_max_bpm: 213,
    })),
    points: [], results: [],
  }
}

describe('serial display follows the authoritative collector', () => {
  it('keeps sparse session participants real while creating 30 UI-only slots', () => {
    const payload = sparsePayload()
    const mappings: HeartRateDeviceMapping[] = [
      { student_no: 1, device_id: '0750478' },
      { student_no: 2, device_id: '0750479' },
    ]
    const payloadBefore = structuredClone(payload)
    const mappingsBefore = structuredClone(mappings)
    const plot = createSerialDisplay(payload, mappings, {
      schoolId: 'school', year: 2026, grade: 1, class_no: 1, schoolType: 1,
    }, 1000)
    const slots = createSerialDisplaySlots(plot.students)

    expect(plot.students).toHaveLength(5)
    expect(slots).toHaveLength(30)
    expect(slots.map((slot) => slot.no)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1))
    expect(slots.filter((slot) => slot.live !== null)).toHaveLength(5)
    expect(slots[0].live?.participant).toMatchObject({ id: 'student-1', device_id: '0750478' })
    expect(slots[1].live).toBeNull()
    expect(plot.students.find((student) => student.participant.no === 4)?.participant.device_id).toBe('')
    expect(getSerialDisplaySlotState(slots[1].live)).toBe('unregistered')
    expect(getSerialDisplaySlotState(slots[3].live)).toBe('unassigned')
    expect(getSerialDisplaySlotState(slots[0].live)).toBe('waiting')
    slots[0].live!.lastSeenAt = 2000
    expect(getSerialDisplaySlotState(slots[0].live)).toBe('no-signal')
    slots[0].live!.cur = 100
    expect(getSerialDisplaySlotState(slots[0].live)).toBe('live')
    expect(payload).toEqual(payloadBefore)
    expect(mappings).toEqual(mappingsBefore)
  })

  it('omits warmup and rejected samples and preserves accepted extrema', () => {
    const collector = createHeartRateStatsCollector()
    const plot = display()
    collector.begin({ startedAt: 1000, studentNumbers: [1] })
    for (let index = 0; index < 5; index++) {
      const sample = event(90 + index, index)
      const time = 1000 + index * 1250
      appendAcceptedSample(plot, 1, sample, time, collector.addSample(1, sample, time))
    }
    const invalid = event(221, 5)
    expect(appendAcceptedSample(plot, 1, invalid, 6100, collector.addSample(1, invalid, 6100))).toBe(false)
    syncSerialDisplay(plot, collector.measurementSnapshot(6100), 6100)
    expect(plot.students[0].agg).toMatchObject({ min: 94, max: 94, sum: 94, n: 1 })
    expect(windowSamples(plot.students[0]).filter(sample => sample.bpm !== null).map(sample => sample.bpm)).toEqual([94])
  })

  it('shows stale current values as missing without changing saved statistics', () => {
    const collector = createHeartRateStatsCollector()
    const plot = display()
    collector.begin({ startedAt: 1000, studentNumbers: [1] })
    for (let index = 0; index < 6; index++) {
      const sample = event(100, index)
      const time = 1000 + index * 1250
      appendAcceptedSample(plot, 1, sample, time, collector.addSample(1, sample, time))
    }
    syncSerialDisplay(plot, collector.advance(10000), 10000)
    expect(plot.students[0].cur).toBeNull()
    expect(plot.students[0].agg.n).toBe(2)
    expect(windowSamples(plot.students[0]).at(-1)?.bpm).toBeNull()
  })

  it('uses the same age and decimal zone boundaries as the server', () => {
    for (let age = 7; age <= 18; age++) {
      const maximum = derivePredictedMaxBpm(age)
      for (let bpm = 40; bpm <= 220; bpm += 0.5) {
        expect(zoneOf(bpm, age).key).toBe(deriveHeartRateZone(bpm, maximum))
      }
    }
  })
})
