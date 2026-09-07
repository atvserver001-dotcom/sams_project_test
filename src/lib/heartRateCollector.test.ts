import { describe, expect, it } from 'vitest'

import { GatewayHeartRateEvent } from './heartRateSerial'
import {
  HEART_RATE_COMMON_WARMUP_MS,
  createHeartRateStatsCollector,
} from './heartRateCollector'

const event = (
  bpm: number,
  seq: number,
  overrides: Partial<GatewayHeartRateEvent> = {},
): GatewayHeartRateEvent => ({
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
  bpm,
  battery_percent: 81,
  rssi_dbm: -63,
  seq,
  fresh: true,
  ...overrides,
})

const warmSensor = (
  collector: ReturnType<typeof createHeartRateStatsCollector>,
  studentNumber: number,
  sequenceStart = 1,
  startedAt = 1_000,
) => {
  const offsets = [0, 1_250, 2_500, 3_750, 5_000]
  return offsets.map((offset, index) => collector.addSample(
    studentNumber,
    event(90 + index, sequenceStart + index),
    startedAt + offset,
  ))
}

describe('heart-rate measurement collector', () => {
  it('excludes warmup values and publishes immutable accepted statistics', () => {
    const collector = createHeartRateStatsCollector()
    collector.begin({ startedAt: 1_000, studentNumbers: [1] })

    expect(warmSensor(collector, 1)).toEqual([false, false, false, false, true])
    const firstSnapshot = collector.snapshot()
    expect(firstSnapshot[1]).toMatchObject({
      currentBpm: 94,
      maxBpm: 94,
      minBpm: 94,
      totalBpm: 94,
      sampleCount: 1,
    })

    expect(collector.addSample(1, event(110, 6, { battery_percent: null }), 6_250)).toBe(true)
    expect(firstSnapshot[1]).toMatchObject({ currentBpm: 94, sampleCount: 1 })
    expect(collector.snapshot()[1]).toMatchObject({
      currentBpm: 110,
      maxBpm: 110,
      minBpm: 94,
      totalBpm: 204,
      sampleCount: 2,
      batteryPercent: null,
    })
  })

  it('keeps the wire range separate from the accepted CL830 measurement range', () => {
    const collector = createHeartRateStatsCollector()
    collector.begin({ startedAt: 1_000, studentNumbers: [1] })

    expect(collector.addSample(1, event(39, 1), 1_000)).toBe(false)
    expect(collector.addSample(1, event(221, 2), 1_250)).toBe(false)
    expect(collector.snapshot()).toEqual({})
    expect(collector.measurementSnapshot(1_250).qualityByStudentNumber[1]).toMatchObject({
      phase: 'connecting',
      rejectedOutOfRangeCount: 2,
      acceptedSampleCount: 0,
    })
  })

  it('keeps gateway sequence diagnostics at run level instead of assigning gaps to a student', () => {
    const collector = createHeartRateStatsCollector()
    collector.begin({ startedAt: 1_000, studentNumbers: [1, 2] })
    collector.updateTransportQuality({
      receivedEventCount: 17,
      sequenceGapCount: 3,
      rejectedSequenceCount: 1,
      lastEventAt: 2_000,
    })
    collector.updateTransportQuality({
      receivedEventCount: 12,
      sequenceGapCount: 1,
      rejectedSequenceCount: 0,
      lastEventAt: 1_500,
    })

    const measurement = collector.measurementSnapshot(2_000)
    expect(measurement.transportQuality).toEqual({
      receivedEventCount: 17,
      sequenceGapCount: 3,
      rejectedSequenceCount: 1,
      lastEventAt: 2_000,
    })
    expect(measurement.qualityByStudentNumber[1]).not.toHaveProperty('sequenceGapCount')
    expect(measurement.qualityByStudentNumber[2]).not.toHaveProperty('sequenceGapCount')
  })

  it('uses the run ACK clock for absolute one-minute buckets and idempotent checkpoints', () => {
    const collector = createHeartRateStatsCollector()
    collector.begin({ startedAt: 1_000, studentNumbers: [1] })
    warmSensor(collector, 1)

    expect(collector.measurementSnapshot(6_000).stableStartedAt).toBe(
      1_000 + HEART_RATE_COMMON_WARMUP_MS,
    )
    let sequence = 5
    for (const receivedAt of [11_000, 16_000, 21_000, 26_000, 31_000, 36_000, 41_000, 46_000, 51_000, 56_000, 61_000, 65_000]) {
      sequence += 1
      expect(collector.addSample(1, event(106, sequence), receivedAt)).toBe(true)
    }

    const firstCheckpoint = collector.checkpoint(0, 65_000)
    expect(firstCheckpoint.points).toHaveLength(1)
    expect(firstCheckpoint.points[0]).toMatchObject({
      minuteIndex: 1,
      bucketStartedAt: 6_000,
      bucketEndedAt: 65_000,
      bpmSum: 1366,
      sampleCount: 13,
      averageBpm: 105.1,
      minBpm: 94,
      maxBpm: 106,
      isPartial: true,
    })

    collector.advance(66_000)
    const finalizedCheckpoint = collector.checkpoint(firstCheckpoint.revision, 66_000)
    expect(finalizedCheckpoint.points).toHaveLength(1)
    expect(finalizedCheckpoint.points[0]).toMatchObject({
      minuteIndex: 1,
      bucketEndedAt: 66_000,
      isPartial: false,
    })
    expect(collector.checkpoint(finalizedCheckpoint.revision, 66_000).points).toEqual([])

    expect(collector.addSample(1, event(120, sequence + 1), 66_000)).toBe(true)
    expect(collector.measurementSnapshot(66_000).minutePointsByStudentNumber[1][1]).toMatchObject({
      minuteIndex: 2,
      bpmSum: 120,
      sampleCount: 1,
      isPartial: true,
    })
  })

  it('requires a fresh warmup after a sensor has been offline for more than five seconds', () => {
    const collector = createHeartRateStatsCollector()
    collector.begin({ startedAt: 1_000, studentNumbers: [1] })
    warmSensor(collector, 1)

    expect(collector.advance(11_001).sensorStatesByStudentNumber[1]).toBe('offline')
    expect(collector.addSample(1, event(100, 6), 11_010)).toBe(false)
    expect(collector.measurementSnapshot(11_010).sensorStatesByStudentNumber[1]).toBe('stabilizing')

    for (const [index, offset] of [1_250, 2_500, 3_750, 5_000].entries()) {
      collector.addSample(1, event(101 + index, 7 + index), 11_010 + offset)
    }
    expect(collector.snapshot()[1]).toMatchObject({ sampleCount: 2, currentBpm: 104 })
    expect(collector.measurementSnapshot(16_010).qualityByStudentNumber[1]).toMatchObject({
      phase: 'live',
      acceptedSampleCount: 2,
      offlineCount: 1,
    })
  })

  it('freezes an unfinished minute exactly once and never changes it after stop', () => {
    const collector = createHeartRateStatsCollector()
    collector.begin({ startedAt: 1_000, studentNumbers: [1] })
    warmSensor(collector, 1)
    const beforeFreezeRevision = collector.revision()

    const frozen = collector.freezeMeasurement(30_000)
    expect(frozen.collecting).toBe(false)
    expect(frozen.minutePointsByStudentNumber[1][0]).toMatchObject({
      minuteIndex: 1,
      bucketEndedAt: 30_000,
      isPartial: true,
    })
    expect(collector.checkpoint(beforeFreezeRevision, 30_000).points).toHaveLength(1)
    expect(collector.addSample(1, event(120, 6), 30_100)).toBe(false)
    expect(collector.advance(100_000)).toEqual(collector.measurementSnapshot(100_000))
    expect(collector.measurementSnapshot(100_000).capturedAt).toBe(30_000)
  })

  it('retains accepted samples for thirty independent sensor slots between UI flushes', () => {
    const collector = createHeartRateStatsCollector()
    const studentNumbers = Array.from({ length: 30 }, (_, index) => index + 1)
    collector.begin({ startedAt: 1_000, studentNumbers })

    let sequence = 0
    for (const receivedAt of [1_000, 2_250, 3_500, 4_750, 6_000]) {
      for (const studentNumber of studentNumbers) {
        sequence += 1
        collector.addSample(studentNumber, event(70 + studentNumber, sequence), receivedAt)
      }
    }
    for (let round = 0; round < 100; round += 1) {
      for (const studentNumber of studentNumbers) {
        sequence += 1
        collector.addSample(
          studentNumber,
          event(70 + studentNumber, sequence),
          6_100 + round * 30 + studentNumber,
        )
      }
    }

    const snapshot = collector.snapshot()
    expect(Object.keys(snapshot)).toHaveLength(30)
    for (const studentNumber of studentNumbers) {
      expect(snapshot[studentNumber].sampleCount).toBe(101)
    }
  })

  it('ignores events before begin and clears all state for a new run', () => {
    const collector = createHeartRateStatsCollector()
    expect(collector.addSample(1, event(90, 1), 1_000)).toBe(false)

    collector.begin({ startedAt: 1_000, studentNumbers: [1] })
    warmSensor(collector, 1)
    expect(collector.snapshot()[1]).toBeDefined()

    collector.begin({ startedAt: 20_000, studentNumbers: [2] })
    expect(collector.snapshot()).toEqual({})
    expect(collector.revision()).toBe(0)
    expect(collector.measurementSnapshot(20_000).sensorStatesByStudentNumber).toEqual({ 2: 'connecting' })

    collector.reset()
    expect(collector.isCollecting()).toBe(false)
    expect(collector.snapshot()).toEqual({})
  })
})
