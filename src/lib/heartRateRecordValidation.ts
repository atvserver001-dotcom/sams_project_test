// ESP32 gateway/serial parser가 허용하는 원시 BPM 계약과 동일하게 유지한다.
export const HEART_RATE_MIN_BPM = 1
export const HEART_RATE_MAX_BPM = 255
export const HEART_RATE_MIN_YEAR = 2000
export const HEART_RATE_MAX_YEAR = 2100
export const HEART_RATE_MAX_RESULTS = 30
export const HEART_RATE_MAX_STORED_RECORD_COUNT = 1_000_000

export interface ValidatedHeartRateResult {
  student_id: string
  student_no: number
  year: number
  month: number
  avg_bpm: number
  max_bpm: number
  min_bpm: number
  record_count: 1
}

export interface ValidatedHeartRateRecordRequest {
  year: number
  grade: number
  class_no: number
  results: ValidatedHeartRateResult[]
}

export type HeartRateRecordValidationResult =
  | { ok: true; value: ValidatedHeartRateRecordRequest }
  | { ok: false; error: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isIntegerInRange = (value: unknown, min: number, max: number): value is number => (
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= min
  && value <= max
)

const isBpm = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= HEART_RATE_MIN_BPM
  && value <= HEART_RATE_MAX_BPM
)

export function validateHeartRateRecordRequest(value: unknown): HeartRateRecordValidationResult {
  if (!isRecord(value)) {
    return { ok: false, error: '요청 본문은 올바른 객체여야 합니다.' }
  }

  const { year, grade, class_no: classNo, results } = value
  if (!isIntegerInRange(year, HEART_RATE_MIN_YEAR, HEART_RATE_MAX_YEAR)) {
    return { ok: false, error: `학년도는 ${HEART_RATE_MIN_YEAR}년부터 ${HEART_RATE_MAX_YEAR}년까지의 정수여야 합니다.` }
  }
  if (!isIntegerInRange(grade, 1, 6)) {
    return { ok: false, error: '학년은 1부터 6까지의 정수여야 합니다.' }
  }
  if (!isIntegerInRange(classNo, 1, 10)) {
    return { ok: false, error: '반은 1부터 10까지의 정수여야 합니다.' }
  }
  if (!Array.isArray(results) || results.length === 0 || results.length > HEART_RATE_MAX_RESULTS) {
    return { ok: false, error: `측정 결과는 1개 이상 ${HEART_RATE_MAX_RESULTS}개 이하여야 합니다.` }
  }

  const validatedResults: ValidatedHeartRateResult[] = []
  const studentIds = new Set<string>()
  const studentNumbers = new Set<number>()

  for (const [index, item] of results.entries()) {
    const label = `${index + 1}번째 측정 결과`
    if (!isRecord(item)) {
      return { ok: false, error: `${label}가 올바른 객체가 아닙니다.` }
    }

    const studentId = item.student_id
    const studentNo = item.student_no
    const resultYear = item.year
    const month = item.month
    const averageBpm = item.avg_bpm
    const maximumBpm = item.max_bpm
    const minimumBpm = item.min_bpm
    const recordCount = item.record_count

    if (typeof studentId !== 'string' || studentId.length !== 36 || !UUID_PATTERN.test(studentId)) {
      return { ok: false, error: `${label}의 학생 식별자가 올바르지 않습니다.` }
    }
    if (!isIntegerInRange(studentNo, 1, 30)) {
      return { ok: false, error: `${label}의 학생 번호는 1부터 30까지의 정수여야 합니다.` }
    }
    if (!isIntegerInRange(resultYear, HEART_RATE_MIN_YEAR, HEART_RATE_MAX_YEAR + 1)) {
      return { ok: false, error: `${label}의 측정 연도가 올바르지 않습니다.` }
    }
    if (!isIntegerInRange(month, 1, 12)) {
      return { ok: false, error: `${label}의 측정 월은 1부터 12까지의 정수여야 합니다.` }
    }

    const expectedCalendarYear = month <= 2 ? year + 1 : year
    if (resultYear !== expectedCalendarYear) {
      return { ok: false, error: `${label}의 측정 연도와 학년도가 일치하지 않습니다.` }
    }
    if (!isBpm(averageBpm) || !isBpm(maximumBpm) || !isBpm(minimumBpm)) {
      return {
        ok: false,
        error: `${label}의 심박수는 ${HEART_RATE_MIN_BPM}부터 ${HEART_RATE_MAX_BPM} BPM 사이의 유한한 숫자여야 합니다.`,
      }
    }
    if (
      !Number.isInteger(maximumBpm)
      || !Number.isInteger(minimumBpm)
      || Math.abs(averageBpm * 10 - Math.round(averageBpm * 10)) > 1e-9
    ) {
      return { ok: false, error: `${label}의 최고·최저 심박수는 정수, 평균 심박수는 소수점 첫째 자리 이하여야 합니다.` }
    }
    if (minimumBpm > averageBpm || averageBpm > maximumBpm) {
      return { ok: false, error: `${label}의 최저·평균·최고 심박수 순서가 올바르지 않습니다.` }
    }
    if (recordCount !== 1) {
      return { ok: false, error: `${label}의 측정 횟수는 1이어야 합니다.` }
    }
    if (studentIds.has(studentId) || studentNumbers.has(studentNo)) {
      return { ok: false, error: '같은 학생 식별자 또는 학생 번호가 측정 결과에 중복되어 있습니다.' }
    }

    studentIds.add(studentId)
    studentNumbers.add(studentNo)
    validatedResults.push({
      student_id: studentId,
      student_no: studentNo,
      year: resultYear,
      month,
      avg_bpm: averageBpm,
      max_bpm: maximumBpm,
      min_bpm: minimumBpm,
      record_count: 1,
    })
  }

  return {
    ok: true,
    value: {
      year,
      grade,
      class_no: classNo,
      results: validatedResults,
    },
  }
}
