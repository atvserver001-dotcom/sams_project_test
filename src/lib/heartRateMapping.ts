export interface ValidatedHeartRateMapping {
  student_no: number
  device_id: string
}

export type HeartRateMappingValidationResult =
  | { ok: true; mappings: ValidatedHeartRateMapping[] }
  | { ok: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const HEART_RATE_DEVICE_ID_PATTERN = /^\d{7}$/

export function isCanonicalHeartRateDeviceId(value: string) {
  return HEART_RATE_DEVICE_ID_PATTERN.test(value)
}

export function validateHeartRateMappings(value: unknown): HeartRateMappingValidationResult {
  if (!Array.isArray(value)) {
    return { ok: false, error: '매핑 목록은 배열이어야 합니다.' }
  }

  const mappings: ValidatedHeartRateMapping[] = []
  const studentNumbers = new Set<number>()
  const deviceIds = new Set<string>()

  for (const item of value) {
    if (!isRecord(item)) {
      return { ok: false, error: '각 매핑 항목은 올바른 객체여야 합니다.' }
    }

    const studentNo = item.student_no
    const deviceId = item.device_id

    if (typeof studentNo !== 'number' || !Number.isInteger(studentNo) || studentNo < 1 || studentNo > 30) {
      return { ok: false, error: '측정 슬롯 번호는 1부터 30까지의 정수여야 합니다.' }
    }

    if (studentNumbers.has(studentNo)) {
      return { ok: false, error: `${studentNo}번 측정 슬롯이 중복되어 있습니다.` }
    }

    if (typeof deviceId !== 'string') {
      return { ok: false, error: `${studentNo}번 측정 슬롯에 배정된 심박계 ID는 문자열이어야 합니다.` }
    }

    if (deviceId !== '' && !isCanonicalHeartRateDeviceId(deviceId)) {
      return { ok: false, error: `${studentNo}번 측정 슬롯에 배정된 심박계 ID는 정확히 7자리 숫자여야 합니다.` }
    }

    if (deviceId !== '' && deviceIds.has(deviceId)) {
      return { ok: false, error: `심박계 ID ${deviceId}가 여러 측정 슬롯에 중복 배정되어 있습니다.` }
    }

    studentNumbers.add(studentNo)
    if (deviceId !== '') deviceIds.add(deviceId)
    mappings.push({ student_no: studentNo, device_id: deviceId })
  }

  return { ok: true, mappings }
}

export function validateHeartRateMappingSnapshot(value: unknown): HeartRateMappingValidationResult {
  const validation = validateHeartRateMappings(value)
  if (!validation.ok) return validation

  if (validation.mappings.length !== 30) {
    return { ok: false, error: 'Heart Fit 설정은 1번부터 30번까지 전체 측정 슬롯을 포함해야 합니다.' }
  }

  const numbers = new Set(validation.mappings.map((mapping) => mapping.student_no))
  for (let studentNo = 1; studentNo <= 30; studentNo += 1) {
    if (!numbers.has(studentNo)) {
      return { ok: false, error: `${studentNo}번 측정 슬롯이 누락되었습니다.` }
    }
  }

  return validation
}
