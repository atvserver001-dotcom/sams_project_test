import {
  GatewayHeartRateEvent,
  HEART_RATE_FRESH_MS,
  HEART_RATE_OFFLINE_MS,
  HEART_RATE_SENSOR_MAX_BPM,
  HEART_RATE_SENSOR_MIN_BPM,
  HeartRateTransportQuality,
  LiveHeartRateStats,
  addHeartRateSample,
} from './heartRateSerial'

export const HEART_RATE_COMMON_WARMUP_MS = 5_000
export const HEART_RATE_SENSOR_WARMUP_MS = 5_000
export const HEART_RATE_SENSOR_WARMUP_SAMPLE_COUNT = 5
export const HEART_RATE_SENSOR_WARMUP_MAX_GAP_MS = 2_000
export const HEART_RATE_MINUTE_BUCKET_MS = 60_000

export type HeartRateStatsByStudentNumber = Record<number, LiveHeartRateStats>
export type HeartRateSensorPhase = 'connecting' | 'stabilizing' | 'live' | 'stale' | 'offline'

export interface HeartRateMinutePointQuality {
  rssiSampleCount: number
  averageRssiDbm: number | null
  minRssiDbm: number | null
  maxRssiDbm: number | null
  batteryPercent: number | null
}

export interface HeartRateMinutePoint {
  studentNumber: number
  minuteIndex: number
  bucketStartedAt: number
  bucketEndedAt: number
  bpmSum: number
  sampleCount: number
  averageBpm: number
  minBpm: number
  maxBpm: number
  isPartial: boolean
  revision: number
  quality: HeartRateMinutePointQuality
}

export interface HeartRateStudentQuality {
  phase: HeartRateSensorPhase
  warmupStartedAt: number | null
  warmupSampleCount: number
  lastRawReceivedAt: number | null
  lastValidReceivedAt: number | null
  lastAcceptedAt: number | null
  acceptedSampleCount: number
  rejectedOutOfRangeCount: number
  rejectedTimestampCount: number
  warmupResetCount: number
  offlineCount: number
  latestBatteryPercent: number | null
  latestRssiDbm: number | null
}

export interface HeartRateMeasurementView {
  startedAt: number
  stableStartedAt: number
  capturedAt: number
  collecting: boolean
  revision: number
  completedMinuteCount: number
  statsByStudentNumber: HeartRateStatsByStudentNumber
  sensorStatesByStudentNumber: Record<number, HeartRateSensorPhase>
  minutePointsByStudentNumber: Record<number, HeartRateMinutePoint[]>
  qualityByStudentNumber: Record<number, HeartRateStudentQuality>
  transportQuality: HeartRateTransportQuality
}

export interface HeartRateCheckpoint {
  revision: number
  capturedAt: number
  startedAt: number
  stableStartedAt: number
  points: HeartRateMinutePoint[]
  qualityByStudentNumber: Record<number, HeartRateStudentQuality>
  transportQuality: HeartRateTransportQuality
}

export interface HeartRateCollectorBeginOptions {
  /** run_start ACK 수신 시각. 모든 학생 그래프의 공통 기준 시각이다. */
  startedAt?: number
  studentNumbers?: readonly number[]
}

export interface HeartRateStatsCollector {
  begin(options?: HeartRateCollectorBeginOptions): void
  addSample(studentNumber: number, event: GatewayHeartRateEvent, receivedAt: number): boolean
  advance(now: number): HeartRateMeasurementView
  freeze(now?: number): HeartRateStatsByStudentNumber
  freezeMeasurement(now?: number): HeartRateMeasurementView
  snapshot(): HeartRateStatsByStudentNumber
  measurementSnapshot(now?: number): HeartRateMeasurementView
  checkpoint(afterRevision?: number, now?: number): HeartRateCheckpoint
  updateTransportQuality(quality: HeartRateTransportQuality): void
  reset(): void
  revision(): number
  isCollecting(): boolean
}

type MutableStudentQuality = HeartRateStudentQuality

interface MutableMinutePoint {
  studentNumber: number
  minuteIndex: number
  bucketStartedAt: number
  nominalBucketEndedAt: number
  bpmSum: number
  sampleCount: number
  minBpm: number
  maxBpm: number
  isPartial: boolean
  revision: number
  rssiSum: number
  rssiSampleCount: number
  minRssiDbm: number | null
  maxRssiDbm: number | null
  batteryPercent: number | null
}

const isValidTimestamp = (value: number) => Number.isFinite(value) && value >= 0
const roundOne = (value: number) => Math.round(value * 10) / 10

const createStudentQuality = (): MutableStudentQuality => ({
  phase: 'connecting',
  warmupStartedAt: null,
  warmupSampleCount: 0,
  lastRawReceivedAt: null,
  lastValidReceivedAt: null,
  lastAcceptedAt: null,
  acceptedSampleCount: 0,
  rejectedOutOfRangeCount: 0,
  rejectedTimestampCount: 0,
  warmupResetCount: 0,
  offlineCount: 0,
  latestBatteryPercent: null,
  latestRssiDbm: null,
})

const cloneStats = (stats: HeartRateStatsByStudentNumber): HeartRateStatsByStudentNumber => {
  const snapshot: HeartRateStatsByStudentNumber = {}
  for (const [studentNumber, value] of Object.entries(stats)) {
    snapshot[Number(studentNumber)] = { ...value }
  }
  return snapshot
}

const cloneQuality = (
  qualities: Record<number, MutableStudentQuality>,
): Record<number, HeartRateStudentQuality> => {
  const snapshot: Record<number, HeartRateStudentQuality> = {}
  for (const [studentNumber, value] of Object.entries(qualities)) {
    snapshot[Number(studentNumber)] = { ...value }
  }
  return snapshot
}

const cloneMinutePoint = (
  point: MutableMinutePoint,
  capturedAt: number,
  frozenAt: number | null,
): HeartRateMinutePoint => {
  const partialEndedAt = Math.min(frozenAt ?? capturedAt, point.nominalBucketEndedAt)
  return {
    studentNumber: point.studentNumber,
    minuteIndex: point.minuteIndex,
    bucketStartedAt: point.bucketStartedAt,
    bucketEndedAt: point.isPartial ? partialEndedAt : point.nominalBucketEndedAt,
    bpmSum: point.bpmSum,
    sampleCount: point.sampleCount,
    averageBpm: roundOne(point.bpmSum / point.sampleCount),
    minBpm: point.minBpm,
    maxBpm: point.maxBpm,
    isPartial: point.isPartial,
    revision: point.revision,
    quality: {
      rssiSampleCount: point.rssiSampleCount,
      averageRssiDbm: point.rssiSampleCount > 0
        ? roundOne(point.rssiSum / point.rssiSampleCount)
        : null,
      minRssiDbm: point.minRssiDbm,
      maxRssiDbm: point.maxRssiDbm,
      batteryPercent: point.batteryPercent,
    },
  }
}

export function createHeartRateStatsCollector(): HeartRateStatsCollector {
  let collecting = false
  let currentRevision = 0
  let startedAt = 0
  let stableStartedAt = HEART_RATE_COMMON_WARMUP_MS
  let frozenAt: number | null = null
  let stats: HeartRateStatsByStudentNumber = {}
  let qualities: Record<number, MutableStudentQuality> = {}
  let minutePoints: Record<number, Map<number, MutableMinutePoint>> = {}
  let transportQuality: HeartRateTransportQuality = {
    receivedEventCount: 0,
    sequenceGapCount: 0,
    rejectedSequenceCount: 0,
    lastEventAt: null,
  }

  const bumpRevision = () => {
    currentRevision += 1
    return currentRevision
  }

  const ensureStudent = (studentNumber: number) => {
    qualities[studentNumber] ??= createStudentQuality()
    minutePoints[studentNumber] ??= new Map<number, MutableMinutePoint>()
    return qualities[studentNumber]
  }

  const resetWarmup = (quality: MutableStudentQuality, nextPhase: HeartRateSensorPhase) => {
    if (quality.warmupSampleCount > 0 || quality.warmupStartedAt !== null) {
      quality.warmupResetCount += 1
    }
    quality.warmupStartedAt = null
    quality.warmupSampleCount = 0
    quality.phase = nextPhase
  }

  const updatePhases = (now: number) => {
    for (const quality of Object.values(qualities)) {
      const previousPhase = quality.phase

      if (quality.phase === 'live' || quality.phase === 'stale') {
        const lastAcceptedAt = quality.lastAcceptedAt
        const age = lastAcceptedAt === null ? Number.POSITIVE_INFINITY : Math.max(0, now - lastAcceptedAt)
        if (age > HEART_RATE_OFFLINE_MS) {
          quality.offlineCount += 1
          resetWarmup(quality, 'offline')
        } else if (age > HEART_RATE_FRESH_MS) {
          quality.phase = 'stale'
        } else {
          quality.phase = 'live'
        }
      } else if (
        quality.phase === 'stabilizing' &&
        quality.lastValidReceivedAt !== null &&
        now - quality.lastValidReceivedAt > HEART_RATE_SENSOR_WARMUP_MAX_GAP_MS
      ) {
        resetWarmup(quality, 'connecting')
      }

      if (quality.phase !== previousPhase) bumpRevision()
    }
  }

  const finalizeElapsedMinutePoints = (now: number) => {
    for (const points of Object.values(minutePoints)) {
      for (const point of points.values()) {
        if (point.isPartial && now >= point.nominalBucketEndedAt) {
          point.isPartial = false
          point.revision = bumpRevision()
        }
      }
    }
  }

  const advanceInternal = (now: number) => {
    const effectiveNow = Math.max(startedAt, now)
    updatePhases(effectiveNow)
    finalizeElapsedMinutePoints(effectiveNow)
    return effectiveNow
  }

  const createView = (capturedAt: number): HeartRateMeasurementView => {
    const minutePointsByStudentNumber: Record<number, HeartRateMinutePoint[]> = {}
    for (const [studentNumber, points] of Object.entries(minutePoints)) {
      minutePointsByStudentNumber[Number(studentNumber)] = [...points.values()]
        .sort((left, right) => left.minuteIndex - right.minuteIndex)
        .map((point) => cloneMinutePoint(point, capturedAt, frozenAt))
    }

    const qualityByStudentNumber = cloneQuality(qualities)
    const sensorStatesByStudentNumber: Record<number, HeartRateSensorPhase> = {}
    for (const [studentNumber, quality] of Object.entries(qualityByStudentNumber)) {
      sensorStatesByStudentNumber[Number(studentNumber)] = quality.phase
    }

    return {
      startedAt,
      stableStartedAt,
      capturedAt,
      collecting,
      revision: currentRevision,
      completedMinuteCount: Math.max(0, Math.floor((capturedAt - stableStartedAt) / HEART_RATE_MINUTE_BUCKET_MS)),
      statsByStudentNumber: cloneStats(stats),
      sensorStatesByStudentNumber,
      minutePointsByStudentNumber,
      qualityByStudentNumber,
      transportQuality: { ...transportQuality },
    }
  }

  const addMinuteSample = (
    studentNumber: number,
    event: GatewayHeartRateEvent,
    receivedAt: number,
  ) => {
    const minuteIndex = Math.floor((receivedAt - stableStartedAt) / HEART_RATE_MINUTE_BUCKET_MS) + 1
    const points = minutePoints[studentNumber]
    let point = points.get(minuteIndex)
    if (!point) {
      const bucketStartedAt = stableStartedAt + (minuteIndex - 1) * HEART_RATE_MINUTE_BUCKET_MS
      point = {
        studentNumber,
        minuteIndex,
        bucketStartedAt,
        nominalBucketEndedAt: bucketStartedAt + HEART_RATE_MINUTE_BUCKET_MS,
        bpmSum: 0,
        sampleCount: 0,
        minBpm: event.bpm,
        maxBpm: event.bpm,
        isPartial: true,
        revision: currentRevision,
        rssiSum: 0,
        rssiSampleCount: 0,
        minRssiDbm: null,
        maxRssiDbm: null,
        batteryPercent: event.battery_percent,
      }
      points.set(minuteIndex, point)
    }

    point.bpmSum += event.bpm
    point.sampleCount += 1
    point.minBpm = Math.min(point.minBpm, event.bpm)
    point.maxBpm = Math.max(point.maxBpm, event.bpm)
    point.batteryPercent = event.battery_percent
    if (event.rssi_dbm !== undefined) {
      point.rssiSum += event.rssi_dbm
      point.rssiSampleCount += 1
      point.minRssiDbm = point.minRssiDbm === null
        ? event.rssi_dbm
        : Math.min(point.minRssiDbm, event.rssi_dbm)
      point.maxRssiDbm = point.maxRssiDbm === null
        ? event.rssi_dbm
        : Math.max(point.maxRssiDbm, event.rssi_dbm)
    }
    point.revision = currentRevision
  }

  const freezeInternal = (now: number) => {
    if (collecting) {
      const effectiveNow = advanceInternal(now)
      collecting = false
      frozenAt = effectiveNow
      for (const points of Object.values(minutePoints)) {
        for (const point of points.values()) {
          if (point.isPartial) point.revision = bumpRevision()
        }
      }
      bumpRevision()
    }
  }

  return {
    begin(options = {}) {
      const nextStartedAt = options.startedAt ?? Date.now()
      if (!isValidTimestamp(nextStartedAt)) {
        throw new Error('측정 시작 시각이 올바르지 않습니다.')
      }

      collecting = true
      currentRevision = 0
      startedAt = nextStartedAt
      stableStartedAt = nextStartedAt + HEART_RATE_COMMON_WARMUP_MS
      frozenAt = null
      stats = {}
      qualities = {}
      minutePoints = {}
      transportQuality = {
        receivedEventCount: 0,
        sequenceGapCount: 0,
        rejectedSequenceCount: 0,
        lastEventAt: null,
      }

      for (const studentNumber of new Set(options.studentNumbers ?? [])) {
        if (Number.isInteger(studentNumber) && studentNumber > 0) ensureStudent(studentNumber)
      }
    },

    addSample(studentNumber, event, receivedAt) {
      if (!collecting || !Number.isInteger(studentNumber) || studentNumber <= 0 || !isValidTimestamp(receivedAt)) {
        return false
      }

      const quality = ensureStudent(studentNumber)
      if (quality.lastRawReceivedAt !== null && receivedAt < quality.lastRawReceivedAt) {
        quality.rejectedTimestampCount += 1
        bumpRevision()
        return false
      }

      quality.lastRawReceivedAt = receivedAt
      quality.latestBatteryPercent = event.battery_percent
      quality.latestRssiDbm = event.rssi_dbm ?? null
      transportQuality.receivedEventCount = Math.max(
        transportQuality.receivedEventCount,
        event.transport_received_event_count ?? 0,
      )
      transportQuality.sequenceGapCount = Math.max(
        transportQuality.sequenceGapCount,
        event.transport_sequence_gap_total ?? 0,
      )
      transportQuality.rejectedSequenceCount = Math.max(
        transportQuality.rejectedSequenceCount,
        event.transport_rejected_sequence_count ?? 0,
      )
      transportQuality.lastEventAt = Math.max(transportQuality.lastEventAt ?? 0, receivedAt)

      if (event.bpm < HEART_RATE_SENSOR_MIN_BPM || event.bpm > HEART_RATE_SENSOR_MAX_BPM) {
        quality.rejectedOutOfRangeCount += 1
        if (quality.phase === 'stabilizing') resetWarmup(quality, 'connecting')
        bumpRevision()
        return false
      }

      const wasOffline = quality.phase === 'offline' || (
        (quality.phase === 'live' || quality.phase === 'stale') &&
        quality.lastAcceptedAt !== null &&
        receivedAt - quality.lastAcceptedAt > HEART_RATE_OFFLINE_MS
      )
      if (wasOffline && quality.phase !== 'offline') {
        quality.offlineCount += 1
        resetWarmup(quality, 'offline')
      }

      if (quality.phase === 'live' || quality.phase === 'stale') {
        quality.lastValidReceivedAt = receivedAt
      } else {
        const warmupGap = quality.lastValidReceivedAt === null
          ? null
          : receivedAt - quality.lastValidReceivedAt
        if (
          quality.warmupStartedAt === null ||
          warmupGap === null ||
          warmupGap > HEART_RATE_SENSOR_WARMUP_MAX_GAP_MS
        ) {
          if (quality.warmupStartedAt !== null) quality.warmupResetCount += 1
          quality.warmupStartedAt = receivedAt
          quality.warmupSampleCount = 1
        } else {
          quality.warmupSampleCount += 1
        }
        quality.lastValidReceivedAt = receivedAt
        quality.phase = 'stabilizing'

        const sensorWarmupComplete =
          receivedAt - quality.warmupStartedAt >= HEART_RATE_SENSOR_WARMUP_MS &&
          quality.warmupSampleCount >= HEART_RATE_SENSOR_WARMUP_SAMPLE_COUNT
        if (!sensorWarmupComplete || receivedAt < stableStartedAt) {
          bumpRevision()
          return false
        }
      }

      quality.phase = 'live'
      quality.lastAcceptedAt = receivedAt
      quality.acceptedSampleCount += 1
      stats[studentNumber] = addHeartRateSample(stats[studentNumber], event, receivedAt)
      bumpRevision()
      addMinuteSample(studentNumber, event, receivedAt)
      return true
    },

    advance(now) {
      if (!isValidTimestamp(now)) throw new Error('측정 진행 시각이 올바르지 않습니다.')
      if (!collecting && frozenAt !== null) return createView(frozenAt)
      return createView(advanceInternal(now))
    },

    freeze(now = Date.now()) {
      if (!isValidTimestamp(now)) throw new Error('측정 종료 시각이 올바르지 않습니다.')
      freezeInternal(now)
      return cloneStats(stats)
    },

    freezeMeasurement(now = Date.now()) {
      if (!isValidTimestamp(now)) throw new Error('측정 종료 시각이 올바르지 않습니다.')
      freezeInternal(now)
      return createView(frozenAt ?? Math.max(startedAt, now))
    },

    snapshot() {
      return cloneStats(stats)
    },

    measurementSnapshot(now = frozenAt ?? Date.now()) {
      if (!isValidTimestamp(now)) throw new Error('측정 조회 시각이 올바르지 않습니다.')
      return createView(Math.max(startedAt, frozenAt ?? now))
    },

    checkpoint(afterRevision = 0, now = frozenAt ?? Date.now()) {
      if (!Number.isInteger(afterRevision) || afterRevision < 0) {
        throw new Error('체크포인트 리비전이 올바르지 않습니다.')
      }
      if (!isValidTimestamp(now)) throw new Error('체크포인트 시각이 올바르지 않습니다.')
      const capturedAt = collecting ? advanceInternal(now) : (frozenAt ?? Math.max(startedAt, now))
      const points: HeartRateMinutePoint[] = []
      for (const studentPoints of Object.values(minutePoints)) {
        for (const point of studentPoints.values()) {
          if (point.revision > afterRevision) {
            points.push(cloneMinutePoint(point, capturedAt, frozenAt))
          }
        }
      }
      points.sort((left, right) => (
        left.minuteIndex - right.minuteIndex || left.studentNumber - right.studentNumber
      ))

      return {
        revision: currentRevision,
        capturedAt,
        startedAt,
        stableStartedAt,
        points,
        qualityByStudentNumber: cloneQuality(qualities),
        transportQuality: { ...transportQuality },
      }
    },

    updateTransportQuality(nextQuality) {
      const countersAreValid = [
        nextQuality.receivedEventCount,
        nextQuality.sequenceGapCount,
        nextQuality.rejectedSequenceCount,
      ].every((value) => Number.isInteger(value) && value >= 0)
      if (!countersAreValid || !(
        nextQuality.lastEventAt === null || isValidTimestamp(nextQuality.lastEventAt)
      )) {
        throw new Error('USB 수신 품질 값이 올바르지 않습니다.')
      }

      const updated: HeartRateTransportQuality = {
        receivedEventCount: Math.max(transportQuality.receivedEventCount, nextQuality.receivedEventCount),
        sequenceGapCount: Math.max(transportQuality.sequenceGapCount, nextQuality.sequenceGapCount),
        rejectedSequenceCount: Math.max(
          transportQuality.rejectedSequenceCount,
          nextQuality.rejectedSequenceCount,
        ),
        lastEventAt: nextQuality.lastEventAt === null
          ? transportQuality.lastEventAt
          : Math.max(transportQuality.lastEventAt ?? 0, nextQuality.lastEventAt),
      }
      if (
        updated.receivedEventCount !== transportQuality.receivedEventCount ||
        updated.sequenceGapCount !== transportQuality.sequenceGapCount ||
        updated.rejectedSequenceCount !== transportQuality.rejectedSequenceCount ||
        updated.lastEventAt !== transportQuality.lastEventAt
      ) {
        transportQuality = updated
        bumpRevision()
      }
    },

    reset() {
      collecting = false
      currentRevision = 0
      startedAt = 0
      stableStartedAt = HEART_RATE_COMMON_WARMUP_MS
      frozenAt = null
      stats = {}
      qualities = {}
      minutePoints = {}
      transportQuality = {
        receivedEventCount: 0,
        sequenceGapCount: 0,
        rejectedSequenceCount: 0,
        lastEventAt: null,
      }
    },

    revision() {
      return currentRevision
    },

    isCollecting() {
      return collecting
    },
  }
}
