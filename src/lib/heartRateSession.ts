export const HEART_RATE_SESSION_MIN_BPM = 40
export const HEART_RATE_SESSION_MAX_BPM = 220
export const HEART_RATE_SESSION_MAX_PARTICIPANTS = 30
export const HEART_RATE_SESSION_MAX_CHECKPOINT_POINTS = 60
export const HEART_RATE_SESSION_MAX_STOP_POINTS = 3_600
export const HEART_RATE_SESSION_MAX_MINUTE_INDEX = 1_440
export const HEART_RATE_SESSION_BUCKET_SECONDS = 60

export const HEART_RATE_AGE_SOURCE = 'school_type_grade_proxy' as const
export const HEART_RATE_AGE_POLICY_VERSION = 'school_grade_age_v1' as const
export const HEART_RATE_ZONE_POLICY_VERSION = 'aha_youth_relative_v1' as const

export type SchoolType = 1 | 2 | 3
export type HeartRateSessionStatus = 'recording' | 'awaiting_decision' | 'completed'
export type HeartRateAgeSource = typeof HEART_RATE_AGE_SOURCE
export type HeartRateZone = 'low' | 'moderate' | 'high' | 'near_max'

export interface HeartRateSessionSummary {
  id: string
  client_request_id: string
  academic_year: number
  grade: number
  class_no: number
  school_type: SchoolType
  age_years: number
  age_source: HeartRateAgeSource
  age_policy_version: typeof HEART_RATE_AGE_POLICY_VERSION
  zone_policy_version: typeof HEART_RATE_ZONE_POLICY_VERSION
  quality_policy_version: 'cl830_stable_5s_5samples_v1'
  stabilization_seconds: 5
  stabilization_min_samples: 5
  stabilization_max_gap_ms: 2_000
  valid_bpm_min: typeof HEART_RATE_SESSION_MIN_BPM
  valid_bpm_max: typeof HEART_RATE_SESSION_MAX_BPM
  bucket_seconds: typeof HEART_RATE_SESSION_BUCKET_SECONDS
  status: HeartRateSessionStatus
  started_at: string
  measurement_started_at: string | null
  stable_started_at: string | null
  gateway_run_id: string | null
  transport_received_event_count: number
  transport_sequence_gap_count: number
  transport_rejected_sequence_count: number
  transport_last_event_at: string | null
  stopped_at: string | null
  finalized_at: string | null
}

export interface HeartRateSessionParticipant {
  participant_id: string
  student_id: string | null
  student_no: number
  name: string
  age_years: number
  age_source: HeartRateAgeSource
  age_policy_version: typeof HEART_RATE_AGE_POLICY_VERSION
  predicted_max_bpm: number
}

export interface HeartRateMinutePoint {
  participant_id: string
  minute_index: number
  revision: number
  duration_ms: number
  bpm_sum: number
  sample_count: number
  min_bpm: number
  max_bpm: number
  is_partial: boolean
  rssi_sample_count?: number
  average_rssi_dbm?: number | null
  min_rssi_dbm?: number | null
  max_rssi_dbm?: number | null
  battery_percent?: number | null
}

export interface HeartRateTransportQuality {
  received_event_count: number
  sequence_gap_count: number
  rejected_sequence_count: number
  last_event_at: string | null
}

export interface BrowserHeartRateTransportQuality {
  receivedEventCount: number
  sequenceGapCount: number
  rejectedSequenceCount: number
  lastEventAt: number | null
}

export interface BrowserHeartRateMinutePoint {
  minuteIndex: number
  revision: number
  bucketStartedAt: number
  bucketEndedAt: number
  bpmSum: number
  sampleCount: number
  minBpm: number
  maxBpm: number
  isPartial: boolean
  quality: {
    rssiSampleCount: number
    averageRssiDbm: number | null
    minRssiDbm: number | null
    maxRssiDbm: number | null
    batteryPercent: number | null
  }
}

export interface StoredHeartRateMinutePoint extends HeartRateMinutePoint {
  avg_bpm: number
  bucket_started_at: string
  bucket_ended_at: string
}

export interface HeartRateSessionResult {
  participant_id: string
  bpm_sum: number
  sample_count: number
  avg_bpm: number
  min_bpm: number
  max_bpm: number
  completed_minute_count: number
  partial_minute_count: number
}

export interface HeartRateSessionPayload {
  session: HeartRateSessionSummary
  participants: HeartRateSessionParticipant[]
  points: StoredHeartRateMinutePoint[]
  results: HeartRateSessionResult[]
}

export interface HeartRateCheckpointResponse {
  session_id: string
  status: 'recording'
  accepted_point_count: number
  checked_at: string
}

export interface HeartRateDiscardResponse {
  session_id: string
  discarded: true
  already_missing: boolean
}

export interface StartHeartRateSessionRequest {
  client_request_id: string
  academic_year: number
  grade: number
  class_no: number
}

export type HeartRateSessionActionRequest =
  | { action: 'stabilize'; gateway_run_id: string; run_started_at: string }
  | { action: 'checkpoint'; points: HeartRateMinutePoint[]; transport_quality: HeartRateTransportQuality }
  | { action: 'stop'; points: HeartRateMinutePoint[]; transport_quality: HeartRateTransportQuality }
  | { action: 'finalize' }

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isIntegerInRange = (value: unknown, min: number, max: number): value is number => (
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= min
  && value <= max
)

const isUuid = (value: unknown): value is string => (
  typeof value === 'string' && UUID_PATTERN.test(value)
)

const isIsoUtcTimestamp = (value: unknown): value is string => (
  typeof value === 'string'
  && ISO_UTC_TIMESTAMP_PATTERN.test(value)
  && Number.isFinite(Date.parse(value))
)

const optionalInteger = (
  value: unknown,
  min: number,
  max: number,
): value is number | null | undefined => (
  value === undefined || value === null || isIntegerInRange(value, min, max)
)

const optionalFiniteNumber = (
  value: unknown,
  min: number,
  max: number,
): value is number | null | undefined => (
  value === undefined
  || value === null
  || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)
)

export function isSchoolType(value: unknown): value is SchoolType {
  return value === 1 || value === 2 || value === 3
}

export function getMaximumGrade(schoolType: SchoolType): number {
  return schoolType === 1 ? 6 : 3
}

/**
 * 학교 종류와 학년만 있는 현재 DB를 위한 나이 추정 정책이다.
 * 생년월일 기반 만 나이가 아니므로 age_source와 policy_version을 항상 함께 저장한다.
 */
export function deriveGradeProxyAge(schoolType: SchoolType, grade: number): number {
  const maximumGrade = getMaximumGrade(schoolType)
  if (!Number.isInteger(grade) || grade < 1 || grade > maximumGrade) {
    throw new RangeError(`학교 유형 ${schoolType}의 학년은 1부터 ${maximumGrade}까지여야 합니다.`)
  }

  if (schoolType === 1) return grade + 6
  if (schoolType === 2) return grade + 12
  return grade + 15
}

export function derivePredictedMaxBpm(ageYears: number): number {
  if (!Number.isInteger(ageYears) || ageYears < 1 || ageYears > 120) {
    throw new RangeError('나이는 1세부터 120세까지의 정수여야 합니다.')
  }
  return Math.round((208 - 0.7 * ageYears) * 10) / 10
}

export function deriveHeartRateZone(bpm: number, predictedMaxBpm: number): HeartRateZone {
  if (!Number.isFinite(bpm) || bpm < HEART_RATE_SESSION_MIN_BPM || bpm > HEART_RATE_SESSION_MAX_BPM) {
    throw new RangeError(`심박수는 ${HEART_RATE_SESSION_MIN_BPM}부터 ${HEART_RATE_SESSION_MAX_BPM} BPM 사이여야 합니다.`)
  }
  if (!Number.isFinite(predictedMaxBpm) || predictedMaxBpm <= 0) {
    throw new RangeError('예측 최대 심박수가 올바르지 않습니다.')
  }

  const ratio = bpm / predictedMaxBpm
  if (ratio < 0.64) return 'low'
  if (ratio < 0.77) return 'moderate'
  if (ratio < 0.96) return 'high'
  return 'near_max'
}

export function serializeHeartRateTransportQuality(
  quality: BrowserHeartRateTransportQuality,
): HeartRateTransportQuality {
  const lastEventAt = quality.lastEventAt === null
    ? null
    : new Date(quality.lastEventAt).toISOString()
  const validation = validateTransportQuality({
    received_event_count: quality.receivedEventCount,
    sequence_gap_count: quality.sequenceGapCount,
    rejected_sequence_count: quality.rejectedSequenceCount,
    last_event_at: lastEventAt,
  })
  if (!validation.ok) throw new RangeError(validation.error)
  return validation.value
}

export function serializeHeartRateMinutePoint(
  participantId: string,
  point: BrowserHeartRateMinutePoint,
): HeartRateMinutePoint {
  const durationMs = Math.round(point.bucketEndedAt - point.bucketStartedAt)
  const validation = validateCheckpointPoint({
    participant_id: participantId,
    minute_index: point.minuteIndex,
    revision: point.revision,
    duration_ms: durationMs,
    bpm_sum: point.bpmSum,
    sample_count: point.sampleCount,
    min_bpm: point.minBpm,
    max_bpm: point.maxBpm,
    is_partial: point.isPartial,
    rssi_sample_count: point.quality.rssiSampleCount,
    average_rssi_dbm: point.quality.averageRssiDbm,
    min_rssi_dbm: point.quality.minRssiDbm,
    max_rssi_dbm: point.quality.maxRssiDbm,
    battery_percent: point.quality.batteryPercent,
  }, 0)
  if (!validation.ok) throw new RangeError(validation.error)
  return validation.value
}

export function validateStartHeartRateSessionRequest(value: unknown): ValidationResult<StartHeartRateSessionRequest> {
  if (!isRecord(value)) return { ok: false, error: '요청 본문은 올바른 객체여야 합니다.' }

  const clientRequestId = value.client_request_id
  const academicYear = value.academic_year
  const grade = value.grade
  const classNo = value.class_no

  if (!isUuid(clientRequestId)) return { ok: false, error: 'client_request_id는 UUID여야 합니다.' }
  if (!isIntegerInRange(academicYear, 2000, 2100)) return { ok: false, error: '학년도는 2000년부터 2100년까지여야 합니다.' }
  if (!isIntegerInRange(grade, 1, 6)) return { ok: false, error: '학년은 1부터 6까지여야 합니다.' }
  if (!isIntegerInRange(classNo, 1, 20)) return { ok: false, error: '반은 1부터 20까지여야 합니다.' }

  return {
    ok: true,
    value: {
      client_request_id: clientRequestId,
      academic_year: academicYear,
      grade,
      class_no: classNo,
    },
  }
}

function validateCheckpointPoint(value: unknown, index: number): ValidationResult<HeartRateMinutePoint> {
  const label = `${index + 1}번째 분 단위 데이터`
  if (!isRecord(value)) return { ok: false, error: `${label}가 올바른 객체가 아닙니다.` }

  const participantId = value.participant_id
  const minuteIndex = value.minute_index
  const revision = value.revision
  const durationMs = value.duration_ms
  const bpmSum = value.bpm_sum
  const sampleCount = value.sample_count
  const minBpm = value.min_bpm
  const maxBpm = value.max_bpm
  const isPartial = value.is_partial

  if (!isUuid(participantId)) return { ok: false, error: `${label}의 측정 참여자 식별자가 올바르지 않습니다.` }
  if (!isIntegerInRange(minuteIndex, 1, HEART_RATE_SESSION_MAX_MINUTE_INDEX)) {
    return { ok: false, error: `${label}의 분 번호가 올바르지 않습니다.` }
  }
  if (!isIntegerInRange(revision, 1, 1_000_000_000)) return { ok: false, error: `${label}의 revision이 올바르지 않습니다.` }
  if (!isIntegerInRange(durationMs, 1, HEART_RATE_SESSION_BUCKET_SECONDS * 1_000)) {
    return { ok: false, error: `${label}의 실제 측정 시간이 올바르지 않습니다.` }
  }
  if (!isIntegerInRange(sampleCount, 1, 10_000)) return { ok: false, error: `${label}의 표본 수가 올바르지 않습니다.` }
  if (!isIntegerInRange(bpmSum, HEART_RATE_SESSION_MIN_BPM, HEART_RATE_SESSION_MAX_BPM * sampleCount)) {
    return { ok: false, error: `${label}의 BPM 합계가 올바르지 않습니다.` }
  }

  if (!isIntegerInRange(minBpm, HEART_RATE_SESSION_MIN_BPM, HEART_RATE_SESSION_MAX_BPM)) {
    return { ok: false, error: `${label}의 최저 BPM이 올바르지 않습니다.` }
  }
  if (!isIntegerInRange(maxBpm, HEART_RATE_SESSION_MIN_BPM, HEART_RATE_SESSION_MAX_BPM)) {
    return { ok: false, error: `${label}의 최고 BPM이 올바르지 않습니다.` }
  }
  if (minBpm > maxBpm) {
    return { ok: false, error: `${label}의 BPM 범위 관계가 올바르지 않습니다.` }
  }
  if (bpmSum < minBpm * sampleCount || bpmSum > maxBpm * sampleCount) {
    return { ok: false, error: `${label}의 BPM 합계가 최저·최고값 및 표본 수와 일치하지 않습니다.` }
  }
  if (typeof isPartial !== 'boolean') return { ok: false, error: `${label}의 부분 구간 여부가 올바르지 않습니다.` }
  if (!isPartial && durationMs !== HEART_RATE_SESSION_BUCKET_SECONDS * 1_000) {
    return { ok: false, error: `${label}의 완성된 1분 측정 시간은 60000ms여야 합니다.` }
  }

  const rssiSampleCount = value.rssi_sample_count
  const averageRssiDbm = value.average_rssi_dbm
  const minimumRssiDbm = value.min_rssi_dbm
  const maximumRssiDbm = value.max_rssi_dbm
  const batteryPercent = value.battery_percent

  if (!optionalInteger(rssiSampleCount, 0, sampleCount)) return { ok: false, error: `${label}의 RSSI 표본 수가 올바르지 않습니다.` }
  if (!optionalFiniteNumber(averageRssiDbm, -127, 20)
    || !optionalInteger(minimumRssiDbm, -127, 20)
    || !optionalInteger(maximumRssiDbm, -127, 20)) {
    return { ok: false, error: `${label}의 RSSI 값이 올바르지 않습니다.` }
  }
  if (!optionalInteger(batteryPercent, 0, 100)) {
    return { ok: false, error: `${label}의 배터리 값이 올바르지 않습니다.` }
  }

  const normalizedRssiSampleCount = rssiSampleCount ?? 0
  const normalizedAverageRssiDbm = averageRssiDbm ?? null
  const normalizedMinimumRssiDbm = minimumRssiDbm ?? null
  const normalizedMaximumRssiDbm = maximumRssiDbm ?? null
  if (normalizedRssiSampleCount === 0) {
    if (normalizedAverageRssiDbm !== null || normalizedMinimumRssiDbm !== null || normalizedMaximumRssiDbm !== null) {
      return { ok: false, error: `${label}의 RSSI 값과 표본 수가 일치하지 않습니다.` }
    }
  } else if (
    normalizedAverageRssiDbm === null
    || normalizedMinimumRssiDbm === null
    || normalizedMaximumRssiDbm === null
    || normalizedMinimumRssiDbm > normalizedAverageRssiDbm
    || normalizedAverageRssiDbm > normalizedMaximumRssiDbm
  ) {
    return { ok: false, error: `${label}의 RSSI 최저·평균·최고값이 올바르지 않습니다.` }
  }

  return {
    ok: true,
    value: {
      participant_id: participantId,
      minute_index: minuteIndex,
      revision,
      duration_ms: durationMs,
      bpm_sum: bpmSum,
      sample_count: sampleCount,
      min_bpm: minBpm,
      max_bpm: maxBpm,
      is_partial: isPartial,
      rssi_sample_count: normalizedRssiSampleCount,
      average_rssi_dbm: normalizedAverageRssiDbm,
      min_rssi_dbm: normalizedMinimumRssiDbm,
      max_rssi_dbm: normalizedMaximumRssiDbm,
      battery_percent: batteryPercent ?? null,
    },
  }
}

function validateTransportQuality(value: unknown): ValidationResult<HeartRateTransportQuality> {
  if (!isRecord(value)) return { ok: false, error: 'USB 전송 품질 정보가 올바른 객체가 아닙니다.' }

  const receivedEventCount = value.received_event_count
  const sequenceGapCount = value.sequence_gap_count
  const rejectedSequenceCount = value.rejected_sequence_count
  const lastEventAt = value.last_event_at

  if (!isIntegerInRange(receivedEventCount, 0, Number.MAX_SAFE_INTEGER)
    || !isIntegerInRange(sequenceGapCount, 0, Number.MAX_SAFE_INTEGER)
    || !isIntegerInRange(rejectedSequenceCount, 0, Number.MAX_SAFE_INTEGER)) {
    return { ok: false, error: 'USB 전송 품질 누적값이 올바르지 않습니다.' }
  }
  if (lastEventAt !== null && !isIsoUtcTimestamp(lastEventAt)) {
    return { ok: false, error: 'USB 마지막 수신 시각이 올바른 ISO 날짜 문자열이 아닙니다.' }
  }
  if ((receivedEventCount === 0 && lastEventAt !== null) || (receivedEventCount > 0 && lastEventAt === null)) {
    return { ok: false, error: 'USB 수신 이벤트 수와 마지막 수신 시각이 일치하지 않습니다.' }
  }

  return {
    ok: true,
    value: {
      received_event_count: receivedEventCount,
      sequence_gap_count: sequenceGapCount,
      rejected_sequence_count: rejectedSequenceCount,
      last_event_at: lastEventAt,
    },
  }
}

export function validateHeartRateSessionAction(value: unknown): ValidationResult<HeartRateSessionActionRequest> {
  if (!isRecord(value) || typeof value.action !== 'string') {
    return { ok: false, error: '측정 세션 동작이 올바르지 않습니다.' }
  }

  if (value.action === 'stabilize') {
    if (typeof value.gateway_run_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.gateway_run_id)) {
      return { ok: false, error: 'USB 수신기 run_id가 올바르지 않습니다.' }
    }
    if (!isIsoUtcTimestamp(value.run_started_at)) {
      return { ok: false, error: 'USB 측정 시작 시각이 올바른 ISO 날짜 문자열이 아닙니다.' }
    }
    return {
      ok: true,
      value: {
        action: 'stabilize',
        gateway_run_id: value.gateway_run_id,
        run_started_at: value.run_started_at,
      },
    }
  }

  if (value.action === 'finalize') {
    return { ok: true, value: { action: 'finalize' } }
  }

  if (value.action !== 'checkpoint' && value.action !== 'stop') {
    return { ok: false, error: '지원하지 않는 측정 세션 동작입니다.' }
  }
  const maximumPointCount = value.action === 'checkpoint'
    ? HEART_RATE_SESSION_MAX_CHECKPOINT_POINTS
    : HEART_RATE_SESSION_MAX_STOP_POINTS
  if (!Array.isArray(value.points)
    || (value.action === 'checkpoint' && value.points.length === 0)
    || value.points.length > maximumPointCount) {
    return {
      ok: false,
      error: value.action === 'checkpoint'
        ? `체크포인트는 1개 이상 ${HEART_RATE_SESSION_MAX_CHECKPOINT_POINTS}개 이하여야 합니다.`
        : `중지 시점 데이터는 ${HEART_RATE_SESSION_MAX_STOP_POINTS}개 이하여야 합니다.`,
    }
  }

  const transportQuality = validateTransportQuality(value.transport_quality)
  if (!transportQuality.ok) return transportQuality

  const points: HeartRateMinutePoint[] = []
  const pointKeys = new Set<string>()
  for (const [index, item] of value.points.entries()) {
    const validated = validateCheckpointPoint(item, index)
    if (!validated.ok) return validated
    const key = `${validated.value.participant_id}:${validated.value.minute_index}`
    if (pointKeys.has(key)) return { ok: false, error: '같은 학생과 분 번호가 체크포인트에 중복되어 있습니다.' }
    pointKeys.add(key)
    points.push(validated.value)
  }

  return {
    ok: true,
    value: {
      action: value.action,
      points,
      transport_quality: transportQuality.value,
    },
  }
}

export function isHeartRateSessionId(value: string): boolean {
  return UUID_PATTERN.test(value)
}
