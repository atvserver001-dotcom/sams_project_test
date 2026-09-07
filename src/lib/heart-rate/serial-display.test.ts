import { describe, expect, it } from 'vitest'
import { createHeartRateStatsCollector } from '../heartRateCollector'
import { deriveHeartRateZone, derivePredictedMaxBpm } from '../heartRateSession'
import type { GatewayHeartRateEvent } from '../heartRateSerial'
import { appendAcceptedSample, syncSerialDisplay } from './serial-display'
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

describe('serial display follows the authoritative collector', () => {
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
