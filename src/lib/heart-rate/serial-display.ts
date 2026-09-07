import type { HeartRateMeasurementView } from '../heartRateCollector'
import { HEART_RATE_SESSION_MAX_PARTICIPANTS, type HeartRateSessionPayload } from '../heartRateSession'
import { currentHeartRateForSignal, getHeartRateSignalState, type GatewayHeartRateEvent, type HeartRateDeviceMapping } from '../heartRateSerial'
import { advanceSession, createSession, ingestSample, type LiveStudent, type Session, type SessionContext } from './session'

export type SerialDisplaySlot = { no: number; live: LiveStudent | null }
export type SerialDisplaySlotState = 'unregistered' | 'unassigned' | 'waiting' | 'no-signal' | 'live'

export function createSerialDisplaySlots(students: readonly LiveStudent[]): SerialDisplaySlot[] {
  const studentByNumber = new Map(students.map((student) => [student.participant.no, student]))
  return Array.from({ length: HEART_RATE_SESSION_MAX_PARTICIPANTS }, (_, index) => ({
    no: index + 1,
    live: studentByNumber.get(index + 1) ?? null,
  }))
}

export function getSerialDisplaySlotState(live: LiveStudent | null): SerialDisplaySlotState {
  if (live === null) return 'unregistered'
  if (!live.participant.device_id) return 'unassigned'
  if (live.cur !== null) return 'live'
  return live.lastSeenAt === null ? 'waiting' : 'no-signal'
}

export function serialDisplaySlotStateLabel(state: SerialDisplaySlotState) {
  if (state === 'unregistered') return '학생 미등록'
  if (state === 'unassigned') return '기기 미배정'
  if (state === 'waiting') return '수신 대기'
  if (state === 'no-signal') return '신호 없음'
  return '정상 수신'
}

// This cache owns waveform pixels only. Collector and server own saved measurements.
export function createSerialDisplay(payload: HeartRateSessionPayload, mappings: HeartRateDeviceMapping[], context: Omit<SessionContext, 'students'>, startedAt: number) {
  return createSession({ ...context, students: payload.participants.map(participant => ({
    id: participant.student_id ?? '', no: participant.student_no, name: participant.name,
    age: participant.age_years, estimatedAge: true,
    device_id: mappings.find(mapping => mapping.student_no === participant.student_no)?.device_id ?? '',
  })) }, startedAt)
}

export function appendAcceptedSample(display: Session, studentNumber: number, event: GatewayHeartRateEvent, receivedAt: number, accepted: boolean) {
  if (!accepted) return false
  const participant = display.students.find(student => student.participant.no === studentNumber)?.participant
  return participant ? ingestSample(display, participant.device_id, event.bpm, receivedAt, 'ANT', event.battery_percent) : false
}

export function syncSerialDisplay(display: Session, view: HeartRateMeasurementView, now: number) {
  advanceSession(display, now)
  for (const student of display.students) {
    const stats = view.statsByStudentNumber[student.participant.no]
    const phase = view.sensorStatesByStudentNumber[student.participant.no]
    student.cur = stats && phase === 'live' ? currentHeartRateForSignal(stats, getHeartRateSignalState(stats, now)) : null
    student.battery = stats?.batteryPercent ?? null
    if (student.cur === null) student.maximumSince = null
    if (stats) {
      student.agg.min = stats.minBpm
      student.agg.max = stats.maxBpm
      student.agg.sum = stats.totalBpm
      student.agg.n = stats.sampleCount
    }
  }
}
