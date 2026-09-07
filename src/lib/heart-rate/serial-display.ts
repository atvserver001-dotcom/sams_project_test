import type { HeartRateMeasurementView } from '../heartRateCollector'
import type { HeartRateSessionPayload } from '../heartRateSession'
import { currentHeartRateForSignal, getHeartRateSignalState, type GatewayHeartRateEvent, type HeartRateDeviceMapping } from '../heartRateSerial'
import { advanceSession, createSession, ingestSample, type Session, type SessionContext } from './session'

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
